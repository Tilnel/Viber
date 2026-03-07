/**
 * Viber Socket Setup
 * 统一 WebSocket 设置入口
 * 
 * @phase 5
 */

import { createViberSocketManager } from './viber.js';
import { createVoiceHandlers } from './handlers/voice.js';
import { createTerminalHandlers } from './handlers/terminal.js';

/**
 * 设置统一的 Viber WebSocket 服务
 */
export function setupViberSocket(io) {
  // 创建管理器
  const manager = createViberSocketManager(io);
  
  // 注册语音处理器
  const voiceHandlers = createVoiceHandlers();
  manager.registerHandlers(voiceHandlers);
  
  // 注册终端处理器
  const terminalHandlers = createTerminalHandlers();
  manager.registerHandlers(terminalHandlers);
  
  // 注册聊天处理器（简化版）
  manager.registerHandler('chat:send', async (socket, data, msgId) => {
    const { sessionId, content, context } = data;
    
    console.log(`[ChatHandler] Message from ${socket.userId} in session ${sessionId}`);
    
    // 这里集成 LLM Service
    // 简化示例：直接回复
    socket.emit('message', {
      type: 'chat:thinking',
      data: {
        messageId: msgId,
        content: '思考中...'
      }
    });
    
    // 模拟流式响应
    const words = ['你好', '，', '这是', 'AI', '的', '回复', '。'];
    for (const word of words) {
      await new Promise(r => setTimeout(r, 100));
      socket.emit('message', {
        type: 'chat:delta',
        data: {
          messageId: msgId,
          content: word
        }
      });
    }
    
    socket.emit('message', {
      type: 'chat:complete',
      data: {
        messageId: msgId,
        usage: { promptTokens: 10, completionTokens: 7 }
      }
    });
  });
  
  // 注册文件系统处理器
  manager.registerHandler('fs:watch', async (socket, data) => {
    const { path } = data;
    
    // 加入房间用于接收文件变更通知
    manager.roomManager.join(socket, `fs:${path}`);
    
    console.log(`[FSHandler] ${socket.userId} watching ${path}`);
  });
  
  console.log('[ViberSocket] All handlers registered');
  
  // 暴露全局访问
  global.viberSocketManager = manager;
  
  return manager;
}

/**
 * 广播文件变更（供文件系统路由使用）
 */
export function broadcastFileChange(projectPath, change) {
  const manager = global.viberSocketManager;
  if (manager) {
    manager.emitToRoom(`fs:${projectPath}`, {
      type: 'fs:change',
      data: change
    });
  }
}

export default setupViberSocket;
