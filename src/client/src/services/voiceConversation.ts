// 实时双向语音对话管理器
// 支持：VAD自动检测、流式识别、打断机制

import { ttsService, TTSOptions } from './tts';

export type VoiceConversationState = 
  | 'idle'           // 空闲
  | 'listening'      // 正在听（VAD检测中）
  | 'processing'     // 处理中（发送给AI）
  | 'speaking'       // AI正在说话
  | 'error';         // 错误

export interface VoiceConversationOptions {
  // VAD设置
  silenceThreshold?: number;    // 静音阈值 (0-1), default 0.02
  silenceTimeout?: number;      // 静音多久认为说话结束(ms), default 1500
  minSpeechDuration?: number;   // 最小说话时长(ms), default 300
  
  // TTS设置
  ttsOptions?: TTSOptions;
  
  // 回调
  onStateChange?: (state: VoiceConversationState) => void;
  onTranscript?: (text: string, isFinal: boolean) => void;
  onError?: (error: string) => void;
  onUserSpeechStart?: () => void;
  onUserSpeechEnd?: (text: string) => void;
  onAIResponse?: (text: string) => void;
  onAIResponseComplete?: () => void;
}

export class VoiceConversation {
  private recognition: SpeechRecognition | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private microphone: MediaStreamAudioSourceNode | null = null;
  
  private state: VoiceConversationState = 'idle';
  private options: VoiceConversationOptions;
  
  // VAD状态
  private isSpeechDetected = false;
  private silenceStartTime = 0;
  private speechStartTime = 0;
  private vadFrameId: number | null = null;
  
  // 识别结果
  private currentTranscript = '';
  private interimTranscript = '';
  
  // 打断检测
  private isInterrupted = false;

  constructor(options: VoiceConversationOptions = {}) {
    this.options = {
      silenceThreshold: 0.02,
      silenceTimeout: 1500,
      minSpeechDuration: 300,
      ...options
    };
  }

  // 初始化
  async initialize(): Promise<boolean> {
    try {
      // 检查浏览器支持
      if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        throw new Error('浏览器不支持语音识别');
      }

      // 请求麦克风权限并设置VAD
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      await this.setupVAD(stream);

      // 初始化语音识别
      this.setupRecognition();

      return true;
    } catch (error) {
      console.error('[VoiceConversation] Init error:', error);
      this.options.onError?.(error instanceof Error ? error.message : '初始化失败');
      return false;
    }
  }

  // 设置VAD (基于音量的简单VAD)
  private async setupVAD(stream: MediaStream) {
    this.audioContext = new AudioContext();
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 256;
    
    this.microphone = this.audioContext.createMediaStreamSource(stream);
    this.microphone.connect(this.analyser);

    // 启动VAD检测循环
    this.startVADLoop();
  }

  // VAD检测循环
  private startVADLoop() {
    if (!this.analyser) return;

    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    const checkVolume = () => {
      if (!this.analyser) return;

      this.analyser.getByteFrequencyData(dataArray);
      
      // 计算平均音量
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const average = sum / bufferLength / 255; // 归一化到0-1

      this.handleVAD(average);

      if (this.state !== 'idle') {
        this.vadFrameId = requestAnimationFrame(checkVolume);
      }
    };

    this.vadFrameId = requestAnimationFrame(checkVolume);
  }

  // 处理VAD逻辑
  private handleVAD(volume: number) {
    const now = Date.now();
    const threshold = this.options.silenceThreshold || 0.02;
    const silenceTimeout = this.options.silenceTimeout || 1500;
    const minDuration = this.options.minSpeechDuration || 300;

    if (volume > threshold) {
      // 检测到声音
      if (!this.isSpeechDetected) {
        // 开始说话
        this.isSpeechDetected = true;
        this.speechStartTime = now;
        this.silenceStartTime = 0;
        
        // 打断AI说话
        if (this.state === 'speaking') {
          this.interrupt();
        }
        
        this.setState('listening');
        this.options.onUserSpeechStart?.();
        console.log('[VAD] Speech started');
      }
    } else {
      // 静音
      if (this.isSpeechDetected) {
        if (this.silenceStartTime === 0) {
          this.silenceStartTime = now;
        }
        
        const silenceDuration = now - this.silenceStartTime;
        const speechDuration = now - this.speechStartTime;
        
        // 静音超过阈值，认为说话结束
        if (silenceDuration > silenceTimeout && speechDuration > minDuration) {
          this.isSpeechDetected = false;
          this.handleSpeechEnd();
        }
      }
    }
  }

  // 设置语音识别
  private setupRecognition() {
    const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.recognition = new SpeechRecognitionAPI();
    
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = 'zh-CN';

    this.recognition.onresult = (event) => {
      let interim = '';
      let final = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += transcript;
        } else {
          interim += transcript;
        }
      }

      if (final) {
        this.currentTranscript += final;
      }
      this.interimTranscript = interim;

      // 通知实时转录
      const fullText = this.currentTranscript + this.interimTranscript;
      this.options.onTranscript?.(fullText, final !== '');
    };

    this.recognition.onerror = (event) => {
      console.error('[SpeechRecognition] Error:', event.error);
      if (event.error !== 'no-speech') {
        this.options.onError?.(event.error);
      }
    };

    this.recognition.onend = () => {
      // 自动重启（除非处于idle状态）
      if (this.state !== 'idle') {
        try {
          this.recognition?.start();
        } catch {
          // ignore
        }
      }
    };
  }

  // 处理说话结束
  private handleSpeechEnd() {
    const text = this.currentTranscript.trim();
    console.log('[VAD] Speech ended:', text);
    
    if (text) {
      this.options.onUserSpeechEnd?.(text);
    }

    // 重置转录
    this.currentTranscript = '';
    this.interimTranscript = '';
  }

  // 开始对话
  start() {
    if (this.state !== 'idle') return;
    
    this.setState('listening');
    this.recognition?.start();
    this.startVADLoop();
  }

  // 停止对话
  stop() {
    this.setState('idle');
    
    // 停止VAD
    if (this.vadFrameId) {
      cancelAnimationFrame(this.vadFrameId);
      this.vadFrameId = null;
    }

    // 停止识别
    try {
      this.recognition?.stop();
    } catch {
      // ignore
    }

    // 停止TTS
    ttsService.stop();

    // 清理音频
    this.audioContext?.close();
    this.audioContext = null;
  }

  // 打断AI说话
  interrupt() {
    if (this.state === 'speaking') {
      console.log('[VoiceConversation] Interrupted');
      ttsService.stop();
      this.isInterrupted = true;
      this.setState('listening');
    }
  }

  // AI开始说话
  async speak(text: string): Promise<void> {
    if (this.state === 'idle') return;
    
    this.isInterrupted = false;
    this.setState('speaking');
    
    try {
      await ttsService.speak(text, this.options.ttsOptions);
      
      if (!this.isInterrupted) {
        this.options.onAIResponseComplete?.();
        // 说完后自动回到监听状态
        if (this.state !== 'idle') {
          this.setState('listening');
        }
      }
    } catch (error) {
      console.error('[TTS] Error:', error);
      this.setState('listening');
    }
  }

  // 流式AI回复
  async speakStreaming(text: string): Promise<void> {
    if (this.state === 'idle') return;
    
    this.isInterrupted = false;
    this.setState('speaking');
    this.options.onAIResponse?.(text);
    
    await ttsService.speakStreaming(text, this.options.ttsOptions);
  }

  // 设置处理中状态（发送给AI时）
  setProcessing() {
    if (this.state !== 'idle') {
      this.setState('processing');
    }
  }

  // 获取当前状态
  getState(): VoiceConversationState {
    return this.state;
  }

  // 是否正在听
  isListening(): boolean {
    return this.state === 'listening';
  }

  // 是否被打断
  isInterruptedState(): boolean {
    return this.isInterrupted;
  }

  private setState(state: VoiceConversationState) {
    if (this.state !== state) {
      this.state = state;
      this.options.onStateChange?.(state);
    }
  }
}

// 创建对话实例的工厂函数
export function createVoiceConversation(options: VoiceConversationOptions = {}) {
  return new VoiceConversation(options);
}
