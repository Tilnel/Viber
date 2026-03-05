import { pathSecurity } from '../utils/pathSecurity.js';
import { setupTerminalHandlers, terminalSessions } from './terminal.js';

export function setupSocketHandlers(io) {
  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    
    // ============ 聊天流 ============
    socket.on('chat:join', (sessionId) => {
      socket.join(`chat:${sessionId}`);
      console.log(`Socket ${socket.id} joined chat session ${sessionId}`);
    });
    
    socket.on('chat:leave', (sessionId) => {
      socket.leave(`chat:${sessionId}`);
    });
    
    // ============ 文件监控 ============
    socket.on('fs:watch', (projectPath) => {
      try {
        const safePath = pathSecurity.sanitizePath(projectPath);
        socket.join(`fs:${safePath}`);
        console.log(`Socket ${socket.id} watching ${safePath}`);
      } catch (err) {
        socket.emit('fs:error', { message: err.message });
      }
    });
    
    socket.on('fs:unwatch', (projectPath) => {
      try {
        const safePath = pathSecurity.sanitizePath(projectPath);
        socket.leave(`fs:${safePath}`);
      } catch (err) {
        // 忽略错误
      }
    });
    
    // ============ Web Terminal (使用 node-pty) ============
    setupTerminalHandlers(socket);
    
    // ============ 语音相关 ============
    socket.on('voice:start', () => {
      socket.emit('voice:state', { state: 'listening' });
    });
    
    socket.on('voice:stop', () => {
      socket.emit('voice:state', { state: 'idle' });
    });
    
    socket.on('voice:transcript', (data) => {
      // 转发转录文本给客户端自己（用于调试）
      socket.emit('voice:transcript:confirmed', data);
    });
    
    // ============ 断开连接 ============
    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
    });
  });
}

// 广播文件变更
export function broadcastFileChange(projectPath, change) {
  const io = global.io;
  if (io) {
    io.to(`fs:${projectPath}`).emit('fs:change', change);
  }
}
