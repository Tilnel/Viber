/**
 * Chat Service
 * 复用 chat.js 中的 kimi-cli 调用逻辑，供 VoiceOrchestrator 使用
 * 
 * @phase 5
 */

import { spawn } from 'child_process';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { query } from '../../db/index.js';

const DEFAULT_ROOT_DIR = process.env.ROOT_DIR || '/path/to/your/code';

// 尝试找到 kimi 命令的路径
function findKimiPath() {
  try {
    const result = execSync('which kimi', { encoding: 'utf8' });
    return result.trim();
  } catch {
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

/**
 * Chat Service - 处理消息发送和 kimi-cli 调用
 */
export class ChatService {
  constructor() {
    this.kimiPath = KIMI_PATH;
    this.activeProcesses = new Map(); // sessionId -> process
  }

  /**
   * 检查 kimi-cli 是否可用
   */
  isAvailable() {
    return !!this.kimiPath;
  }

  /**
   * 获取 kimi-cli 路径
   */
  getKimiPath() {
    return this.kimiPath;
  }

  /**
   * 发送消息并获取流式响应
   * @param {Object} options
   * @param {number} options.sessionId - 会话ID
   * @param {string} options.content - 消息内容
   * @param {Object} options.context - 上下文信息 { currentFile, projectPath }
   * @param {boolean} options.skipUserMessageSave - 是否跳过保存用户消息（用于语音对话，因为 ASR 结果已在前端保存）
   * @param {Object} handlers - 事件处理器
   */
  async sendMessage(options, handlers = {}) {
    const { sessionId, content, context = {}, skipUserMessageSave = false } = options;
    const { onTextDelta, onToolCall, onToolResult, onComplete, onError } = handlers;

    if (!this.kimiPath) {
      throw new Error('Kimi CLI not found. Please install kimi-cli: npm install -g kimi-cli');
    }

    // 获取会话信息
    const { rows: [session] } = await query(`
      SELECT s.id, s.project_id, p.path as project_path
      FROM sessions s
      JOIN projects p ON s.project_id = p.id
      WHERE s.id = $1
    `, [sessionId]);

    if (!session) {
      throw new Error('Session not found');
    }

    // 保存用户消息（除非跳过）
    if (!skipUserMessageSave) {
      await query(`
        INSERT INTO messages (session_id, role, content, metadata)
        VALUES ($1, 'user', $2, $3)
      `, [sessionId, content, JSON.stringify(context)]);
    }

    // 获取历史消息
    const { rows: historyMessages } = await query(`
      SELECT role, content, created_at
      FROM messages
      WHERE session_id = $1
      ORDER BY created_at ASC
    `, [sessionId]);

    // 构建系统提示
    let systemPrompt = `You are Kimi, a helpful AI assistant integrated into a web-based code editor.`;
    
    if (context.currentFile) {
      systemPrompt += `\n\nCurrent file: ${context.currentFile}`;
    }
    
    if (context.selectedCode) {
      systemPrompt += `\n\nSelected code:\n\`\`\`\n${context.selectedCode}\n\`\`\``;
    }
    
    if (context.projectPath) {
      systemPrompt += `\n\nProject path: ${context.projectPath}`;
    }

    // 构建对话历史
    let conversationHistory = '';
    const MAX_HISTORY_ROUNDS = 20;
    const recentMessages = historyMessages.slice(-MAX_HISTORY_ROUNDS * 2);
    
    for (const msg of recentMessages) {
      if (msg.role === 'user') {
        let userContent = msg.content;
        try {
          const parsed = JSON.parse(msg.content);
          if (Array.isArray(parsed)) {
            userContent = parsed
              .filter(b => b.type === 'text')
              .map(b => b.content)
              .join('');
          }
        } catch {
          // 不是 JSON，使用原始内容
        }
        conversationHistory += `\n\nUser: ${userContent}`;
      } else if (msg.role === 'assistant') {
        let assistantContent = msg.content;
        try {
          const parsed = JSON.parse(msg.content);
          if (Array.isArray(parsed)) {
            assistantContent = parsed
              .filter(b => b.type === 'text')
              .map(b => b.content)
              .join('');
          }
        } catch {
          // 不是 JSON，使用原始内容
        }
        if (assistantContent.trim()) {
          conversationHistory += `\n\nAssistant: ${assistantContent}`;
        }
      }
    }

    const fullPrompt = systemPrompt + conversationHistory + '\n\nAssistant:';

    console.log('[ChatService] Session ID:', sessionId);
    console.log('[ChatService] Prompt length:', fullPrompt.length);

    // 构建 kimi 参数
    const kimiArgs = [
      '--print',
      '--output-format=stream-json'
    ];

    const projectCwd = path.join(DEFAULT_ROOT_DIR, session.project_path);
    console.log('[ChatService] Project CWD:', projectCwd);

    if (!fs.existsSync(projectCwd)) {
      throw new Error(`Project directory not found: ${projectCwd}`);
    }

    // 读取 shebang 确定 Python 路径
    let pythonPath = 'python3';
    try {
      const kimiContent = fs.readFileSync(this.kimiPath, 'utf8');
      const shebangMatch = kimiContent.match(/^#!(.+)$/m);
      if (shebangMatch) {
        pythonPath = shebangMatch[1].trim();
        console.log('[ChatService] Using Python from shebang:', pythonPath);
      }
    } catch (err) {
      console.log('[ChatService] Could not read shebang, using default python3');
    }

    // 启动 kimi 进程
    const kimiProcess = spawn(pythonPath, [this.kimiPath, ...kimiArgs, '-p', fullPrompt], {
      cwd: projectCwd,
      env: {
        ...process.env,
        KIMI_PLATFORM: 'kimi-code'
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.activeProcesses.set(sessionId, kimiProcess);

    let assistantContent = '';
    let assistantBlocks = [];
    let buffer = '';
    const pendingToolCalls = new Map();
    const processedToolResults = new Set();

    return new Promise((resolve, reject) => {
      // 处理进程启动错误
      kimiProcess.on('error', (err) => {
        console.error('[ChatService] Failed to start Kimi CLI:', err);
        this.activeProcesses.delete(sessionId);
        onError?.(`Failed to start Kimi CLI - ${err.message}`);
        reject(err);
      });

      kimiProcess.stdout.on('data', (data) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const parsed = JSON.parse(line);

            // 处理工具调用
            if (parsed.role === 'assistant' && parsed.tool_calls && Array.isArray(parsed.tool_calls)) {
              for (const toolCall of parsed.tool_calls) {
                if (toolCall.type === 'function' && toolCall.function) {
                  const toolId = toolCall.id;
                  const toolName = toolCall.function.name;
                  const args = JSON.parse(toolCall.function.arguments || '{}');
                  
                  pendingToolCalls.set(toolId, { name: toolName, args });
                  
                  onToolCall?.({
                    id: toolId,
                    name: toolName,
                    args
                  });
                }
              }
            }

            // 处理工具结果
            if (parsed.role === 'tool' && parsed.tool_call_id) {
              const toolId = parsed.tool_call_id;
              
              if (processedToolResults.has(toolId)) {
                continue;
              }
              processedToolResults.add(toolId);
              
              const pending = pendingToolCalls.get(toolId);
              
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
              
              onToolResult?.({
                id: toolId,
                name: pending?.name || 'Unknown',
                args: pending?.args || {},
                content: resultContent
              });
              
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

            // 处理助手文本内容
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
                const lastBlock = assistantBlocks[assistantBlocks.length - 1];
                if (lastBlock && lastBlock.type === 'text') {
                  lastBlock.content += textContent;
                } else {
                  assistantBlocks.push({ type: 'text', content: textContent });
                }
                onTextDelta?.(textContent);
              }
            }

          } catch (err) {
            console.log('[ChatService] Non-JSON line:', line.substring(0, 100));
          }
        }
      });

      kimiProcess.stderr.on('data', (data) => {
        console.error('[ChatService] Kimi stderr:', data.toString());
      });

      kimiProcess.on('close', async (code) => {
        this.activeProcesses.delete(sessionId);

        // 处理缓冲区中剩余的内容
        if (buffer.trim()) {
          try {
            const parsed = JSON.parse(buffer);
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
                const lastBlock = assistantBlocks[assistantBlocks.length - 1];
                if (lastBlock && lastBlock.type === 'text') {
                  lastBlock.content += textContent;
                } else {
                  assistantBlocks.push({ type: 'text', content: textContent });
                }
                onTextDelta?.(textContent);
              }
            }
          } catch (err) {
            // 非 JSON，忽略
          }
        }

        // 保存助手回复到数据库
        try {
          if (assistantBlocks.length > 0) {
            await query(`
              INSERT INTO messages (session_id, role, content)
              VALUES ($1, 'assistant', $2)
            `, [sessionId, JSON.stringify(assistantBlocks)]);
            
            await query(`
              UPDATE sessions 
              SET message_count = message_count + 2,
                  updated_at = CURRENT_TIMESTAMP
              WHERE id = $1
            `, [sessionId]);
          }
        } catch (err) {
          console.error('[ChatService] Failed to save message:', err);
        }

        if (code !== 0) {
          console.error(`[ChatService] Kimi process exited with code ${code}`);
        }

        onComplete?.({
          content: assistantContent,
          blocks: assistantBlocks
        });

        resolve({
          content: assistantContent,
          blocks: assistantBlocks
        });
      });
    });
  }

  /**
   * 停止指定会话的生成
   */
  stopGeneration(sessionId) {
    const process = this.activeProcesses.get(sessionId);
    if (process && !process.killed) {
      console.log('[ChatService] Stopping generation for session:', sessionId);
      process.kill('SIGTERM');
      this.activeProcesses.delete(sessionId);
      return true;
    }
    return false;
  }
}

// 单例实例
let chatServiceInstance = null;

export function getChatService() {
  if (!chatServiceInstance) {
    chatServiceInstance = new ChatService();
  }
  return chatServiceInstance;
}

export default ChatService;
