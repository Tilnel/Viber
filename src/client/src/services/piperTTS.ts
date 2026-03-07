// Piper TTS - 本地神经网络语音合成服务
import { cleanTextForTTS, cleanTextForTTSStreaming } from '../utils/ttsTextCleaner';

export interface PiperTTSOptions {
  model?: string;      // 模型 ID
  speed?: number;      // 语速，默认 1.0
}

export type PiperTTSState = 'idle' | 'synthesizing' | 'playing' | 'error';

class PiperTTSService {
  private currentAudio: HTMLAudioElement | null = null;
  private state: PiperTTSState = 'idle';
  private onStateChangeCallbacks: ((state: PiperTTSState) => void)[] = [];
  private defaultModel = 'zh_CN-huayan-medium';
  private audioQueue: string[] = [];
  private isPlayingQueue = false;

  // 合成并播放
  async speak(text: string, options: PiperTTSOptions = {}): Promise<void> {
    if (!text.trim()) return;
    
    // 清洗 Markdown 格式
    const cleanedText = cleanTextForTTS(text, {
      keepCodeHint: true,
      codeHintText: '【以下是代码示例】',
      keepLinkUrl: false,
      keepEmojis: false,
    });
    
    if (!cleanedText.trim()) {
      console.log('[PiperTTS] Text is empty after cleaning, skipping');
      return;
    }
    
    console.log('[PiperTTS] Cleaned text:', cleanedText.substring(0, 100) + '...');
    
    this.stop();
    
    this.setState('synthesizing');
    try {
      const audioUrl = await this.synthesize(cleanedText, options);
      this.setState('playing');
      await this.playAudio(audioUrl);
      this.setState('idle');
    } catch (error) {
      console.error('[PiperTTS] Error:', error);
      this.setState('error');
      throw error;
    }
  }

  // 流式播放
  async speakStreaming(text: string, options: PiperTTSOptions = {}): Promise<void> {
    if (!text.trim()) return;
    
    const sentences = this.splitIntoSentences(text);
    
    // 预加载第一段
    if (sentences.length > 0) {
      this.setState('synthesizing');
      try {
        const audioUrl = await this.synthesize(sentences[0], options);
        this.playQueue([audioUrl]);
      } catch (error) {
        console.error('[PiperTTS] Error synthesizing first chunk:', error);
      }
    }

    // 后台合成剩余段落
    const remainingUrls: string[] = [];
    for (let i = 1; i < sentences.length; i++) {
      try {
        const audioUrl = await this.synthesize(sentences[i], options);
        remainingUrls.push(audioUrl);
      } catch (error) {
        console.error(`[PiperTTS] Error synthesizing chunk ${i}:`, error);
      }
    }
    
    if (remainingUrls.length > 0) {
      this.playQueue(remainingUrls);
    }
  }

  // 分割文本
  private splitIntoSentences(text: string): string[] {
    const matches = text.match(/[^。！？.!?]+[。！？.!?]?/g);
    if (!matches) return [text];
    
    const result: string[] = [];
    let current = '';
    
    for (const match of matches) {
      if (current.length < 10) {
        current += match;
      } else {
        if (current) result.push(current);
        current = match;
      }
    }
    if (current) result.push(current);
    
    return result;
  }

  // 合成文本
  private async synthesize(text: string, options: PiperTTSOptions): Promise<string> {
    const model = options.model || this.defaultModel;
    const speed = options.speed || 1.2; // Piper 默认稍快

    const response = await fetch('/api/piper/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model, speed }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Unknown error' }));
      throw new Error(`Piper TTS error: ${error.message || response.status}`);
    }

    const blob = await response.blob();
    return URL.createObjectURL(blob);
  }

  // 播放队列
  private async playQueue(urls: string[]): Promise<void> {
    this.audioQueue.push(...urls);
    if (this.isPlayingQueue) return;
    
    this.isPlayingQueue = true;
    
    while (this.audioQueue.length > 0) {
      const url = this.audioQueue.shift();
      if (url) {
        this.setState('playing');
        await this.playAudio(url);
        URL.revokeObjectURL(url);
      }
    }
    
    this.isPlayingQueue = false;
    this.setState('idle');
  }

  // 播放音频
  private playAudio(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.currentAudio = new Audio(url);
      
      this.currentAudio.onended = () => {
        this.currentAudio = null;
        resolve();
      };
      
      this.currentAudio.onerror = (e) => {
        console.error('[PiperTTS] Audio error:', e);
        this.currentAudio = null;
        reject(new Error('Audio playback failed'));
      };

      this.currentAudio.play().catch(reject);
    });
  }

  // 停止
  stop() {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio = null;
    }
    this.audioQueue = [];
    this.setState('idle');
  }

  getState(): PiperTTSState {
    return this.state;
  }

  onStateChange(callback: (state: PiperTTSState) => void) {
    this.onStateChangeCallbacks.push(callback);
    return () => {
      this.onStateChangeCallbacks = this.onStateChangeCallbacks.filter(cb => cb !== callback);
    };
  }

  private setState(state: PiperTTSState) {
    this.state = state;
    this.onStateChangeCallbacks.forEach(cb => cb(state));
  }
}

export const piperTTSService = new PiperTTSService();
