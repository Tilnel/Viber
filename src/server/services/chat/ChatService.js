/**
 * Chat Service - 单例模式，同一时间只有一个 kimi-cli 进程
 * 
 * 设计原则：
 * 1. 全局只有一个 kimi-cli 进程在运行
 * 2. 新请求到来时，自动终止当前进程（取消上一个对话）
 * 3. 使用请求队列确保请求按顺序处理
 * 
 * @phase 5
 */

import { spawn, execSync } from 'child_process';
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
 * Chat Service - 单例模式管理 kimi-cli 进程
 */
export class ChatService {
  constructor() {
    this.kimiPath = KIMI_PATH;
    this.currentProcess = null;      // 当前运行的进程
    this.currentSessionId = null;    // 当前处理的会话ID
    this.requestQueue = [];          // 请求队列
    this.isProcessing = false;       // 是否正在处理请求
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
   * 如果当前有进程在运行，会先终止它
   */
  async sendMessage(options, handlers = {}) {
    const { sessionId, content, context = {}, skipUserMessageSave = false } = options;
    const { onTextDelta, onThinking, onToolCall, onToolResult, onComplete, onError } = handlers;

    if (!this.kimiPath) {
      throw new Error('Kimi CLI not found. Please install kimi-cli: npm install -g kimi-cli');
    }

    // 如果当前有进程在运行，终止它
    if (this.currentProcess && !this.currentProcess.killed) {
      console.log(`[ChatService] New request for session ${sessionId}, terminating current process for session ${this.currentSessionId}`);
      this._killCurrentProcess();
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
    let systemPrompt = `你是 Kimi，作为 **Viber** (VoIce & Intelligence Backed EditoR) 项目的 AI 助手，深度集成在这个基于语音交互的智能代码编辑器中。

## 关于 Viber
Viber 是一个结合了实时语音对话和 AI 编程辅助的 Web 应用，特点包括：
- 实时双工语音对话（火山引擎 ASR/TTS）
- 基于 Monaco Editor 的代码编辑器
- 项目文件管理和 Git 版本控制
- 内置 Web Terminal
- 技术栈：Node.js + Express + PostgreSQL + React + TypeScript + Socket.io

## 你的职责
1. 协助用户编写、理解和重构代码
2. 回答关于项目架构、技术选型的问题
3. 使用工具（如 Bash、Search、Editor 等）主动探索和操作项目文件
4. 保持对话自然，支持语音交互场景（回答简洁，适合朗读）`;
    
    if (context.currentFile) {
      systemPrompt += `\n\n当前文件: ${context.currentFile}`;
    }
    
    if (context.selectedCode) {
      systemPrompt += `\n\n选中代码:\n\`\`\`\n${context.selectedCode}\n\`\`\``;
    }
    
    if (context.projectPath) {
      systemPrompt += `\n\n项目路径: ${context.projectPath}`;
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
    console.log(`[ChatService] Starting kimi process for session ${sessionId}`);
    const kimiProcess = spawn(pythonPath, [this.kimiPath, ...kimiArgs, '-p', fullPrompt], {
      cwd: projectCwd,
      env: {
        ...process.env,
        KIMI_PLATFORM: 'kimi-code',
        PYTHONUNBUFFERED: '1'
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // 设置为当前进程
    this.currentProcess = kimiProcess;
    this.currentSessionId = sessionId;

    let assistantContent = '';
    let assistantBlocks = [];
    let buffer = '';
    const pendingToolCalls = new Map();
    const processedToolResults = new Set();

    return new Promise((resolve, reject) => {
      // 处理进程启动错误
      kimiProcess.on('error', (err) => {
        console.error('[ChatService] Failed to start Kimi CLI:', err);
        this._clearCurrentProcess();
        onError?.(`Failed to start Kimi CLI - ${err.message}`);
        reject(err);
      });

      kimiProcess.stdout.on('data', (data) => {
        // 检查是否还是当前进程（可能已被新请求替换）
        if (this.currentProcess !== kimiProcess) {
          console.log('[ChatService] Data from old process, ignoring');
          return;
        }

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

            // 处理助手文本内容（包括 thinking 和正式回复）
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
                // 解析 thinking 内容（<think> 标签包裹的内容）
                const thinkMatch = textContent.match(/<think>([\s\S]*?)<\/think>/);
                if (thinkMatch) {
                  const thinkingContent = thinkMatch[1].trim();
                  if (thinkingContent) {
                    // 单独回调 thinking 内容，用于 TTS
                    onThinking?.(thinkingContent);
                    
                    // 添加 thinking 块到 assistantBlocks
                    assistantBlocks.push({ type: 'thinking', content: thinkingContent });
                  }
                  
                  // 提取正式回复内容（think 标签之后的内容）
                  const afterThink = textContent.split('<\/think>')[1]?.trim();
                  if (afterThink) {
                    assistantContent += afterThink;
                    assistantBlocks.push({ type: 'text', content: afterThink });
                    onTextDelta?.(afterThink);
                  }
                } else {
                  // 普通文本内容
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
        // 检查是否还是当前进程
        if (this.currentProcess !== kimiProcess) {
          console.log('[ChatService] Old process closed, ignoring');
          return;
        }

        this._clearCurrentProcess();

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
   * 停止当前生成
   * 终止当前运行的 kimi-cli 进程
   */
  stopGeneration(sessionId) {
    // 只有当是当前会话的进程时才终止
    if (this.currentProcess && !this.currentProcess.killed && this.currentSessionId === sessionId) {
      console.log('[ChatService] Stopping generation for session:', sessionId);
      this._killCurrentProcess();
      return true;
    }
    console.log(`[ChatService] No active process for session ${sessionId} to stop (current: ${this.currentSessionId})`);
    return false;
  }

  /**
   * 获取当前状态
   */
  getStatus() {
    return {
      hasActiveProcess: !!this.currentProcess && !this.currentProcess.killed,
      currentSessionId: this.currentSessionId,
      queueLength: this.requestQueue.length
    };
  }

  /**
   * 终止当前进程（内部方法）
   */
  _killCurrentProcess() {
    if (this.currentProcess && !this.currentProcess.killed) {
      try {
        this.currentProcess.kill('SIGTERM');
      } catch (err) {
        console.error('[ChatService] Error killing process:', err.message);
      }
    }
    this._clearCurrentProcess();
  }

  /**
   * 清除当前进程引用（内部方法）
   */
  _clearCurrentProcess() {
    this.currentProcess = null;
    this.currentSessionId = null;
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

export function resetChatService() {
  if (chatServiceInstance) {
    chatServiceInstance._killCurrentProcess();
    chatServiceInstance = null;
  }
}

export default ChatService;
