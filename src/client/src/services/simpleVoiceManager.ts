// 简化版语音管理器 - 每次说话独立连接

import { io, Socket } from 'socket.io-client';

export type VoiceState = 'idle' | 'listening';

export interface SimpleVoiceManagerOptions {
  speechThreshold: number;
  onStateChange?: (state: VoiceState) => void;
  onTranscript?: (text: string) => void;  // 最终结果
  onInterimTranscript?: (text: string) => void;  // 中间结果（实时）
  onError?: (error: string) => void;
}

export class SimpleVoiceManager {
  private state: VoiceState = 'idle';
  private options: SimpleVoiceManagerOptions;
  
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  
  private socket: Socket | null = null;
  private isRecording = false;
  
  private vadFrameId: number | null = null;
  private isSpeechDetected = false;
  private speechStartTime = 0;
  
  private preBuffer: Int16Array[] = [];
  private readonly PREBUFFER_SIZE = 20;
  private frameCount = 0;

  constructor(options: SimpleVoiceManagerOptions) {
    this.options = options;
  }

  async start(): Promise<boolean> {
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true }
      });

      this.audioContext = new AudioContext({ sampleRate: 16000 });
      const source = this.audioContext.createMediaStreamSource(this.mediaStream);
      
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 512;
      
      this.scriptProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);
      
      source.connect(this.analyser);
      this.analyser.connect(this.scriptProcessor);
      this.scriptProcessor.connect(this.audioContext.destination);
      
      this.scriptProcessor.onaudioprocess = (e) => this.handleAudio(e.inputBuffer.getChannelData(0));
      
      this.startVAD();
      this.setState('listening');
      return true;
    } catch {
      this.options.onError?.('无法启动麦克风');
      return false;
    }
  }

  stop(): void {
    this.setState('idle');
    
    if (this.vadFrameId) cancelAnimationFrame(this.vadFrameId);
    this.vadFrameId = null;
    
    this.socket?.disconnect();
    this.socket = null;
    
    this.scriptProcessor?.disconnect();
    this.scriptProcessor = null;
    this.mediaStream?.getTracks().forEach(t => t.stop());
    this.mediaStream = null;
    this.audioContext?.close();
    this.audioContext = null;
    
    this.preBuffer = [];
    this.isRecording = false;
    this.isSpeechDetected = false;
    this.frameCount = 0;
  }

  private startVAD(): void {
    if (!this.analyser) return;
    
    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    const threshold = this.options.speechThreshold;
    let speechFrames = 0;
    let silenceFrames = 0;

    const check = () => {
      if (!this.analyser) return;
      
      this.analyser.getByteFrequencyData(dataArray);
      
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
      const volume = sum / dataArray.length / 255;
      
      if (volume > threshold) {
        silenceFrames = 0;
        speechFrames++;
        
        if (speechFrames >= 3 && !this.isSpeechDetected) {
          this.isSpeechDetected = true;
          this.speechStartTime = Date.now();
          this.onSpeechStart();
        }
      } else {
        speechFrames = 0;
        
        if (this.isSpeechDetected) {
          silenceFrames++;
          
          if (silenceFrames >= 20) {
            this.isSpeechDetected = false;
            this.onSpeechEnd();
          }
        }
      }
      
      this.vadFrameId = requestAnimationFrame(check);
    };
    
    this.vadFrameId = requestAnimationFrame(check);
  }

  private handleAudio(float32Data: Float32Array): void {
    const int16Data = new Int16Array(float32Data.length);
    for (let i = 0; i < float32Data.length; i++) {
      int16Data[i] = Math.min(1, Math.max(-1, float32Data[i])) * 32767;
    }
    
    if (this.isRecording && this.socket?.connected) {
      this.sendAudioData(int16Data);
    } else {
      // 预缓冲或丢弃
      this.preBuffer.push(int16Data);
      if (this.preBuffer.length > this.PREBUFFER_SIZE) this.preBuffer.shift();
    }
  }

  private sendAudioData(data: Int16Array): void {
    if (!this.socket?.connected) {
      console.log('[SimpleVoice] Cannot send: socket not connected');
      return;
    }
    
    this.frameCount++;
    if (this.frameCount % 10 === 0) {
      console.log('[SimpleVoice] Sent', this.frameCount, 'audio frames');
    }
    
    // 计算音频统计信息用于调试
    let maxVal = 0, sum = 0;
    for (let i = 0; i < data.length; i++) {
      const val = Math.abs(data[i]);
      maxVal = Math.max(maxVal, val);
      sum += val;
    }
    const avgVal = sum / data.length;
    
    if (this.frameCount <= 3) {
      console.log('[SimpleVoice] Audio stats - max:', maxVal, 'avg:', avgVal.toFixed(2));
    }
    
    // 将 Int16Array 转换为 Uint8Array (小端序)
    const uint8 = new Uint8Array(data.buffer);
    
    // 使用更可靠的 base64 编码
    const base64 = this.arrayBufferToBase64(uint8);
    this.socket.emit('audio', { audio: base64 });
  }
  
  private arrayBufferToBase64(buffer: Uint8Array): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private async onSpeechStart(): Promise<void> {
    console.log('[SimpleVoice] Speech start, connecting ASR...');
    
    try {
      await this.connectASR();
      console.log('[SimpleVoice] ASR connected successfully');
    } catch (err) {
      console.error('[SimpleVoice] ASR connection failed:', err);
      this.options.onError?.('ASR连接失败');
      return;
    }
    
    this.isRecording = true;
    console.log('[SimpleVoice] Started recording, flushing prebuffer:', this.preBuffer.length);
    
    for (const frame of this.preBuffer) this.sendAudioData(frame);
    this.preBuffer = [];
  }

  private onSpeechEnd(): void {
    console.log('[SimpleVoice] Speech end, duration:', Date.now() - this.speechStartTime);
    
    if (!this.isRecording) {
      console.log('[SimpleVoice] Not recording, skip');
      return;
    }
    
    this.isRecording = false;
    
    setTimeout(() => {
      if (this.socket?.connected) {
        console.log('[SimpleVoice] Sending finalize, total frames:', this.frameCount);
        this.socket.emit('finalize');
        
        // 30秒后断开（给足够时间接收结果）
        setTimeout(() => {
          if (this.socket?.connected) {
            console.log('[SimpleVoice] Disconnecting after timeout');
            this.socket.disconnect();
            this.socket = null;
          }
        }, 30000);
      } else {
        console.log('[SimpleVoice] Socket not connected when trying to finalize');
      }
    }, 200);
  }

  private connectASR(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.socket) {
        this.socket.disconnect();
        this.socket = null;
      }
      
      console.log('[SimpleVoice] Creating socket.io connection...');
      this.socket = io('/volcano-stt', { transports: ['websocket'], reconnection: false });
      
      this.socket.on('connect', () => {
        console.log('[SimpleVoice] Socket connected');
      });
      
      this.socket.on('connected', () => {
        console.log('[SimpleVoice] ASR ready event received');
        resolve();
      });
      
      this.socket.on('result', (data: { text: string; isFinal: boolean }) => {
        console.log('[SimpleVoice] ASR result:', data.text, 'final:', data.isFinal);
        if (!data.text) return;
        
        if (data.isFinal) {
          // 最终结果
          this.options.onTranscript?.(data.text);
        } else {
          // 中间结果（实时）
          this.options.onInterimTranscript?.(data.text);
        }
      });
      
      this.socket.on('error', (err: { message: string }) => {
        console.error('[SimpleVoice] ASR error:', err);
        this.options.onError?.(err.message);
      });
      
      this.socket.on('disconnect', (reason) => {
        console.log('[SimpleVoice] Socket disconnected:', reason);
      });
      
      this.socket.on('connect_error', (err) => {
        console.error('[SimpleVoice] Connect error:', err);
        reject(err);
      });
      
      setTimeout(() => reject(new Error('连接超时')), 5000);
    });
  }

  private setState(state: VoiceState): void {
    if (this.state === state) return;
    this.state = state;
    this.options.onStateChange?.(state);
  }
}

export default SimpleVoiceManager;
