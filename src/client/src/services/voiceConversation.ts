// 实时双向语音对话管理器 - 简化版
// 核心原则：任何时候检测到用户说话，立即停止一切并监听

import { piperTTSService, PiperTTSOptions } from './piperTTS';
import { volcanoTTSService } from './volcanoTTS';
import { VolcanoSTTService } from './volcanoSTT';
import { cleanTextForTTSStreaming } from '../utils/ttsTextCleaner';
import { VoiceConfig, loadVoiceConfig, TTSEngine, STTEngine, volcanoVoices } from './voiceConfig';
import { useSettingsStore } from '../stores/settings';

export type VoiceConversationState = 'idle' | 'listening' | 'processing' | 'speaking';

export interface VoiceConversationOptions {
  silenceThreshold?: number;
  silenceTimeout?: number;
  minSpeechDuration?: number;
  voiceConfig?: VoiceConfig;
  ttsOptions?: PiperTTSOptions;
  onStateChange?: (state: VoiceConversationState) => void;
  onTranscript?: (text: string, isFinal: boolean) => void;
  onError?: (error: string) => void;
  onUserSpeechStart?: () => void;
  onUserSpeechEnd?: (text: string) => void;
  onInterrupt?: () => void; // 新增：打断回调
  onAIResponse?: (text: string) => void;
  onAIResponseComplete?: () => void;
}

export class VoiceConversation {
  private volcanoSTT: VolcanoSTTService | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private microphone: MediaStreamAudioSourceNode | null = null;

  private state: VoiceConversationState = 'idle';
  private options: VoiceConversationOptions;
  private config: VoiceConfig;
  private ttsEngine: TTSEngine = 'volcano';
  private sttEngine: STTEngine = 'volcano';

  // VAD状态
  private isSpeechDetected = false;
  private silenceStartTime = 0;
  private speechStartTime = 0;
  private vadFrameId: number | null = null;
  private isListening = false; // 是否正在监听（独立于state）

  // 转录结果
  private currentTranscript = '';
  private interimTranscript = '';
  private sttResultReceived = false; // 标记是否收到STT最终结果

  // 防止重复发送同一段语音
  private lastSentText = '';
  private lastSentTime = 0;
  private readonly DEBOUNCE_TIME = 3000;

  // 打断标志
  private interruptRequested = false;
  
  // 语音结束处理超时
  private speechEndTimeout: NodeJS.Timeout | null = null;

  constructor(options: VoiceConversationOptions = {}) {
    this.options = {
      silenceThreshold: 0.02,
      silenceTimeout: 2000, // 2秒静音认为结束
      minSpeechDuration: 400,
      ...options,
    };
    this.config = options.voiceConfig || loadVoiceConfig();
    this.ttsEngine = this.config.ttsEngine;
    this.sttEngine = this.config.sttEngine;
  }

  // 获取 AnalyserNode 用于音量可视化
  getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  // 更新 VAD 阈值
  setThreshold(threshold: number): void {
    console.log('[VoiceConversation] Updating threshold:', threshold);
    this.options.silenceThreshold = threshold;
  }

  // 初始化
  async initialize(): Promise<boolean> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        }
      });
      
      this.audioContext = new AudioContext({ sampleRate: 16000 });
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 512; // 更大的采样窗口
      
      this.microphone = this.audioContext.createMediaStreamSource(stream);
      this.microphone.connect(this.analyser);
      
      return true;
    } catch (error) {
      console.error('[VoiceConversation] Init error:', error);
      this.options.onError?.(error instanceof Error ? error.message : '初始化失败');
      return false;
    }
  }

  // 开始对话
  async start(): Promise<void> {
    if (this.isListening) return;
    
    console.log('[VoiceConversation] Starting voice conversation');
    this.isListening = true;
    this.interruptRequested = false;
    this.setState('listening');
    
    // 启动STT
    await this.startSTT();
    
    // 启动VAD
    this.startVADLoop();
  }

  // 启动STT
  private async startSTT(): Promise<void> {
    // 如果STT已存在且运行中，不要重新创建连接
    if (this.volcanoSTT) {
      console.log('[VoiceConversation] STT already exists, reusing connection');
      return;
    }

    this.volcanoSTT = new VolcanoSTTService({
      onText: (text, isFinal) => {
        if (!this.isListening) return;
        
        if (isFinal && text.trim()) {
          console.log('[VoiceConversation] STT final:', text);
          this.currentTranscript = text;
          this.sttResultReceived = true;
          this.options.onTranscript?.(text, true);
          
          // 如果语音已经结束但还在等结果，现在处理
          if (!this.isSpeechDetected && this.speechEndTimeout) {
            console.log('[VoiceConversation] STT result arrived after speech end, processing now');
            clearTimeout(this.speechEndTimeout);
            this.speechEndTimeout = null;
            this.processSpeechText(text);
          }
        } else {
          this.interimTranscript = text;
          this.options.onTranscript?.(text, false);
        }
      },
      onError: (error) => {
        console.error('[VoiceConversation] STT error:', error);
      },
      onDisconnected: () => {
        console.log('[VoiceConversation] STT disconnected, will restart on next speech');
        this.volcanoSTT = null;
      },
    });

    await this.volcanoSTT.start();
    console.log('[VoiceConversation] STT started');
  }

  // TTS播放中标志（用于防止自激）
  private isTTSSpeaking = false;

  // VAD检测循环
  private startVADLoop(): void {
    if (!this.analyser) return;

    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    let consecutiveSpeechFrames = 0;
    let consecutiveSilenceFrames = 0;
    const SPEECH_THRESHOLD = 2; // 连续2帧检测到语音才认为开始说话（更灵敏）
    const SILENCE_THRESHOLD = 120; // 连续120帧静音才认为结束（约2秒，容忍连续说话中的停顿）

    const checkVolume = () => {
      if (!this.analyser || !this.isListening) return;

      this.analyser.getByteFrequencyData(dataArray);

      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const average = sum / bufferLength / 255;
      const threshold = this.options.silenceThreshold || 0.02;

      // 检测到语音
      // TTS播放时：轻微提高阈值防止自激，但更容易打断
      const effectiveThreshold = this.isTTSSpeaking ? threshold * 1.2 : threshold;
      
      if (average > effectiveThreshold) {
        consecutiveSilenceFrames = 0;
        consecutiveSpeechFrames++;
        
        if (consecutiveSpeechFrames >= SPEECH_THRESHOLD && !this.isSpeechDetected) {
          this.isSpeechDetected = true;
          this.speechStartTime = Date.now();
          this.silenceStartTime = 0;
          consecutiveSpeechFrames = 0;
          
          console.log('[VoiceConversation] Speech START detected', this.isTTSSpeaking ? '(during TTS)' : '');
          
          // 关键：立即停止一切并准备听新的话（异步处理）
          this.handleSpeechStart();
        }
      } else {
        // 检测到静音
        consecutiveSpeechFrames = 0;
        
        if (this.isSpeechDetected) {
          consecutiveSilenceFrames++;
          
          if (consecutiveSilenceFrames >= SILENCE_THRESHOLD) {
            const speechDuration = Date.now() - this.speechStartTime;
            const minDuration = this.options.minSpeechDuration || 400;
            
            if (speechDuration >= minDuration) {
              console.log('[VoiceConversation] Speech END detected, duration:', speechDuration);
              this.handleSpeechEnd();
            }
            
            this.isSpeechDetected = false;
            consecutiveSilenceFrames = 0;
          }
        }
      }

      if (this.isListening) {
        this.vadFrameId = requestAnimationFrame(checkVolume);
      }
    };

    this.vadFrameId = requestAnimationFrame(checkVolume);
  }

  // 处理语音开始
  private handleSpeechStart(): void {
    // 1. 立即停止TTS
    console.log('[VoiceConversation] Calling stopTTS');
    this.stopTTS();
    
    // 2. 通知父组件打断
    if (this.state !== 'idle' && this.state !== 'listening') {
      console.log('[VoiceConversation] Calling onInterrupt');
      this.interruptRequested = true;
      this.options.onInterrupt?.();
    }
    
    // 3. 设置状态
    this.setState('listening');
    
    // 4. 关键：保持STT连接，不要重启！
    // 重启会导致音频流中断，丢失开头的字
    if (!this.volcanoSTT) {
      console.log('[VoiceConversation] STT not running, starting it');
      this.startSTT();
    } else {
      console.log('[VoiceConversation] STT already running, keeping connection');
    }
    
    // 5. 通知 STT 开始录音（会发送预缓冲音频，防止漏掉开头）
    this.volcanoSTT?.startRecording();
    
    // 6. 清空上一句的转录结果，准备接收新的
    // 注意：这里清空的是上一句的结果，但 STT 服务器会继续返回新结果
    this.currentTranscript = '';
    this.interimTranscript = '';
    this.sttResultReceived = false;
    
    // 7. 通知外部
    this.options.onUserSpeechStart?.();
  }

  // 立即打断 - 停止所有输出（供外部调用，不重建STT）
  private immediateInterrupt(): void {
    console.log('[VoiceConversation] Immediate interrupt, state:', this.state);
    
    // 1. 立即停止TTS
    this.stopTTS();
    
    // 2. 通知父组件打断
    if (this.state !== 'idle' && this.state !== 'listening') {
      this.interruptRequested = true;
      this.options.onInterrupt?.();
    }
    
    // 3. 设置状态
    this.setState('listening');
  }

  // 处理说话结束
  private handleSpeechEnd(): void {
    // 等待尾音音频传输到服务器后再 finalize（避免尾音丢失）
    console.log('[VoiceConversation] Waiting for trailing audio to arrive...');
    
    setTimeout(() => {
      // 触发STT finalize，让后端返回最终结果（保持连接）
      console.log('[VoiceConversation] Finalizing STT for current utterance');
      this.volcanoSTT?.finalize();
      
      // 如果已经收到STT结果，立即处理
      if (this.sttResultReceived && this.currentTranscript.trim()) {
        this.processSpeechText(this.currentTranscript);
        return;
      }
      
      // 否则等待STT结果（最多等2秒，给后端足够时间返回最终结果）
      console.log('[VoiceConversation] Waiting for STT result...');
      this.speechEndTimeout = setTimeout(() => {
        this.speechEndTimeout = null;
        const text = this.currentTranscript.trim();
        
        if (text) {
          this.processSpeechText(text);
        } else {
          console.log('[VoiceConversation] STT result timeout, no text');
        }
      }, 2000);
    }, 500);  // 500ms 延迟，确保尾音音频到达服务器
  }

  // 处理识别到的语音文本
  private processSpeechText(text: string): void {
    // 检查是否重复
    const now = Date.now();
    if (text === this.lastSentText && now - this.lastSentTime < this.DEBOUNCE_TIME) {
      console.log('[VoiceConversation] Duplicate speech, ignoring:', text);
      this.resetForNextSpeech();
      return;
    }

    // 记录发送的文本
    this.lastSentText = text;
    this.lastSentTime = now;
    
    console.log('[VoiceConversation] Sending speech:', text);
    
    // 发送给用户
    this.setState('processing');
    this.options.onUserSpeechEnd?.(text);
    
    // 重置准备下一句
    this.resetForNextSpeech();
  }

  // 重置状态准备下一句
  private resetForNextSpeech(): void {
    this.currentTranscript = '';
    this.interimTranscript = '';
    this.sttResultReceived = false;
    
    // 关键：停止录音（进入预缓冲模式），但保持连接！
    // 这样可以确保下一句开头不会丢失，同时STT连接保持
    console.log('[VoiceConversation] Reset for next speech, stop recording but keep STT connection');
    this.volcanoSTT?.stopRecording();
  }

  // 设置状态
  private setState(state: VoiceConversationState): void {
    if (this.state === state) return;
    console.log('[VoiceConversation] State:', this.state, '->', state);
    this.state = state;
    this.options.onStateChange?.(state);
  }

  // 停止 TTS
  private stopTTS(): void {
    console.log('[VoiceConversation] Stopping TTS, engine:', this.ttsEngine);
    if (this.ttsEngine === 'volcano') {
      volcanoTTSService.stop();
    } else {
      piperTTSService.stop();
    }
    console.log('[VoiceConversation] TTS stop called');
  }

  // AI 开始回复
  startAIResponse(): void {
    this.setState('processing');
    this.interruptRequested = false;
  }

  // AI 开始说话（TTS）
  async speak(text: string): Promise<void> {
    if (!this.isListening || this.interruptRequested) {
      console.log('[VoiceConversation] Not speaking, interrupted or not listening');
      return;
    }

    this.setState('speaking');
    this.isTTSSpeaking = true; // 标记TTS播放中
    console.log('[VoiceConversation] TTS started, VAD threshold increased to prevent echo');

    try {
      if (this.ttsEngine === 'volcano') {
        await volcanoTTSService.synthesize(text, {
          voice: this.config.ttsVoice,
          speed: this.config.ttsSpeed,
        });
      } else {
        await piperTTSService.speak(text, this.options.ttsOptions);
      }

      if (!this.interruptRequested && this.isListening) {
        this.options.onAIResponseComplete?.();
        this.setState('listening');
        // TTS结束，重启STT准备听下一句
        if (!this.volcanoSTT) {
          await this.startSTT();
        }
      }
    } catch (error) {
      console.error('[VoiceConversation] TTS error:', error);
    } finally {
      this.isTTSSpeaking = false; // TTS结束
      console.log('[VoiceConversation] TTS ended, VAD threshold restored');
    }
  }

  // 停止对话
  stop(): void {
    console.log('[VoiceConversation] Stopping');
    
    this.isListening = false;
    this.interruptRequested = true;
    
    if (this.vadFrameId) {
      cancelAnimationFrame(this.vadFrameId);
      this.vadFrameId = null;
    }
    
    if (this.speechEndTimeout) {
      clearTimeout(this.speechEndTimeout);
      this.speechEndTimeout = null;
    }

    this.volcanoSTT?.stop();
    this.volcanoSTT = null;
    this.stopTTS();
    
    this.audioContext?.close();
    this.audioContext = null;
    
    this.setState('idle');
  }

  // 获取当前状态
  getState(): VoiceConversationState {
    return this.state;
  }
}

// 工厂函数
export function createVoiceConversation(options: VoiceConversationOptions = {}): VoiceConversation {
  return new VoiceConversation(options);
}
