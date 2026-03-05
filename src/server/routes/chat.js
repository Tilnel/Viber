import { Router } from 'express';
import { spawn } from 'child_process';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { Transform, pipeline } from 'stream';
import { query } from '../db/index.js';
import { pathSecurity } from '../utils/pathSecurity.js';

const DEFAULT_ROOT_DIR = process.env.ROOT_DIR || '/path/to/your/code';

// 创建 Transform stream 来解析 Kimi 的 JSONL 输出
function createKimiTransformStream() {
  let buffer = '';
  
  return new Transform({
    objectMode: false,
    transform(chunk, encoding, callback) {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop(); // 保留不完整的最后一行
      
      let output = '';
      
      for (const line of lines) {
        if (!line.trim()) continue;
        
        try {
          const parsed = JSON.parse(line);
          
          // 提取内容
          if (parsed.content && Array.isArray(parsed.content)) {
            for (const item of parsed.content) {
              if (item.type === 'text' && item.text) {
                output += item.text;
              }
            }
          } else if (typeof parsed.content === 'string') {
            output += parsed.content;
          }
        } catch (err) {
          // 非 JSON 行，可能是直接输出
          if (!line.startsWith('{')) {
            output += line + '\n';
          }
        }
      }
      
      callback(null, output);
    },
    flush(callback) {
      // 处理缓冲区中剩余的内容
      if (buffer.trim()) {
        try {
          const parsed = JSON.parse(buffer);
          if (parsed.content && Array.isArray(parsed.content)) {
            let output = '';
            for (const item of parsed.content) {
              if (item.type === 'text' && item.text) {
                output += item.text;
              }
            }
            callback(null, output);
            return;
          }
        } catch (err) {
          // 忽略解析错误
        }
      }
      callback();
    }
  });
}

// 尝试找到 kimi 命令的路径
function findKimiPath() {
  try {
    // 尝试在 PATH 中查找 kimi
    const result = execSync('which kimi', { encoding: 'utf8' });
    return result.trim();
  } catch {
    // 尝试常见的安装位置
    const possiblePaths = [
      '/usr/local/bin/kimi',
      '/usr/bin/kimi',
      path.join(process.env.HOME || '', '.local/bin/kimi'),
      path.join(process.env.HOME || '', 'bin/kimi'),
    ];
    
    for (const kimiPath of possiblePaths) {
      try {
        execSync(`test -x ${kimiPath}`);
        return kimiPath;
      } catch {
        continue;
      }
    }
    
    return null;
  }
}

const KIMI_PATH = findKimiPath();

const router = Router();

// 获取会话的消息列表
router.get('/sessions/:sessionId/messages', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;
    
    const { rows: messages } = await query(`
      SELECT id, role, content, metadata, created_at, token_count
      FROM messages
      WHERE session_id = $1
      ORDER BY created_at ASC
      LIMIT $2 OFFSET $3
    `, [sessionId, limit, offset]);
    
    res.json({ messages, limit, offset });
  } catch (err) {
    next(err);
  }
});

// 创建新会话
router.post('/sessions', async (req, res, next) => {
  try {
    const { projectId, name } = req.body;
    
    if (!projectId) {
      return res.status(400).json({ error: 'Project ID is required' });
    }
    
    const sessionName = name || `Session ${new Date().toLocaleString('zh-CN')}`;
    
    const { rows } = await query(`
      INSERT INTO sessions (project_id, name)
      VALUES ($1, $2)
      RETURNING id, project_id, name, created_at, updated_at, message_count
    `, [projectId, sessionName]);
    
    res.json({ session: rows[0] });
  } catch (err) {
    next(err);
  }
});

// 删除会话
router.delete('/sessions/:sessionId', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    
    // 由于外键设置了 ON DELETE CASCADE，删除 session 会自动删除关联的 messages
    const { rowCount } = await query(`
      DELETE FROM sessions WHERE id = $1
    `, [sessionId]);
    
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// 重命名会话
router.patch('/sessions/:sessionId', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { name } = req.body;
    
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'Name is required' });
    }
    
    const { rows } = await query(`
      UPDATE sessions 
      SET name = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING id, project_id, name, created_at, updated_at, message_count
    `, [name, sessionId]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    res.json({ session: rows[0] });
  } catch (err) {
    next(err);
  }
});

// 保存不完整的回复（用于页面关闭前）
router.post('/save-partial', async (req, res, next) => {
  try {
    const { sessionId, content } = req.body;
    
    if (!sessionId || !content) {
      return res.status(400).json({ error: 'Session ID and content are required' });
    }
    
    // 保存消息
    await query(`
      INSERT INTO messages (session_id, role, content)
      VALUES ($1, 'assistant', $2)
    `, [sessionId, content]);
    
    // 更新会话消息计数
    await query(`
      UPDATE sessions 
      SET message_count = message_count + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [sessionId]);
    
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// 发送消息（流式响应）
router.post('/sessions/:sessionId/messages', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { content, context = {} } = req.body;
    
    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: 'Content is required' });
    }
    
    // 获取会话信息
    const { rows: [session] } = await query(`
      SELECT s.id, s.project_id, p.path as project_path
      FROM sessions s
      JOIN projects p ON s.project_id = p.id
      WHERE s.id = $1
    `, [sessionId]);
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    // 保存用户消息
    await query(`
      INSERT INTO messages (session_id, role, content, metadata)
      VALUES ($1, 'user', $2, $3)
    `, [sessionId, content, JSON.stringify(context)]);
    
    // 构建系统提示
    let systemPrompt = `You are Kimi, a helpful AI assistant integrated into a web-based code editor.`;
    
    // 如果提供了上下文，添加到提示中
    if (context.currentFile) {
      systemPrompt += `\n\nCurrent file: ${context.currentFile}`;
    }
    
    if (context.selectedCode) {
      systemPrompt += `\n\nSelected code:\n\`\`\`\n${context.selectedCode}\n\`\`\``;
    }
    
    if (context.projectPath) {
      systemPrompt += `\n\nProject path: ${context.projectPath}`;
    }
    
    // 构建传递给 Kimi CLI 的提示
    const userPrompt = content;
    
    // 设置流式响应头 - 禁用所有缓冲
    // 使用 application/x-ndjson 表示每行一个 JSON 对象的流
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');  // 禁用 Nginx 缓冲
    res.setHeader('Transfer-Encoding', 'chunked');
    
    // 立即刷新头部
    res.flushHeaders?.();
    
    // 启动 Kimi CLI 进程
    // 使用 --session 参数维持对话上下文
    const kimiArgs = [
      '--print',
      '--output-format=stream-json',
      '--session', `kimi-web-${sessionId}`
    ];
    
    // 构建系统提示 + 当前用户输入
    // Kimi CLI 会自动维护会话历史
    const fullPrompt = systemPrompt + '\n\nUser: ' + userPrompt + '\n\nAssistant:';
    
    console.log('Starting Kimi CLI with prompt length:', fullPrompt.length);
    
    // 检查 kimi 是否安装
    if (!KIMI_PATH) {
      console.error('Kimi CLI not found in PATH');
      res.write('\n[Error: Kimi CLI not found. Please install kimi-cli first:\n');
      res.write('  npm install -g kimi-cli\n');
      res.write('  or visit: https://github.com/MoonshotAI/kimi-cli]\n');
      res.end();
      return;
    }
    
    console.log('Using Kimi CLI at:', KIMI_PATH);
    
    // 使用默认根目录解析项目路径（避免被动态 rootDir 影响）
    const projectCwd = path.join(DEFAULT_ROOT_DIR, session.project_path);
    console.log('Project CWD:', projectCwd);
    
    // 检查目录是否存在
    if (!fs.existsSync(projectCwd)) {
      console.error('Project directory does not exist:', projectCwd);
      res.write(`\n[Error: Project directory not found: ${projectCwd}]`);
      res.end();
      return;
    }
    
    // 读取 shebang 来确定 Python 路径
    let pythonPath = 'python3';
    try {
      const content = fs.readFileSync(KIMI_PATH, 'utf8');
      const shebangMatch = content.match(/^#!(.+)$/m);
      if (shebangMatch) {
        pythonPath = shebangMatch[1].trim();
        console.log('Using Python from shebang:', pythonPath);
      }
    } catch (err) {
      console.log('Could not read shebang, using default python3');
    }
    
    // 使用 Python 直接执行 kimi 脚本
    // stdio: 'pipe' 确保我们可以控制流
    const kimiProcess = spawn(pythonPath, [KIMI_PATH, ...kimiArgs, '-p', fullPrompt], {
      cwd: projectCwd,
      env: {
        ...process.env,
        // 确保使用用户的订阅计划
        KIMI_PLATFORM: 'kimi-code'
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    // 处理进程启动错误
    kimiProcess.on('error', (err) => {
      console.error('Failed to start Kimi CLI:', err);
      res.write(`\n[Error: Failed to start Kimi CLI - ${err.message}]`);
      res.end();
    });
    
    let assistantContent = '';
    let assistantBlocks = []; // 结构化 blocks 用于保存
    let buffer = '';
    let hasReceivedData = false;
    
    // 跟踪工具调用状态
    const pendingToolCalls = new Map(); // tool_id -> {name, args}
    const processedToolResults = new Set(); // 已处理的工具结果 ID
    
    let lastFlushTime = Date.now();
    
    // 发送结构化事件给客户端
    const sendEvent = (event) => {
      res.write(JSON.stringify(event) + '\n');
    };
    
    kimiProcess.stdout.on('data', (data) => {
      hasReceivedData = true;
      buffer += data.toString();
      
      // 调试：记录数据接收
      if (Date.now() - lastFlushTime > 1000) {
        console.log('Receiving data from Kimi...', buffer.length, 'bytes buffered');
        lastFlushTime = Date.now();
      }
      
      // 处理 JSONL 输出
      const lines = buffer.split('\n');
      buffer = lines.pop(); // 保留不完整的最后一行
      
      for (const line of lines) {
        if (!line.trim()) continue;
        
        try {
          const parsed = JSON.parse(line);
          
          // 1. 处理工具调用 (role === 'assistant' 且有 tool_calls)
          if (parsed.role === 'assistant' && parsed.tool_calls && Array.isArray(parsed.tool_calls)) {
            for (const toolCall of parsed.tool_calls) {
              if (toolCall.type === 'function' && toolCall.function) {
                const toolId = toolCall.id;
                const toolName = toolCall.function.name;
                const args = JSON.parse(toolCall.function.arguments || '{}');
                
                pendingToolCalls.set(toolId, { name: toolName, args });
                
                // 发送工具调用事件
                sendEvent({
                  type: 'tool_call',
                  id: toolId,
                  name: toolName,
                  args
                });
              }
            }
          }
          
          // 2. 处理工具结果 (role === 'tool')
          if (parsed.role === 'tool' && parsed.tool_call_id) {
            const toolId = parsed.tool_call_id;
            
            // 避免重复处理同一个工具结果
            if (processedToolResults.has(toolId)) {
              continue;
            }
            processedToolResults.add(toolId);
            
            const pending = pendingToolCalls.get(toolId);
            
            // 提取工具结果内容
            let resultContent = '';
            if (parsed.content && Array.isArray(parsed.content)) {
              for (const item of parsed.content) {
                if (item.type === 'text' && item.text) {
                  resultContent += item.text;
                }
              }
            } else if (typeof parsed.content === 'string') {
              resultContent = parsed.content;
            }
            
            // 发送工具结果事件
            sendEvent({
              type: 'tool_result',
              id: toolId,
              name: pending?.name || 'Unknown',
              args: pending?.args || {},
              content: resultContent
            });
            
            // 构建 block
            const toolBlock = {
              type: 'tool',
              id: toolId,
              operation: pending?.name || 'Unknown',
              target: pending?.args?.path || pending?.args?.command || 
                      pending?.args?.pattern || pending?.args?.url || pending?.args?.q || '',
              result: resultContent,
              args: pending?.args || {}
            };
            assistantBlocks.push(toolBlock);
            
            pendingToolCalls.delete(toolId);
          }
          
          // 3. 处理助手文本内容 (role === 'assistant' 的文本)
          if (parsed.role === 'assistant' && parsed.content) {
            let textContent = '';
            
            if (Array.isArray(parsed.content)) {
              for (const item of parsed.content) {
                if (item.type === 'text' && item.text) {
                  textContent += item.text;
                }
              }
            } else if (typeof parsed.content === 'string') {
              textContent = parsed.content;
            }
            
            if (textContent) {
              assistantContent += textContent;
              // 追加到 blocks
              const lastBlock = assistantBlocks[assistantBlocks.length - 1];
              if (lastBlock && lastBlock.type === 'text') {
                lastBlock.content += textContent;
              } else {
                assistantBlocks.push({ type: 'text', content: textContent });
              }
              // 发送文本增量事件
              sendEvent({
                type: 'text_delta',
                content: textContent
              });
            }
          }
          
          // 强制刷新缓冲区
          if (res.socket && !res.socket.destroyed && res.socket.cork) {
            res.socket.cork();
            process.nextTick(() => {
              res.socket?.uncork();
            });
          }
          
        } catch (err) {
          // 非 JSON 行，忽略或作为原始文本处理
          console.log('Non-JSON line:', line.substring(0, 100));
        }
      }
    });
    
    kimiProcess.stderr.on('data', (data) => {
      console.error('Kimi stderr:', data.toString());
    });
    
    kimiProcess.on('close', async (code) => {
      // 处理缓冲区中剩余的内容
      if (buffer.trim()) {
        try {
          const parsed = JSON.parse(buffer);
          // 处理剩余的工具结果或文本
          if (parsed.role === 'tool' && parsed.tool_call_id) {
            if (!processedToolResults.has(parsed.tool_call_id)) {
              processedToolResults.add(parsed.tool_call_id);
              const pending = pendingToolCalls.get(parsed.tool_call_id);
              let resultContent = '';
              if (parsed.content && Array.isArray(parsed.content)) {
                for (const item of parsed.content) {
                  if (item.type === 'text' && item.text) {
                    resultContent += item.text;
                  }
                }
              } else if (typeof parsed.content === 'string') {
                resultContent = parsed.content;
              }
              sendEvent({
                type: 'tool_result',
                id: parsed.tool_call_id,
                name: pending?.name || 'Unknown',
                args: pending?.args || {},
                content: resultContent
              });
              // 添加 block
              assistantBlocks.push({
                type: 'tool',
                id: parsed.tool_call_id,
                operation: pending?.name || 'Unknown',
                target: pending?.args?.path || pending?.args?.command || 
                        pending?.args?.pattern || pending?.args?.url || pending?.args?.q || '',
                result: resultContent,
                args: pending?.args || {}
              });
            }
          } else if (parsed.role === 'assistant' && parsed.content) {
            let textContent = '';
            if (Array.isArray(parsed.content)) {
              for (const item of parsed.content) {
                if (item.type === 'text' && item.text) {
                  textContent += item.text;
                }
              }
            } else if (typeof parsed.content === 'string') {
              textContent = parsed.content;
            }
            if (textContent) {
              assistantContent += textContent;
              // 追加到 blocks
              const lastBlock = assistantBlocks[assistantBlocks.length - 1];
              if (lastBlock && lastBlock.type === 'text') {
                lastBlock.content += textContent;
              } else {
                assistantBlocks.push({ type: 'text', content: textContent });
              }
              sendEvent({ type: 'text_delta', content: textContent });
            }
          }
        } catch (err) {
          // 非 JSON，忽略
        }
      }
      
      // 发送完成事件
      sendEvent({ type: 'done' });
      
      // 保存助手回复
      try {
        if (assistantBlocks.length > 0) {
          // 保存为 JSON blocks
          await query(`
            INSERT INTO messages (session_id, role, content)
            VALUES ($1, 'assistant', $2)
          `, [sessionId, JSON.stringify(assistantBlocks)]);
          
          // 更新会话消息计数和时间
          await query(`
            UPDATE sessions 
            SET message_count = message_count + 2,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
          `, [sessionId]);
        }
      } catch (err) {
        console.error('Failed to save message:', err);
      }
      
      if (code !== 0) {
        console.error(`Kimi process exited with code ${code}`);
        if (!hasReceivedData) {
          sendEvent({ type: 'error', message: 'Kimi process failed to generate response' });
        }
      }
      
      res.end();
    });
    
    // 处理客户端断开连接
    req.on('close', () => {
      if (kimiProcess.killed) return;
      
      console.log('Client disconnected, killing Kimi process');
      kimiProcess.kill('SIGTERM');
      
      // 保存已生成的内容
      if (assistantBlocks.length > 0) {
        query(`
          INSERT INTO messages (session_id, role, content)
          VALUES ($1, 'assistant', $2)
        `, [sessionId, JSON.stringify(assistantBlocks)]).catch(console.error);
      }
    });
    
  } catch (err) {
    next(err);
  }
});


export default router;
