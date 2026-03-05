import type { 
  Project, 
  ChatSession, 
  ChatMessage, 
  FileNode, 
  FileChange,
  GitStatus,
  Settings 
} from '../../../shared/types';

const API_BASE = '/api';

async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers
    }
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Unknown error' }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }
  
  return response.json();
}

// Store getState function to access current project
let getProjectState: (() => { currentProject: { id: number } | null }) | null = null;

// 设置 store 引用（由 store 初始化时调用）
export function setProjectStoreRef(getState: () => { currentProject: { id: number } | null }) {
  getProjectState = getState;
}

// 获取当前项目ID的辅助函数
function getProjectId(): number | null {
  return getProjectState?.()?.currentProject?.id || null;
}

// 文件系统 API
export const fsAPI = {
  listDirectory: (path: string): Promise<{ path: string; items: FileNode[] }> => {
    const projectId = getProjectId();
    const params = new URLSearchParams({ path });
    if (projectId) params.append('projectId', String(projectId));
    return fetchJSON(`${API_BASE}/fs/list?${params}`);
  },
  
  readFile: (path: string): Promise<{ path: string; content: string; encoding: string; mtime: string; isBinary?: boolean }> => {
    const projectId = getProjectId();
    const params = new URLSearchParams({ path });
    if (projectId) params.append('projectId', String(projectId));
    return fetchJSON(`${API_BASE}/fs/read?${params}`);
  },
  
  writeFile: (path: string, content: string): Promise<{ success: boolean }> => {
    const projectId = getProjectId();
    return fetchJSON(`${API_BASE}/fs/write`, {
      method: 'POST',
      body: JSON.stringify({ path, content, projectId })
    });
  },
  
  createFile: (path: string, type: 'file' | 'directory'): Promise<{ success: boolean }> => {
    const projectId = getProjectId();
    return fetchJSON(`${API_BASE}/fs/operation`, {
      method: 'POST',
      body: JSON.stringify({ operation: 'create', source: path, type, projectId })
    });
  },
  
  deleteFile: (path: string): Promise<{ success: boolean }> => {
    const projectId = getProjectId();
    return fetchJSON(`${API_BASE}/fs/operation`, {
      method: 'POST',
      body: JSON.stringify({ operation: 'delete', source: path, projectId })
    });
  },
  
  renameFile: (source: string, target: string): Promise<{ success: boolean }> => {
    const projectId = getProjectId();
    return fetchJSON(`${API_BASE}/fs/operation`, {
      method: 'POST',
      body: JSON.stringify({ operation: 'rename', source, target, projectId })
    });
  }
};

// 项目 API
export const projectAPI = {
  getRecentProjects: (): Promise<{ projects: Project[] }> =>
    fetchJSON(`${API_BASE}/projects`),
  
  openProject: (path: string): Promise<{ project: Project; sessions: ChatSession[] }> =>
    fetchJSON(`${API_BASE}/projects/open`, {
      method: 'POST',
      body: JSON.stringify({ path })
    }),
  
  updateProject: (id: number, updates: Partial<Project>): Promise<{ project: Project }> =>
    fetchJSON(`${API_BASE}/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates)
    }),
  
  deleteProject: (id: number): Promise<{ success: boolean }> =>
    fetchJSON(`${API_BASE}/projects/${id}`, {
      method: 'DELETE'
    }),
  
  createSession: (projectId: number, name?: string): Promise<{ session: ChatSession }> =>
    fetchJSON(`${API_BASE}/chat/sessions`, {
      method: 'POST',
      body: JSON.stringify({ projectId, name })
    }),
  
  deleteSession: (sessionId: number): Promise<{ success: boolean }> =>
    fetchJSON(`${API_BASE}/chat/sessions/${sessionId}`, {
      method: 'DELETE'
    })
};

// 流式事件类型
export interface StreamEvent {
  type: 'text_delta' | 'tool_call' | 'tool_result' | 'error' | 'done';
  content?: string;
  id?: string;
  name?: string;
  args?: Record<string, any>;
  message?: string;
}

// 聊天 API
export const chatAPI = {
  createSession: (projectId: number, name?: string): Promise<{ session: ChatSession }> =>
    fetchJSON(`${API_BASE}/chat/sessions`, {
      method: 'POST',
      body: JSON.stringify({ projectId, name })
    }),
  
  deleteSession: (sessionId: number): Promise<{ success: boolean }> =>
    fetchJSON(`${API_BASE}/chat/sessions/${sessionId}`, {
      method: 'DELETE'
    }),
  
  renameSession: (sessionId: number, name: string): Promise<{ session: ChatSession }> =>
    fetchJSON(`${API_BASE}/chat/sessions/${sessionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name })
    }),
  
  getMessages: (sessionId: number): Promise<{ messages: ChatMessage[] }> =>
    fetchJSON(`${API_BASE}/chat/sessions/${sessionId}/messages`),
  
  // 新版：结构化流式响应
  sendMessageStream: (
    sessionId: number,
    content: string,
    context?: { currentFile?: string; selectedCode?: string },
    handlers?: {
      onTextDelta?: (text: string) => void;
      onToolCall?: (tool: { id: string; name: string; args: Record<string, any> }) => void;
      onToolResult?: (result: { id: string; name: string; args: Record<string, any>; content: string }) => void;
      onError?: (message: string) => void;
      onDone?: () => void;
    }
  ): Promise<void> => {
    return new Promise((resolve, reject) => {
      fetch(`${API_BASE}/chat/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, context })
      }).then(response => {
        if (!response.ok) {
          reject(new Error(`HTTP ${response.status}`));
          return;
        }
        
        const reader = response.body?.getReader();
        if (!reader) {
          reject(new Error('No response body'));
          return;
        }
        
        const decoder = new TextDecoder();
        let buffer = '';
        
        function read() {
          reader!.read().then(({ done, value }) => {
            if (done) {
              handlers?.onDone?.();
              resolve();
              return;
            }
            
            buffer += decoder.decode(value, { stream: true });
            
            // 处理完整行（JSONL 格式）
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // 保留不完整的最后一行
            
            for (const line of lines) {
              if (!line.trim()) continue;
              
              try {
                const event: StreamEvent = JSON.parse(line);
                
                switch (event.type) {
                  case 'text_delta':
                    handlers?.onTextDelta?.(event.content || '');
                    break;
                  case 'tool_call':
                    handlers?.onToolCall?.({
                      id: event.id || '',
                      name: event.name || 'Unknown',
                      args: event.args || {}
                    });
                    break;
                  case 'tool_result':
                    handlers?.onToolResult?.({
                      id: event.id || '',
                      name: event.name || 'Unknown',
                      args: event.args || {},
                      content: event.content || ''
                    });
                    break;
                  case 'error':
                    handlers?.onError?.(event.message || 'Unknown error');
                    break;
                  case 'done':
                    handlers?.onDone?.();
                    break;
                }
              } catch (err) {
                console.warn('Failed to parse event:', line);
              }
            }
            
            read();
          }).catch(reject);
        }
        
        read();
      }).catch(reject);
    });
  },
  
  // 兼容旧版：纯文本流（现在只是对 sendMessageStream 的包装）
  sendMessage: (
    sessionId: number, 
    content: string, 
    context?: { currentFile?: string; selectedCode?: string },
    onChunk?: (chunk: string) => void
  ): Promise<void> => {
    let fullText = '';
    return chatAPI.sendMessageStream(sessionId, content, context, {
      onTextDelta: (text) => {
        fullText += text;
        onChunk?.(fullText);
      },
      onToolResult: (result) => {
        // 将工具结果格式化为文本，保持兼容性
        const toolBlock = `<system><tool>${result.name}</tool>` +
          (result.args.path ? `<path>${result.args.path}</path>` : '') +
          (result.args.command ? `<command>${result.args.command}</command>` : '') +
          (result.args.pattern ? `<pattern>${result.args.pattern}</pattern>` : '') +
          (result.args.url ? `<url>${result.args.url}</url>` : '') +
          (result.args.q ? `<q>${result.args.q}</q>` : '') +
          `</system>\n${result.content}`;
        fullText += '\n' + toolBlock + '\n';
        onChunk?.(fullText);
      }
    });
  },
  
  getFileChanges: (sessionId: number): Promise<{ changes: FileChange[] }> =>
    fetchJSON(`${API_BASE}/chat/sessions/${sessionId}/changes`),
  
  applyChange: (changeId: number): Promise<{ success: boolean }> =>
    fetchJSON(`${API_BASE}/chat/changes/${changeId}/apply`, { method: 'POST' }),
  
  rejectChange: (changeId: number): Promise<{ success: boolean }> =>
    fetchJSON(`${API_BASE}/chat/changes/${changeId}/reject`, { method: 'POST' })
};

// Git API
export const gitAPI = {
  getStatus: (projectPath: string): Promise<GitStatus> =>
    fetchJSON(`${API_BASE}/git/status?path=${encodeURIComponent(projectPath)}`),
  
  add: (projectPath: string, files?: string[]): Promise<{ success: boolean }> =>
    fetchJSON(`${API_BASE}/git/add`, {
      method: 'POST',
      body: JSON.stringify({ path: projectPath, files })
    }),
  
  commit: (projectPath: string, message: string): Promise<{ success: boolean }> =>
    fetchJSON(`${API_BASE}/git/commit`, {
      method: 'POST',
      body: JSON.stringify({ path: projectPath, message })
    })
};

// 设置 API
export const settingsAPI = {
  getSettings: (): Promise<{ settings: Settings; keybindings: Record<string, string> }> =>
    fetchJSON(`${API_BASE}/settings`),
  
  updateSettings: (updates: Partial<Settings>): Promise<{ settings: Settings }> =>
    fetchJSON(`${API_BASE}/settings`, {
      method: 'PATCH',
      body: JSON.stringify(updates)
    })
};
