/**
 * Volcano Engine TTS Service Implementation
 * 火山引擎语音合成服务实现
 * 
 * @phase 1
 * @implements {TTSService}
 */

import WebSocket from 'ws';
import FormData from 'form-data';
import fetch from 'node-fetch';
import crypto from 'crypto';
import {
  TTSService,
  TTSTask,
  TTSResult,
  VoiceInfo,
  ServiceStatus,
  TTSEventType,
  AudioOutputFormat,
  DefaultTTSConfig,
  TTSServiceFactory
} from './types.js';

/**
 * 火山引擎 TTS 服务
 * 支持两种模式：
 1. 长文本合成 API（HTTP，异步）
 2. 流式合成 WebSocket（WebSocket，实时）
 * 
 * 当前实现使用 HTTP API，WebSocket 流式待后续优化
 */
export class VolcanoTTSService extends TTSService {
  constructor(config = {}) {
    super(config);
    
    this.name = 'volcano';
    this.config = {
      appId: process.env.VOLCANO_APP_ID,
      accessKey: process.env.VOLCANO_ACCESS_KEY,
      secretKey: process.env.VOLCANO_SECRET_KEY,
      cluster: process.env.VOLCANO_CLUSTER || 'volcengine_streaming_common',
      apiUrl: 'https://openspeech.bytedance.com/api/v1/tts',
      wsUrl: 'wss://openspeech.bytedance.com/api/v1/tts/ws',
      ...this.config
    };
    
    if (!this.config.appId || !this.config.accessKey || !this.config.secretKey) {
      console.warn('[VolcanoTTSService] Missing credentials, service will be unavailable');
    }
    
    this.activeTasks = new Map();
    this.status = new ServiceStatus();
    
    console.log('[VolcanoTTSService] Initialized');
  }
  
  /**
   * 合成语音（异步完整音频）
   */
  async synthesize(text, options = {}) {
    const task = new TTSTask(text, { ...this.config, ...options });
    this.activeTasks.set(task.id, task);
    
    task.state = 'synthesizing';
    task.startedAt = Date.now();
    task.emit(TTSEventType.STARTED);
    
    try {
      const result = await this._synthesizeHTTP(task);
      
      task.state = 'completed';
      task.completedAt = Date.now();
      task.audioData = result.audioData;
      task.audioDuration = result.duration;
      task.emit(TTSEventType.COMPLETED);
      
      this.activeTasks.delete(task.id);
      return result;
    } catch (error) {
      task.state = 'error';
      task.error = error.message;
      task.emit(TTSEventType.ERROR, { error: error.message });
      
      this.activeTasks.delete(task.id);
      throw error;
    }
  }
  
  /**
   * 流式合成
   * 当前使用 HTTP 轮询模拟，后续应改为 WebSocket 流式
   */
  async synthesizeStream(text, options = {}) {
    // TODO: 实现 WebSocket 流式合成
    // 当前先返回完整音频的 ReadableStream
    const result = await this.synthesize(text, options);
    
    // 将 Buffer 转为 ReadableStream
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(result.audioData);
        controller.close();
      }
    });
    
    return stream;
  }
  
  /**
   * 取消指定任务
   */
  async cancel(taskId) {
    const task = this.activeTasks.get(taskId);
    if (task) {
      task.state = 'cancelled';
      task.emit(TTSEventType.CANCELLED);
      this.activeTasks.delete(taskId);
      return true;
    }
    return false;
  }
  
  /**
   * 取消所有任务
   */
  async cancelAll() {
    for (const [id, task] of this.activeTasks) {
      task.state = 'cancelled';
      task.emit(TTSEventType.CANCELLED);
    }
    this.activeTasks.clear();
  }
  
  /**
   * 获取支持的音色
   */
  async getVoices() {
    // 火山引擎常用音色
    return [
      new VoiceInfo({
        id: 'BV001_streaming',
        name: '通用女声',
        language: 'zh-CN',
        gender: 'female',
        engine: 'volcano',
        styles: ['general'],
        previewText: '你好，我是火山引擎语音合成。'
      }),
      new VoiceInfo({
        id: 'BV002_streaming',
        name: '通用男声',
        language: 'zh-CN',
        gender: 'male',
        engine: 'volcano',
        styles: ['general'],
        previewText: '你好，我是火山引擎语音合成。'
      }),
      new VoiceInfo({
        id: 'BV074_streaming',
        name: '少女声',
        language: 'zh-CN',
        gender: 'female',
        engine: 'volcano',
        styles: ['cheerful'],
        previewText: '嗨，今天天气真好呀！'
      }),
      new VoiceInfo({
        id: '_Sichuanese',
        name: '四川话女声',
        language: 'zh-SC',
        gender: 'female',
        engine: 'volcano',
        styles: ['dialect'],
        previewText: '你好，我说四川话。'
      }),
      new VoiceInfo({
        id: '_Dongbei',
        name: '东北话男声',
        language: 'zh-DB',
        gender: 'male',
        engine: 'volcano',
        styles: ['dialect'],
        previewText: '你好，我说东北话。'
      })
    ];
  }
  
  /**
   * 获取服务状态
   */
  async getStatus() {
    this.status.activeTasks = this.activeTasks.size;
    this.status.lastChecked = new Date();
    
    // 简单健康检查
    if (!this.config.appId) {
      this.status.online = false;
      return this.status;
    }
    
    // 尝试一次简单的请求
    try {
      const response = await fetch(this.config.apiUrl, {
        method: 'HEAD',
        timeout: 5000
      });
      this.status.online = response.status < 500;
    } catch (err) {
      this.status.online = false;
    }
    
    return this.status;
  }
  
  /**
   * HTTP 合成实现
   */
  async _synthesizeHTTP(task) {
    const { text, options } = task;
    
    // 构建请求体
    const requestJson = {
      app: {
        appid: this.config.appId,
        token: this.config.accessKey,
        cluster: this.config.cluster
      },
      user: {
        uid: `user_${Date.now()}`
      },
      audio: {
        voice_type: options.voiceId || this.config.voiceId,
        encoding: options.outputFormat || this.config.outputFormat,
        speed_ratio: options.speed || this.config.speed,
        volume_ratio: (options.volume || this.config.volume) / 100,
        pitch_ratio: options.pitch || this.config.pitch
      },
      request: {
        reqid: crypto.randomUUID().replace(/-/g, ''),
        text,
        operation: 'submit',
        // 使用异步回调或轮询
        with_frontend: 1,
        frontend_type: 'unitTson'
      }
    };
    
    const headers = this._buildHeaders(requestJson);
    
    const response = await fetch(this.config.apiUrl, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestJson)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`TTS request failed: ${response.status} ${errorText}`);
    }
    
    const result = await response.json();
    
    if (result.code !== 3000) {
      throw new Error(`TTS error: ${result.code} ${result.message}`);
    }
    
    // 异步获取结果（轮询）
    const audioData = await this._pollResult(result.data.task_id, requestJson.request.reqid);
    
    return new TTSResult({
      taskId: task.id,
      text,
      audioData,
      format: options.outputFormat || this.config.outputFormat,
      duration: this._estimateDuration(text, options.speed),
      voiceId: options.voiceId || this.config.voiceId,
      latency: Date.now() - task.startedAt
    });
  }
  
  /**
   * 轮询获取合成结果
   */
  async _pollResult(taskId, reqid) {
    const maxRetries = 30;
    const interval = 500; // ms
    
    for (let i = 0; i < maxRetries; i++) {
      await new Promise(resolve => setTimeout(resolve, interval));
      
      // 查询状态
      const queryRequest = {
        app: {
          appid: this.config.appId,
          token: this.config.accessKey,
          cluster: this.config.cluster
        },
        user: { uid: `user_${Date.now()}` },
        request: {
          reqid,
          task_id: taskId,
          operation: 'query'
        }
      };
      
      const headers = this._buildHeaders(queryRequest);
      
      const response = await fetch(this.config.apiUrl, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(queryRequest)
      });
      
      if (!response.ok) continue;
      
      const result = await response.json();
      
      if (result.code === 3000 && result.data && result.data.audio) {
        // 解码 Base64 音频
        return Buffer.from(result.data.audio, 'base64');
      }
      
      if (result.message && result.message.includes('processing')) {
        continue; // 还在处理中
      }
      
      // 其他错误
      throw new Error(`TTS polling error: ${result.message}`);
    }
    
    throw new Error('TTS polling timeout');
  }
  
  /**
   * 构建请求头（签名）
   */
  _buildHeaders(requestJson) {
    const { accessKey, secretKey } = this.config;
    
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = crypto.randomUUID().replace(/-/g, '');
    
    // 构建签名串
    const signStr = `${accessKey}${timestamp}${nonce}${JSON.stringify(requestJson)}`;
    const signature = crypto
      .createHmac('sha256', secretKey)
      .update(signStr)
      .digest('hex');
    
    return {
      'X-Api-Access-Key': accessKey,
      'X-Api-Timestamp': timestamp,
      'X-Api-Nonce': nonce,
      'X-Api-Signature': signature
    };
  }
  
  /**
   * 估算音频时长
   */
  _estimateDuration(text, speed) {
    // 中文：每秒约 5-6 个字
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const otherChars = text.length - chineseChars;
    
    // 中文字符 0.2s/字，其他字符 0.1s/字符，除以语速
    const duration = (chineseChars * 0.2 + otherChars * 0.1) / (speed || 1);
    
    return Math.max(1, duration);
  }
}

// 注册到工厂
TTSServiceFactory.register('volcano', VolcanoTTSService);

export default VolcanoTTSService;
