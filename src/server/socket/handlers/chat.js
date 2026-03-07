/**
 * Chat Handlers
 * 聊天消息处理器 - 文字输入入口
 * 
 * 所有输入都交给 VoiceOrchestrator 统一处理
 * 
 * @phase 5
 */

import { getUserTTSConfig } from '../../services/user/UserSettingsService.js';

/**
 * 创建聊天处理器
 * @param {VoiceOrchestrator} voiceOrchestrator - 语音协调器（统一处理 LLM + TTS）
 */
export function createChatHandlers(voiceOrchestrator) {
  return {
    /**
     * 发送消息（文字输入入口）
     * 交给 VoiceOrchestrator 统一处理 LLM + TTS
     */
    'chat:send': async (socket, data) => {
      const { sessionId, content, context = {} } = data;
      const streamId = `text_${Date.now()}_${socket.id}`;
      
      console.log(`[ChatHandler] Text input from ${socket.userId}, session ${sessionId}`);
      
      // 从数据库获取用户 TTS 配置
      const ttsConfig = await getUserTTSConfig(socket.userId);
      console.log(`[ChatHandler] User TTS config:`, ttsConfig);
      
      // 交给 VoiceOrchestrator 统一处理
      // 与语音输入走完全相同的流程
      await voiceOrchestrator.handleTextInput(streamId, {
        sessionId,
        socketId: socket.id,
        userId: socket.userId,
        userContent: content,
        context,
        ttsConfig
      });
    },

    /**
     * 停止生成和 TTS
     */
    'chat:stop': (socket, data) => {
      const { sessionId } = data;
      
      // 找到对应的对话并打断
      for (const [streamId, dialog] of voiceOrchestrator.dialogs) {
        if (dialog.sessionId === sessionId) {
          voiceOrchestrator.interrupt(streamId);
          break;
        }
      }
    }
  };
}

export default createChatHandlers;
