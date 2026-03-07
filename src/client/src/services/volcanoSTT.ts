// 火山引擎语音识别 (STT) 服务
// WebSocket 二进制协议，实时流式识别

import { io, Socket } from 'socket.io-client';

export interface VolcanoSTTOptions {
  onText?: (text: string, isFinal: boolean) => void;
  onError?: (error: string) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
}

export class VolcanoSTTService {
  private socket: Socket | null = null;
  private options: VolcanoSTTOptions;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private isRecording = false;
  private sequence = 0;
  
  // 音频预缓冲：保存最近几百毫秒的音频，避免漏掉开头
  private preBuffer: Int16Array[] = [];
  private readonly PRE_BUFFER_SIZE = 20; // 保留最近20个缓冲块（约5秒）- 大幅增加防止开头丢失
  
  // 音频发送队列：当socket断开时缓存音频，重连后发送
  private audioQueue: Int16Array[] = [];
  private readonly MAX_QUEUE_SIZE = 100; // 最大缓存100帧（约25秒）
  private isProcessingQueue = false;

  constructor(options: VolcanoSTTOptions = {}) {
    this.options = options;
  }

  // 检查服务可用性
  async checkStatus(): Promise<{ available: boolean; error?: string }> {
    try {
      const response = await fetch('/api/volcano/stt/status', {
        credentials: 'include',
      });
      const data = await response.json();
      return { available: data.available, error: data.error };
    } catch (error) {
      return { available: false, error: '无法连接到 STT 服务' };
    }
  }

  // 开始录音和识别
  async start(): Promise<boolean> {
    // 如果已经在录音，直接返回成功
    if (this.isRecording) {
      console.log('[VolcanoSTT] Already recording');
      return true;
    }
    
    // 如果已有连接，只重启录音，不重建连接
    if (this.socket?.connected && this.audioContext?.state === 'running') {
      console.log('[VolcanoSTT] Reusing existing connection, just restarting recording');
      this.isRecording = true;
      return true;
    }
    
    const status = await this.checkStatus();
    if (!status.available) {
      console.error('[VolcanoSTT] Service not available:', status.error);
      this.options.onError?.(status.error || '服务不可用');
      return false;
    }

    try {
      // 获取麦克风权限（16k采样率）
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      // 创建音频上下文（强制16k采样率）
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 16000,
      });

      const source = this.audioContext.createMediaStreamSource(this.mediaStream);
      
      // 创建脚本处理器（256ms切片：4096样本，必须是2的幂次方）
      this.scriptProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);
      
      // 连接 Socket.io（如果已有连接会复用）
      try {
        await this.connectSocket();
      } catch (err) {
        console.error('[VolcanoSTT] Socket connection failed:', err);
        this.options.onError?.('连接失败');
        return false;
      }
      
      console.log('[VolcanoSTT] Started with prebuffer mode enabled');

      // 处理音频数据
      this.scriptProcessor.onaudioprocess = (e) => {
        // Float32 → Int16 PCM
        const float32Data = e.inputBuffer.getChannelData(0);
        const int16Data = new Int16Array(float32Data.length);
        
        for (let i = 0; i < float32Data.length; i++) {
          const val = Math.min(1, Math.max(-1, float32Data[i]));
          int16Data[i] = val * 32767;
        }
        
        // 始终保存到预缓冲（用于防止漏掉开头）- 不管 socket 是否连接
        this.preBuffer.push(int16Data);
        if (this.preBuffer.length > this.PRE_BUFFER_SIZE) {
          this.preBuffer.shift(); // 移除最旧的数据
        }
        
        // 只有在录音状态时才发送（支持队列，断连时不会丢失）
        if (this.isRecording) {
          this.sendAudio(int16Data);
        }
      };

      source.connect(this.scriptProcessor);
      this.scriptProcessor.connect(this.audioContext.destination);
      this.isRecording = true;

      return true;
    } catch (error) {
      console.error('[VolcanoSTT] Start failed:', error);
      this.options.onError?.(error instanceof Error ? error.message : '启动失败');
      return false;
    }
  }

  // 连接 Socket.io
  private connectSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      // 如果已有连接且可用，直接复用
      if (this.socket?.connected) {
        console.log('[VolcanoSTT] Reusing existing socket');
        resolve();
        return;
      }

      this.socket = io('/volcano-stt', {
        transports: ['websocket'],
      });

      this.socket.on('connect', () => {
        console.log('[VolcanoSTT] Socket.io connected');
      });

      this.socket.on('connected', () => {
        console.log('[VolcanoSTT] Server ready');
        this.sequence = 0;
        this.options.onConnected?.();
        
        // 连接成功后，处理队列中的音频
        if (this.audioQueue.length > 0) {
          console.log(`[VolcanoSTT] Connection restored, processing ${this.audioQueue.length} queued frames`);
          this.processQueue();
        }
        
        resolve();
      });
      
      // 超时处理：如果3秒内没收到 connected 事件，也继续
      setTimeout(() => {
        if (this.socket?.connected) {
          console.log('[VolcanoSTT] Timeout waiting for connected event, but socket is connected');
          resolve();
        }
      }, 3000);

      this.socket.on('text', (data: { text: string; isFinal: boolean }) => {
        this.options.onText?.(data.text, data.isFinal);
      });

      this.socket.on('error', (data: { message: string }) => {
        console.error('[VolcanoSTT] Error:', data.message);
        this.options.onError?.(data.message);
      });

      this.socket.on('disconnect', () => {
        console.log('[VolcanoSTT] Socket.io disconnected');
        this.isRecording = false;
        this.options.onDisconnected?.();
      });
      
      // 后端通知连接已断开（需要重建连接）
      this.socket.on('disconnected', () => {
        console.log('[VolcanoSTT] Server signaled connection lost');
        this.isRecording = false;
        this.socket?.disconnect();
        this.socket = null;
        this.options.onDisconnected?.();
      });

      this.socket.on('connect_error', (err) => {
        console.error('[VolcanoSTT] Connect error:', err);
        reject(err);
      });
    });
  }

  // 发送音频数据（支持队列，防止断连时丢失）
  private sendAudio(int16Data: Int16Array) {
    // 如果未连接，加入队列（如果队列未满）
    if (!this.socket?.connected) {
      if (this.audioQueue.length < this.MAX_QUEUE_SIZE) {
        this.audioQueue.push(int16Data);
        if (this.audioQueue.length % 10 === 0) {
          console.log(`[VolcanoSTT] Socket disconnected, queued ${this.audioQueue.length} frames`);
        }
      }
      return;
    }
    
    // 先发送队列中的音频（如果有）
    if (this.audioQueue.length > 0 && !this.isProcessingQueue) {
      this.processQueue();
    }
    
    // 发送当前音频
    this.emitAudio(int16Data);
  }
  
  // 发送音频帧
  private emitAudio(int16Data: Int16Array) {
    try {
      // Int16Array → base64（使用更高效的编码方式）
      const base64 = this.arrayBufferToBase64(int16Data.buffer);
      this.socket?.emit('audio', { audio: base64 });
    } catch (err) {
      console.error('[VolcanoSTT] Failed to send audio:', err);
      // 发送失败时加入队列，稍后重试
      if (this.audioQueue.length < this.MAX_QUEUE_SIZE) {
        this.audioQueue.push(int16Data);
      }
    }
  }
  
  // 处理发送队列
  private async processQueue() {
    if (this.isProcessingQueue || this.audioQueue.length === 0) return;
    
    this.isProcessingQueue = true;
    console.log(`[VolcanoSTT] Processing ${this.audioQueue.length} queued frames`);
    
    // 批量发送队列中的音频
    const batchSize = 5; // 每批发送5帧
    while (this.audioQueue.length > 0 && this.socket?.connected) {
      const batch = this.audioQueue.splice(0, Math.min(batchSize, this.audioQueue.length));
      for (const frame of batch) {
        this.emitAudio(frame);
      }
      // 给事件循环一点时间，避免阻塞
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    
    this.isProcessingQueue = false;
    
    if (this.audioQueue.length > 0) {
      console.warn(`[VolcanoSTT] ${this.audioQueue.length} frames still queued (disconnected)`);
    }
  }
  
  // 高效的 ArrayBuffer → Base64 转换
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    
    // 使用 chunk 处理大数组，避免栈溢出
    const chunkSize = 0x8000; // 32KB chunks
    let binary = '';
    
    for (let i = 0; i < len; i += chunkSize) {
      const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
      binary += String.fromCharCode.apply(null, Array.from(chunk));
    }
    
    return btoa(binary);
  }
  
  // 开始录音（发送预缓冲音频，防止漏掉开头）
  startRecording(): void {
    if (this.isRecording) return;
    
    console.log('[VolcanoSTT] Starting recording with prebuffer:', this.preBuffer.length, 'chunks');
    
    // 先发送预缓冲音频（确保开头不丢失）
    for (const chunk of this.preBuffer) {
      this.sendAudio(chunk);
    }
    this.preBuffer = []; // 清空预缓冲
    
    this.isRecording = true;
  }
  
  // 停止录音（但保持连接，进入预缓冲模式）
  stopRecording(): void {
    if (!this.isRecording) return;
    
    console.log('[VolcanoSTT] Stopping recording, entering prebuffer mode');
    this.isRecording = false;
  }
  
  // 结束当前识别（获取最终结果，但保持连接）
  finalize(): void {
    if (!this.socket?.connected) {
      console.log('[VolcanoSTT] Cannot finalize: socket not connected');
      return;
    }
    
    console.log('[VolcanoSTT] Finalizing: stopping recording, waiting for trailing audio');
    
    // 先停止录音（进入预缓冲模式，继续收集音频但不发送）
    this.stopRecording();
    
    // 延迟后 finalize，确保：
    // 1. 网络中未发送的尾音音频到达 ASR 服务器
    // 2. scriptProcessor 中最后几帧音频被处理并进入预缓冲
    setTimeout(() => {
      // 关键修复：发送预缓冲中的尾音音频！
      // stopRecording() 后产生的尾音被保存在 preBuffer 中，需要发送给服务器
      if (this.preBuffer.length > 0) {
        console.log('[VolcanoSTT] Sending trailing audio from prebuffer:', this.preBuffer.length, 'chunks');
        for (const chunk of this.preBuffer) {
          this.sendAudio(chunk);
        }
        this.preBuffer = [];
      }
      
      // 再等待一小段时间，确保尾音音频到达服务器
      setTimeout(() => {
        if (this.socket?.connected) {
          console.log('[VolcanoSTT] Sending finalize to server');
          this.socket.emit('finalize');
        }
      }, 300); // 增加等待时间确保尾音到达
    }, 800); // 增加延迟确保尾音被收集
    // 注意：不断开连接，保持音频流继续
  }

  // 停止录音（完全关闭连接）
  stop(): void {
    this.isRecording = false;

    // 发送停止信号
    if (this.socket?.connected) {
      console.log('[VolcanoSTT] Sending stop and disconnecting');
      this.socket.emit('stop');
    }

    // 立即关闭 Socket
    this.socket?.disconnect();
    this.socket = null;

    // 停止音频处理
    this.scriptProcessor?.disconnect();
    this.scriptProcessor = null;

    this.mediaStream?.getTracks().forEach((track) => track.stop());
    this.mediaStream = null;

    this.audioContext?.close();
    this.audioContext = null;

    console.log('[VolcanoSTT] Stopped');
  }
}

export function createVolcanoSTT(options: VolcanoSTTOptions = {}): VolcanoSTTService {
  return new VolcanoSTTService(options);
}

export default VolcanoSTTService;
