// TTS 类型定义

export type TTSState = 'idle' | 'speaking' | 'paused' | 'loading';
export type TTSProvider = 'browser' | 'edge' | 'baidu' | 'xunfei';

export interface TTSVoice {
  id: string;
  name: string;
  lang: string;
  gender?: 'male' | 'female' | 'neutral';
  quality?: 'low' | 'medium' | 'high';
}

export interface TTSOptions {
  rate?: number;      // 语速 0.5-2
  pitch?: number;     // 音调 0.5-2
  volume?: number;    // 音量 0-1
  voice?: TTSVoice;
}

export interface TTSProviderConfig {
  name: string;
  description: string;
  requiresBackend: boolean;
  voices: TTSVoice[];
}

// 后端 TTS 请求
export interface TTSSynthesisRequest {
  text: string;
  voice?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
}

// 后端 TTS 响应
export interface TTSSynthesisResponse {
  audioUrl?: string;
  audioBase64?: string;
  error?: string;
}

// 统一 TTS 接口
export interface ITTSProvider {
  readonly name: TTSProvider;
  readonly isReady: boolean;
  
  init(): Promise<void>;
  getVoices(): TTSVoice[];
  speak(text: string, options?: TTSOptions): Promise<void>;
  stop(): void;
  pause(): void;
  resume(): void;
  getState(): TTSState;
  onStateChange(callback: (state: TTSState) => void): () => void;
  onBoundary(callback: (charIndex: number, charLength: number) => void): () => void;
}
