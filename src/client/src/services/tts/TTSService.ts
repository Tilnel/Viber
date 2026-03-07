import { ITTSProvider, TTSProvider, TTSOptions, TTSState, TTSVoice } from './types';
import { BrowserTTSProvider } from './BrowserTTSProvider';
import { EdgeTTSProvider } from './EdgeTTSProvider';
import { cleanTextForTTS, cleanTextForTTSStreaming } from '../../utils/ttsTextCleaner';

/**
 * 统一 TTS 服务
 * 管理多个 TTS 提供器，支持切换
 */
class TTSService {
  private providers: Map<TTSProvider, ITTSProvider> = new Map();
  private currentProvider: ITTSProvider | null = null;
  private currentProviderName: TTSProvider = 'browser';
  private voiceQueue: string[] = [];
  private isProcessingQueue = false;
  private currentOptions: TTSOptions = {};

  constructor() {
    // 注册默认提供器
    this.registerProvider('browser', new BrowserTTSProvider());
    this.registerProvider('edge', new EdgeTTSProvider());
  }

  /**
   * 初始化 TTS 服务
   */
  async init(): Promise<void> {
    // 初始化所有提供器
    for (const [name, provider] of this.providers) {
      try {
        await provider.init();
        console.log(`[TTS] Provider ${name} initialized`);
      } catch (error) {
        console.error(`[TTS] Failed to initialize ${name}:`, error);
      }
    }

    // 默认使用 edge（质量更好），如果不可用则回退到 browser
    if (this.providers.get('edge')?.isReady) {
      await this.setProvider('edge');
    } else if (this.providers.get('browser')?.isReady) {
      await this.setProvider('browser');
    }
  }

  /**
   * 注册新的 TTS 提供器
   */
  registerProvider(name: TTSProvider, provider: ITTSProvider): void {
    this.providers.set(name, provider);
  }

  /**
   * 切换 TTS 提供器
   */
  async setProvider(name: TTSProvider): Promise<boolean> {
    const provider = this.providers.get(name);
    if (!provider) {
      console.error(`[TTS] Provider ${name} not found`);
      return false;
    }

    // 停止当前播放
    this.currentProvider?.stop();

    this.currentProvider = provider;
    this.currentProviderName = name;
    console.log(`[TTS] Switched to provider: ${name}`);
    return true;
  }

  /**
   * 获取当前提供器名称
   */
  getCurrentProvider(): TTSProvider {
    return this.currentProviderName;
  }

  /**
   * 获取所有可用的提供器
   */
  getAvailableProviders(): TTSProvider[] {
    return Array.from(this.providers.entries())
      .filter(([_, provider]) => provider.isReady)
      .map(([name, _]) => name);
  }

  /**
   * 获取当前提供器的语音列表
   */
  getVoices(): TTSVoice[] {
    return this.currentProvider?.getVoices() || [];
  }

  /**
   * 获取所有提供器的语音列表
   */
  getAllVoices(): { provider: TTSProvider; voices: TTSVoice[] }[] {
    return Array.from(this.providers.entries()).map(([name, provider]) => ({
      provider: name,
      voices: provider.getVoices(),
    }));
  }

  /**
   * 播放文本
   * 会自动清洗 Markdown 格式，转换为适合朗读的纯文本
   */
  async speak(text: string, options: TTSOptions = {}): Promise<void> {
    if (!this.currentProvider) {
      throw new Error('No TTS provider available');
    }
    this.currentOptions = options;
    
    // 清洗文本，移除 Markdown 标记
    const cleanedText = cleanTextForTTS(text, {
      keepCodeHint: true,
      codeHintText: '【以下是代码示例】',
      keepLinkUrl: false,
      keepEmojis: false,
    });
    
    if (!cleanedText.trim()) {
      console.log('[TTS] Text is empty after cleaning, skipping');
      return;
    }
    
    console.log('[TTS] Cleaned text for speech:', cleanedText.substring(0, 100) + '...');
    return this.currentProvider.speak(cleanedText, options);
  }

  /**
   * 流式播放 - 累积文本并适时播放
   * 适合 AI 流式输出的场景
   * 会自动清洗 Markdown 格式
   */
  async speakStreaming(text: string, options: TTSOptions = {}): Promise<void> {
    this.voiceQueue.push(text);
    
    if (this.isProcessingQueue) {
      return;
    }

    this.isProcessingQueue = true;

    // 等待一小段时间收集更多文本
    await new Promise(resolve => setTimeout(resolve, 150));

    // 合并队列中的文本
    const fullText = this.voiceQueue.join('');
    this.voiceQueue = [];
    this.isProcessingQueue = false;

    // 只播放有意义的片段
    // 策略：超过 10 个字，或包含完整句子标点
    if (fullText.length >= 10 || /[。！？.!?]/.test(fullText)) {
      // 流式清洗，处理未闭合的 Markdown
      const cleanedText = cleanTextForTTSStreaming(fullText, false, {
        keepCodeHint: true,
        codeHintText: '【代码】',
        keepLinkUrl: false,
        keepEmojis: false,
      });
      
      if (!cleanedText.trim()) {
        return;
      }
      
      // 如果正在播放，先停止
      if (this.getState() === 'speaking') {
        this.stop();
      }
      await this.speak(cleanedText, options);
    }
  }

  /**
   * 停止播放
   */
  stop(): void {
    this.voiceQueue = [];
    this.currentProvider?.stop();
  }

  /**
   * 暂停播放
   */
  pause(): void {
    this.currentProvider?.pause();
  }

  /**
   * 恢复播放
   */
  resume(): void {
    this.currentProvider?.resume();
  }

  /**
   * 获取当前状态
   */
  getState(): TTSState {
    return this.currentProvider?.getState() || 'idle';
  }

  /**
   * 是否正在播放
   */
  isSpeaking(): boolean {
    return this.getState() === 'speaking';
  }

  /**
   * 注册状态变化回调
   */
  onStateChange(callback: (state: TTSState) => void): () => void {
    const callbacks: (() => void)[] = [];
    for (const provider of this.providers.values()) {
      callbacks.push(provider.onStateChange(callback));
    }
    return () => callbacks.forEach(cb => cb());
  }

  /**
   * 注册播放进度回调
   */
  onBoundary(callback: (charIndex: number, charLength: number) => void): () => void {
    const callbacks: (() => void)[] = [];
    for (const provider of this.providers.values()) {
      callbacks.push(provider.onBoundary(callback));
    }
    return () => callbacks.forEach(cb => cb());
  }
}

// 导出单例
export const ttsService = new TTSService();
