/**
 * Refactored Listener Service
 * 重构后的监听服务 - 只负责音频输入，使用 SpeechDetector 进行 VAD
 * 
 * @phase 3
 * @module services/listener
 */

import { EventEmitter } from 'events';
import { ASRServiceFactory } from '../asr/index.js';

/**
 * Listener 状态
 */
export const ListenerState = {
  IDLE: 'idle',           // 空闲
  LISTENING: 'listening', // 监听中（有声音输入）
  PROCESSING: 'processing' // 处理中（ASR 识别）
};

/**
 * 重构后的 Listener 服务
 * 职责：
 * 1. 接收前端音频数据
 * 2. 使用 SpeechDetector 检测语音
 * 3. 管理 ASR 会话
 * 4. 输出识别结果
 */
export class RefactoredListener extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      sampleRate: 16000,
      channels: 1,
      sampleWidth: 2,
      frameDuration: 30,      // 每帧时长（ms）
      ...config
    };
    
    // 状态
    this.state = ListenerState.IDLE;
    
    // SpeechDetector（由外部注入）
    this.speechDetector = null;
    
    // ASR 服务
    this.asrService = null;
    this.asrSession = null;
    
    // 音频上下文（用于检测器）
    this.audioContext = null;
    
    // 音频缓冲区
    this.audioBuffer = [];
    this.maxBufferSize = 50; // 最大缓存帧数
    
    // 统计
    this.stats = {
      totalFrames: 0,
      speechFrames: 0,
      silenceFrames: 0,
      sessionsCreated: 0,
      sessionsClosed: 0
    };
    
    console.log('[RefactoredListener] Initialized');
  }
  
  /**
   * 设置 SpeechDetector
   * @param {SpeechDetector} detector 
   */
  setSpeechDetector(detector) {
    this.speechDetector = detector;
    console.log(`[RefactoredListener] SpeechDetector set: ${detector.getName()}`);
  }
  
  /**
   * 设置 ASR 服务
   * @param {ASRService} asrService 
   */
  setASRService(asrService) {
    this.asrService = asrService;
    console.log('[RefactoredListener] ASR service set');
  }
  
  /**
   * 开始监听
   */
  async start() {
    if (this.state !== ListenerState.IDLE) {
      console.log('[RefactoredListener] Already listening');
      return;
    }
    
    console.log('[RefactoredListener] Starting...');
    
    // 重置状态
    this.state = ListenerState.LISTENING;
    this.audioBuffer = [];
    this.audioContext = null;
    
    // 重置检测器
    if (this.speechDetector) {
      this.speechDetector.reset();
    }
    
    this.emit('started');
  }
  
  /**
   * 停止监听
   */
  async stop() {
    console.log('[RefactoredListener] Stopping...');
    
    // 关闭 ASR 会话
    await this._closeASRSession();
    
    this.state = ListenerState.IDLE;
    this.audioBuffer = [];
    
    this.emit('stopped');
  }
  
  /**
   * 接收音频数据
   * @param {Buffer|Uint8Array} audioData - PCM 音频数据
   */
  async processAudio(audioData) {
    if (this.state === ListenerState.IDLE) {
      console.log('[RefactoredListener] Not listening, ignoring audio');
      return;
    }
    
    this.stats.totalFrames++;
    
    // 创建音频上下文（首次）
    if (!this.audioContext) {
      this.audioContext = {
        sampleRate: this.config.sampleRate,
        channels: this.config.channels,
        samples: [],
        volume: 0,
        vadScore: 0,
        isVoice: false,
        speechDuration: 0,
        silenceDuration: 0,
        timestamp: Date.now()
      };
    }
    
    // 转换为 Buffer
    const buffer = Buffer.isBuffer(audioData) 
      ? audioData 
      : Buffer.from(audioData);
    
    // 计算音量
    const volume = this._calculateVolume(buffer);
    this.audioContext.volume = volume;
    this.audioContext.samples.push(buffer);
    
    // 限制样本数量
    if (this.audioContext.samples.length > 10) {
      this.audioContext.samples.shift();
    }
    
    // 使用 SpeechDetector 检测
    if (this.speechDetector) {
      const result = this.speechDetector.detect(this.audioContext);
      
      if (result.isSpeech) {
        this.stats.speechFrames++;
        this.audioContext.isVoice = true;
        this.audioContext.speechDuration += this.config.frameDuration;
        this.audioContext.silenceDuration = 0;
        
        // 开始 ASR 会话（如果还没有）
        if (!this.asrSession) {
          await this._startASRSession();
        }
        
        // 发送音频到 ASR
        if (this.asrSession) {
          this.asrSession.sendAudio(buffer);
        }
        
        // 缓存音频
        this.audioBuffer.push(buffer);
        if (this.audioBuffer.length > this.maxBufferSize) {
          this.audioBuffer.shift();
        }
        
      } else {
        this.stats.silenceFrames++;
        this.audioContext.isVoice = false;
        this.audioContext.silenceDuration += this.config.frameDuration;
        
        // 检测语音结束
        if (result.metadata?.reason === 'speech_end' && this.asrSession) {
          console.log('[RefactoredListener] Speech ended');
          this._handleSpeechEnd();
        }
      }
      
      // 更新上下文时间戳
      this.audioContext.timestamp = Date.now();
    }
    
    // 发射音量更新事件（用于前端显示）
    this.emit('volume', { volume });
  }
  
  /**
   * 计算音量
   * @private
   */
  _calculateVolume(buffer) {
    let sum = 0;
    const samples = new Int16Array(
      buffer.buffer, 
      buffer.byteOffset, 
      buffer.length / 2
    );
    
    for (let i = 0; i < samples.length; i++) {
      sum += Math.abs(samples[i]);
    }
    
    const avg = sum / samples.length;
    // 转换为 dB 范围 [-100, 0]
    return Math.max(0, Math.min(100, avg / 327.67));
  }
  
  /**
   * 开始 ASR 会话
   * @private
   */
  async _startASRSession() {
    if (!this.asrService) {
      console.error('[RefactoredListener] ASR service not set');
      return;
    }
    
    console.log('[RefactoredListener] Starting ASR session');
    
    this.state = ListenerState.PROCESSING;
    
    // 创建 ASR 会话
    this.asrSession = this.asrService.createSession({
      sampleRate: this.config.sampleRate,
      partialResults: true
    });
    
    this.stats.sessionsCreated++;
    
    // 绑定事件
    this.asrSession.on('interim', (result) => {
      this.emit('interim', { text: result.text });
    });
    
    this.asrSession.on('final', (result) => {
      this.emit('final', { text: result.text });
      
      // 关闭会话
      this._closeASRSession();
    });
    
    this.asrSession.on('error', (error) => {
      console.error('[RefactoredListener] ASR error:', error);
      this.emit('error', error);
      this._closeASRSession();
    });
    
    // 发送之前缓存的音频（预缓冲区）
    for (const buffer of this.audioBuffer) {
      this.asrSession.sendAudio(buffer);
    }
    
    this.emit('sessionStarted');
  }
  
  /**
   * 关闭 ASR 会话
   * @private
   */
  async _closeASRSession() {
    if (!this.asrSession) return;
    
    console.log('[RefactoredListener] Closing ASR session');
    
    this.asrSession.close();
    this.asrSession = null;
    this.stats.sessionsClosed++;
    
    // 清空缓冲区
    this.audioBuffer = [];
    
    // 如果还在监听，回到 LISTENING 状态
    if (this.state === ListenerState.PROCESSING) {
      this.state = ListenerState.LISTENING;
    }
    
    this.emit('sessionClosed');
  }
  
  /**
   * 处理语音结束
   * @private
   */
  _handleSpeechEnd() {
    if (this.asrSession) {
      // 触发最终识别（某些 ASR 需要手动结束）
      // 这里依赖于 ASR 会话的自动超时或手动关闭
      setTimeout(() => {
        this._closeASRSession();
      }, 500); // 延迟 500ms 确保最后一点音频被处理
    }
  }
  
  /**
   * 获取状态
   */
  getStatus() {
    return {
      state: this.state,
      hasDetector: !!this.speechDetector,
      hasASRService: !!this.asrService,
      hasASRSession: !!this.asrSession,
      bufferSize: this.audioBuffer.length,
      stats: { ...this.stats }
    };
  }
  
  /**
   * 重置统计
   */
  resetStats() {
    this.stats = {
      totalFrames: 0,
      speechFrames: 0,
      silenceFrames: 0,
      sessionsCreated: 0,
      sessionsClosed: 0
    };
  }
}

export default RefactoredListener;
