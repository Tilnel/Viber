/**
 * Volcano Engine ASR Service Implementation
 * 火山引擎语音识别服务实现
 * 
 * @phase 1
 * @implements {ASRService}
 */

import WebSocket from 'ws';
import crypto from 'crypto';
import { EventEmitter } from 'events';
import {
  ASRService,
  ASRSession,
  ASREvent,
  ASREventType,
  AudioFormat,
  DefaultASRConfig,
  UtteranceInfo,
  ServiceStatus,
  ASRServiceFactory
} from './types.js';

/**
 * 火山引擎 ASR 服务
 */
export class VolcanoASRService extends ASRService {
  constructor(config = {}) {
    super();
    
    this.config = {
      appId: process.env.VOLCANO_APP_ID,
      token: process.env.VOLCANO_ACCESS_TOKEN,
      cluster: process.env.VOLCANO_CLUSTER || 'volcengine_streaming_common',
      wsUrl: 'wss://openspeech.bytedance.com/api/v2/asr',
      ...DefaultASRConfig,
      ...config
    };
    
    if (!this.config.appId || !this.config.token) {
      throw new Error('Volcano ASR: Missing VOLCANO_APP_ID or VOLCANO_ACCESS_TOKEN');
    }
    
    this.sessions = new Map();
    this.status = new ServiceStatus();
    
    console.log('[VolcanoASRService] Initialized with cluster:', this.config.cluster);
  }
  
  /**
   * 创建识别会话
   */
  async createSession(sessionId, config = {}) {
    const session = new VolcanoASRSession(sessionId, {
      ...this.config,
      ...config
    });
    
    this.sessions.set(sessionId, session);
    
    // 连接火山引擎
    await session.connect();
    
    console.log(`[VolcanoASRService] Session created: ${sessionId}`);
    return session;
  }
  
  /**
   * 关闭识别会话
   */
  async closeSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      await session.terminate();
      this.sessions.delete(sessionId);
      console.log(`[VolcanoASRService] Session closed: ${sessionId}`);
    }
  }
  
  /**
   * 获取支持的语言
   */
  async getSupportedLanguages() {
    return [
      { code: 'zh-CN', name: '中文普通话' },
      { code: 'en-US', name: '英语' },
      { code: 'ja-JP', name: '日语' },
      { code: 'ko-KR', name: '韩语' }
    ];
  }
  
  /**
   * 获取服务状态
   */
  async getStatus() {
    this.status.activeSessions = this.sessions.size;
    this.status.lastChecked = new Date();
    
    // 简单健康检查
    try {
      const ws = new WebSocket(this.config.wsUrl, {
        headers: { 'Authorization': `Bearer;${this.config.token}` },
        timeout: 5000
      });
      
      await new Promise((resolve, reject) => {
        ws.on('open', () => {
          this.status.online = true;
          ws.close();
          resolve();
        });
        ws.on('error', (err) => {
          this.status.online = false;
          reject(err);
        });
      });
    } catch (err) {
      this.status.online = false;
    }
    
    return this.status;
  }
}

/**
 * 火山引擎 ASR 会话
 */
export class VolcanoASRSession extends ASRSession {
  constructor(sessionId, config) {
    super(sessionId, config);
    
    this.ws = null;
    this.sequence = 1;
    this.responseBuffer = Buffer.alloc(0);
    this.emitter = new EventEmitter();
    
    // 事件处理
    this._setupEventHandlers();
  }
  
  /**
   * 连接火山引擎 WebSocket
   */
  async connect() {
    return new Promise((resolve, reject) => {
      const { wsUrl, token } = this.config;
      
      this.ws = new WebSocket(wsUrl, {
        headers: { 'Authorization': `Bearer;${token}` }
      });
      
      this.ws.on('open', () => {
        console.log(`[VolcanoASRSession:${this.sessionId}] WebSocket connected`);
        
        // 发送全量客户端请求
        const fullRequest = this._buildFullClientRequest();
        this.ws.send(fullRequest);
        
        this.state = 'listening';
        this._emitEvent(ASREventType.STARTED, {});
        
        resolve();
      });
      
      this.ws.on('message', (data) => {
        this._handleMessage(data);
      });
      
      this.ws.on('error', (err) => {
        console.error(`[VolcanoASRSession:${this.sessionId}] WebSocket error:`, err.message);
        this._emitEvent(ASREventType.ERROR, {
          errorCode: 500,
          errorMessage: err.message
        });
        reject(err);
      });
      
      this.ws.on('close', () => {
        console.log(`[VolcanoASRSession:${this.sessionId}] WebSocket closed`);
        if (this.state !== 'ended') {
          this.state = 'ended';
          this._emitEvent(ASREventType.ENDED, {});
        }
      });
      
      // 连接超时
      setTimeout(() => {
        if (this.state === 'idle') {
          reject(new Error('Connection timeout'));
        }
      }, this.config.timeout?.connect || 5000);
    });
  }
  
  /**
   * 发送音频数据
   */
  async sendAudio(audioData) {
    if (this.state !== 'listening') {
      throw new Error(`Session not listening, current state: ${this.state}`);
    }
    
    // 验证音频格式
    const validation = AudioFormat.validate(audioData);
    if (!validation.valid) {
      throw new Error(`Invalid audio format: ${validation.error}`);
    }
    
    // 构建音频请求
    const audioRequest = this._buildAudioRequest(audioData);
    
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(audioRequest);
      this.lastActivityAt = Date.now();
      this.sequence++;
    } else {
      throw new Error('WebSocket not connected');
    }
  }
  
  /**
   * 结束音频输入，请求最终结果
   */
  async finalize() {
    if (this.state !== 'listening') return;
    
    this.state = 'processing';
    
    // 发送结束标记（负序列号）
    const endRequest = this._buildAudioRequest(Buffer.alloc(0), true);
    
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(endRequest);
      console.log(`[VolcanoASRSession:${this.sessionId}] Sent finalize marker`);
    }
  }
  
  /**
   * 强制结束会话
   */
  async terminate() {
    this.state = 'ended';
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    this.emitter.removeAllListeners();
  }
  
  /**
   * 注册事件回调
   */
  on(event, callback) {
    this.emitter.on(event, callback);
  }
  
  /**
   * 移除事件回调
   */
  off(event, callback) {
    this.emitter.off(event, callback);
  }
  
  /**
   * 设置内部事件处理
   */
  _setupEventHandlers() {
    // 内部处理，可扩展
  }
  
  /**
   * 触发事件
   */
  _emitEvent(type, data) {
    const event = new ASREvent(type, {
      ...data,
      sessionId: this.sessionId
    });
    this.emitter.emit(type, event);
    this.emitter.emit('*', event); // 通配符事件
  }
  
  /**
   * 处理服务器消息
   */
  _handleMessage(data) {
    if (!Buffer.isBuffer(data)) return;
    
    this.responseBuffer = Buffer.concat([this.responseBuffer, data]);
    
    while (this.responseBuffer.length >= 8) {
      const parsed = this._parseResponse(this.responseBuffer);
      
      if (parsed.partial) break;
      
      if (parsed.error) {
        this._emitEvent(ASREventType.ERROR, {
          errorCode: parsed.errorCode,
          errorMessage: 'Failed to parse response'
        });
        this.responseBuffer = parsed.remaining || Buffer.alloc(0);
        continue;
      }
      
      const result = parsed.result;
      this.responseBuffer = parsed.remaining || Buffer.alloc(0);
      
      // 处理识别结果
      this._processResult(result);
    }
  }
  
  /**
   * 处理识别结果
   */
  _processResult(result) {
    if (result.code !== 1000) {
      this._emitEvent(ASREventType.ERROR, {
        errorCode: result.code,
        errorMessage: result.message
      });
      return;
    }
    
    if (!result.result || result.result.length === 0) return;
    
    const utterances = result.result[0]?.utterances || [];
    const last = utterances[utterances.length - 1];
    
    if (!last || !last.text) return;
    
    // 判断是中间结果还是最终结果
    const isFinal = last.definite === true;
    const eventType = isFinal ? ASREventType.FINAL : ASREventType.INTERIM;
    
    this._emitEvent(eventType, {
      text: last.text,
      confidence: last.confidence || 0,
      utterances: utterances.map(u => new UtteranceInfo(u)),
      duration: last.end_time
    });
    
    // 如果是最终结果且是负数 sequence，表示会话结束
    if (isFinal && result.sequence < 0) {
      this.state = 'ended';
      this._emitEvent(ASREventType.ENDED, {});
    }
  }
  
  /**
   * 构建全量客户端请求（初始化）
   */
  _buildFullClientRequest() {
    const reqid = crypto.randomUUID().replace(/-/g, '');
    
    const payload = JSON.stringify({
      app: {
        appid: this.config.appId,
        token: this.config.token,
        cluster: this.config.cluster
      },
      user: {
        uid: `user_${Date.now()}`
      },
      audio: {
        format: 'raw',
        rate: AudioFormat.SAMPLE_RATE,
        bits: AudioFormat.BITS,
        channel: AudioFormat.CHANNELS,
        language: this.config.language
      },
      request: {
        reqid,
        sequence: 1,
        show_utterances: this.config.engineConfig?.showUtterances ?? true,
        result_type: 'single',
        enable_itn: this.config.engineConfig?.enableITN ?? true,
        enable_punctuation: this.config.engineConfig?.enablePunctuation ?? true
      }
    });
    
    const payloadBuf = Buffer.from(payload, 'utf8');
    
    // Header: version(1) + msgType(1) + serialization(1) + reserved(1)
    const header = Buffer.alloc(4);
    header.writeUInt8(0x11, 0);  // version=1, headerSize=1
    header.writeUInt8((0x1 << 4) | 0x0, 1);  // msgType=1 (full client request), flags=0
    header.writeUInt8((0x1 << 4) | 0x0, 2);  // serialization=1 (JSON), compression=0
    header.writeUInt8(0x00, 3);  // reserved
    
    // Length (big-endian)
    const lengthBuf = Buffer.alloc(4);
    lengthBuf.writeUInt32BE(payloadBuf.length, 0);
    
    return Buffer.concat([header, lengthBuf, payloadBuf]);
  }
  
  /**
   * 构建音频数据请求
   */
  _buildAudioRequest(audioData, isLast = false) {
    const header = Buffer.alloc(4);
    header.writeUInt8(0x11, 0);  // version=1, headerSize=1
    
    // msgType=2 (audio), flags=0x0 (正常) 或 0x2 (最后一包)
    const flags = isLast ? 0x2 : 0x0;
    header.writeUInt8((0x2 << 4) | flags, 1);
    header.writeUInt8(0x00, 2);  // serialization=0 (raw), compression=0
    header.writeUInt8(0x00, 3);  // reserved
    
    // Sequence
    const seqBuf = Buffer.alloc(4);
    const seq = isLast ? -this.sequence : this.sequence;
    seqBuf.writeInt32BE(seq, 0);
    
    // Payload = sequence + audio data
    const payload = Buffer.concat([seqBuf, audioData]);
    
    // Length
    const lengthBuf = Buffer.alloc(4);
    lengthBuf.writeUInt32BE(payload.length, 0);
    
    return Buffer.concat([header, lengthBuf, payload]);
  }
  
  /**
   * 解析服务器响应
   */
  _parseResponse(buffer) {
    if (buffer.length < 8) {
      return { partial: true };
    }
    
    const msgType = (buffer[1] >> 4) & 0x0F;
    
    // Error message (type=15) has different format
    if (msgType === 0xF) {
      if (buffer.length < 12) return { partial: true };
      
      const errorCode = buffer.readUInt32BE(4);
      const errorMsgSize = buffer.readUInt32BE(8);
      const totalLen = 12 + errorMsgSize;
      
      if (buffer.length < totalLen) return { partial: true };
      
      const errorMsg = buffer.slice(12, totalLen).toString('utf8');
      const remaining = buffer.slice(totalLen);
      
      return { error: true, errorCode, errorMsg, remaining };
    }
    
    // Normal response
    const payloadLen = buffer.readUInt32BE(4);
    const totalLen = 8 + payloadLen;
    
    if (buffer.length < totalLen) {
      return { partial: true };
    }
    
    const payload = buffer.slice(8, totalLen);
    const remaining = buffer.slice(totalLen);
    
    try {
      const result = JSON.parse(payload.toString('utf8'));
      return { result, remaining };
    } catch (e) {
      return { error: true, remaining };
    }
  }
}

// 注册到工厂
ASRServiceFactory.register('volcano', VolcanoASRService);

export default VolcanoASRService;
