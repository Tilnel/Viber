// Edge TTS (Microsoft) - 更好的语音合成
// 使用 Microsoft 的在线 TTS 服务，无需 API key

export interface EdgeTTSOptions {
  voice?: string;      // 声音
  rate?: string;       // 语速，如 "+0%", "+20%", "-10%"
  volume?: string;     // 音量，如 "+0%", "+50%"
  pitch?: string;      // 音调，如 "+0Hz", "+50Hz"
}

export type EdgeTTSState = 'idle' | 'synthesizing' | 'playing' | 'paused' | 'error';

// 中文声音选项
export const CHINESE_VOICES = [
  { name: 'zh-CN-XiaoxiaoNeural', desc: '晓晓 (女声，自然)', default: true },
  { name: 'zh-CN-YunxiNeural', desc: '云希 (男声，自然)' },
  { name: 'zh-CN-YunjianNeural', desc: '云健 (男声，新闻)' },
  { name: 'zh-CN-XiaoyiNeural', desc: '晓伊 (女声，温柔)' },
  { name: 'zh-CN-YunyangNeural', desc: '云扬 (男声，新闻)' },
  { name: 'zh-CN-XiaochenNeural', desc: '晓晨 (女声，活泼)' },
  { name: 'zh-CN-XiaohanNeural', desc: '晓涵 (女声，温柔)' },
  { name: 'zh-CN-XiaomengNeural', desc: '晓梦 (女声，甜美)' },
  { name: 'zh-CN-XiaomoNeural', desc: '晓墨 (女声，知性)' },
  { name: 'zh-CN-XiaoqiuNeural', desc: '晓秋 (女声，成熟)' },
  { name: 'zh-CN-XiaoruiNeural', desc: '晓睿 (女声，专业)' },
  { name: 'zh-CN-XiaoshuangNeural', desc: '晓双 (女声，可爱)' },
  { name: 'zh-CN-XiaoxuanNeural', desc: '晓萱 (女声，温柔)' },
  { name: 'zh-CN-XiaoyanNeural', desc: '晓妍 (女声，标准)' },
  { name: 'zh-CN-XiaoyouNeural', desc: '晓悠 (女声，童声)' },
  { name: 'zh-CN-XiaozhenNeural', desc: '晓甄 (女声，成熟)' },
  { name: 'zh-HK-HiuMaanNeural', desc: '晓曼 (粤语女声)' },
  { name: 'zh-HK-WanLungNeural', desc: '云龙 (粤语男声)' },
  { name: 'zh-TW-HsiaoChenNeural', desc: '晓臻 (台湾女声)' },
  { name: 'zh-TW-YunJheNeural', desc: '云哲 (台湾男声)' },
];

class EdgeTTSService {
  private currentAudio: HTMLAudioElement | null = null;
  private state: EdgeTTSState = 'idle';
  private onStateChangeCallbacks: ((state: EdgeTTSState) => void)[] = [];
  private defaultVoice = 'zh-CN-XiaoxiaoNeural';

  // 获取声音列表
  getVoices() {
    return CHINESE_VOICES;
  }

  // 获取默认声音
  getDefaultVoice(): string {
    return this.defaultVoice;
  }

  // 设置默认声音
  setDefaultVoice(voice: string) {
    this.defaultVoice = voice;
  }

  // 合成并播放
  async speak(text: string, options: EdgeTTSOptions = {}): Promise<void> {
    if (!text.trim()) return;
    this.stop();
    
    this.setState('synthesizing');
    const audioUrl = await this.synthesize(text, options);
    
    this.setState('playing');
    await this.playAudio(audioUrl);
    this.setState('idle');
  }

  // 流式播放
  async speakStreaming(text: string, options: EdgeTTSOptions = {}): Promise<void> {
    if (!text.trim()) return;
    
    // 收集文本片段
    const sentences = this.splitIntoSentences(text);
    
    // 预加载第一段
    if (sentences.length > 0) {
      this.setState('synthesizing');
      try {
        const audioUrl = await this.synthesize(sentences[0], options);
        this.playQueue([audioUrl]);
      } catch (error) {
        console.error('[EdgeTTS] Error synthesizing first chunk:', error);
      }
    }

    // 后台合成剩余段落
    const remainingUrls: string[] = [];
    for (let i = 1; i < sentences.length; i++) {
      try {
        const audioUrl = await this.synthesize(sentences[i], options);
        remainingUrls.push(audioUrl);
      } catch (error) {
        console.error(`[EdgeTTS] Error synthesizing chunk ${i}:`, error);
      }
    }
    
    // 添加到播放队列
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

  // 合成文本返回音频 URL
  private async synthesize(text: string, options: EdgeTTSOptions): Promise<string> {
    const voice = options.voice || this.defaultVoice;
    const rate = options.rate || '+20%';
    const volume = options.volume || '+0%';
    const pitch = options.pitch || '+0Hz';

    const response = await fetch('/api/tts/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice, rate, volume, pitch }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Unknown error' }));
      throw new Error(`TTS API error: ${error.message || response.status}`);
    }

    const blob = await response.blob();
    return URL.createObjectURL(blob);
  }

  private audioQueue: string[] = [];
  private isPlayingQueue = false;

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
      this.currentAudio.playbackRate = 1.0;
      
      this.currentAudio.onended = () => {
        this.currentAudio = null;
        resolve();
      };
      
      this.currentAudio.onerror = (e) => {
        console.error('[EdgeTTS] Audio error:', e);
        this.currentAudio = null;
        reject(new Error('Audio playback failed'));
      };

      this.currentAudio.play().catch(reject);
    });
  }

  // 停止播放
  stop() {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio = null;
    }
    this.audioQueue = [];
    this.setState('idle');
  }

  // 暂停
  pause() {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.setState('paused');
    }
  }

  // 恢复
  resume() {
    if (this.currentAudio) {
      this.currentAudio.play();
      this.setState('playing');
    }
  }

  getState(): EdgeTTSState {
    return this.state;
  }

  onStateChange(callback: (state: EdgeTTSState) => void) {
    this.onStateChangeCallbacks.push(callback);
    return () => {
      this.onStateChangeCallbacks = this.onStateChangeCallbacks.filter(cb => cb !== callback);
    };
  }

  private setState(state: EdgeTTSState) {
    this.state = state;
    this.onStateChangeCallbacks.forEach(cb => cb(state));
  }
}

export const edgeTTSService = new EdgeTTSService();
