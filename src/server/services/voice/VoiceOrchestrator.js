/**
 * Voice Orchestrator
 * 语音对话协调器 - 管理 ASR → LLM → TTS 完整流程
 * 
 * @phase 5
 * @module services/voice
 */

import { LLMMessage, LLMMessageRole, LLMStreamChunkType } from '../llm/types.js';

/**
 * 语音对话上下文
 */
export class VoiceDialogContext {
  constructor(data) {
    this.sessionId = data.sessionId;
    this.socketId = data.socketId;
    this.userId = data.userId;
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
 * 2. 直接调用 LLMService 获取回复
 * 3. 将 LLM 文本送给 TTSService 合成
 * 4. 通过 WebSocket 推送到前端（识别文本、LLM 文本、TTS 音频）
 * 5. 管理对话历史
 */
export class VoiceOrchestrator {
  constructor(options) {
    this.llmService = options.llmService;
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
   * 处理 ASR 识别结果
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

    // 2. 添加到对话历史
    dialog.messages.push(LLMMessage.text(LLMMessageRole.USER, text));
    dialog.state = 'processing';

    // 3. 直接调用 LLM（不走前端 API）
    await this.processLLM(streamId, dialog);
  }

  /**
   * 调用 LLM 处理
   */
  async processLLM(streamId, dialog) {
    console.log(`[VoiceOrchestrator] Starting LLM for ${streamId}`);
    
    // 通知前端 LLM 开始处理
    this.socketManager.sendToSocket(dialog.socketId, {
      type: 'chat:thinking',
      data: {
        streamId,
        sessionId: dialog.sessionId
      }
    });
    
    try {
      // 构建系统提示词
      const systemMessage = LLMMessage.text(
        LLMMessageRole.SYSTEM,
        '你是一个有帮助的 AI 助手。请用简洁的语言回答问题。'
      );
      
      const messages = [systemMessage, ...dialog.messages];
      
      // 流式请求 LLM
      const stream = this.llmService.request(messages, {
        streaming: true,
        processPipeline: {
          thinkingProcessor: false, // 语音对话不需要思考处理
          enableTTS: false // 我们自己控制 TTS
        }
      });

      let fullResponse = '';
      let ttsBuffer = '';
      
      for await (const chunk of stream) {
        // 处理不同类型的 chunk
        switch (chunk.type) {
          case LLMStreamChunkType.TEXT:
            const textChunk = chunk.data.text;
            fullResponse += textChunk;
            ttsBuffer += textChunk;
            
            // 实时推送给前端显示
            this.socketManager.sendToSocket(dialog.socketId, {
              type: 'chat:delta',
              data: {
                streamId,
                content: textChunk
              }
            });
            
            // 累积足够文本后触发 TTS
            if (this.shouldTriggerTTS(ttsBuffer)) {
              const ttsText = this.extractTTSText(ttsBuffer);
              ttsBuffer = ttsBuffer.slice(ttsText.length);
              
              // 异步合成 TTS
              this.synthesizeAndPlay(streamId, ttsText);
            }
            break;
            
          case LLMStreamChunkType.TOOL_USE:
            // 工具调用 - 前端显示
            this.socketManager.sendToSocket(dialog.socketId, {
              type: 'chat:tool:call',
              data: {
                streamId,
                tool: chunk.data.name,
                input: chunk.data.input
              }
            });
            break;
            
          case LLMStreamChunkType.TOOL_RESULT:
            // 工具结果 - 前端显示
            this.socketManager.sendToSocket(dialog.socketId, {
              type: 'chat:tool:result',
              data: {
                streamId,
                result: chunk.data.result
              }
            });
            break;
            
          case LLMStreamChunkType.DONE:
            // LLM 完成
            console.log(`[VoiceOrchestrator] LLM done for ${streamId}`);
            
            // 处理剩余 TTS 缓冲
            if (ttsBuffer.trim()) {
              await this.synthesizeAndPlay(streamId, ttsBuffer);
            }
            
            // 添加助手回复到历史
            dialog.messages.push(
              LLMMessage.text(LLMMessageRole.ASSISTANT, fullResponse)
            );
            
            // 通知前端完成
            this.socketManager.sendToSocket(dialog.socketId, {
              type: 'chat:complete',
              data: {
                streamId,
                text: fullResponse
              }
            });
            
            dialog.state = 'idle';
            break;
            
          case LLMStreamChunkType.ERROR:
            console.error(`[VoiceOrchestrator] LLM error:`, chunk.data);
            this.socketManager.sendToSocket(dialog.socketId, {
              type: 'error',
              data: {
                code: 'LLM_ERROR',
                message: chunk.data.message,
                context: { streamId }
              }
            });
            dialog.state = 'idle';
            break;
        }
      }
      
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
   */
  extractTTSText(buffer) {
    // 找到最后一个句子结束位置
    const match = buffer.match(/^(.*?[。！？.!?\n])/);
    if (match) {
      return match[1];
    }
    
    // 如果没有标点，返回全部（如果超过 50 字符）
    if (buffer.length >= 50) {
      return buffer;
    }
    
    return '';
  }

  /**
   * 合成并播放 TTS
   */
  async synthesizeAndPlay(streamId, text) {
    const dialog = this.dialogs.get(streamId);
    if (!dialog) return;

    console.log(`[VoiceOrchestrator] TTS for ${streamId}: "${text.substring(0, 30)}..."`);
    
    try {
      const result = await this.ttsService.synthesize(text);
      
      // 发送音频给前端播放
      this.socketManager.sendToSocket(dialog.socketId, {
        type: 'speaker:play',
        data: {
          taskId: `tts_${Date.now()}`,
          type: 'response',
          text,
          audioData: result.audioData.toString('base64'),
          format: result.format || 'mp3',
          duration: result.duration
        }
      });
      
    } catch (error) {
      console.error(`[VoiceOrchestrator] TTS error:`, error);
    }
  }

  /**
   * 结束对话
   */
  endDialog(streamId) {
    const dialog = this.dialogs.get(streamId);
    if (dialog) {
      console.log(`[VoiceOrchestrator] Ending dialog ${streamId}`);
      
      // 如果正在处理，停止 LLM
      if (dialog.llmRequestId) {
        this.llmService.stop(dialog.llmRequestId);
      }
      
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
    
    // 停止 LLM
    if (dialog.llmRequestId) {
      this.llmService.stop(dialog.llmRequestId);
    }
    
    // 停止 TTS
    this.socketManager.sendToSocket(dialog.socketId, {
      type: 'speaker:stop',
      data: { reason: 'interrupted' }
    });
    
    dialog.state = 'idle';
  }
}

export default VoiceOrchestrator;
