/**
 * Voice Orchestrator
 * 语音对话协调器 - 管理 ASR → LLM → TTS 完整流程
 * 
 * @phase 5
 * @module services/voice
 */

import { getChatService } from '../chat/ChatService.js';

/**
 * 语音对话上下文
 */
export class VoiceDialogContext {
  constructor(data) {
    this.sessionId = data.sessionId;
    this.socketId = data.socketId;
    this.userId = data.userId;
    this.ttsConfig = data.ttsConfig || { voice: 'BV001_streaming', speed: 1.0 };
    this.messages = []; // 对话历史
    this.currentStream = null; // 当前音频流
    this.llmRequestId = null; // LLM 请求 ID
    this.state = 'idle'; // idle | listening | processing | speaking
    this.createdAt = Date.now();
  }
}

/**
 * 语音对话协调器
 * 
 * 职责：
 * 1. 接收 ASR 识别结果
 * 2. 直接调用 ChatService (kimi-cli) 获取回复
 * 3. 将 LLM 文本送给 TTSService 合成
 * 4. 通过 WebSocket 推送到前端（识别文本、LLM 文本、TTS 音频）
 * 5. 管理对话历史
 */
export class VoiceOrchestrator {
  constructor(options) {
    this.chatService = options.chatService || getChatService();
    this.ttsService = options.ttsService;
    this.socketManager = options.socketManager;
    
    // 活跃的对话
    this.dialogs = new Map(); // streamId -> VoiceDialogContext
  }

  /**
   * 创建新的语音对话
   */
  createDialog(streamId, data) {
    const dialog = new VoiceDialogContext({
      sessionId: data.sessionId,
      socketId: data.socketId,
      userId: data.userId
    });
    
    this.dialogs.set(streamId, dialog);
    return dialog;
  }

  /**
   * 处理 ASR 识别结果（语音输入）
   * 这是核心方法：ASR 识别完成后自动走完整流程
   */
  async handleASRResult(streamId, text) {
    const dialog = this.dialogs.get(streamId);
    if (!dialog) {
      console.error(`[VoiceOrchestrator] Dialog not found: ${streamId}`);
      return;
    }

    console.log(`[VoiceOrchestrator] ASR result for ${streamId}: "${text}"`);
    
    // 1. 发送识别文本给前端（填入输入框）
    this.socketManager.sendToSocket(dialog.socketId, {
      type: 'voice:transcript',
      data: {
        streamId,
        text,
        isFinal: true
      }
    });

    // 2. 更新状态
    dialog.state = 'processing';

    // 3. 走统一处理流程
    await this.processConversation(streamId, dialog, text);
  }

  /**
   * 处理文字输入（与语音输入统一流程）
   */
  async handleTextInput(streamId, data) {
    const { sessionId, socketId, userId, userContent, context, ttsConfig } = data;
    
    console.log(`[VoiceOrchestrator] Text input for ${streamId}: "${userContent}"`);
    
    // 创建对话上下文
    this.createDialog(streamId, {
      sessionId,
      socketId,
      userId,
      ttsConfig
    });
    
    const dialog = this.dialogs.get(streamId);
    dialog.state = 'processing';
    dialog.context = context;
    dialog.isTextInput = true; // 标记为文字输入
    
    // 走统一处理流程
    await this.processConversation(streamId, dialog, userContent);
  }

  /**
   * 统一处理对话流程：LLM + 流式显示 + TTS
   * 语音输入和文字输入都走这里
   */
  async processConversation(streamId, dialog, userContent) {
    console.log(`[VoiceOrchestrator] Starting LLM for ${streamId}, session: ${dialog.sessionId}, content: "${userContent}"`);
    
    if (!userContent) {
      console.error('[VoiceOrchestrator] No user content provided');
      dialog.state = 'idle';
      return;
    }
    
    if (!this.chatService.isAvailable()) {
      console.error('[VoiceOrchestrator] ChatService (kimi-cli) not available');
      this.socketManager.sendToSocket(dialog.socketId, {
        type: 'error',
        data: {
          code: 'CHAT_SERVICE_UNAVAILABLE',
          message: 'Kimi CLI not found. Please install: npm install -g kimi-cli',
          context: { streamId }
        }
      });
      dialog.state = 'idle';
      return;
    }
    
    // 通知前端 LLM 开始处理（携带用户消息内容用于显示）
    this.socketManager.sendToSocket(dialog.socketId, {
      type: 'chat:thinking',
      data: {
        streamId,
        sessionId: dialog.sessionId,
        text: userContent  // 用户语音识别的文本
      }
    });
    
    let fullResponse = '';
    let ttsBuffer = '';
    let ttsTriggered = false; // 标记是否触发过 TTS
    
    try {
      await this.chatService.sendMessage(
        {
          sessionId: dialog.sessionId,
          content: userContent,
          context: dialog.context || {},
          skipUserMessageSave: dialog.isTextInput || false // 文字输入跳过保存（前端已保存）
        },
        {
          onTextDelta: (text) => {
            fullResponse += text;
            ttsBuffer += text;
            
            // 实时推送给前端显示
            this.socketManager.sendToSocket(dialog.socketId, {
              type: 'chat:delta',
              data: {
                streamId,
                content: text
              }
            });
            
            // 累积足够文本后触发 TTS
            console.log(`[VoiceOrchestrator] Text delta received, ttsBuffer length: ${ttsBuffer.length}`);
            if (this.shouldTriggerTTS(ttsBuffer)) {
              const ttsText = this.extractTTSText(ttsBuffer);
              if (ttsText) {
                console.log(`[VoiceOrchestrator] TTS triggered, ttsText: "${ttsText.substring(0, 50)}...", remaining: ${ttsBuffer.length - ttsText.length}`);
                ttsBuffer = ttsBuffer.slice(ttsText.length);
                ttsTriggered = true;
                
                // 异步合成 TTS（不等待，流式处理）
                this.synthesizeAndPlay(streamId, ttsText).catch(err => {
                  console.error(`[VoiceOrchestrator] TTS failed:`, err.message);
                });
              }
            }
          },
          
          onToolCall: (tool) => {
            // 工具调用 - 前端显示
            this.socketManager.sendToSocket(dialog.socketId, {
              type: 'chat:tool:call',
              data: {
                streamId,
                tool: tool.name,
                input: tool.args
              }
            });
          },
          
          onToolResult: (result) => {
            // 工具结果 - 前端显示
            this.socketManager.sendToSocket(dialog.socketId, {
              type: 'chat:tool:result',
              data: {
                streamId,
                result: result.content
              }
            });
          },
          
          onComplete: async (result) => {
            console.log(`[VoiceOrchestrator] LLM done for ${streamId}, full response length: ${fullResponse.length}, ttsTriggered: ${ttsTriggered}`);
            
            // 处理剩余 TTS 缓冲
            if (ttsBuffer.trim()) {
              console.log(`[VoiceOrchestrator] Processing remaining TTS buffer: ${ttsBuffer.length} chars`);
              await this.synthesizeAndPlay(streamId, ttsBuffer);
            } else if (!ttsTriggered && fullResponse.trim()) {
              // 兜底：如果从未触发过 TTS，朗读全部回复
              console.log(`[VoiceOrchestrator] TTS fallback - speaking full response: ${fullResponse.length} chars`);
              await this.synthesizeAndPlay(streamId, fullResponse);
            }
            
            // 通知前端完成
            this.socketManager.sendToSocket(dialog.socketId, {
              type: 'chat:complete',
              data: {
                streamId,
                text: result.content
              }
            });
            
            dialog.state = 'idle';
          },
          
          onError: (error) => {
            console.error(`[VoiceOrchestrator] LLM error:`, error);
            this.socketManager.sendToSocket(dialog.socketId, {
              type: 'error',
              data: {
                code: 'LLM_ERROR',
                message: error,
                context: { streamId }
              }
            });
            dialog.state = 'idle';
          }
        }
      );
      
    } catch (error) {
      console.error(`[VoiceOrchestrator] LLM processing error:`, error);
      this.socketManager.sendToSocket(dialog.socketId, {
        type: 'error',
        data: {
          code: 'LLM_PROCESS_ERROR',
          message: error.message,
          context: { streamId }
        }
      });
      dialog.state = 'idle';
    }
  }

  /**
   * 判断是否触发 TTS
   * 策略：遇到标点符号或累积足够字符
   */
  shouldTriggerTTS(buffer) {
    // 超过 50 字符触发
    if (buffer.length >= 50) return true;
    
    // 遇到完整句子标点触发
    if (/[。！？.!?\n]/.test(buffer)) return true;
    
    return false;
  }

  /**
   * 提取适合 TTS 的文本
   * 限制最大长度，避免一次性合成过长音频
   */
  extractTTSText(buffer) {
    const MAX_TTS_LENGTH = 100; // 最大 100 字符，保证快速响应
    
    // 找到第一个句子结束位置（使用非贪婪匹配找到第一个标点）
    const match = buffer.match(/^.+?[。！？.!?\n]/);
    if (match) {
      // 如果匹配的句子太长，截断
      if (match[0].length > MAX_TTS_LENGTH) {
        return match[0].substring(0, MAX_TTS_LENGTH);
      }
      return match[0];
    }
    
    // 如果没有标点，但有足够字符，返回一段（限制长度）
    if (buffer.length >= 50) {
      return buffer.substring(0, Math.min(buffer.length, MAX_TTS_LENGTH));
    }
    
    return '';
  }

  /**
   * 合成并播放 TTS（支持长文本分段）
   * 长文本会分成多段，每段合成后立即发送给前端
   */
  async synthesizeAndPlay(streamId, text) {
    const dialog = this.dialogs.get(streamId);
    if (!dialog) {
      console.log(`[VoiceOrchestrator] TTS skipped: dialog not found for ${streamId}`);
      return;
    }

    if (!text || !text.trim()) {
      console.log(`[VoiceOrchestrator] TTS skipped: empty text`);
      return;
    }

    // 获取用户的 TTS 配置
    const { voice, speed } = dialog.ttsConfig;
    const trimmedText = text.trim();
    
    // 如果文本较长，先分段
    if (trimmedText.length > 100) {
      console.log(`[VoiceOrchestrator] TTS long text (${trimmedText.length} chars), splitting...`);
      const segments = this.splitTextForTTSSimple(trimmedText);
      for (const segment of segments) {
        await this.synthesizeAndSend(streamId, dialog, segment, voice, speed);
      }
      return;
    }
    
    // 短文本直接合成
    await this.synthesizeAndSend(streamId, dialog, trimmedText, voice, speed);
  }

  /**
   * 简单的文本分段（用于兜底逻辑）
   */
  splitTextForTTSSimple(text) {
    const MAX_LEN = 100;
    const segments = [];
    
    // 按句子分割
    const sentences = text.split(/([。！？.!?；;\n]+)/);
    let current = '';
    
    for (const part of sentences) {
      if (!part) continue;
      
      if ((current + part).length <= MAX_LEN) {
        current += part;
      } else {
        if (current) segments.push(current);
        current = part.length > MAX_LEN ? part.substring(0, MAX_LEN) : part;
      }
    }
    
    if (current) segments.push(current);
    return segments;
  }

  /**
   * 合成单段并发送
   */
  async synthesizeAndSend(streamId, dialog, text, voice, speed) {
    console.log(`[VoiceOrchestrator] TTS synthesize: "${text.substring(0, 50)}..." (${text.length} chars)`);
    
    try {
      const result = await this.ttsService._synthesizeSegment(text, { voice, speed });
      
      if (!result || !result.audioData || result.audioData.length === 0) {
        console.error(`[VoiceOrchestrator] TTS returned empty audio!`);
        return;
      }
      
      // 转换为 base64
      const audioBase64 = result.audioData.toString('base64');
      
      // 发送音频给前端播放
      const message = {
        type: 'speaker:play',
        data: {
          taskId: `tts_${Date.now()}`,
          type: 'response',
          text,
          audioData: audioBase64,
          format: result.format || 'mp3',
          duration: result.duration
        }
      };
      
      this.socketManager.sendToSocket(dialog.socketId, message);
      
    } catch (error) {
      console.error(`[VoiceOrchestrator] TTS error in synthesizeAndSend:`, error.message);
    }
  }

  /**
   * 结束对话
   */
  endDialog(streamId) {
    const dialog = this.dialogs.get(streamId);
    if (dialog) {
      console.log(`[VoiceOrchestrator] Ending dialog ${streamId}`);
      
      // 停止该会话的生成
      this.chatService.stopGeneration(dialog.sessionId);
      
      this.dialogs.delete(streamId);
    }
  }

  /**
   * 打断当前对话
   */
  interrupt(streamId) {
    const dialog = this.dialogs.get(streamId);
    if (!dialog) return;

    console.log(`[VoiceOrchestrator] Interrupting ${streamId}`);
    
    // 停止该会话的生成
    this.chatService.stopGeneration(dialog.sessionId);
    
    // 停止 TTS
    this.socketManager.sendToSocket(dialog.socketId, {
      type: 'speaker:stop',
      data: { reason: 'interrupted' }
    });
    
    dialog.state = 'idle';
  }
}

export default VoiceOrchestrator;
