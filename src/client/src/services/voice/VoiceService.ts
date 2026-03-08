/**
 * Voice Service - 统一语音服务
 * 
 * 整合：
 * - SimpleRecorder: 音频采集
 * - SpeakerController: 音频播放
 * - VoiceSocketService: 前后端通信
 * 
 * @phase 4
 */

import { SimpleRecorder, RecorderState } from './SimpleRecorder';
import { SpeakerController, SpeakerState, SpeakerTask, getSpeakerController } from './SpeakerController';
import { VoiceSocketService, VoiceMessageType, SpeakerTaskMessage } from './VoiceSocketService';

export type VoiceServiceState = 'idle' | 'listening' | 'processing' | 'speaking';

export interface VoiceServiceOptions {
  onStateChange?: (state: VoiceServiceState) => void;
  onTranscript?: (text: string, isFinal: boolean) => void;
  onAIResponse?: (text: string) => void;
  onError?: (error: string) => void;
}

/**
 * 统一语音服务
 * 封装所有语音相关功能
 */
export class VoiceService {
  private state: VoiceServiceState = 'idle';
  private options: VoiceServiceOptions;
  
  // 子服务
  private recorder: SimpleRecorder;
  private speaker: SpeakerController;
  private socket: VoiceSocketService;
  
  // 状态
  private isInitialized = false;

  constructor(options: VoiceServiceOptions = {}) {
    this.options = options;
    
    // 初始化录音器（纯采集，无 VAD）
    this.recorder = new SimpleRecorder({
      onAudioFrame: (frame) => this.handleAudioFrame(frame),
      onVolume: (volume) => this.handleVolume(volume),
      onStateChange: (state) => this.handleRecorderStateChange(state),
      onError: (error) => this.handleError(error)
    });
    
    // 初始化播放器（使用单例，避免与 NewVoiceService 重复创建）
    this.speaker = getSpeakerController({
      onStateChange: (state) => this.handleSpeakerStateChange(state),
      onTaskStart: (task) => console.log('[VoiceService] Task start:', task.id),
      onTaskComplete: (task) => this.handleTaskComplete(task),
      onTaskCancelled: (task) => console.log('[VoiceService] Task cancelled:', task.id),
      onError: (error) => this.handleError(error)
    });
    
    // 初始化 Socket 服务
    this.socket = new VoiceSocketService({
      onConnect: () => console.log('[VoiceService] Socket connected'),
      onDisconnect: (reason) => console.log('[VoiceService] Socket disconnected:', reason),
      onSpeakerTask: (task) => this.handleSpeakerTask(task),
      onSpeakerStop: () => this.speaker.stopAll(),
      onASRResult: (text, isFinal) => this.handleASRResult(text, isFinal),
      onVolumeUpdate: (volume) => {
        // 这里可以使用后端计算的音量
      },
      onStateChange: (state) => this.handleBackendStateChange(state),
      onError: (error) => this.handleError(error)
    });
  }

  /**
   * 初始化服务
   */
  async init(): Promise<boolean> {
    if (this.isInitialized) return true;
    
    try {
      // 初始化音频上下文（用于播放）
      const speakerReady = await this.speaker.init();
      if (!speakerReady) {
        throw new Error('Speaker initialization failed');
      }
      
      // 连接 WebSocket
      const socketReady = await this.socket.connect();
      if (!socketReady) {
        throw new Error('Socket connection failed');
      }
      
      this.isInitialized = true;
      console.log('[VoiceService] Initialized');
      return true;
      
    } catch (error) {
      console.error('[VoiceService] Init failed:', error);
      this.options.onError?.(error instanceof Error ? error.message : '初始化失败');
      return false;
    }
  }

  /**
   * 开始语音对话
   */
  async start(): Promise<boolean> {
    if (!this.isInitialized) {
      const ready = await this.init();
      if (!ready) return false;
    }
    
    if (this.state !== 'idle') {
      console.log('[VoiceService] Already active');
      return true;
    }
    
    // 启动录音器
    const success = await this.recorder.start();
    if (!success) {
      return false;
    }
    
    this.setState('listening');
    return true;
  }

  /**
   * 停止语音对话
   */
  stop(): void {
    if (this.state === 'idle') return;
    
    console.log('[VoiceService] Stopping...');
    
    this.recorder.stop();
    this.speaker.stopAll();
    this.socket.stopAudioStream();
    
    this.setState('idle');
  }

  /**
   * 打断（用户说话时调用）
   */
  interrupt(): void {
    console.log('[VoiceService] Interrupting...');
    
    // 停止播放
    this.speaker.stopAll();
    
    // 通知后端打断
    // this.socket.emit('interrupt');
    
    // 回到聆听状态
    if (this.recorder.isRecording()) {
      this.setState('listening');
    }
  }

  /**
   * 获取当前状态
   */
  getState(): VoiceServiceState {
    return this.state;
  }

  /**
   * 销毁服务
   */
  destroy(): void {
    this.stop();
    this.socket.disconnect();
    this.speaker.destroy();
    this.isInitialized = false;
  }

  // ========== 事件处理器 ==========

  /**
   * 处理音频帧（来自 Recorder）
   * 直接推送到后端
   */
  private handleAudioFrame(frame: Int16Array): void {
    this.socket.sendAudioFrame(frame);
  }

  /**
   * 处理音量（来自 Recorder）
   * 仅用于前端可视化
   */
  private handleVolume(volume: number): void {
    // 可以发射事件给 UI 显示音量条
  }

  /**
   * 处理 ASR 结果（来自后端）
   */
  private handleASRResult(text: string, isFinal: boolean): void {
    this.options.onTranscript?.(text, isFinal);
    
    if (isFinal) {
      // 用户说话结束，进入处理状态
      this.setState('processing');
    }
  }

  /**
   * 处理播报任务（来自后端）
   */
  private async handleSpeakerTask(message: SpeakerTaskMessage): Promise<void> {
    const task: SpeakerTask = {
      id: message.taskId,
      type: message.taskType,
      text: message.text,
      format: message.format,
      duration: message.duration
    };
    
    // 如果有音频数据，解码
    if (message.audioData) {
      const binary = atob(message.audioData);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      task.audioData = bytes.buffer;
    } else if (message.audioUrl) {
      task.audioUrl = message.audioUrl;
    }
    
    // 添加到播放器队列
    await this.speaker.enqueue(task);
  }

  /**
   * 处理任务完成
   */
  private handleTaskComplete(task: SpeakerTask): void {
    // 通知后端播放完成
    this.socket.notifyPlaybackComplete(task.id);
    
    // 如果所有任务完成且处于处理状态，回到聆听
    const info = this.speaker.getQueueInfo();
    if (info.queueLength === 0 && this.state === 'speaking') {
      this.setState('listening');
    }
  }

  /**
   * 处理录音器状态变化
   */
  private handleRecorderStateChange(state: RecorderState): void {
    console.log('[VoiceService] Recorder state:', state);
  }

  /**
   * 处理播放器状态变化
   */
  private handleSpeakerStateChange(state: SpeakerState): void {
    console.log('[VoiceService] Speaker state:', state);
    
    if (state === 'playing') {
      this.setState('speaking');
    }
  }

  /**
   * 处理后端状态变化
   */
  private handleBackendStateChange(state: string): void {
    console.log('[VoiceService] Backend state:', state);
    
    // 可以同步后端状态到前端
    switch (state) {
      case 'idle':
        this.setState('idle');
        break;
      case 'listening':
        this.setState('listening');
        break;
      case 'processing':
        this.setState('processing');
        break;
      case 'speaking':
        this.setState('speaking');
        break;
    }
  }

  /**
   * 处理错误
   */
  private handleError(error: string): void {
    console.error('[VoiceService] Error:', error);
    this.options.onError?.(error);
  }

  /**
   * 设置状态
   */
  private setState(state: VoiceServiceState): void {
    if (this.state === state) return;
    console.log('[VoiceService] State:', this.state, '->', state);
    this.state = state;
    this.options.onStateChange?.(state);
  }
}

// 单例导出
let globalVoiceService: VoiceService | null = null;

export function getVoiceService(options?: VoiceServiceOptions): VoiceService {
  console.warn('[VoiceService] 已弃用，请使用 getNewVoiceService()');
  if (!globalVoiceService) {
    globalVoiceService = new VoiceService(options);
  }
  return globalVoiceService;
}

export function resetVoiceService(): void {
  globalVoiceService?.destroy();
  globalVoiceService = null;
}

export default VoiceService;
