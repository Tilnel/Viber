import { ITTSProvider, TTSVoice, TTSOptions, TTSState, TTSSynthesisRequest } from './types';

/**
 * Edge TTS 提供器 (微软 Azure TTS)
 * 通过后端代理访问 Edge TTS 服务
 * 
 * Edge TTS 特点：
 * - 免费使用
 * - 中文语音质量好
 * - 支持多种音色（晓晓、晓伊、云扬等）
 * - 支持 SSML 高级控制
 */
export class EdgeTTSProvider implements ITTSProvider {
  readonly name = 'edge';
  private state: TTSState = 'idle';
  private voices: TTSVoice[] = [];
  private onStateChangeCallbacks: ((state: TTSState) => void)[] = [];
  private onBoundaryCallbacks: ((charIndex: number, charLength: number) => void)[] = [];
  private currentAudio: HTMLAudioElement | null = null;
  private abortController: AbortController | null = null;

  // Edge TTS 中文语音列表
  static readonly DEFAULT_VOICES: TTSVoice[] = [
    { id: 'zh-CN-XiaoxiaoNeural', name: '晓晓（女，活泼）', lang: 'zh-CN', gender: 'female', quality: 'high' },
    { id: 'zh-CN-XiaoyiNeural', name: '晓伊（女，温柔）', lang: 'zh-CN', gender: 'female', quality: 'high' },
    { id: 'zh-CN-YunjianNeural', name: '云健（男，新闻）', lang: 'zh-CN', gender: 'male', quality: 'high' },
    { id: 'zh-CN-YunxiNeural', name: '云希（男，活泼）', lang: 'zh-CN', gender: 'male', quality: 'high' },
    { id: 'zh-CN-YunxiaNeural', name: '云夏（男，少年）', lang: 'zh-CN', gender: 'male', quality: 'high' },
    { id: 'zh-CN-YunyangNeural', name: '云扬（男，专业）', lang: 'zh-CN', gender: 'male', quality: 'high' },
    { id: 'zh-CN-liaoning-XiaobeiNeural', name: '晓北（女，东北话）', lang: 'zh-CN', gender: 'female', quality: 'high' },
    { id: 'zh-CN-shaanxi-XiaoniNeural', name: '晓妮（女，陕西话）', lang: 'zh-CN', gender: 'female', quality: 'high' },
    { id: 'zh-HK-HiuMaanNeural', name: '晓曼（女，粤语）', lang: 'zh-HK', gender: 'female', quality: 'high' },
    { id: 'zh-TW-HsiaoChenNeural', name: '晓臻（女，台湾）', lang: 'zh-TW', gender: 'female', quality: 'high' },
  ];

  constructor() {
    this.voices = EdgeTTSProvider.DEFAULT_VOICES;
  }

  get isReady(): boolean {
    return true; // Edge TTS 总是可用（依赖后端）
  }

  async init(): Promise<void> {
    // 从后端获取可用语音列表（可选）
    try {
      const response = await fetch('/api/tts/voices');
      if (response.ok) {
        const data = await response.json();
        if (data.voices && data.voices.length > 0) {
          this.voices = data.voices;
        }
      }
    } catch {
      // 使用默认列表
    }
  }

  getVoices(): TTSVoice[] {
    return this.voices;
  }

  async speak(text: string, options: TTSOptions = {}): Promise<void> {
    if (!text.trim()) return;

    this.stop();
    this.abortController = new AbortController();

    try {
      this.state = 'loading';
      this.notifyStateChange();

      const request: TTSSynthesisRequest = {
        text,
        voice: options.voice?.id || 'zh-CN-XiaoxiaoNeural',
        rate: options.rate,
        pitch: options.pitch,
        volume: options.volume,
      };

      console.log('[EdgeTTS] Sending request:', request);
      
      const response = await fetch('/api/tts/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: this.abortController.signal,
      });

      console.log('[EdgeTTS] Response status:', response.status, response.statusText);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || `TTS request failed: ${response.statusText}`);
      }

      // 后端直接返回音频二进制数据，不是 JSON
      const audioBlob = await response.blob();
      console.log('[EdgeTTS] Received audio blob:', audioBlob.size, 'bytes, type:', audioBlob.type);
      
      const audioUrl = URL.createObjectURL(audioBlob);
      console.log('[EdgeTTS] Created audio URL:', audioUrl);

      // 播放音频
      await this.playAudio(audioUrl);

    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        this.state = 'idle';
        this.notifyStateChange();
        throw error;
      }
    }
  }

  private audioUrl: string | null = null;

  private async playAudio(audioSource: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const audio = new Audio();
      this.currentAudio = audio;

      // 支持 base64 或 URL
      if (audioSource.startsWith('data:') || audioSource.startsWith('http') || audioSource.startsWith('blob:')) {
        audio.src = audioSource;
        this.audioUrl = audioSource;
      } else {
        audio.src = `data:audio/mp3;base64,${audioSource}`;
      }

      audio.oncanplay = () => {
        this.state = 'speaking';
        this.notifyStateChange();
      };

      audio.onended = () => {
        this.cleanupAudio();
        resolve();
      };

      audio.onerror = (e) => {
        this.cleanupAudio();
        reject(new Error('Audio playback failed'));
      };

      audio.onpause = () => {
        if (this.state === 'speaking') {
          this.state = 'paused';
          this.notifyStateChange();
        }
      };

      audio.onplay = () => {
        if (this.state === 'paused') {
          this.state = 'speaking';
          this.notifyStateChange();
        }
      };

      audio.play().catch(reject);
    });
  }

  private cleanupAudio(): void {
    this.state = 'idle';
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.currentAudio = null;
    }
    // 释放 blob URL
    if (this.audioUrl && this.audioUrl.startsWith('blob:')) {
      URL.revokeObjectURL(this.audioUrl);
      this.audioUrl = null;
    }
    this.notifyStateChange();
  }

  stop(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.cleanupAudio();
  }

  pause(): void {
    if (this.currentAudio && this.state === 'speaking') {
      this.currentAudio.pause();
    }
  }

  resume(): void {
    if (this.currentAudio && this.state === 'paused') {
      this.currentAudio.play();
    }
  }

  getState(): TTSState {
    return this.state;
  }

  onStateChange(callback: (state: TTSState) => void): () => void {
    this.onStateChangeCallbacks.push(callback);
    return () => {
      this.onStateChangeCallbacks = this.onStateChangeCallbacks.filter(cb => cb !== callback);
    };
  }

  onBoundary(callback: (charIndex: number, charLength: number) => void): () => void {
    this.onBoundaryCallbacks.push(callback);
    return () => {
      this.onBoundaryCallbacks = this.onBoundaryCallbacks.filter(cb => cb !== callback);
    };
  }

  private notifyStateChange() {
    this.onStateChangeCallbacks.forEach(cb => cb(this.state));
  }
}
