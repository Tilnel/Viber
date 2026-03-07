/**
 * Viber Unified WebSocket Client
 * 前端统一 WebSocket 客户端
 * 
 * @phase 5
 */

import { io, Socket } from 'socket.io-client';

// 消息类型定义
export enum ViberMessageType {
  // 连接管理
  AUTH = 'auth',
  AUTH_SUCCESS = 'auth:success',
  AUTH_ERROR = 'auth:error',
  
  // 语音
  VOICE_START = 'voice:start',
  VOICE_STARTED = 'voice:started',
  VOICE_AUDIO = 'voice:audio',
  VOICE_STOP = 'voice:stop',
  VOICE_STOPPED = 'voice:stopped',
  VOICE_VOLUME = 'voice:volume',
  VOICE_ASR_INTERIM = 'voice:asr:interim',
  VOICE_ASR_FINAL = 'voice:asr:final',
  VOICE_INTERRUPT = 'voice:interrupt',
  VOICE_LLM_START = 'voice:llm:start',
  VOICE_LLM_CHUNK = 'voice:llm:chunk',
  VOICE_LLM_DONE = 'voice:llm:done',
  VOICE_END = 'voice:end',
  
  // 播报
  SPEAKER_PLAY = 'speaker:play',
  SPEAKER_STOP = 'speaker:stop',
  SPEAKER_PAUSE = 'speaker:pause',
  SPEAKER_RESUME = 'speaker:resume',
  SPEAKER_COMPLETED = 'speaker:completed',
  
  // 聊天
  CHAT_SEND = 'chat:send',
  CHAT_THINKING = 'chat:thinking',
  CHAT_DELTA = 'chat:delta',
  CHAT_TOOL_CALL = 'chat:tool:call',
  CHAT_TOOL_RESULT = 'chat:tool:result',
  CHAT_COMPLETE = 'chat:complete',
  CHAT_ERROR = 'chat:error',
  CHAT_STOP = 'chat:stop',
  
  // 终端
  TERMINAL_CREATE = 'terminal:create',
  TERMINAL_CREATED = 'terminal:created',
  TERMINAL_INPUT = 'terminal:input',
  TERMINAL_OUTPUT = 'terminal:output',
  TERMINAL_RESIZE = 'terminal:resize',
  TERMINAL_CLOSE = 'terminal:close',
  
  // 文件系统
  FS_WATCH = 'fs:watch',
  FS_CHANGE = 'fs:change',
  
  // 房间
  ROOM_JOIN = 'room:join',
  ROOM_LEAVE = 'room:leave',
  ROOM_JOINED = 'room:joined',
  
  // 错误
  ERROR = 'error'
}

// 通用消息接口
export interface ViberMessage {
  type: string;
  data?: any;
  id?: string;
  timestamp?: number;
  error?: {
    code: string;
    message: string;
    context?: any;
  };
}

export interface ViberSocketOptions {
  namespace?: string;
  token?: string;
  autoConnect?: boolean;
  onConnect?: () => void;
  onDisconnect?: (reason: string) => void;
  onError?: (error: string) => void;
  onMessage?: (message: ViberMessage) => void;
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'authenticated' | 'error';

/**
 * Viber 统一 WebSocket 客户端
 */
export class ViberSocket {
  private socket: Socket | null = null;
  private options: Required<ViberSocketOptions>;
  private state: ConnectionState = 'disconnected';
  private messageQueue: ViberMessage[] = [];
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private messageHandlers = new Map<string, Set<(data: any) => void>>();

  constructor(options: ViberSocketOptions = {}) {
    this.options = {
      namespace: '/viber',
      token: '',
      autoConnect: false,
      onConnect: () => {},
      onDisconnect: () => {},
      onError: () => {},
      onMessage: () => {},
      ...options
    };
  }

  /**
   * 连接 WebSocket
   */
  async connect(): Promise<boolean> {
    if (this.state === 'connected' || this.state === 'authenticated') {
      return true;
    }

    this.setState('connecting');

    return new Promise((resolve, reject) => {
      console.log(`[ViberSocket] Connecting to ${this.options.namespace}...`);

      this.socket = io(this.options.namespace, {
        transports: ['websocket'],
        auth: { token: this.options.token },
        reconnection: true,
        reconnectionAttempts: this.maxReconnectAttempts,
        reconnectionDelay: 1000
      });

      // 连接成功
      this.socket.on('connect', () => {
        console.log('[ViberSocket] Connected');
        this.setState('connected');
        this.reconnectAttempts = 0;
        this.options.onConnect();
        resolve(true);
      });

      // 认证成功
      this.socket.on('message', (message: ViberMessage) => {
        this.handleMessage(message);
      });

      // 断开连接
      this.socket.on('disconnect', (reason) => {
        console.log('[ViberSocket] Disconnected:', reason);
        this.setState('disconnected');
        this.options.onDisconnect(reason);
      });

      // 连接错误
      this.socket.on('connect_error', (err) => {
        console.error('[ViberSocket] Connection error:', err);
        this.reconnectAttempts++;
        this.options.onError(err.message);
        
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          this.setState('error');
          reject(err);
        }
      });

      // 超时
      setTimeout(() => {
        if (this.state === 'connecting') {
          this.setState('error');
          reject(new Error('Connection timeout'));
        }
      }, 10000);
    });
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    console.log('[ViberSocket] Disconnecting...');
    this.socket?.disconnect();
    this.socket = null;
    this.setState('disconnected');
  }

  /**
   * 发送消息
   */
  send(type: string, data?: any, id?: string): void {
    const message: ViberMessage = {
      type,
      data,
      id: id || this.generateId(),
      timestamp: Date.now()
    };

    if (this.state === 'authenticated' || this.state === 'connected') {
      this.socket?.emit('message', message);
    } else {
      // 队列消息等待连接
      this.messageQueue.push(message);
    }
  }

  /**
   * 发送消息并等待响应
   */
  async sendAndWait(type: string, data?: any, timeout = 10000): Promise<ViberMessage> {
    const id = this.generateId();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off(type + ':response', handler);
        reject(new Error('Request timeout'));
      }, timeout);

      const handler = (response: ViberMessage) => {
        clearTimeout(timer);
        this.off(type + ':response', handler);
        resolve(response);
      };

      this.on(type + ':response', handler);
      this.send(type, data, id);
    });
  }

  /**
   * 注册消息处理器
   */
  on(type: string, handler: (data: any) => void): () => void {
    if (!this.messageHandlers.has(type)) {
      this.messageHandlers.set(type, new Set());
    }
    this.messageHandlers.get(type)!.add(handler);

    // 返回取消订阅函数
    return () => {
      this.messageHandlers.get(type)?.delete(handler);
    };
  }

  /**
   * 移除消息处理器
   */
  off(type: string, handler: (data: any) => void): void {
    this.messageHandlers.get(type)?.delete(handler);
  }

  /**
   * 获取连接状态
   */
  getState(): ConnectionState {
    return this.state;
  }

  /**
   * 是否已连接
   */
  isConnected(): boolean {
    return this.state === 'connected' || this.state === 'authenticated';
  }

  // ========== 便捷方法 ==========

  /**
   * 开始录音
   */
  startVoice(sessionId: string, config?: { 
    sampleRate?: number; 
    language?: string;
    ttsVoice?: string;
    ttsSpeed?: number;
  }): void {
    this.send(ViberMessageType.VOICE_START, { sessionId, config });
  }

  /**
   * 发送音频数据
   */
  sendAudio(streamId: string, audio: Int16Array, seq: number): void {
    const base64 = this.arrayBufferToBase64(audio.buffer);
    this.send(ViberMessageType.VOICE_AUDIO, {
      streamId,
      seq,
      audio: base64,
      timestamp: Date.now()
    });
  }

  /**
   * 停止录音
   */
  stopVoice(streamId: string): void {
    this.send(ViberMessageType.VOICE_STOP, { streamId });
  }

  /**
   * 打断
   */
  interruptVoice(streamId: string): void {
    this.send(ViberMessageType.VOICE_INTERRUPT, { streamId });
  }

  /**
   * 发送聊天消息
   */
  sendChat(sessionId: number, content: string, context?: any): string {
    const id = this.generateId();
    this.send(ViberMessageType.CHAT_SEND, {
      sessionId,
      content,
      context
    }, id);
    return id;
  }

  /**
   * 停止聊天生成
   */
  stopChat(messageId: string): void {
    this.send(ViberMessageType.CHAT_STOP, { messageId });
  }

  /**
   * 加入房间
   */
  joinRoom(room: string, metadata?: any): void {
    this.send(ViberMessageType.ROOM_JOIN, { room, metadata });
  }

  /**
   * 离开房间
   */
  leaveRoom(room: string): void {
    this.send(ViberMessageType.ROOM_LEAVE, { room });
  }

  // ========== 私有方法 ==========

  /**
   * 处理消息
   */
  private handleMessage(message: ViberMessage): void {
    // 全局回调
    this.options.onMessage(message);

    // 状态处理
    if (message.type === ViberMessageType.AUTH_SUCCESS) {
      this.setState('authenticated');
      // 发送队列中的消息
      this.flushQueue();
    } else if (message.type === ViberMessageType.AUTH_ERROR) {
      this.setState('error');
      this.options.onError(message.error?.message || 'Authentication failed');
    }

    // 调用注册的处理器
    const handlers = this.messageHandlers.get(message.type);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(message.data);
        } catch (error) {
          console.error('[ViberSocket] Handler error:', error);
        }
      });
    }
  }

  /**
   * 刷新消息队列
   */
  private flushQueue(): void {
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (message) {
        this.socket?.emit('message', message);
      }
    }
  }

  /**
   * 设置状态
   */
  private setState(state: ConnectionState): void {
    if (this.state !== state) {
      console.log('[ViberSocket] State:', this.state, '->', state);
      this.state = state;
    }
  }

  /**
   * 生成唯一 ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * ArrayBuffer → Base64
   */
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const len = bytes.byteLength;
    const chunkSize = 0x8000;

    for (let i = 0; i < len; i += chunkSize) {
      const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
      binary += String.fromCharCode.apply(null, Array.from(chunk));
    }

    return btoa(binary);
  }
}

// 单例实例
let globalSocket: ViberSocket | null = null;

export function getViberSocket(options?: ViberSocketOptions): ViberSocket {
  if (!globalSocket) {
    globalSocket = new ViberSocket(options);
  }
  return globalSocket;
}

export function resetViberSocket(): void {
  globalSocket?.disconnect();
  globalSocket = null;
}

export default ViberSocket;
