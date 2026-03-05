import { useState, useRef, useEffect, useCallback } from 'react';
import { flushSync } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useProjectStore } from '../stores/project';
import { chatAPI, projectAPI, type StreamEvent } from '../services/api';
import { useSettingsStore } from '../stores/settings';
import VoiceButton from './VoiceButton';
import ToolCallBlock from './ToolCallBlock';
import type { ChatMessage, ChatSession } from '../../../shared/types';
import './ChatPanel.css';

// 消息块类型
interface MessageBlock {
  type: 'text' | 'tool';
  id?: string;
  content?: string;
  operation?: string;
  target?: string;
  result?: string;
  args?: Record<string, any>;
}

// 解析消息内容为块
function parseMessageContent(content: string): MessageBlock[] {
  // 解析为 JSON blocks
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].type) {
      return parsed as MessageBlock[];
    }
  } catch {
    // 不是 JSON，返回纯文本块
  }
  
  return [{ type: 'text', content }];
}

interface ChatPanelProps {
  projectId: number;
}

export default function ChatPanel({ projectId }: ChatPanelProps) {
  const { currentSession, sessions, createSession, deleteSession, renameSession, setCurrentSession } = useProjectStore();
  const { settings } = useSettingsStore();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [showSessionMenu, setShowSessionMenu] = useState(false);
  
  // 用于流式消息构建的状态
  const [streamingBlocks, setStreamingBlocks] = useState<MessageBlock[]>([]);
  const streamingBlocksRef = useRef<MessageBlock[]>([]);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load messages when session changes
  useEffect(() => {
    if (currentSession) {
      loadMessages(currentSession.id);
    } else {
      setMessages([]);
    }
  }, [currentSession]);
  
  // 页面关闭前保存未完成的回复
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (isStreaming && streamingBlocksRef.current.length > 0 && currentSession) {
        const finalBlocks = streamingBlocksRef.current.map(block => ({
          type: block.type,
          ...(block.type === 'text' 
            ? { content: block.content }
            : {
                id: block.id,
                operation: block.operation,
                target: block.target,
                result: block.result,
                args: block.args
              }
          )
        }));
        
        // 使用 sendBeacon 在页面关闭前发送保存请求
        const data = JSON.stringify({
          sessionId: currentSession.id,
          content: JSON.stringify(finalBlocks)
        });
        navigator.sendBeacon?.('/api/chat/save-partial', new Blob([data], { type: 'application/json' }));
      }
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isStreaming, currentSession]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingBlocks]);

  const loadMessages = async (sessionId: number) => {
    try {
      const data = await chatAPI.getMessages(sessionId);
      setMessages(data.messages);
    } catch (error) {
      console.error('Failed to load messages:', error);
    }
  };

  // 生成 session 名称：取前 20 个字符
  const generateSessionName = (text: string): string => {
    const trimmed = text.trim();
    if (trimmed.length <= 20) return trimmed;
    return trimmed.substring(0, 20) + '...';
  };

  const handleSend = async () => {
    if (!inputText.trim() || isStreaming) return;
    
    if (!currentSession) {
      // 新 session 用用户输入的前几个字命名
      const sessionName = generateSessionName(inputText);
      const newSession = await createSession(sessionName);
      setCurrentSession(newSession);
      await sendMessage(newSession.id, inputText, true);
    } else {
      // 检查是否是当前 session 的第一条消息
      const isFirstMessage = messages.length === 0;
      await sendMessage(currentSession.id, inputText, isFirstMessage);
    }
    
    setInputText('');
  };

  const sendMessage = async (sessionId: number, content: string, isFirstMessage: boolean = false) => {
    setIsStreaming(true);
    streamingBlocksRef.current = [];
    setStreamingBlocks([]);
    
    // Add user message to UI immediately
    const userMessage: ChatMessage = {
      id: Date.now(),
      sessionId,
      role: 'user',
      content,
      createdAt: new Date().toISOString()
    };
    setMessages(prev => [...prev, userMessage]);
    
    // 如果是第一条消息，自动重命名 session
    if (isFirstMessage && currentSession) {
      const newName = generateSessionName(content);
      renameSession(currentSession.id, newName);
    }
    
    // Get context from current file
    const { activeFilePath } = useProjectStore.getState();
    
    const context = {
      currentFile: activeFilePath || undefined,
      selectedCode: undefined
    };
    
    try {
      let assistantContent = '';
      
      await chatAPI.sendMessageStream(
        sessionId,
        content,
        context,
        {
          onTextDelta: (text) => {
            assistantContent += text;
            
            // 更新最后一个文本块或添加新块
            flushSync(() => {
              setStreamingBlocks(prev => {
                const lastBlock = prev[prev.length - 1];
                if (lastBlock?.type === 'text') {
                  // 追加到现有文本块
                  const newBlocks = [...prev];
                  newBlocks[newBlocks.length - 1] = {
                    ...lastBlock,
                    content: (lastBlock.content || '') + text
                  };
                  streamingBlocksRef.current = newBlocks;
                  return newBlocks;
                } else {
                  // 创建新文本块
                  const newBlocks = [...prev, { type: 'text' as const, content: text }];
                  streamingBlocksRef.current = newBlocks;
                  return newBlocks;
                }
              });
            });
          },
          
          onToolCall: (tool) => {
            // 工具调用开始时添加一个占位块
            flushSync(() => {
              setStreamingBlocks(prev => {
                const target = tool.args.path || tool.args.command || 
                              tool.args.pattern || tool.args.url || tool.args.q || '';
                const newBlocks = [...prev, {
                  type: 'tool' as const,
                  id: tool.id,
                  operation: tool.name,
                  target,
                  result: '',
                  args: tool.args
                }];
                streamingBlocksRef.current = newBlocks;
                return newBlocks;
              });
            });
          },
          
          onToolResult: (result) => {
            // 更新对应的工具块
            flushSync(() => {
              setStreamingBlocks(prev => {
                const index = prev.findIndex(b => b.type === 'tool' && b.id === result.id);
                if (index >= 0) {
                  const newBlocks = [...prev];
                  newBlocks[index] = {
                    ...newBlocks[index],
                    result: result.content
                  };
                  streamingBlocksRef.current = newBlocks;
                  return newBlocks;
                }
                // 如果没有找到对应的调用，直接添加结果块
                const target = result.args.path || result.args.command || 
                              result.args.pattern || result.args.url || result.args.q || '';
                const newBlocks = [...prev, {
                  type: 'tool' as const,
                  id: result.id,
                  operation: result.name,
                  target,
                  result: result.content,
                  args: result.args
                }];
                streamingBlocksRef.current = newBlocks;
                return newBlocks;
              });
            });
            
            // 同时构建文本格式的内容用于保存
            const toolHeader = `<tool>${result.name}</tool>` +
              (result.args.path ? `<path>${result.args.path}</path>` : '') +
              (result.args.command ? `<command>${result.args.command}</command>` : '') +
              (result.args.pattern ? `<pattern>${result.args.pattern}</pattern>` : '') +
              (result.args.url ? `<url>${result.args.url}</url>` : '') +
              (result.args.q ? `<q>${result.args.q}</q>` : '');
            assistantContent += `<system>${toolHeader}</system>\n${result.content}\n`;
          },
          
          onError: (message) => {
            console.error('Stream error:', message);
          },
          
          onDone: () => {
            // 流结束，将流式块转换为最终消息
          }
        }
      );
      
      // 流结束后，将最终内容添加到消息列表
      // 直接将 blocks 作为 JSON 存储（与后端格式一致）
      const finalBlocks = streamingBlocksRef.current.map(block => ({
        type: block.type,
        ...(block.type === 'text' 
          ? { content: block.content }
          : {
              id: block.id,
              operation: block.operation,
              target: block.target,
              result: block.result,
              args: block.args
            }
        )
      }));
      
      // 添加助手消息到列表
      setMessages(prev => [...prev, {
        id: Date.now() + 1,
        sessionId,
        role: 'assistant',
        content: JSON.stringify(finalBlocks),
        createdAt: new Date().toISOString()
      }]);
      
      // 清空流式块
      streamingBlocksRef.current = [];
      setStreamingBlocks([]);
      
    } catch (error) {
      console.error('Failed to send message:', error);
      
      // 如果已经有生成的内容，保存不完整的回复
      if (streamingBlocksRef.current.length > 0) {
        const finalBlocks = streamingBlocksRef.current.map(block => ({
          type: block.type,
          ...(block.type === 'text' 
            ? { content: block.content }
            : {
                id: block.id,
                operation: block.operation,
                target: block.target,
                result: block.result,
                args: block.args
              }
          )
        }));
        
        // 添加不完整回复到消息列表
        setMessages(prev => [...prev, {
          id: Date.now() + 1,
          sessionId,
          role: 'assistant',
          content: JSON.stringify(finalBlocks),
          createdAt: new Date().toISOString()
        }]);
      } else {
        // 如果没有生成任何内容，显示错误消息
        setMessages(prev => [...prev, {
          id: Date.now() + 1,
          sessionId,
          role: 'assistant',
          content: `❌ Error: ${error instanceof Error ? error.message : 'Failed to get response from Kimi'}`,
          createdAt: new Date().toISOString()
        }]);
      }
    } finally {
      // 清空流式块
      streamingBlocksRef.current = [];
      setStreamingBlocks([]);
      setIsStreaming(false);
    }
  };

  const handleVoiceTranscript = (transcript: string) => {
    setInputText(prev => prev + transcript);
    inputRef.current?.focus();
  };

  const handleNewSession = async () => {
    const newSession = await createSession();
    setCurrentSession(newSession);
    setMessages([]);
    setShowSessionMenu(false);
  };

  const handleDeleteSession = async (sessionId: number) => {
    if (!confirm('确定要删除这个会话吗？')) return;
    
    try {
      await deleteSession(sessionId);
      // 如果删除的是当前会话，清空消息
      if (currentSession?.id === sessionId) {
        setMessages([]);
      }
    } catch (error) {
      console.error('Failed to delete session:', error);
      alert('删除会话失败');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  // 渲染消息块
  const renderBlocks = (blocks: MessageBlock[]) => {
    return blocks.map((block, index) => {
      if (block.type === 'text') {
        return (
          <div key={index} className="markdown-content">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.content || ''}</ReactMarkdown>
          </div>
        );
      } else {
        return (
          <ToolCallBlock
            key={block.id || index}
            operation={block.operation || 'Unknown'}
            target={block.target || ''}
            result={block.result || '执行中...'}
            defaultExpanded={false}
          />
        );
      }
    });
  };

  return (
    <div className="chat-panel">
      {/* Header */}
      <div className="chat-header">
        <div className="session-selector">
          <button 
            className="session-dropdown"
            onClick={() => setShowSessionMenu(!showSessionMenu)}
          >
            <span>{currentSession?.name || '新会话'}</span>
            <span className="dropdown-arrow">▼</span>
          </button>
          
          {showSessionMenu && (
            <div className="session-menu">
              {sessions.map(session => (
                <div
                  key={session.id}
                  className={`session-item ${currentSession?.id === session.id ? 'active' : ''}`}
                  onClick={() => {
                    setCurrentSession(session);
                    setShowSessionMenu(false);
                  }}
                >
                  <span className="session-name">{session.name}</span>
                  <span className="message-count">{session.messageCount} 消息</span>
                  <span 
                    className="delete-btn" 
                    title="删除会话"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteSession(session.id);
                    }}
                  >
                    ✕
                  </span>
                </div>
              ))}
              <div className="session-item new" onClick={handleNewSession}>
                + 新会话
              </div>
            </div>
          )}
        </div>
        
        <button className="btn btn-icon" onClick={handleNewSession} title="新建会话">
          ✚
        </button>
      </div>

      {/* Messages */}
      <div className="chat-messages">
        {messages.length === 0 && streamingBlocks.length === 0 && (
          <div className="chat-welcome">
            <h3>🤖 Kimi AI 助手</h3>
            <p>我可以帮你：</p>
            <ul>
              <li>💬 回答编程问题</li>
              <li>📝 解释和优化代码</li>
              <li>🔧 生成和修改文件</li>
              <li>🌐 搜索网络信息</li>
            </ul>
          </div>
        )}
        
        {messages.map((message, index) => {
          // 助手消息解析为块，用户消息保持原样
          const messageBlocks = message.role === 'assistant' 
            ? parseMessageContent(message.content)
            : [{ type: 'text' as const, content: message.content }];
          
          return (
            <div 
              key={message.id} 
              className={`message ${message.role} ${message.metadata?.isSTTResult ? 'stt-result' : ''}`}
            >
              <div className="message-avatar">
                {message.role === 'user' ? '👤' : '🤖'}
              </div>
              <div className="message-content">
                {message.metadata?.isSTTResult && (
                  <div className="stt-badge">🎤 语音识别</div>
                )}
                {message.metadata?.currentFile && (
                  <div className="context-badge">
                    📄 {message.metadata.currentFile.split('/').pop()}
                  </div>
                )}
                <div className="message-text">
                  {renderBlocks(messageBlocks)}
                </div>
              </div>
            </div>
          );
        })}
        
        {/* 流式消息 */}
        {isStreaming && streamingBlocks.length > 0 && (
          <div className="message assistant">
            <div className="message-avatar">🤖</div>
            <div className="message-content">
              <div className="message-text">
                {renderBlocks(streamingBlocks)}
                <span className="typing-cursor">▌</span>
              </div>
            </div>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="chat-input-container">
        <div className="context-hint">
          {useProjectStore.getState().activeFilePath && (
            <span className="current-file">
              📄 {useProjectStore.getState().activeFilePath?.split('/').pop()}
            </span>
          )}
        </div>
        
        <div className="chat-input-wrapper">
          <textarea
            ref={inputRef}
            className="chat-input"
            placeholder="输入消息... (Ctrl+Enter 发送)"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={isStreaming}
          />
          
          <div className="chat-actions">
            <VoiceButton 
              onTranscript={handleVoiceTranscript}
              disabled={isStreaming}
            />
            <button 
              className="btn btn-primary send-btn"
              onClick={handleSend}
              disabled={!inputText.trim() || isStreaming}
            >
              {isStreaming ? '...' : '➤'}
            </button>
          </div>
        </div>
        
        <div className="input-hint">
          Ctrl + Enter 发送
        </div>
      </div>
    </div>
  );
}
