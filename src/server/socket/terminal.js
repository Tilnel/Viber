import { spawn } from 'node-pty';
import { pathSecurity } from '../utils/pathSecurity.js';

// 存储活跃的终端会话
const terminalSessions = new Map();

export function setupTerminalHandlers(socket) {
  // ============ Web Terminal ============
  socket.on('terminal:create', (data) => {
    const { cwd, id } = data;
    
    try {
      const safeCwd = cwd ? pathSecurity.sanitizePath(cwd) : process.env.HOME || '/tmp';
      
      // 检测可用的 shell
      const shell = process.env.SHELL || '/bin/bash';
      
      console.log(`Creating terminal ${id} in ${safeCwd} with shell ${shell}`);
      
      // 使用 node-pty 创建真正的伪终端
      const ptyProcess = spawn(shell, [], {
        name: 'xterm-256color',
        cols: 80,
        rows: 30,
        cwd: safeCwd,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor'
        }
      });
      
      terminalSessions.set(id, ptyProcess);
      
      // 发送输出到客户端
      ptyProcess.onData((data) => {
        socket.emit(`terminal:data:${id}`, data);
      });
      
      ptyProcess.onExit(({ exitCode, signal }) => {
        console.log(`Terminal ${id} exited with code ${exitCode}, signal ${signal}`);
        socket.emit(`terminal:close:${id}`, { code: exitCode, signal });
        terminalSessions.delete(id);
      });
      
      // 发送创建成功消息
      socket.emit(`terminal:created:${id}`, { 
        success: true, 
        shell,
        cwd: safeCwd
      });
      
    } catch (err) {
      console.error('Failed to create terminal:', err);
      socket.emit(`terminal:error:${id}`, { 
        message: err.message,
        hint: 'Please ensure node-pty is properly installed'
      });
    }
  });
  
  socket.on('terminal:input', (data) => {
    const { id, input } = data;
    const pty = terminalSessions.get(id);
    
    if (pty) {
      try {
        pty.write(input);
      } catch (err) {
        console.error(`Failed to write to terminal ${id}:`, err);
      }
    }
  });
  
  socket.on('terminal:resize', (data) => {
    const { id, cols, rows } = data;
    const pty = terminalSessions.get(id);
    
    if (pty) {
      try {
        pty.resize(cols, rows);
      } catch (err) {
        console.error(`Failed to resize terminal ${id}:`, err);
      }
    }
  });
  
  socket.on('terminal:kill', (id) => {
    const pty = terminalSessions.get(id);
    
    if (pty) {
      try {
        pty.kill('SIGTERM');
      } catch (err) {
        console.error(`Failed to kill terminal ${id}:`, err);
      }
      terminalSessions.delete(id);
    }
  });
  
  // 清理断开的 socket 相关的终端
  socket.on('disconnect', () => {
    console.log('Client disconnected, cleaning up terminals');
    
    // 查找并清理该 socket 创建的终端
    // 注意：这里简化处理，实际应该关联 socket ID
    for (const [id, pty] of terminalSessions.entries()) {
      try {
        pty.kill('SIGTERM');
      } catch (err) {
        // 忽略错误
      }
      terminalSessions.delete(id);
    }
  });
}

export { terminalSessions };
