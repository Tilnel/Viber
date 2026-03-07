/**
 * Voice Socket Service - 语音 WebSocket 服务
 * 
 * 职责：
 * 1. 管理前端与后端的 WebSocket 连接
 * 2. 处理音频上行（Recorder → Backend）
 * 3. 处理指令下行（Backend → Speaker）
 * 4. 处理 SSE 流式 LLM 输出
 * 
 * @phase 4
 */

import { io, Socket } from 'socket.io-client';

// 消息类型定义
export enum VoiceMessageType {
  // 上行（Frontend → Backend）
  AUDIO_FRAME = 'audio:frame',      // 音频帧
  AUDIO_START = 'audio:start',      // 开始发送音频
  AUDIO_STOP = 'audio:stop',        // 停止发送音频
  
  // 下行（Backend → Frontend）
  SPEAKER_PLAY = 'speaker:play',    // 播放指令
  SPEAKER_STOP = 'speaker:stop',    // 停止指令
  SPEAKER_PAUSE = 'speaker:pause',  // 暂停指令
  SPEAKER_RESUME = 'speaker:resume', // 恢复指令
  
  // 状态
  STATE_CHANGE = 'state:change',    // 状态变化
  VOLUME_UPDATE = 'volume:update',  // 音量更新（用于前端显示）
  
  // ASR 结果
  ASR_INTERIM = 'asr:interim',      // 临时识别结果
  ASR_FINAL = 'asr:final',          // 最终识别结果
  
  // 错误
  ERROR = 'error'
}

// 音频帧消息
export interface AudioFrameMessage {
  type: VoiceMessageType.AUDIO_FRAME;
  data: string;  // base64 encoded PCM data
  timestamp: number;
  seq: number;
}

// 播报任务消息
export interface SpeakerTaskMessage {
  type: VoiceMessageType.SPEAKER_PLAY;
  taskId: string;
  taskType: 'thinking' | 'response' | 'tool_result' | 'notification';
  text?: string;
  audioData?: string;  // base64 encoded audio
  audioUrl?: string;
  format: string;
  duration?: number;
}

// ASR 结果消息
export interface ASRResultMessage {
  type: VoiceMessageType.ASR_INTERIM | VoiceMessageType.ASR_FINAL;
  text: string;
  isFinal: boolean;
}

// 状态变化消息
export interface StateChangeMessage {
  type: VoiceMessageType.STATE_CHANGE;
  state: 'idle' | 'listening' | 'processing' | 'speaking';
}

// 音量更新消息
export interface VolumeUpdateMessage {
  type: VoiceMessageType.VOLUME_UPDATE;
  volume: number;  // 0-1
}

export interface VoiceSocketOptions {
  namespace?: string;
  onConnect?: () => void;
  onDisconnect?: (reason: string) => void;
  onSpeakerTask?: (task: SpeakerTaskMessage) => void;
  onSpeakerStop?: () => void;
  onASRResult?: (text: string, isFinal: boolean) => void;
  onVolumeUpdate?: (volume: number) => void;
  onStateChange?: (state: string) => void;
  onError?: (error: string) => void;
}

/**
 * 语音 WebSocket 服务
 * 统一处理前后端语音通信
 */
export class VoiceSocketService {
  private socket: Socket | null = null;
  private options: VoiceSocketOptions;
  private connected = false;
  private audioSeq = 0;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;

  constructor(options: VoiceSocketOptions = {}) {
    this.options = {
      namespace: '/voice',
      ...options
    };
  }

  /**
   * 连接 WebSocket
   */
  async connect(): Promise<boolean> {
    if (this.connected && this.socket?.connected) {
      console.log('[VoiceSocket] Already connected');
      return true;
    }

    return new Promise((resolve, reject) => {
      console.log(`[VoiceSocket] Connecting to ${this.options.namespace}...`);
      
      this.socket = io(this.options.namespace!, {
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: this.maxReconnectAttempts,
        reconnectionDelay: 1000
      });

      // 连接成功
      this.socket.on('connect', () => {
        console.log('[VoiceSocket] Connected');
        this.connected = true;
        this.reconnectAttempts = 0;
        this.options.onConnect?.();
        resolve(true);
      });

      // 连接断开
      this.socket.on('disconnect', (reason) => {
        console.log('[VoiceSocket] Disconnected:', reason);
        this.connected = false;
        this.options.onDisconnect?.(reason);
      });

      // 连接错误
      this.socket.on('connect_error', (err) => {
        console.error('[VoiceSocket] Connection error:', err);
        this.reconnectAttempts++;
        
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          this.options.onError?.('连接失败，请检查网络');
          reject(err);
        }
      });

      // 注册消息处理器
      this.registerHandlers();
    });
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    console.log('[VoiceSocket] Disconnecting...');
    this.socket?.disconnect();
    this.socket = null;
    this.connected = false;
  }

  /**
   * 发送音频帧
   */
  sendAudioFrame(int16Data: Int16Array): void {
    if (!this.connected || !this.socket?.connected) {
      console.warn('[VoiceSocket] Cannot send audio: not connected');
      return;
    }

    // Int16Array → Base64
    const base64 = this.arrayBufferToBase64(int16Data.buffer);
    
    const message: AudioFrameMessage = {
      type: VoiceMessageType.AUDIO_FRAME,
      data: base64,
      timestamp: Date.now(),
      seq: this.audioSeq++
    };

    this.socket.emit(VoiceMessageType.AUDIO_FRAME, message);
  }

  /**
   * 通知后端开始音频流
   */
  startAudioStream(): void {
    console.log('[VoiceSocket] Starting audio stream');
    this.socket?.emit(VoiceMessageType.AUDIO_START, { timestamp: Date.now() });
  }

  /**
   * 通知后端停止音频流
   */
  stopAudioStream(): void {
    console.log('[VoiceSocket] Stopping audio stream');
    this.socket?.emit(VoiceMessageType.AUDIO_STOP, { timestamp: Date.now() });
    this.audioSeq = 0;
  }

  /**
   * 发送播报完成通知（告诉后端前端已播放完成）
   */
  notifyPlaybackComplete(taskId: string): void {
    this.socket?.emit('speaker:completed', { taskId });
  }

  /**
   * 是否已连接
   */
  isConnected(): boolean {
    return this.connected && !!this.socket?.connected;
  }

  // ========== 私有方法 ==========

  /**
   * 注册消息处理器
   */
  private registerHandlers(): void {
    if (!this.socket) return;

    // 播报指令
    this.socket.on(VoiceMessageType.SPEAKER_PLAY, (data: SpeakerTaskMessage) => {
      console.log('[VoiceSocket] Received speaker play:', data.taskId);
      this.options.onSpeakerTask?.(data);
    });

    this.socket.on(VoiceMessageType.SPEAKER_STOP, () => {
      console.log('[VoiceSocket] Received speaker stop');
      this.options.onSpeakerStop?.();
    });

    this.socket.on(VoiceMessageType.SPEAKER_PAUSE, () => {
      console.log('[VoiceSocket] Received speaker pause');
    });

    this.socket.on(VoiceMessageType.SPEAKER_RESUME, () => {
      console.log('[VoiceSocket] Received speaker resume');
    });

    // ASR 结果
    this.socket.on(VoiceMessageType.ASR_INTERIM, (data: ASRResultMessage) => {
      this.options.onASRResult?.(data.text, false);
    });

    this.socket.on(VoiceMessageType.ASR_FINAL, (data: ASRResultMessage) => {
      this.options.onASRResult?.(data.text, true);
    });

    // 音量更新（用于前端可视化）
    this.socket.on(VoiceMessageType.VOLUME_UPDATE, (data: VolumeUpdateMessage) => {
      this.options.onVolumeUpdate?.(data.volume);
    });

    // 状态变化
    this.socket.on(VoiceMessageType.STATE_CHANGE, (data: StateChangeMessage) => {
      this.options.onStateChange?.(data.state);
    });

    // 错误
    this.socket.on(VoiceMessageType.ERROR, (data: { message: string }) => {
      console.error('[VoiceSocket] Error:', data.message);
      this.options.onError?.(data.message);
    });
  }

  /**
   * ArrayBuffer → Base64
   */
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const len = bytes.byteLength;
    
    // 使用 chunk 处理大数组
    const chunkSize = 0x8000; // 32KB
    for (let i = 0; i < len; i += chunkSize) {
      const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
      binary += String.fromCharCode.apply(null, Array.from(chunk));
    }
    
    return btoa(binary);
  }
}

// 单例导出
let globalVoiceSocket: VoiceSocketService | null = null;

export function getVoiceSocket(options?: VoiceSocketOptions): VoiceSocketService {
  if (!globalVoiceSocket) {
    globalVoiceSocket = new VoiceSocketService(options);
  }
  return globalVoiceSocket;
}

export function resetVoiceSocket(): void {
  globalVoiceSocket?.disconnect();
  globalVoiceSocket = null;
}

export default VoiceSocketService;
