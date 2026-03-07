import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { projectAPI, fsAPI, setProjectStoreRef, setReinitializeHandler } from '../services/api';
import type { Project, ChatSession, FileNode, OpenFile } from '../../../shared/types';

// 从 localStorage 恢复展开状态（按项目）
const getPersistedExpandedDirs = (projectId: number | null): Set<string> => {
  if (!projectId) return new Set();
  try {
    const saved = localStorage.getItem(`kimi-filetree-expanded-${projectId}`);
    return saved ? new Set(JSON.parse(saved)) : new Set();
  } catch {
    return new Set();
  }
};

// 保存展开状态到 localStorage（按项目）
const persistExpandedDirs = (projectId: number, dirs: Set<string>) => {
  try {
    localStorage.setItem(`kimi-filetree-expanded-${projectId}`, JSON.stringify([...dirs]));
  } catch (e) {
    console.error('Failed to persist expanded dirs:', e);
  }
};

// 从 localStorage 恢复滚动位置（按项目）
const getPersistedScrollTop = (projectId: number | null): number => {
  if (!projectId) return 0;
  try {
    const saved = localStorage.getItem(`kimi-filetree-scroll-${projectId}`);
    return saved ? parseInt(saved, 10) : 0;
  } catch {
    return 0;
  }
};

// 保存滚动位置到 localStorage（按项目）
const persistScrollTop = (projectId: number, scrollTop: number) => {
  try {
    localStorage.setItem(`kimi-filetree-scroll-${projectId}`, String(scrollTop));
  } catch (e) {
    console.error('Failed to persist scroll position:', e);
  }
};

// 持久化打开的文件列表（按项目）
const persistOpenFiles = (projectId: number, filePaths: string[], activePath: string | null) => {
  try {
    const key = `kimi-openfiles-${projectId}`;
    localStorage.setItem(key, JSON.stringify({ files: filePaths, active: activePath }));
  } catch (e) {
    console.error('Failed to persist open files:', e);
  }
};

// 恢复打开的文件列表
const getPersistedOpenFiles = (projectId: number): { files: string[], active: string | null } => {
  try {
    const saved = localStorage.getItem(`kimi-openfiles-${projectId}`);
    return saved ? JSON.parse(saved) : { files: [], active: null };
  } catch {
    return { files: [], active: null };
  }
};

// 持久化文件滚动位置（按项目+文件）
const persistFileScrollPosition = (projectId: number, filePath: string, scrollTop: number) => {
  try {
    const key = `kimi-filescroll-${projectId}`;
    const saved = localStorage.getItem(key);
    const positions = saved ? JSON.parse(saved) : {};
    positions[filePath] = scrollTop;
    localStorage.setItem(key, JSON.stringify(positions));
  } catch (e) {
    console.error('Failed to persist file scroll position:', e);
  }
};

// 恢复文件滚动位置
const getPersistedFileScrollPosition = (projectId: number, filePath: string): number => {
  try {
    const saved = localStorage.getItem(`kimi-filescroll-${projectId}`);
    const positions = saved ? JSON.parse(saved) : {};
    return positions[filePath] || 0;
  } catch {
    return 0;
  }
};

// 清除项目的所有滚动位置
const clearProjectFileScrollPositions = (projectId: number) => {
  try {
    localStorage.removeItem(`kimi-filescroll-${projectId}`);
  } catch (e) {
    console.error('Failed to clear file scroll positions:', e);
  }
};

interface ProjectState {
  // Project
  currentProject: Project | null;
  isLoading: boolean;
  loadProject: (id: number) => Promise<void>;
  
  // Sessions
  sessions: ChatSession[];
  currentSession: ChatSession | null;
  setCurrentSession: (session: ChatSession | null) => void;
  createSession: (name?: string) => Promise<ChatSession>;
  deleteSession: (sessionId: number) => Promise<void>;
  renameSession: (sessionId: number, name: string) => Promise<void>;
  
  // File Tree
  fileTree: FileNode[];
  expandedDirs: Set<string>;
  fileTreeScrollTop: number;
  loadDirectory: (path: string, isRefresh?: boolean) => Promise<void>;
  refreshFileTree: () => Promise<void>;
  toggleDir: (path: string) => void;
  setFileTreeScrollTop: (scrollTop: number) => void;
  startAutoRefresh: () => void;
  stopAutoRefresh: () => void;
  
  // Editor
  openFiles: OpenFile[];
  activeFilePath: string | null;
  openFile: (path: string) => Promise<void>;
  closeFile: (path: string) => void;
  setActiveFile: (path: string) => void;
  updateFileContent: (path: string, content: string) => void;
  saveFile: (path: string) => Promise<void>;
  setFileScrollPosition: (filePath: string, scrollTop: number) => void;
  getFileScrollPosition: (filePath: string) => number;
}

export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => ({
  // Project
  currentProject: null,
  isLoading: false,
  
  loadProject: async (id) => {
    set({ isLoading: true });
    try {
      // This would need a specific API endpoint to get project by ID
      // For now, we'll get recent projects and find the one we need
      const { projects } = await projectAPI.getRecentProjects();
      const project = projects.find(p => p.id === id);
      
      if (!project) {
        throw new Error('Project not found');
      }
      
      // Open the project to get sessions
      const data = await projectAPI.openProject(project.path);
      
      // 恢复打开的文件列表
      const persistedFiles = getPersistedOpenFiles(project.id);
      const openFiles: OpenFile[] = [];
      
      // 尝试恢复每个文件
      for (const filePath of persistedFiles.files) {
        try {
          const fileData = await fsAPI.readFile(filePath);
          openFiles.push({
            path: fileData.path,
            content: fileData.content,
            originalContent: fileData.content,
            language: getLanguageFromPath(fileData.path),
            isDirty: false,
            isLoading: false
          });
        } catch (e) {
          console.warn('Failed to restore file:', filePath);
        }
      }
      
      // 加载该项目的展开状态和滚动位置
      const expandedDirs = getPersistedExpandedDirs(data.project.id);
      const fileTreeScrollTop = getPersistedScrollTop(data.project.id);
      
      set({
        currentProject: data.project,
        sessions: data.sessions,
        currentSession: data.sessions[0] || null,
        openFiles,
        activeFilePath: persistedFiles.active && persistedFiles.files.includes(persistedFiles.active) 
          ? persistedFiles.active 
          : openFiles[0]?.path || null,
        expandedDirs,
        fileTreeScrollTop
      });
      
      // Load root directory
      await get().loadDirectory('.');
    } finally {
      set({ isLoading: false });
    }
  },
  
  // Sessions
  sessions: [],
  currentSession: null,
  
  setCurrentSession: (session) => {
    set({ currentSession: session });
  },
  
  createSession: async (name) => {
    const { currentProject } = get();
    if (!currentProject) throw new Error('No project loaded');
    
    const data = await projectAPI.createSession(currentProject.id, name);
    set(state => ({
      sessions: [data.session, ...state.sessions],
      currentSession: data.session
    }));
    return data.session;
  },
  
  deleteSession: async (sessionId) => {
    const { currentSession } = get();
    
    await projectAPI.deleteSession(sessionId);
    
    set(state => ({
      sessions: state.sessions.filter(s => s.id !== sessionId),
      currentSession: currentSession?.id === sessionId ? null : currentSession
    }));
  },
  
  renameSession: async (sessionId, name) => {
    const { currentSession } = get();
    
    const data = await projectAPI.renameSession(sessionId, name);
    
    set(state => ({
      sessions: state.sessions.map(s => 
        s.id === sessionId ? data.session : s
      ),
      currentSession: currentSession?.id === sessionId ? data.session : currentSession
    }));
  },
  
  // File Tree
  fileTree: [],
  expandedDirs: new Set<string>(),
  fileTreeScrollTop: 0,
  
  loadDirectory: async (path, isRefresh = false) => {
    const { currentProject } = get();
    // 如果没有当前项目，不加载目录
    if (!currentProject) {
      console.warn('Cannot load directory: no project loaded');
      return;
    }
    
    try {
      const data = await fsAPI.listDirectory(path);
      
      set(state => {
        if (path === '.') {
          // 更新根目录
          const mergeNodes = (newItems: any[], oldNodes: FileNode[]): FileNode[] => {
            return newItems.map(item => {
              const oldNode = oldNodes.find(n => n.path === item.path);
              // 如果是目录且已展开且已有 children，保留 children（刷新时也保留，由调用者重新加载）
              if (item.type === 'directory' && 
                  state.expandedDirs.has(item.path) && 
                  oldNode?.children && 
                  oldNode.children.length > 0) {
                return { ...item, children: oldNode.children, isLoaded: true };
              }
              return { 
                ...item, 
                children: item.type === 'directory' ? [] : undefined,
                isLoaded: false 
              };
            });
          };
          
          const newNodes = mergeNodes(data.items, state.fileTree);
          return { fileTree: newNodes };
        }
        
        // 递归更新子目录
        const updateTree = (nodes: FileNode[]): FileNode[] => {
          return nodes.map(node => {
            if (node.path === path) {
              // 保留已展开子目录的 children
              const mergeChildren = (newItems: any[], oldChildren: FileNode[] = []): FileNode[] => {
                return newItems.map(item => {
                  const oldChild = oldChildren.find(c => c.path === item.path);
                  if (item.type === 'directory' && 
                      state.expandedDirs.has(item.path) && 
                      oldChild?.children) {
                    return { ...item, children: oldChild.children, isLoaded: true };
                  }
                  return { 
                    ...item, 
                    children: item.type === 'directory' ? [] : undefined,
                    isLoaded: false 
                  };
                });
              };
              
              const newChildren = data.items;
              const mergedChildren = node.children 
                ? mergeChildren(newChildren, node.children)
                : newChildren.map(item => ({ 
                    ...item, 
                    children: item.type === 'directory' ? [] : undefined,
                    isLoaded: false 
                  }));
              
              return { ...node, children: mergedChildren, isLoaded: true };
            }
            if (node.children && node.children.length > 0) {
              return { ...node, children: updateTree(node.children) };
            }
            return node;
          });
        };
        
        return { fileTree: updateTree(state.fileTree) };
      });
    } catch (error) {
      console.error('Failed to load directory:', error);
    }
  },
  
  refreshFileTree: async () => {
    const { currentProject, expandedDirs } = get();
    // 如果没有当前项目，不刷新
    if (!currentProject) {
      console.warn('Cannot refresh file tree: no project loaded');
      return;
    }
    
    try {
      
      // 先刷新根目录（不保留旧 children，获取最新状态）
      await get().loadDirectory('.', true);
      
      // 然后逐个重新加载所有已展开的目录
      // 使用 Array.from 避免在 async 操作中遍历 Set 出现问题
      const expandedPaths = Array.from(expandedDirs);
      for (const dirPath of expandedPaths) {
        try {
          await get().loadDirectory(dirPath, true);
        } catch (e) {
          // 如果某个目录加载失败（可能被删除），从展开列表中移除
          console.warn('Failed to refresh directory:', dirPath);
        }
      }
    } catch (error) {
      console.error('Failed to refresh file tree:', error);
    }
  },
  
  toggleDir: (path) => {
    set(state => {
      const expanded = new Set(state.expandedDirs);
      if (expanded.has(path)) {
        expanded.delete(path);
      } else {
        expanded.add(path);
      }
      // 按项目保存
      if (state.currentProject) {
        persistExpandedDirs(state.currentProject.id, expanded);
      }
      return { expandedDirs: expanded };
    });
  },
  
  setFileTreeScrollTop: (scrollTop) => {
    set(state => {
      // 按项目保存
      if (state.currentProject) {
        persistScrollTop(state.currentProject.id, scrollTop);
      }
      return { fileTreeScrollTop: scrollTop };
    });
  },
  
  startAutoRefresh: () => {
    // 每 5 秒自动刷新文件树
    const intervalId = setInterval(() => {
      get().refreshFileTree();
    }, 5000);
    
    // 保存 interval ID 以便停止
    (window as any).__fileTreeRefreshInterval = intervalId;
  },
  
  stopAutoRefresh: () => {
    const intervalId = (window as any).__fileTreeRefreshInterval;
    if (intervalId) {
      clearInterval(intervalId);
      delete (window as any).__fileTreeRefreshInterval;
    }
  },
  
  // Editor
  openFiles: [],
  activeFilePath: null,
  
  openFile: async (path) => {
    const { openFiles, currentProject, activeFilePath } = get();
    
    // Check if already open
    const existing = openFiles.find(f => f.path === path);
    if (existing) {
      set({ activeFilePath: path });
      // 持久化状态
      if (currentProject) {
        persistOpenFiles(currentProject.id, openFiles.map(f => f.path), path);
      }
      return;
    }
    
    try {
      const data = await fsAPI.readFile(path);
      
      const language = data.isBinary ? 'plaintext' : getLanguageFromPath(path);
      
      const newFile: OpenFile = {
        path: data.path,
        content: data.content,
        originalContent: data.content,
        language,
        isDirty: false,
        isLoading: false,
        isBinary: data.isBinary
      };
      
      const newOpenFiles = [...openFiles, newFile];
      set({
        openFiles: newOpenFiles,
        activeFilePath: path
      });
      
      // 持久化打开的文件列表
      if (currentProject) {
        persistOpenFiles(currentProject.id, newOpenFiles.map(f => f.path), path);
      }
    } catch (error) {
      console.error('Failed to open file:', error);
      throw error;
    }
  },
  
  closeFile: (path) => {
    const { currentProject } = get();
    
    set(state => {
      const openFiles = state.openFiles.filter(f => f.path !== path);
      let activeFilePath = state.activeFilePath;
      
      if (activeFilePath === path) {
        activeFilePath = openFiles[openFiles.length - 1]?.path || null;
      }
      
      return { openFiles, activeFilePath };
    });
    
    // 持久化打开的文件列表
    if (currentProject) {
      const { openFiles, activeFilePath } = get();
      persistOpenFiles(currentProject.id, openFiles.map(f => f.path), activeFilePath);
    }
  },
  
  setActiveFile: (path) => {
    const { currentProject, openFiles } = get();
    
    set({ activeFilePath: path });
    
    // 持久化活跃文件
    if (currentProject) {
      persistOpenFiles(currentProject.id, openFiles.map(f => f.path), path);
    }
  },
  
  updateFileContent: (path, content) => {
    set(state => ({
      openFiles: state.openFiles.map(f => 
        f.path === path 
          ? { ...f, content, isDirty: f.originalContent !== content }
          : f
      )
    }));
  },
  
  saveFile: async (path) => {
    const { openFiles } = get();
    const file = openFiles.find(f => f.path === path);
    if (!file) return;
    
    await fsAPI.writeFile(path, file.content);
    
    set(state => ({
      openFiles: state.openFiles.map(f => 
        f.path === path 
          ? { ...f, originalContent: f.content, isDirty: false }
          : f
      )
    }));
  },
  
  setFileScrollPosition: (filePath, scrollTop) => {
    const { currentProject } = get();
    if (currentProject) {
      persistFileScrollPosition(currentProject.id, filePath, scrollTop);
    }
  },
  
  getFileScrollPosition: (filePath) => {
    const { currentProject } = get();
    if (currentProject) {
      return getPersistedFileScrollPosition(currentProject.id, filePath);
    }
    return 0;
  }
}),
{
  name: 'kimi-project-store',
  partialize: (state) => ({ 
    currentProject: state.currentProject,
    // 不持久化这些 transient 状态
    // isLoading, fileTree, expandedDirs 等会在加载项目时重新初始化
  }),
}
)
);

// 设置 store 引用供 API 使用
setProjectStoreRef(() => useProjectStore.getState());

// 设置重新初始化处理函数（服务器重启后自动重新打开项目）
setReinitializeHandler(async () => {
  const state = useProjectStore.getState();
  const { currentProject } = state;
  
  if (currentProject?.id) {
    console.log('[ProjectStore] Reinitializing project after server restart:', currentProject.id);
    try {
      // 重新调用 openProject 来设置服务器端的 PathSecurity
      await projectAPI.openProject(currentProject.path);
      console.log('[ProjectStore] Project reinitialized successfully');
    } catch (error) {
      console.error('[ProjectStore] Failed to reinitialize project:', error);
      throw error;
    }
  }
});

function getLanguageFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  const langMap: Record<string, string> = {
    'js': 'javascript',
    'ts': 'typescript',
    'jsx': 'javascript',
    'tsx': 'typescript',
    'py': 'python',
    'java': 'java',
    'cpp': 'cpp',
    'c': 'c',
    'h': 'c',
    'hpp': 'cpp',
    'go': 'go',
    'rs': 'rust',
    'rb': 'ruby',
    'php': 'php',
    'html': 'html',
    'css': 'css',
    'scss': 'scss',
    'less': 'less',
    'json': 'json',
    'yaml': 'yaml',
    'yml': 'yaml',
    'md': 'markdown',
    'sql': 'sql',
    'sh': 'shell',
    'bash': 'shell',
    'zsh': 'shell',
    'dockerfile': 'dockerfile',
    'vue': 'vue',
    'svelte': 'svelte'
  };
  return langMap[ext || ''] || 'plaintext';
}
