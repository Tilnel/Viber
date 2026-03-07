/**
 * Simple Recorder - 简化版录音器
 * 
 * 职责：
 * 1. 纯音频采集
 * 2. 实时推送到后端
 * 3. 无 VAD 逻辑（后端处理）
 * 
 * @phase 4
 */

export type RecorderState = 'idle' | 'recording';

export interface RecorderOptions {
  sampleRate?: number;
  channelCount?: number;
  frameSize?: number;  // 每帧样本数
  onStateChange?: (state: RecorderState) => void;
  onAudioFrame?: (frame: Int16Array) => void;
  onVolume?: (volume: number) => void;  // 音量用于前端展示
  onError?: (error: string) => void;
}

/**
 * 简化版录音器
 * 只负责采集和推送，不做任何 VAD 处理
 */
export class SimpleRecorder {
  private state: RecorderState = 'idle';
  private options: Required<RecorderOptions>;
  
  // 音频上下文
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private analyser: AnalyserNode | null = null;
  
  // 音量监测
  private volumeInterval: number | null = null;

  constructor(options: RecorderOptions = {}) {
    this.options = {
      sampleRate: 16000,
      channelCount: 1,
      frameSize: 4096,
      onStateChange: () => {},
      onAudioFrame: () => {},
      onVolume: () => {},
      onError: () => {},
      ...options
    };
  }

  /**
   * 开始录音
   */
  async start(): Promise<boolean> {
    if (this.state === 'recording') {
      console.log('[SimpleRecorder] Already recording');
      return true;
    }

    try {
      console.log('[SimpleRecorder] Starting...');
      
      // 1. 获取麦克风权限
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: this.options.sampleRate,
          channelCount: this.options.channelCount,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      
      // 2. 创建音频上下文
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: this.options.sampleRate
      });
      
      // 3. 创建音频图
      const source = this.audioContext.createMediaStreamSource(this.mediaStream);
      
      // Analyser 用于音量监测（仅用于前端展示）
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      source.connect(this.analyser);
      
      // ScriptProcessor 用于采集音频
      this.scriptProcessor = this.audioContext.createScriptProcessor(
        this.options.frameSize,
        this.options.channelCount,
        1
      );
      
      // 4. 设置音频处理回调
      this.scriptProcessor.onaudioprocess = (e) => {
        this.handleAudioFrame(e.inputBuffer.getChannelData(0));
      };
      
      // 连接
      source.connect(this.scriptProcessor);
      this.scriptProcessor.connect(this.audioContext.destination);
      
      // 5. 启动音量监测
      this.startVolumeMonitor();
      
      this.setState('recording');
      console.log('[SimpleRecorder] Started');
      return true;
      
    } catch (error) {
      console.error('[SimpleRecorder] Start failed:', error);
      this.options.onError(error instanceof Error ? error.message : '启动失败');
      this.cleanup();
      return false;
    }
  }

  /**
   * 停止录音
   */
  stop(): void {
    if (this.state === 'idle') return;
    
    console.log('[SimpleRecorder] Stopping...');
    
    this.setState('idle');
    this.cleanup();
  }

  /**
   * 获取当前状态
   */
  getState(): RecorderState {
    return this.state;
  }

  /**
   * 是否正在录音
   */
  isRecording(): boolean {
    return this.state === 'recording';
  }

  // ========== 私有方法 ==========

  /**
   * 处理音频帧
   */
  private handleAudioFrame(float32Data: Float32Array): void {
    // 转换为 Int16 PCM
    const int16Data = new Int16Array(float32Data.length);
    for (let i = 0; i < float32Data.length; i++) {
      const val = Math.min(1, Math.max(-1, float32Data[i]));
      int16Data[i] = val * 32767;
    }
    
    // 推送到回调
    this.options.onAudioFrame(int16Data);
  }

  /**
   * 启动音量监测
   */
  private startVolumeMonitor(): void {
    if (!this.analyser) return;
    
    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    
    const updateVolume = () => {
      if (!this.analyser || this.state !== 'recording') return;
      
      this.analyser.getByteFrequencyData(dataArray);
      
      // 计算平均音量
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const volume = sum / dataArray.length / 255; // 0-1
      
      this.options.onVolume(volume);
      
      this.volumeInterval = window.requestAnimationFrame(updateVolume);
    };
    
    this.volumeInterval = window.requestAnimationFrame(updateVolume);
  }

  /**
   * 停止音量监测
   */
  private stopVolumeMonitor(): void {
    if (this.volumeInterval !== null) {
      cancelAnimationFrame(this.volumeInterval);
      this.volumeInterval = null;
    }
  }

  /**
   * 清理资源
   */
  private cleanup(): void {
    this.stopVolumeMonitor();
    
    // 断开音频处理
    try {
      this.scriptProcessor?.disconnect();
    } catch {
      // 忽略
    }
    this.scriptProcessor = null;
    
    // 停止媒体流
    this.mediaStream?.getTracks().forEach(track => track.stop());
    this.mediaStream = null;
    
    // 关闭音频上下文
    this.audioContext?.close().catch(() => {});
    this.audioContext = null;
    this.analyser = null;
    
    console.log('[SimpleRecorder] Cleaned up');
  }

  /**
   * 设置状态
   */
  private setState(state: RecorderState): void {
    if (this.state === state) return;
    this.state = state;
    this.options.onStateChange(state);
  }
}

// 单例导出
let globalRecorder: SimpleRecorder | null = null;

export function getRecorder(options?: RecorderOptions): SimpleRecorder {
  if (!globalRecorder) {
    globalRecorder = new SimpleRecorder(options);
  }
  return globalRecorder;
}

export function resetRecorder(): void {
  globalRecorder?.stop();
  globalRecorder = null;
}

export default SimpleRecorder;
