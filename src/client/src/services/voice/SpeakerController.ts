/**
 * Speaker Controller - 前端语音播报控制器
 * 
 * 职责：
 * 1. 接收后端播放指令
 * 2. 管理音频播放队列
 * 3. 控制播放状态（播放/暂停/停止）
 * 
 * @phase 4
 */

export type SpeakerState = 'idle' | 'playing' | 'paused';

export interface SpeakerTask {
  id: string;
  type: 'thinking' | 'response' | 'tool_result' | 'notification';
  text?: string;
  audioData?: ArrayBuffer;
  audioUrl?: string;
  format?: string;
  sampleRate?: number;
  duration?: number;
}

export interface SpeakerOptions {
  onStateChange?: (state: SpeakerState) => void;
  onTaskStart?: (task: SpeakerTask) => void;
  onTaskComplete?: (task: SpeakerTask) => void;
  onTaskCancelled?: (task: SpeakerTask) => void;
  onError?: (error: string) => void;
}

export class SpeakerController {
  private state: SpeakerState = 'idle';
  private options: SpeakerOptions;
  
  // 队列
  private queue: SpeakerTask[] = [];
  private currentTask: SpeakerTask | null = null;
  
  // 音频播放
  private audioContext: AudioContext | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private gainNode: GainNode | null = null;
  private startTime = 0;
  private pauseTime = 0;
  
  // 状态
  private isProcessing = false;
  
  // 当前播放完成回调（用于通知 playAudio 的 Promise）
  private currentOnComplete: (() => void) | null = null;

  constructor(options: SpeakerOptions = {}) {
    this.options = options;
  }

  /**
   * 初始化音频上下文
   */
  async init(): Promise<boolean> {
    try {
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        this.gainNode = this.audioContext.createGain();
        this.gainNode.connect(this.audioContext.destination);
        console.log('[SpeakerController] Audio context initialized');
      }
      return true;
    } catch (error) {
      console.error('[SpeakerController] Init failed:', error);
      this.options.onError?.('初始化音频失败');
      return false;
    }
  }

  /**
   * 添加播放任务（由后端调用）
   */
  async enqueue(task: SpeakerTask): Promise<void> {
    console.log(`[SpeakerController] Enqueue task ${task.id}, type: ${task.type}`);
    
    // 确保已初始化
    if (!this.audioContext) {
      await this.init();
    }
    
    // 添加到队列
    this.queue.push(task);
    
    // 如果空闲，开始播放
    if (this.state === 'idle' && !this.isProcessing) {
      this.processQueue();
    }
  }

  /**
   * 播放音频数据（由后端调用）
   * 返回 Promise，在音频播放完成后 resolve
   */
  async playAudio(task: SpeakerTask): Promise<void> {
    if (!this.audioContext) {
      await this.init();
    }
    
    // 如果有正在播放的任务，停止它
    if (this.currentTask) {
      this.stopCurrent();
    }
    
    this.currentTask = task;
    this.setState('playing');
    this.options.onTaskStart?.(task);
    
    return new Promise((resolve, reject) => {
      // 存储完成回调，供 onPlaybackComplete 调用
      this.currentOnComplete = resolve;
      
      try {
        this.decodeAndPlay(task);
      } catch (error) {
        console.error('[SpeakerController] Play failed:', error);
        this.options.onError?.('播放音频失败');
        this.onPlaybackComplete();
        this.currentOnComplete = null;
        reject(error);
      }
    });
  }
  
  /**
   * 解码并播放音频
   */
  private async decodeAndPlay(task: SpeakerTask): Promise<void> {
    let audioBuffer: AudioBuffer;
    
    if (task.audioData) {
      // 根据格式解码
      if (task.format === 'pcm') {
        // PCM 格式：直接创建 AudioBuffer
        audioBuffer = this.decodePCM(task.audioData, task.sampleRate || 24000);
      } else {
        // MP3 等其他格式：使用浏览器解码
        audioBuffer = await this.audioContext!.decodeAudioData(task.audioData.slice(0));
      }
    } else if (task.audioUrl) {
      // 从 URL 加载
      const response = await fetch(task.audioUrl);
      const arrayBuffer = await response.arrayBuffer();
      audioBuffer = await this.audioContext!.decodeAudioData(arrayBuffer);
    } else {
      throw new Error('No audio data or URL provided');
    }
    
    // 创建音频源
    this.currentSource = this.audioContext!.createBufferSource();
    this.currentSource.buffer = audioBuffer;
    this.currentSource.connect(this.gainNode!);
    
    // 播放完成回调 - 关键：触发 onPlaybackComplete
    this.currentSource.onended = () => {
      this.onPlaybackComplete();
    };
    
    // 开始播放
    this.startTime = this.audioContext!.currentTime;
    this.currentSource.start(0);
    
    console.log(`[SpeakerController] Playing task ${task.id}, duration: ${audioBuffer.duration}s`);
  }

  /**
   * 停止所有播放并清空队列
   */
  stopAll(): void {
    console.log('[SpeakerController] Stop all');
    
    // 取消队列中的所有任务
    for (const task of this.queue) {
      this.options.onTaskCancelled?.(task);
    }
    this.queue = [];
    
    // 停止当前播放
    this.stopCurrent();
    
    this.setState('idle');
  }

  /**
   * 跳过当前任务
   */
  skip(): void {
    console.log('[SpeakerController] Skip current');
    this.stopCurrent();
    
    // 继续播放下一个
    if (this.queue.length > 0) {
      this.processQueue();
    } else {
      this.setState('idle');
    }
  }

  /**
   * 暂停播放
   */
  pause(): void {
    if (this.state === 'playing' && this.audioContext) {
      console.log('[SpeakerController] Pause');
      this.audioContext.suspend();
      this.pauseTime = this.audioContext.currentTime;
      this.setState('paused');
    }
  }

  /**
   * 恢复播放
   */
  resume(): void {
    if (this.state === 'paused' && this.audioContext) {
      console.log('[SpeakerController] Resume');
      this.audioContext.resume();
      this.setState('playing');
    }
  }

  /**
   * 获取当前状态
   */
  getState(): SpeakerState {
    return this.state;
  }

  /**
   * 获取队列信息
   */
  getQueueInfo(): { queueLength: number; currentTask: SpeakerTask | null } {
    return {
      queueLength: this.queue.length,
      currentTask: this.currentTask
    };
  }

  // ========== 私有方法 ==========

  /**
   * 处理播放队列
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) return;
    
    this.isProcessing = true;
    
    while (this.queue.length > 0) {
      const task = this.queue.shift()!;
      
      // 播放音频或文本
      if (task.audioData || task.audioUrl) {
        await this.playAudio(task);
      } else if (task.text) {
        // 如果需要 TTS，这里可以调用 TTS 服务
        // 简化起见，直接标记完成
        this.options.onTaskComplete?.(task);
      }
      
      // 如果状态变为 idle（被 stop），退出循环
      if (this.state === 'idle') break;
    }
    
    this.isProcessing = false;
  }

  /**
   * 停止当前播放
   */
  private stopCurrent(): void {
    if (this.currentSource) {
      try {
        this.currentSource.stop();
        this.currentSource.disconnect();
      } catch {
        // 可能已经停止
      }
      this.currentSource = null;
    }
    
    if (this.currentTask) {
      this.options.onTaskCancelled?.(this.currentTask);
      this.currentTask = null;
    }
  }

  /**
   * 播放完成回调
   */
  private onPlaybackComplete(): void {
    // 通知 playAudio 的 Promise 完成
    if (this.currentOnComplete) {
      this.currentOnComplete();
      this.currentOnComplete = null;
    }
    
    if (this.currentTask) {
      this.options.onTaskComplete?.(this.currentTask);
      this.currentTask = null;
    }
    
    this.currentSource = null;
    
    // 如果队列还有任务，继续播放
    if (this.queue.length > 0) {
      this.processQueue();
    } else {
      this.setState('idle');
    }
  }

  /**
   * 解码 PCM 数据为 AudioBuffer
   * 火山引擎 PCM 格式: 24kHz, 16bit, 单声道, 小端序
   */
  private decodePCM(pcmData: ArrayBuffer, sampleRate: number = 24000): AudioBuffer {
    const pcmArray = new Int16Array(pcmData);
    const audioBuffer = this.audioContext!.createBuffer(1, pcmArray.length, sampleRate);
    const channelData = audioBuffer.getChannelData(0);
    
    // Int16 (-32768 ~ 32767) 转 Float32 (-1.0 ~ 1.0)
    for (let i = 0; i < pcmArray.length; i++) {
      channelData[i] = pcmArray[i] / 32768;
    }
    
    return audioBuffer;
  }

  /**
   * 设置状态
   */
  private setState(state: SpeakerState): void {
    if (this.state === state) return;
    this.state = state;
    this.options.onStateChange?.(state);
  }

  /**
   * 销毁
   */
  destroy(): void {
    this.stopAll();
    this.gainNode?.disconnect();
    this.audioContext?.close();
    this.audioContext = null;
    this.gainNode = null;
  }
}

// 单例导出
let globalSpeakerController: SpeakerController | null = null;
let isCreatingSpeaker = false;

export function getSpeakerController(options?: SpeakerOptions): SpeakerController {
  if (!globalSpeakerController && !isCreatingSpeaker) {
    isCreatingSpeaker = true;
    globalSpeakerController = new SpeakerController(options);
    isCreatingSpeaker = false;
  }
  return globalSpeakerController!;
}

export function resetSpeakerController(): void {
  globalSpeakerController?.destroy();
  globalSpeakerController = null;
}

export default SpeakerController;
