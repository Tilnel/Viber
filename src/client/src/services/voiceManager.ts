// 智能语音管理器
// 核心特性：
// 1. 本地音频预缓冲 + 触发式 ASR（节省成本）
// 2. 补充检测：2-3秒内的停顿视为同一句话
// 3. 简洁的状态管理

import { io, Socket } from 'socket.io-client';

export type VoiceState = 'idle' | 'recording' | 'waiting' | 'appending' | 'processing' | 'speaking';

export interface VoiceManagerOptions {
  // VAD 设置
  speechThreshold: number;      // 音量阈值（0-1）
  silenceTimeout: number;       // 静音超时（ms）
  continuationTimeout: number;  // 补充超时（ms），默认 3000
  
  // 回调
  onStateChange?: (state: VoiceState) => void;
  onTranscript?: (text: string, isFinal: boolean) => void;
  onSpeechStart?: () => void;
  onSpeechEnd?: (text: string) => void;      // 确定结束，发送给 AI
  onAppend?: (newText: string) => void;      // 补充检测
  onError?: (error: string) => void;
}

export class VoiceManager {
  private state: VoiceState = 'idle';
  private options: VoiceManagerOptions;
  
  // 音频相关
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private analyser: AnalyserNode | null = null;
  private gainNode: GainNode | null = null;
  
  // 本地音频缓冲区（语音开始前的预缓冲，用于补发开头）
  private audioBuffer: Int16Array[] = [];
  private readonly BUFFER_SIZE = 20; // 约 400ms
  
  // Socket
  private socket: Socket | null = null;
  private isConnected = false;
  
  // VAD 状态
  private isSpeechDetected = false;
  private silenceStartTime = 0;
  private speechStartTime = 0;
  private vadFrameId: number | null = null;
  private consecutiveSpeechFrames = 0;
  private consecutiveSilenceFrames = 0;
  
  // 识别结果
  private currentUtterance = '';      // 当前这句话
  private lastSentUtterance = '';     // 上次发送的话（用于补充）
  private continuationTimer: NodeJS.Timeout | null = null;
  private isInContinuationWindow = false; // 是否处于补充窗口期
  
  // 打断标志
  private interruptRequested = false;
  
  constructor(options: VoiceManagerOptions) {
    this.options = {
      speechThreshold: 0.015,  // 降低阈值，更容易检测小声
      silenceTimeout: 500,     // 缩短静音检测，更快响应尾音
      continuationTimeout: 3000,
      ...options
    };
  }
  
  // ========== 公共方法 ==========
  
  async start(): Promise<boolean> {
    try {
      // 1. 获取麦克风
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        }
      });
      
      // 2. 创建音频图
      this.audioContext = new AudioContext({ sampleRate: 16000 });
      const source = this.audioContext.createMediaStreamSource(this.mediaStream);
      
      // Analyser 用于 VAD
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 512;
      
      // ScriptProcessor 用于音频处理
      this.scriptProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);
      
      // 连接：source -> analyser -> scriptProcessor
      source.connect(this.analyser);
      this.analyser.connect(this.scriptProcessor);
      this.scriptProcessor.connect(this.audioContext.destination);
      
      // 3. 启动 VAD 循环
      this.startVAD();
      
      // 4. 设置音频处理回调（本地缓冲模式）
      this.scriptProcessor.onaudioprocess = (e) => {
        this.handleAudioFrame(e.inputBuffer.getChannelData(0));
      };
      
      this.setState('idle');
      console.log('[VoiceManager] Started, state: idle');
      return true;
      
    } catch (error) {
      console.error('[VoiceManager] Start failed:', error);
      this.options.onError?.(error instanceof Error ? error.message : '启动失败');
      return false;
    }
  }
  
  stop(): void {
    this.setState('idle');
    
    // 停止 VAD
    if (this.vadFrameId) {
      cancelAnimationFrame(this.vadFrameId);
      this.vadFrameId = null;
    }
    
    // 清除补充定时器
    if (this.continuationTimer) {
      clearTimeout(this.continuationTimer);
      this.continuationTimer = null;
    }
    
    // 断开连接
    this.socket?.disconnect();
    this.socket = null;
    this.isConnected = false;
    
    // 停止音频
    this.scriptProcessor?.disconnect();
    this.scriptProcessor = null;
    this.mediaStream?.getTracks().forEach(t => t.stop());
    this.mediaStream = null;
    this.audioContext?.close();
    this.audioContext = null;
    
    // 清空缓冲区
    this.audioBuffer = [];
    this.currentUtterance = '';
    
    console.log('[VoiceManager] Stopped');
  }
  
  // AI 开始说话（外部调用）
  onAIStartSpeaking(): void {
    if (this.state === 'processing') {
      this.setState('speaking');
    }
  }
  
  // AI 停止说话（外部调用）
  onAIStopSpeaking(): void {
    if (this.state === 'speaking') {
      this.setState('idle');
    }
  }
  
  // 获取当前状态
  getState(): VoiceState {
    return this.state;
  }
  
  // ========== 私有方法 ==========
  
  // VAD 循环
  private startVAD(): void {
    if (!this.analyser) return;
    
    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    const SPEECH_FRAMES = 3;   // 连续3帧语音才认为开始
    // 根据 silenceTimeout 计算静音帧数（requestAnimationFrame 约 60fps = 16.7ms/帧）
    const SILENCE_FRAMES = Math.max(30, Math.round(this.options.silenceTimeout / 16.7)); 
    console.log('[VoiceManager] VAD configured: silenceTimeout=', this.options.silenceTimeout, 'silenceFrames=', SILENCE_FRAMES);
    
    const check = () => {
      if (!this.analyser) return;
      
      this.analyser.getByteFrequencyData(dataArray);
      
      // 计算音量
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const volume = sum / dataArray.length / 255;
      const threshold = this.options.speechThreshold;
      
      if (volume > threshold) {
        // 检测到语音
        this.consecutiveSilenceFrames = 0;
        this.consecutiveSpeechFrames++;
        
        if (this.consecutiveSpeechFrames >= SPEECH_FRAMES && !this.isSpeechDetected) {
          this.isSpeechDetected = true;
          this.speechStartTime = Date.now();
          this.onLocalSpeechStart();
        }
      } else {
        // 检测到静音
        this.consecutiveSpeechFrames = 0;
        
        if (this.isSpeechDetected) {
          this.consecutiveSilenceFrames++;
          
          if (this.consecutiveSilenceFrames >= SILENCE_FRAMES) {
            this.isSpeechDetected = false;
            this.onLocalSpeechEnd();
          }
        }
      }
      
      this.vadFrameId = requestAnimationFrame(check);
    };
    
    this.vadFrameId = requestAnimationFrame(check);
  }
  
  // 处理音频帧（本地缓冲）
  private handleAudioFrame(float32Data: Float32Array): void {
    // 转换为 Int16
    const int16Data = new Int16Array(float32Data.length);
    for (let i = 0; i < float32Data.length; i++) {
      const val = Math.min(1, Math.max(-1, float32Data[i]));
      int16Data[i] = val * 32767;
    }
    
    // 根据状态决定如何处理音频
    if (this.state === 'recording') {
      // 实时发送到 ASR
      this.sendAudioToASR(int16Data);
    } else {
      // 空闲或等待状态：本地缓冲（用于补发开头）
      this.audioBuffer.push(int16Data);
      if (this.audioBuffer.length > this.BUFFER_SIZE) {
        this.audioBuffer.shift();
      }
    }
  }
  
  // 本地检测到语音开始
  private async onLocalSpeechStart(): Promise<void> {
    console.log('[VoiceManager] Local speech detected, current state:', this.state);
    
    // 取消任何待处理的确认定时器
    if (this.continuationTimer) {
      clearTimeout(this.continuationTimer);
      this.continuationTimer = null;
    }
    
    // 检查是否处于补充窗口期
    if (this.isInContinuationWindow && this.lastSentUtterance && this.currentUtterance) {
      console.log('[VoiceManager] Continuation detected, will append to:', this.lastSentUtterance);
      this.setState('appending');
      this.options.onAppend?.(this.lastSentUtterance);
      this.isInContinuationWindow = false;
      // 保留 currentUtterance，继续累积
    } else {
      // 正常开始新的一句话
      this.currentUtterance = '';
      this.lastSentUtterance = '';
      this.options.onSpeechStart?.();
    }
    
    // 打断 AI 说话
    this.interruptRequested = true;
    
    // 切换到录音状态
    this.setState('recording');
    
    // 连接 ASR（如果未连接）
    try {
      await this.ensureASRConnected();
    } catch (err) {
      console.error('[VoiceManager] Failed to connect ASR:', err);
      this.setState('idle');
      this.options.onError?.('无法连接语音识别服务');
      return;
    }
    
    // 发送预缓冲的音频
    console.log(`[VoiceManager] Flushing ${this.audioBuffer.length} buffered frames`);
    for (const frame of this.audioBuffer) {
      this.sendAudioToASR(frame);
    }
    this.audioBuffer = [];
  }
  
  // 本地检测到语音结束
  private onLocalSpeechEnd(): void {
    const duration = Date.now() - this.speechStartTime;
    console.log('[VoiceManager] Local speech ended, duration:', duration);
    
    // 防止重复触发（如果已经在 waiting 或更后状态，直接返回）
    if (this.state !== 'recording') {
      console.log('[VoiceManager] Already not recording, skip');
      return;
    }
    
    // 关键修复：先保持 recording 状态一会儿，继续收集尾音
    // 延迟后再切换到 waiting 并 finalize
    setTimeout(() => {
      // 切换到等待状态
      this.setState('waiting');
      
      // 发送 finalize，给服务器时间处理所有音频
      if (this.socket?.connected) {
        console.log('[VoiceManager] Sending finalize after trailing audio collection');
        this.socket?.emit('finalize');
      }
    }, 400);  // 400ms 收集尾音
    
    // 启动补充检测定时器
    if (duration > 500) {
      this.isInContinuationWindow = true;
      this.continuationTimer = setTimeout(() => {
        this.isInContinuationWindow = false;
        this.continuationTimer = null;
        if (this.state === 'waiting') {
          this.onUtteranceConfirmed();
        }
      }, this.options.continuationTimeout);
    } else {
      // 说话太短，直接确认
      setTimeout(() => {
        if (this.state === 'waiting') {
          this.onUtteranceConfirmed();
        }
      }, this.options.continuationTimeout);
    }
  }
  
  // 话语确定（超过补充窗口期）
  private onUtteranceConfirmed(): void {
    const text = this.currentUtterance.trim();
    console.log('[VoiceManager] Utterance confirmed:', text);
    
    // 防止重复确认
    if (this.state === 'processing' || this.state === 'speaking') {
      console.log('[VoiceManager] Already processing, skip confirmation');
      return;
    }
    
    if (text) {
      this.lastSentUtterance = text;
      this.options.onSpeechEnd?.(text);
      this.setState('processing');
    } else {
      console.log('[VoiceManager] Empty utterance, going idle');
      this.setState('idle');
    }
    
    this.currentUtterance = '';
    this.isInContinuationWindow = false;
  }
  
  // 确保 ASR 连接（复用已有连接，避免频繁重建）
  private async ensureASRConnected(): Promise<void> {
    // 如果已有连接且可用，直接复用
    if (this.socket?.connected && this.isConnected) {
      console.log('[VoiceManager] Reusing existing ASR connection');
      return;
    }
    
    // 断开无效的旧连接（如果存在）
    if (this.socket) {
      console.log('[VoiceManager] Disconnecting old socket');
      this.socket.disconnect();
      this.socket = null;
    }
    this.isConnected = false;
    
    return new Promise((resolve, reject) => {
      console.log('[VoiceManager] Creating new ASR connection');
      this.socket = io('/volcano-stt', { 
        transports: ['websocket'],
        reconnection: false  // 禁用自动重连，我们手动管理
      });
      
      this.socket.on('connect', () => {
        console.log('[VoiceManager] ASR socket connected');
      });
      
      this.socket.on('connected', () => {
        this.isConnected = true;
        console.log('[VoiceManager] ASR ready');
        resolve();
      });
      
      this.socket.on('result', (data: { text: string; isFinal: boolean }) => {
        // 只记录非空结果
        if (!data.text) return;
        
        console.log('[VoiceManager] ASR result:', data.text, 'final:', data.isFinal);
        
        // 更新当前话语（累积）
        this.currentUtterance = data.text;
        this.options.onTranscript?.(data.text, data.isFinal);
        
        // 如果是最终结果且处于 waiting 状态，提前确认
        if (data.isFinal && this.state === 'waiting') {
          console.log('[VoiceManager] Final result received, confirming early');
          // 取消补充定时器
          if (this.continuationTimer) {
            clearTimeout(this.continuationTimer);
            this.continuationTimer = null;
          }
          this.isInContinuationWindow = false;
          this.onUtteranceConfirmed();
        }
      });
      
      this.socket.on('error', (err: { message: string }) => {
        console.error('[VoiceManager] ASR error:', err);
        this.options.onError?.(err.message);
      });
      
      this.socket.on('disconnected', () => {
        console.log('[VoiceManager] ASR disconnected');
        this.isConnected = false;
      });
      
      this.socket.on('disconnect', (reason) => {
        console.log('[VoiceManager] ASR socket disconnect:', reason);
        this.isConnected = false;
      });
      
      this.socket.on('connect_error', (err) => {
        console.error('[VoiceManager] ASR connect error:', err);
        reject(err);
      });
      
      // 超时处理
      setTimeout(() => {
        if (!this.isConnected) {
          reject(new Error('ASR connection timeout'));
        }
      }, 5000);
    });
  }
  
  // 发送音频到 ASR
  private sendAudioToASR(int16Data: Int16Array): void {
    if (!this.socket?.connected) {
      console.warn('[VoiceManager] Cannot send audio: socket not connected');
      return;
    }
    
    // Int16 -> Base64
    const uint8 = new Uint8Array(int16Data.buffer);
    let binary = '';
    for (let i = 0; i < uint8.length; i++) {
      binary += String.fromCharCode(uint8[i]);
    }
    const base64 = btoa(binary);
    
    this.socket.emit('audio', { audio: base64 });
  }
  
  // 设置状态
  private setState(state: VoiceState): void {
    if (this.state === state) return;
    console.log('[VoiceManager] State:', this.state, '->', state);
    this.state = state;
    this.options.onStateChange?.(state);
  }
}

export default VoiceManager;
