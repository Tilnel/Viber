import { useState, useEffect, useRef } from 'react';
import { useProjectStore } from '../stores/project';
import type { FileNode } from '../../../shared/types';
import './FileTree.css';

interface FileTreeProps {
  projectPath: string;
  projectId: number;
}

export default function FileTree({ projectPath, projectId }: FileTreeProps) {
  const { 
    openFile, 
    activeFilePath, 
    fileTree, 
    expandedDirs, 
    toggleDir, 
    loadDirectory,
    fileTreeScrollTop, 
    setFileTreeScrollTop, 
    startAutoRefresh, 
    stopAutoRefresh 
  } = useProjectStore();
  
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  // 初始加载和项目切换时加载
  useEffect(() => {
    // 如果没有 projectId，不加载文件树
    if (!projectId) {
      return;
    }
    
    const init = async () => {
      // 加载根目录
      await loadDirectory('.');
      
      // 加载所有已展开的目录
      const expandedList = Array.from(expandedDirs);
      for (const dirPath of expandedList) {
        if (dirPath !== '.') {
          await loadDirWithLoading(dirPath);
        }
      }
    };
    
    init();
    
    // 恢复滚动位置
    if (scrollRef.current && fileTreeScrollTop > 0) {
      scrollRef.current.scrollTop = fileTreeScrollTop;
    }
  }, [projectPath, projectId]);
  
  // 启动自动刷新
  useEffect(() => {
    startAutoRefresh();
    return () => stopAutoRefresh();
  }, []);
  
  // 监听滚动位置变化
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    
    const handleScroll = () => {
      setFileTreeScrollTop(container.scrollTop);
    };
    
    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [setFileTreeScrollTop]);

  // 加载目录并显示 loading 状态
  const loadDirWithLoading = async (path: string) => {
    setLoadingDirs(prev => new Set(prev).add(path));
    await loadDirectory(path);
    setLoadingDirs(prev => {
      const next = new Set(prev);
      next.delete(path);
      return next;
    });
  };

  const handleToggleDir = async (node: FileNode) => {
    const isExpanding = !expandedDirs.has(node.path);
    
    toggleDir(node.path);
    
    // 如果展开且没有 children，加载子目录
    if (isExpanding && node.type === 'directory' && (!node.children || node.children.length === 0)) {
      await loadDirWithLoading(node.path);
    }
  };

  const handleFileClick = (node: FileNode) => {
    if (node.type === 'directory') {
      handleToggleDir(node);
    } else {
      openFile(node.path);
    }
  };

  const getFileIcon = (node: FileNode) => {
    if (node.type === 'directory') {
      return expandedDirs.has(node.path) ? '📂' : '📁';
    }
    
    const ext = node.name.split('.').pop()?.toLowerCase();
    const iconMap: Record<string, string> = {
      'js': '📜', 'ts': '📘', 'jsx': '⚛️', 'tsx': '⚛️',
      'py': '🐍', 'java': '☕', 'go': '🐹', 'rs': '🦀',
      'html': '🌐', 'css': '🎨', 'scss': '🎨', 'json': '📋',
      'md': '📝', 'sql': '🗄️', 'sh': '⌨️', 'yml': '⚙️',
      'yaml': '⚙️', 'dockerfile': '🐳', 'vue': '💚',
      'png': '🖼️', 'jpg': '🖼️', 'gif': '🖼️', 'svg': '🎭'
    };
    return iconMap[ext || ''] || '📄';
  };

  const handleRefresh = () => {
    if (!projectId) return;
    loadDirectory('.');
  };

  // 递归渲染树
  const renderTree = (nodes: FileNode[], level: number = 0): JSX.Element[] => {
    if (!nodes || nodes.length === 0) return [];
    
    return nodes.map(node => (
      <div key={node.path}>
        <div
          className={`file-tree-item ${
            activeFilePath === node.path ? 'active' : ''
          } ${node.type === 'directory' ? 'directory' : 'file'}`}
          style={{ paddingLeft: `${level * 16 + 8}px` }}
          onClick={() => handleFileClick(node)}
        >
          <span className="file-tree-icon">
            {node.type === 'directory' && (
              <span className="expand-icon">
                {expandedDirs.has(node.path) ? '▼' : '▶'}
              </span>
            )}
            {getFileIcon(node)}
          </span>
          <span className="file-tree-name" title={node.name}>
            {node.name}
          </span>
          {loadingDirs.has(node.path) && (
            <span className="loading-indicator">⟳</span>
          )}
        </div>
        
        {node.type === 'directory' && 
         expandedDirs.has(node.path) && 
         node.children && node.children.length > 0 && (
          <div className="file-tree-children">
            {renderTree(node.children, level + 1)}
          </div>
        )}
      </div>
    ));
  };

  return (
    <div className="file-tree">
      <div className="file-tree-header">
        <span>文件资源管理器</span>
        <div className="file-tree-actions">
          <button className="btn btn-icon" title="新建文件">📄+</button>
          <button className="btn btn-icon" title="新建文件夹">📁+</button>
          <button className="btn btn-icon" title="刷新" onClick={handleRefresh}>🔄</button>
        </div>
      </div>
      <div className="file-tree-content" ref={scrollRef}>
        {renderTree(fileTree)}
      </div>
    </div>
  );
}
