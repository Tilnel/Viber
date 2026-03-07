/**
 * Terminal Handlers
 * 终端相关消息处理器
 * 
 * @phase 5
 */

import { getViberSocketManager } from '../viber.js';
import { setupTerminalHandlers as setupLegacyHandlers } from '../../socket/terminal.js';

// 复用现有的终端会话管理
let terminalSessions = new Map();

/**
 * 创建终端处理器
 */
export function createTerminalHandlers() {
  const manager = getViberSocketManager();

  return {
    /**
     * 创建终端
     */
    'terminal:create': async (socket, data) => {
      const { id, cwd } = data;
      
      console.log(`[TerminalHandler] Create terminal ${id} in ${cwd}`);
      
      // 这里复用现有的终端实现
      // 简化起见，先返回成功
      
      terminalSessions.set(id, {
        id,
        cwd,
        socketId: socket.id,
        createdAt: Date.now()
      });
      
      socket.emit('message', {
        type: 'terminal:created',
        data: { id, status: 'ready' }
      });
    },

    /**
     * 终端输入
     */
    'terminal:input': async (socket, data) => {
      const { id, data: inputData } = data;
      
      const session = terminalSessions.get(id);
      if (!session) {
        return socket.emit('message', {
          type: 'error',
          data: {
            code: 'TERMINAL_NOT_FOUND',
            message: 'Terminal not found'
          }
        });
      }
      
      // 转发到终端进程
      // 实际实现需要集成 node-pty
    },

    /**
     * 调整大小
     */
    'terminal:resize': async (socket, data) => {
      const { id, cols, rows } = data;
      
      const session = terminalSessions.get(id);
      if (session) {
        session.cols = cols;
        session.rows = rows;
        // 调整 PTY 大小
      }
    },

    /**
     * 关闭终端
     */
    'terminal:close': async (socket, data) => {
      const { id } = data;
      
      console.log(`[TerminalHandler] Close terminal ${id}`);
      
      const session = terminalSessions.get(id);
      if (session) {
        // 关闭 PTY
        terminalSessions.delete(id);
      }
    }
  };
}

export { terminalSessions };
export default createTerminalHandlers;
