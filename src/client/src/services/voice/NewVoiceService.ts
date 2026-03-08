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
import { getSpeakerController } from './SpeakerController';
import { loadVoiceConfig } from '../voiceConfig';

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
  onSpeakerStateChange?: (state: 'idle' | 'playing' | 'paused') => void;
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
    // sessionId 必须是有效的数字，不能是 'default' 字符串
    if (!sessionId || sessionId === 'default') {
      this.setState('error');
      throw new Error('请先选择一个会话才能开始语音对话');
    }
    
    // 获取用户 TTS 配置
    const voiceConfig = loadVoiceConfig();
    
    this.socket.startVoice(sessionId, {
      sampleRate: 16000,
      language: 'zh-CN',
      ttsVoice: voiceConfig.ttsVoice,
      ttsSpeed: voiceConfig.ttsSpeed
    });
    
    this.setState('streaming');
    // 开始向后端发送音频
    return true;
  }

  /**
   * 停止语音对话
   */
  stop(): void {
    if (this.state === 'idle') return;
    
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
    registerHandler(this.socket.on(ViberMessageType.VOICE_STARTED, (data) => {
      this.streamId = data.streamId;
    }));
    
    // 音量更新（后端计算）
    registerHandler(this.socket.on(ViberMessageType.VOICE_VOLUME, (data) => {
      this.options.onVolume?.(data.volume);
    }));
    
    // ASR 临时结果
    registerHandler(this.socket.on(ViberMessageType.VOICE_ASR_INTERIM, (data) => {
      this.options.onTranscript?.(data.text, false);
    }));
    
    // ASR 最终结果
    registerHandler(this.socket.on(ViberMessageType.VOICE_ASR_FINAL, (data) => {
      this.options.onTranscript?.(data.text, true);
    }));
    
    // TTS 播放指令
    registerHandler(this.socket.on(ViberMessageType.SPEAKER_PLAY, (data) => {
      console.log('[NewVoiceService] Received TTS task:', data.taskId);
      const speaker = getSpeakerController({
        onStateChange: (state) => {
          this.options.onSpeakerStateChange?.(state);
        }
      });
      
      // Base64 转 ArrayBuffer
      const audioData = data.audioData 
        ? this.base64ToArrayBuffer(data.audioData)
        : undefined;
      
      speaker.enqueue({
        id: data.taskId,
        type: data.type,
        text: data.text,
        audioData,
        format: data.format,
        sampleRate: data.sampleRate,
        duration: data.duration
      });
    }));
    
    // TTS 停止指令
    registerHandler(this.socket.on(ViberMessageType.SPEAKER_STOP, () => {
      console.log('[NewVoiceService] Received stop speaker');
      const speaker = getSpeakerController();
      speaker.stopAll();
    }));
    
    // 错误
    registerHandler(this.socket.on(ViberMessageType.ERROR, (data) => {
      const isRelevant = !data?.context?.streamId || data.context.streamId === this.streamId;
      if (isRelevant) {
        const errorMsg = data?.message || data?.error?.message || data?.error?.code || 'Unknown error';
        this.options.onError?.(errorMsg);
      }
    }));
  }

  /**
   * Base64 转 ArrayBuffer
   */
  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
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
let unsubscribeHandlers: (() => void)[] = [];
let isCreating = false;

export function getNewVoiceService(options?: NewVoiceServiceOptions): NewVoiceService {
  if (!globalNewVoiceService && !isCreating) {
    isCreating = true;
    globalNewVoiceService = new NewVoiceService(options);
    isCreating = false;
  }
  return globalNewVoiceService!;
}

export function resetNewVoiceService(): void {
  // 清理所有监听器
  unsubscribeHandlers.forEach(unsub => unsub());
  unsubscribeHandlers = [];
  
  globalNewVoiceService?.stop();
  globalNewVoiceService = null;
}

export function registerHandler(unsubscribe: () => void): void {
  unsubscribeHandlers.push(unsubscribe);
}

export default NewVoiceService;
