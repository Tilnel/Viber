import { ITTSProvider, TTSVoice, TTSOptions, TTSState } from './types';

/**
 * 浏览器原生 TTS 提供器
 * 使用 Web Speech API
 */
export class BrowserTTSProvider implements ITTSProvider {
  readonly name = 'browser';
  private synthesis: SpeechSynthesis;
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private state: TTSState = 'idle';
  private voices: TTSVoice[] = [];
  private onStateChangeCallbacks: ((state: TTSState) => void)[] = [];
  private onBoundaryCallbacks: ((charIndex: number, charLength: number) => void)[] = [];

  constructor() {
    this.synthesis = window.speechSynthesis;
  }

  get isReady(): boolean {
    return this.voices.length > 0;
  }

  async init(): Promise<void> {
    return new Promise((resolve) => {
      const loadVoices = () => {
        const nativeVoices = this.synthesis.getVoices();
        this.voices = nativeVoices.map(v => ({
          id: v.voiceURI,
          name: v.name,
          lang: v.lang,
          gender: v.name.toLowerCase().includes('female') ? 'female' : 
                  v.name.toLowerCase().includes('male') ? 'male' : 'neutral',
          quality: 'medium'
        }));
        resolve();
      };

      if (this.synthesis.onvoiceschanged !== undefined) {
        this.synthesis.onvoiceschanged = loadVoices;
        // 有些浏览器已经加载好了
        if (this.synthesis.getVoices().length > 0) {
          loadVoices();
        }
      } else {
        loadVoices();
      }
    });
  }

  getVoices(): TTSVoice[] {
    return this.voices;
  }

  getChineseVoices(): TTSVoice[] {
    return this.voices.filter(v => v.lang.startsWith('zh') || v.lang.includes('CN'));
  }

  async speak(text: string, options: TTSOptions = {}): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!text.trim()) {
        resolve();
        return;
      }

      this.stop();

      const utterance = new SpeechSynthesisUtterance(text);
      
      utterance.rate = options.rate ?? 1.2;
      utterance.pitch = options.pitch ?? 1;
      utterance.volume = options.volume ?? 1;
      
      if (options.voice) {
        const nativeVoice = this.synthesis.getVoices().find(v => v.voiceURI === options.voice!.id);
        if (nativeVoice) {
          utterance.voice = nativeVoice;
        }
      } else {
        const chineseVoices = this.getChineseVoices();
        if (chineseVoices.length > 0) {
          const nativeVoice = this.synthesis.getVoices().find(v => v.voiceURI === chineseVoices[0].id);
          if (nativeVoice) utterance.voice = nativeVoice;
        }
      }

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
        console.error('[BrowserTTS] Error:', event.error);
        this.state = 'idle';
        this.currentUtterance = null;
        this.notifyStateChange();
        reject(new Error(event.error));
      };

      utterance.onboundary = (event) => {
        this.onBoundaryCallbacks.forEach(cb => cb(event.charIndex, event.charLength));
      };

      this.currentUtterance = utterance;
      this.synthesis.speak(utterance);
    });
  }

  stop(): void {
    if (this.synthesis.speaking || this.synthesis.pending) {
      this.synthesis.cancel();
    }
    this.currentUtterance = null;
    this.state = 'idle';
    this.notifyStateChange();
  }

  pause(): void {
    if (this.synthesis.speaking && !this.synthesis.paused) {
      this.synthesis.pause();
      this.state = 'paused';
      this.notifyStateChange();
    }
  }

  resume(): void {
    if (this.synthesis.paused) {
      this.synthesis.resume();
      this.state = 'speaking';
      this.notifyStateChange();
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
