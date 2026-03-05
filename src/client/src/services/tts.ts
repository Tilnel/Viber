// TTS (Text-to-Speech) 服务

export interface TTSOptions {
  rate?: number;      // 语速 0.1-10, default 1
  pitch?: number;     // 音调 0-2, default 1
  volume?: number;    // 音量 0-1, default 1
  voice?: SpeechSynthesisVoice;
}

export type TTSState = 'idle' | 'speaking' | 'paused';

class TTSService {
  private synthesis: SpeechSynthesis;
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private state: TTSState = 'idle';
  private onStateChangeCallbacks: ((state: TTSState) => void)[] = [];
  private onBoundaryCallbacks: ((event: SpeechSynthesisEvent) => void)[] = [];
  private voiceQueue: string[] = [];
  private isProcessingQueue = false;

  constructor() {
    this.synthesis = window.speechSynthesis;
    this.loadVoices();
  }

  // 获取可用语音
  getVoices(): SpeechSynthesisVoice[] {
    return this.synthesis.getVoices();
  }

  // 获取中文语音
  getChineseVoices(): SpeechSynthesisVoice[] {
    return this.getVoices().filter(v => 
      v.lang.startsWith('zh') || v.lang.includes('CN')
    );
  }

  // 加载语音列表
  private loadVoices() {
    // Chrome需要异步加载语音
    if (this.synthesis.onvoiceschanged !== undefined) {
      this.synthesis.onvoiceschanged = () => {
        console.log('[TTS] Voices loaded:', this.getVoices().length);
      };
    }
  }

  // 播放文本
  speak(text: string, options: TTSOptions = {}): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!text.trim()) {
        resolve();
        return;
      }

      // 如果正在播放，先停止
      this.stop();

      const utterance = new SpeechSynthesisUtterance(text);
      
      // 设置选项
      utterance.rate = options.rate ?? 1.2;  // 稍快一点，更自然
      utterance.pitch = options.pitch ?? 1;
      utterance.volume = options.volume ?? 1;
      
      // 选择语音
      if (options.voice) {
        utterance.voice = options.voice;
      } else {
        const chineseVoices = this.getChineseVoices();
        if (chineseVoices.length > 0) {
          utterance.voice = chineseVoices[0];
        }
      }

      // 事件处理
      utterance.onstart = () => {
        this.state = 'speaking';
        this.notifyStateChange();
      };

      utterance.onend = () => {
        this.state = 'idle';
        this.currentUtterance = null;
        this.notifyStateChange();
        resolve();
      };

      utterance.onerror = (event) => {
        console.error('[TTS] Error:', event.error);
        this.state = 'idle';
        this.currentUtterance = null;
        this.notifyStateChange();
        reject(new Error(event.error));
      };

      utterance.onboundary = (event) => {
        this.onBoundaryCallbacks.forEach(cb => cb(event));
      };

      this.currentUtterance = utterance;
      this.synthesis.speak(utterance);
    });
  }

  // 流式播放 - 累积文本并适时播放
  async speakStreaming(text: string, options: TTSOptions = {}): Promise<void> {
    // 将文本加入队列
    this.voiceQueue.push(text);
    
    if (this.isProcessingQueue) {
      return;
    }

    this.isProcessingQueue = true;

    // 等待一小段时间收集更多文本
    await new Promise(resolve => setTimeout(resolve, 100));

    // 合并队列中的文本
    const fullText = this.voiceQueue.join('');
    this.voiceQueue = [];
    this.isProcessingQueue = false;

    // 只播放有意义的片段（至少3个字或包含标点）
    if (fullText.length >= 3 || /[。！？.!?]/.test(fullText)) {
      await this.speak(fullText, options);
    }
  }

  // 停止播放
  stop() {
    if (this.synthesis.speaking || this.synthesis.pending) {
      this.synthesis.cancel();
    }
    this.currentUtterance = null;
    this.voiceQueue = [];
    this.state = 'idle';
    this.notifyStateChange();
  }

  // 暂停
  pause() {
    if (this.synthesis.speaking && !this.synthesis.paused) {
      this.synthesis.pause();
      this.state = 'paused';
      this.notifyStateChange();
    }
  }

  // 恢复
  resume() {
    if (this.synthesis.paused) {
      this.synthesis.resume();
      this.state = 'speaking';
      this.notifyStateChange();
    }
  }

  // 获取当前状态
  getState(): TTSState {
    return this.state;
  }

  // 是否正在播放
  isSpeaking(): boolean {
    return this.synthesis.speaking;
  }

  // 注册状态变化回调
  onStateChange(callback: (state: TTSState) => void) {
    this.onStateChangeCallbacks.push(callback);
    return () => {
      this.onStateChangeCallbacks = this.onStateChangeCallbacks.filter(cb => cb !== callback);
    };
  }

  // 注册播放进度回调
  onBoundary(callback: (event: SpeechSynthesisEvent) => void) {
    this.onBoundaryCallbacks.push(callback);
    return () => {
      this.onBoundaryCallbacks = this.onBoundaryCallbacks.filter(cb => cb !== callback);
    };
  }

  private notifyStateChange() {
    this.onStateChangeCallbacks.forEach(cb => cb(this.state));
  }
}

// 单例实例
export const ttsService = new TTSService();
