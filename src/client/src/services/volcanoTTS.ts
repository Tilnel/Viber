// 火山引擎语音合成 (TTS) 服务
// MP3格式音频，需要decodeAudioData解码后播放

import { API_BASE_URL } from './config';

export interface Voice {
  id: string;
  name: string;
}

export interface TTSOptions {
  voice?: string;
  speed?: number;
}

export class VolcanoTTSService {
  private audioContext: AudioContext | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private currentAudio: HTMLAudioElement | null = null; // 流式播放的audio元素
  private currentMediaSource: MediaSource | null = null; // 流式播放的mediaSource
  private isPlaying = false;

  constructor() {
    this.initAudioContext();
  }

  private initAudioContext() {
    if (typeof window !== 'undefined') {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
  }

  // PCM Int16 转 Float32
  private pcm16ToFloat32(pcmData: Int16Array): Float32Array {
    const floatData = new Float32Array(pcmData.length);
    for (let i = 0; i < pcmData.length; i++) {
      floatData[i] = pcmData[i] / 32768;
    }
    return floatData;
  }

  // 获取音色列表
  async getVoices(): Promise<Voice[]> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/volcano/tts/voices`, {
        credentials: 'include',
      });
      const data = await response.json();
      return data.voices || [];
    } catch (error) {
      console.error('[VolcanoTTS] Failed to get voices:', error);
      return [
        { id: 'BV001_streaming', name: '通用女声' },
        { id: 'BV002_streaming', name: '通用男声' },
      ];
    }
  }

  // 将长文本拆分成多个片段（每段不超过300字符/900字节，避免1024字节限制）
  private splitTextForTTS(text: string): string[] {
    const maxChars = 300; // 严格限制，中文可能占3字节
    const maxBytes = 900; // 留 124 字节余量给协议头
    
    const segments: string[] = [];
    
    // 计算UTF-8字节长度
    const byteLength = (str: string) => new TextEncoder().encode(str).length;
    
    // 按句子拆分（优先在句号、问号、感叹号处分割）
    const sentences = text.split(/([。！？.!?；;\n]+)/);
    let currentSegment = '';
    
    for (let i = 0; i < sentences.length; i++) {
      const part = sentences[i];
      if (!part) continue;
      
      const combined = currentSegment + part;
      // 检查字符数和字节数
      if (combined.length <= maxChars && byteLength(combined) <= maxBytes) {
        currentSegment = combined;
      } else {
        // 保存当前片段
        if (currentSegment.trim()) {
          segments.push(currentSegment.trim());
        }
        
        // 如果单句就超过限制，需要强制截断
        if (part.length > maxChars || byteLength(part) > maxBytes) {
          // 按字符逐个添加，确保不超限
          let subSegment = '';
          for (const char of part) {
            const test = subSegment + char;
            if (test.length > maxChars || byteLength(test) > maxBytes) {
              if (subSegment.trim()) {
                segments.push(subSegment.trim());
              }
              subSegment = char;
            } else {
              subSegment = test;
            }
          }
          currentSegment = subSegment;
        } else {
          currentSegment = part;
        }
      }
    }
    
    // 添加最后一段
    if (currentSegment.trim()) {
      segments.push(currentSegment.trim());
    }
    
    // 最终检查：确保每段都不超限
    return segments.map(s => {
      if (s.length > maxChars || byteLength(s) > maxBytes) {
        // 强制截断
        let result = '';
        for (const char of s) {
          const test = result + char;
          if (test.length > maxChars || byteLength(test) > maxBytes) {
            break;
          }
          result = test;
        }
        return result;
      }
      return s;
    }).filter(s => s.length > 0);
  }

  // 合成并播放（支持长文本自动拆分）
  async synthesize(text: string, options: TTSOptions = {}): Promise<boolean> {
    if (!text.trim()) return false;

    const segments = this.splitTextForTTS(text.trim());
    console.log('[VolcanoTTS] Text split into', segments.length, 'segments');
    
    if (segments.length === 0) return false;
    
    // 单段直接播放
    if (segments.length === 1) {
      return this.synthesizeSegment(segments[0], options);
    }
    
    // 多段顺序播放
    this.stop(); // 先停止当前播放
    this.isPlaying = true;
    
    for (let i = 0; i < segments.length; i++) {
      if (!this.isPlaying) break; // 被打断
      console.log(`[VolcanoTTS] Playing segment ${i + 1}/${segments.length}`);
      await this.synthesizeSegment(segments[i], options, true);
    }
    
    this.isPlaying = false;
    return true;
  }
  
  // 合成单段
  private async synthesizeSegment(text: string, options: TTSOptions, waitForEnd = false): Promise<boolean> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/volcano/tts/synthesize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          text: text.trim(),
          voice: options.voice || 'BV001_streaming',
          speed: options.speed || 1.0,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'TTS synthesis failed');
      }

      // 获取MP3数据并解码
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await this.audioContext!.decodeAudioData(arrayBuffer);
      
      if (waitForEnd) {
        await this.playBufferAndWait(audioBuffer);
      } else {
        this.playBuffer(audioBuffer);
      }

      return true;
    } catch (error) {
      console.error('[VolcanoTTS] Segment synthesis error:', error);
      return false;
    }
  }
  
  // 播放并等待结束
  private playBufferAndWait(buffer: AudioBuffer): Promise<void> {
    return new Promise((resolve) => {
      if (!this.audioContext) {
        resolve();
        return;
      }

      // 存储到 currentSource 以便可以被 stop() 控制
      this.currentSource = this.audioContext.createBufferSource();
      this.currentSource.buffer = buffer;
      this.currentSource.connect(this.audioContext.destination);
      this.currentSource.start(0);

      this.currentSource.onended = () => {
        this.currentSource?.disconnect();
        this.currentSource = null;
        resolve();
      };
    });
  }

  // 播放音频缓冲区
  private playBuffer(buffer: AudioBuffer) {
    if (!this.audioContext) return;

    this.stop();

    this.currentSource = this.audioContext.createBufferSource();
    this.currentSource.buffer = buffer;
    this.currentSource.connect(this.audioContext.destination);
    this.currentSource.start(0);
    this.isPlaying = true;

    this.currentSource.onended = () => {
      this.isPlaying = false;
      this.currentSource = null;
    };
  }

  // 流式播放MP3（使用MediaSource Extensions）
  async synthesizeStream(text: string, options: TTSOptions = {}): Promise<boolean> {
    if (!text.trim()) return false;

    try {
      // 使用 EventSource 接收流式音频
      const response = await fetch(`${API_BASE_URL}/api/volcano/tts/synthesize-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          text: text.trim(),
          speed: options.speed || 1.0,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'TTS synthesis failed');
      }

      // 使用 MediaSource 流式播放
      await this.playStream(response.body!);
      return true;
    } catch (error) {
      console.error('[VolcanoTTS] Stream synthesis error:', error);
      // 失败后尝试非流式
      return this.synthesize(text, options);
    }
  }

  // 流式播放
  private async playStream(readableStream: ReadableStream<Uint8Array>): Promise<void> {
    if (!this.audioContext) return;
    this.stop();

    const mediaSource = new MediaSource();
    this.currentMediaSource = mediaSource;
    
    const audio = new Audio();
    this.currentAudio = audio;
    audio.src = URL.createObjectURL(mediaSource);

    await new Promise<void>((resolve, reject) => {
      const sourceBufferQueue: Uint8Array[] = [];
      let sourceBuffer: SourceBuffer | null = null;
      let isUpdating = false;

      mediaSource.addEventListener('sourceopen', async () => {
        try {
          sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg');
          sourceBuffer.mode = 'sequence';

          const reader = readableStream.getReader();
          
          const appendNext = () => {
            if (!sourceBuffer || sourceBufferQueue.length === 0) {
              isUpdating = false;
              return;
            }
            isUpdating = true;
            const chunk = sourceBufferQueue.shift()!;
            try {
              sourceBuffer.appendBuffer(chunk);
            } catch (e) {
              console.error('[VolcanoTTS] appendBuffer error:', e);
              isUpdating = false;
            }
          };

          sourceBuffer.addEventListener('updateend', () => {
            if (sourceBufferQueue.length > 0) {
              appendNext();
            } else {
              isUpdating = false;
            }
          });

          // 开始播放
          audio.play().catch(e => console.error('[VolcanoTTS] Play error:', e));
          this.isPlaying = true;

          // 读取流
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            sourceBufferQueue.push(value);
            if (!isUpdating && sourceBuffer) {
              appendNext();
            }
          }

          // 等待所有数据播放完
          const checkEnd = setInterval(() => {
            if (sourceBufferQueue.length === 0 && !isUpdating && sourceBuffer) {
              clearInterval(checkEnd);
              if (mediaSource.readyState === 'open') {
                try {
                  mediaSource.endOfStream();
                } catch {}
              }
              resolve();
            }
          }, 100);

          // 音频结束
          audio.onended = () => {
            this.isPlaying = false;
            this.currentAudio = null;
            this.currentMediaSource = null;
            clearInterval(checkEnd);
            resolve();
          };

        } catch (err) {
          reject(err);
        }
      });

      mediaSource.addEventListener('error', (e) => {
        reject(new Error('MediaSource error'));
      });
    });

    // 清理
    audio.onended = () => {
      URL.revokeObjectURL(audio.src);
      this.isPlaying = false;
      this.currentAudio = null;
      this.currentMediaSource = null;
    };
  }

  // 停止播放
  stop(): void {
    console.log('[VolcanoTTS] Stop requested, currentAudio:', !!this.currentAudio, 'currentSource:', !!this.currentSource);
    
    // 停止 AudioBufferSourceNode 播放
    if (this.currentSource) {
      console.log('[VolcanoTTS] Stopping AudioBufferSourceNode');
      try {
        this.currentSource.stop();
      } catch {
        // 忽略已停止的错误
      }
      this.currentSource.disconnect();
      this.currentSource = null;
    }
    
    // 停止流式播放（HTML5 Audio）
    if (this.currentAudio) {
      console.log('[VolcanoTTS] Stopping HTML5 Audio');
      try {
        this.currentAudio.pause();
        this.currentAudio.currentTime = 0;
        console.log('[VolcanoTTS] Audio paused');
      } catch (e) {
        console.error('[VolcanoTTS] Error stopping audio:', e);
      }
      // 清理资源
      if (this.currentAudio.src) {
        URL.revokeObjectURL(this.currentAudio.src);
      }
      this.currentAudio = null;
    }
    
    // 清理 MediaSource
    if (this.currentMediaSource) {
      console.log('[VolcanoTTS] Cleaning up MediaSource');
      try {
        if (this.currentMediaSource.readyState === 'open') {
          this.currentMediaSource.endOfStream();
        }
      } catch (e) {
        // 忽略错误
      }
      this.currentMediaSource = null;
    }
    
    this.isPlaying = false;
    console.log('[VolcanoTTS] Stop complete');
  }

  // 暂停/恢复
  pause(): void {
    this.audioContext?.suspend();
  }

  resume(): void {
    this.audioContext?.resume();
  }

  // 获取播放状态
  get isPlayingNow(): boolean {
    return this.isPlaying;
  }
}

// 默认实例
export const volcanoTTSService = new VolcanoTTSService();
export default volcanoTTSService;
