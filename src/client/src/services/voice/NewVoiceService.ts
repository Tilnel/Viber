/**
 * New Voice Service - 使用统一 WebSocket 的新版语音服务
 * 
 * 架构：
 * - SimpleRecorder: 纯采集，无 VAD，持续推送音频
 * - ViberSocket: 统一 WebSocket 通信
 * - 后端: VAD + ASR + 分段管理
 * 
 * @phase 5
 */

import { SimpleRecorder } from './SimpleRecorder';
import { getViberSocket, ViberMessageType, resetViberSocket } from '../viberSocket';

// 获取认证 token
function getAuthToken(): string {
  return localStorage.getItem('auth_token') || '';
}

export type NewVoiceState = 'idle' | 'connecting' | 'streaming' | 'error';

export interface NewVoiceServiceOptions {
  onStateChange?: (state: NewVoiceState) => void;
  onVolume?: (volume: number) => void;  // 用于前端音量显示
  onTranscript?: (text: string, isFinal: boolean) => void;
  onError?: (error: string) => void;
}

/**
 * 新版语音服务
 * 前端只负责采集和推送，所有逻辑在后端处理
 */
export class NewVoiceService {
  private state: NewVoiceState = 'idle';
  private options: NewVoiceServiceOptions;
  
  // 组件
  private recorder: SimpleRecorder | null = null;
  private socket: ReturnType<typeof getViberSocket>;
  
  // 状态
  private streamId: string | null = null;
  private audioSeq = 0;
  private isInitialized = false;

  constructor(options: NewVoiceServiceOptions = {}) {
    this.options = options;
    // 创建带 token 的 socket 实例
    this.socket = getViberSocket({
      token: getAuthToken()
    });
    this.setupSocketHandlers();
  }

  /**
   * 初始化
   */
  async init(): Promise<boolean> {
    if (this.isInitialized) return true;
    
    // 连接 WebSocket
    const connected = await this.socket.connect();
    if (!connected) {
      this.options.onError?.('无法连接到服务器');
      return false;
    }
    
    this.isInitialized = true;
    return true;
  }

  /**
   * 开始语音对话
   * 持续推送音频到后端，后端自行处理 VAD 和 ASR
   */
  async start(sessionId?: string): Promise<boolean> {
    if (this.state === 'streaming') return true;
    
    // 确保已初始化
    if (!this.isInitialized) {
      const ready = await this.init();
      if (!ready) return false;
    }
    
    this.setState('connecting');
    
    // 帧计数器用于日志
    let frameCount = 0;
    let lastLogTime = Date.now();
    
    // 1. 初始化录音器（纯采集，无 VAD）
    this.recorder = new SimpleRecorder({
      sampleRate: 16000,
      frameSize: 4096,
      onStateChange: (state) => {
        console.log('[NewVoiceService] Recorder state:', state);
      },
      onAudioFrame: (frame) => {
        // 持续推送音频到后端
        if (this.streamId) {
          this.socket.sendAudio(this.streamId, frame, this.audioSeq++);
          frameCount++;
          
          // 每秒打印一次发送统计
          const now = Date.now();
          if (now - lastLogTime > 1000) {
            console.log(`[NewVoiceService] Sent ${frameCount} frames in last second, total seq: ${this.audioSeq}`);
            frameCount = 0;
            lastLogTime = now;
          }
        } else {
          // streamId 还没收到，丢弃音频
          if (frameCount === 0) {
            console.log('[NewVoiceService] Waiting for streamId, dropping audio frames...');
          }
          frameCount++;
        }
      },
      onVolume: (volume) => {
        // 仅用于前端显示
        this.options.onVolume?.(volume);
      },
      onError: (error) => {
        console.error('[NewVoiceService] Recorder error:', error);
        this.options.onError?.(error);
        this.stop();
      }
    });
    
    // 2. 启动录音
    const started = await this.recorder.start();
    if (!started) {
      this.setState('error');
      return false;
    }
    
    // 3. 通知后端开始音频流
    this.socket.startVoice(sessionId || 'default', {
      sampleRate: 16000,
      language: 'zh-CN'
    });
    
    this.setState('streaming');
    console.log('[NewVoiceService] Started streaming audio to backend');
    return true;
  }

  /**
   * 停止语音对话
   */
  stop(): void {
    if (this.state === 'idle') return;
    
    console.log('[NewVoiceService] Stopping... (called from:)');
    console.trace('[NewVoiceService] Stop stack trace');
    
    // 停止录音
    this.recorder?.stop();
    this.recorder = null;
    
    // 通知后端停止
    if (this.streamId) {
      this.socket.stopVoice(this.streamId);
    }
    
    this.streamId = null;
    this.audioSeq = 0;
    this.setState('idle');
  }

  /**
   * 打断
   */
  interrupt(): void {
    if (this.streamId) {
      this.socket.interruptVoice(this.streamId);
    }
  }

  /**
   * 获取当前状态
   */
  getState(): NewVoiceState {
    return this.state;
  }

  /**
   * 是否正在录音
   */
  isStreaming(): boolean {
    return this.state === 'streaming';
  }

  // ========== 私有方法 ==========

  /**
   * 设置 Socket 消息处理器
   */
  private setupSocketHandlers(): void {
    // 录音已开始
    this.socket.on(ViberMessageType.VOICE_STARTED, (data) => {
      console.log('[NewVoiceService] Voice started:', data.streamId);
      this.streamId = data.streamId;
    });
    
    // 音量更新（后端计算）
    this.socket.on(ViberMessageType.VOICE_VOLUME, (data) => {
      this.options.onVolume?.(data.volume);
    });
    
    // ASR 临时结果
    this.socket.on(ViberMessageType.VOICE_ASR_INTERIM, (data) => {
      this.options.onTranscript?.(data.text, false);
    });
    
    // ASR 最终结果
    this.socket.on(ViberMessageType.VOICE_ASR_FINAL, (data) => {
      this.options.onTranscript?.(data.text, true);
    });
    
    // 错误
    this.socket.on(ViberMessageType.ERROR, (data) => {
      console.error('[NewVoiceService] Received error from backend:', JSON.stringify(data, null, 2));
      console.error('[NewVoiceService] Current streamId:', this.streamId, 'Error context streamId:', data?.context?.streamId);
      
      // 只处理当前流的错误，或者是全局错误
      const isRelevant = !data?.context?.streamId || data.context.streamId === this.streamId;
      console.error('[NewVoiceService] Is relevant error:', isRelevant);
      
      if (isRelevant) {
        const errorMsg = data?.message || data?.error?.message || data?.error?.code || JSON.stringify(data);
        this.options.onError?.(errorMsg);
      }
    });
  }

  /**
   * 设置状态
   */
  private setState(state: NewVoiceState): void {
    if (this.state === state) return;
    console.log('[NewVoiceService] State:', this.state, '->', state);
    this.state = state;
    this.options.onStateChange?.(state);
  }
}

// 单例
let globalNewVoiceService: NewVoiceService | null = null;

export function getNewVoiceService(options?: NewVoiceServiceOptions): NewVoiceService {
  if (!globalNewVoiceService) {
    globalNewVoiceService = new NewVoiceService(options);
  }
  return globalNewVoiceService;
}

export function resetNewVoiceService(): void {
  globalNewVoiceService?.stop();
  globalNewVoiceService = null;
}

export default NewVoiceService;
