// 对话管理器
// 处理 AI 对话，支持取消和重新发送

import { VoiceManager, VoiceState } from './voiceManager';
import { volcanoTTSService } from './volcanoTTS';

export interface ConversationManagerOptions {
  onStateChange?: (state: VoiceState) => void;
  onTranscript?: (text: string, isFinal: boolean) => void;
  onAIResponse?: (text: string) => void;
  onAIResponseComplete?: () => void;
  onError?: (error: string) => void;
}

export class ConversationManager {
  private voiceManager: VoiceManager;
  private options: ConversationManagerOptions;
  
  // 对话状态
  private currentAIRequest: AbortController | null = null;
  private pendingUtterance: string = ''; // 等待确认的完整话语（用于补充）
  private isSpeaking = false;
  
  constructor(options: ConversationManagerOptions = {}) {
    this.options = options;
    
    this.voiceManager = new VoiceManager({
      speechThreshold: 0.02,        // 降低阈值，对小声更敏感
      silenceTimeout: 1500,        // 1.5秒静音才结束，避免截断尾音
      continuationTimeout: 3000, // 3秒内视为补充
      
      onStateChange: (state) => {
        this.options.onStateChange?.(state);
      },
      
      onTranscript: (text, isFinal) => {
        this.options.onTranscript?.(text, isFinal);
      },
      
      onSpeechStart: () => {
        console.log('[Conversation] Speech started');
      },
      
      onSpeechEnd: (text) => {
        console.log('[Conversation] Speech ended:', text);
        this.pendingUtterance = text;
        this.sendToAI(text);
      },
      
      onAppend: (previousText) => {
        console.log('[Conversation] Appending to:', previousText);
        // 取消当前 AI 请求
        this.cancelCurrentRequest();
        // 保留 pendingUtterance，等待新的语音结束后再拼接
      },
      
      onError: (error) => {
        this.options.onError?.(error);
      }
    });
  }
  
  async start(): Promise<boolean> {
    return this.voiceManager.start();
  }
  
  stop(): void {
    this.cancelCurrentRequest();
    this.voiceManager.stop();
  }
  
  // 发送给 AI（支持补充）
  private async sendToAI(text: string): Promise<void> {
    // 检查是否是补充
    if (this.pendingUtterance && this.pendingUtterance !== text) {
      // 这是补充，拼接文本
      const combinedText = this.pendingUtterance + '，' + text;
      console.log('[Conversation] Combined text:', combinedText);
      text = combinedText;
    }
    
    // 取消之前的请求（如果有）
    this.cancelCurrentRequest();
    
    // 创建新的 AbortController
    this.currentAIRequest = new AbortController();
    const signal = this.currentAIRequest.signal;
    
    console.log('[Conversation] Sending to AI:', text);
    
    try {
      // 通知外部开始处理
      this.options.onAIResponse?.('');
      
      // 调用 Kimi API
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
        signal
      });
      
      if (!response.ok) {
        throw new Error('AI request failed');
      }
      
      // 读取流式响应
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }
      
      let fullResponse = '';
      const decoder = new TextDecoder();
      
      while (true) {
        if (signal.aborted) {
          console.log('[Conversation] Request aborted');
          reader.cancel();
          return;
        }
        
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(l => l.trim());
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;
            
            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content || '';
              if (content) {
                fullResponse += content;
                this.options.onAIResponse?.(fullResponse);
              }
            } catch {
              // 忽略解析错误
            }
          }
        }
      }
      
      // 完成后朗读
      if (!signal.aborted && fullResponse) {
        this.speak(fullResponse);
      }
      
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        console.log('[Conversation] Request was aborted');
        return;
      }
      console.error('[Conversation] AI request error:', error);
      this.options.onError?.('AI 请求失败');
    } finally {
      this.currentAIRequest = null;
    }
  }
  
  // 朗读 AI 回复
  private async speak(text: string): Promise<void> {
    if (this.isSpeaking) {
      volcanoTTSService.stop();
    }
    
    this.isSpeaking = true;
    this.voiceManager.onAIStartSpeaking();
    
    try {
      await volcanoTTSService.synthesize(text, {
        voice: 'BV700_V2_streaming',
        speed: 1.0
      });
    } catch (error) {
      console.error('[Conversation] TTS error:', error);
    } finally {
      this.isSpeaking = false;
      this.voiceManager.onAIStopSpeaking();
      this.options.onAIResponseComplete?.();
    }
  }
  
  // 取消当前请求
  private cancelCurrentRequest(): void {
    if (this.currentAIRequest) {
      console.log('[Conversation] Cancelling current AI request');
      this.currentAIRequest.abort();
      this.currentAIRequest = null;
    }
    
    if (this.isSpeaking) {
      volcanoTTSService.stop();
      this.isSpeaking = false;
    }
  }
  
  getVoiceManager(): VoiceManager {
    return this.voiceManager;
  }
}

export default ConversationManager;
