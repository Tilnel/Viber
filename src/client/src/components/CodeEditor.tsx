import { useCallback, useEffect, useState, useRef, useLayoutEffect } from 'react';
import Editor, { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import { useProjectStore } from '../stores/project';
import { useSettingsStore } from '../stores/settings';
import './CodeEditor.css';

// 配置 Monaco 从本地加载，避免 CDN 被浏览器阻止
loader.config({ monaco });

// 存储每个文件的 view state（内存 + localStorage 双保险）
const fileViewStates = new Map<string, monaco.editor.ICodeEditorViewState | null>();

export default function CodeEditor() {
  const { 
    openFiles, 
    activeFilePath, 
    setActiveFile, 
    closeFile, 
    updateFileContent,
    saveFile,
    setFileScrollPosition,
    getFileScrollPosition
  } = useProjectStore();
  const { settings } = useSettingsStore();

  const [isEditorReady, setIsEditorReady] = useState(false);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const previousFilePathRef = useRef<string | null>(null);
  const activeFilePathRef = useRef<string | null>(activeFilePath);
  const isSwitchingRef = useRef(false);
  
  // 同步 ref 与 state
  activeFilePathRef.current = activeFilePath;
  
  // Determine Monaco theme based on settings
  const monacoTheme = settings.theme === 'light' ? 'vs' : 'vs-dark';

  const handleEditorChange = useCallback((value: string | undefined, path: string) => {
    if (value !== undefined) {
      updateFileContent(path, value);
    }
  }, [updateFileContent]);

  const handleSave = useCallback(async (path: string) => {
    try {
      await saveFile(path);
    } catch (error) {
      console.error('Failed to save file:', error);
    }
  }, [saveFile]);

  // 保存当前文件的 view state（同步操作）
  const saveCurrentViewState = useCallback(() => {
    const editor = editorRef.current;
    const currentPath = activeFilePathRef.current;
    if (!editor || !currentPath) return;
    
    const viewState = editor.saveViewState();
    fileViewStates.set(currentPath, viewState);
    // 同时保存滚动位置到 localStorage
    const scrollTop = editor.getScrollTop();
    setFileScrollPosition(currentPath, scrollTop);
    console.log(`[Scroll] Saved for ${currentPath}: ${scrollTop}`);
  }, [setFileScrollPosition]);

  // 包装关闭文件函数
  const handleCloseFile = useCallback((path: string) => {
    saveCurrentViewState();
    closeFile(path);
  }, [closeFile, saveCurrentViewState]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        const currentPath = activeFilePathRef.current;
        if (currentPath) {
          handleSave(currentPath);
        }
      }
      
      if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
        e.preventDefault();
        const currentPath = activeFilePathRef.current;
        if (currentPath) {
          handleCloseFile(currentPath);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleCloseFile, handleSave]);

  // 使用 useLayoutEffect 确保在 DOM 更新前保存状态
  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const prevPath = previousFilePathRef.current;
    const newPath = activeFilePath;

    // 如果正在切换中，先保存当前状态
    if (isSwitchingRef.current && prevPath) {
      const viewState = editor.saveViewState();
      fileViewStates.set(prevPath, viewState);
    }

    // 标记开始切换
    isSwitchingRef.current = true;

    // 保存之前文件的 view state（必须同步立即保存）
    if (prevPath && prevPath !== newPath) {
      const viewState = editor.saveViewState();
      fileViewStates.set(prevPath, viewState);
      const scrollTop = editor.getScrollTop();
      setFileScrollPosition(prevPath, scrollTop);
      console.log(`[Scroll] LayoutEffect save for ${prevPath}: ${scrollTop}`);
    }

    previousFilePathRef.current = newPath;
  }, [activeFilePath, setFileScrollPosition]);

  // Editor 挂载时的处理 - 这里恢复 view state
  const handleEditorMount = (editor: monaco.editor.IStandaloneCodeEditor) => {
    editorRef.current = editor;
    setIsEditorReady(true);

    // 恢复当前文件的 view state
    const currentPath = activeFilePathRef.current;
    if (currentPath) {
      // 延迟一点确保 Monaco 准备好
      setTimeout(() => {
        const savedViewState = fileViewStates.get(currentPath);
        if (savedViewState) {
          editor.restoreViewState(savedViewState);
          console.log(`[Scroll] Restored view state for ${currentPath}`);
        } else {
          // 尝试从 localStorage 恢复
          const savedScrollTop = getFileScrollPosition(currentPath);
          if (savedScrollTop > 0) {
            editor.setScrollTop(savedScrollTop);
            console.log(`[Scroll] Restored scrollTop for ${currentPath}: ${savedScrollTop}`);
          }
        }
        editor.focus();
      }, 50);
    }
  };

  // 监听编辑器内容变化时恢复 view state
  // Monaco Editor 在 value 变化后会重新渲染，需要在渲染后恢复
  useEffect(() => {
    const editor = editorRef.current;
    const currentPath = activeFilePath;
    
    if (!editor || !currentPath || !isEditorReady) return;

    // 使用 requestAnimationFrame 确保在 Monaco 渲染完成后执行
    const frameId = requestAnimationFrame(() => {
      const savedViewState = fileViewStates.get(currentPath);
      if (savedViewState) {
        editor.restoreViewState(savedViewState);
        console.log(`[Scroll] Effect restore for ${currentPath}`);
      }
    });

    return () => cancelAnimationFrame(frameId);
  }, [activeFilePath, isEditorReady, openFiles]);

  // 组件卸载时保存
  useEffect(() => {
    return () => {
      const currentPath = activeFilePathRef.current;
      if (editorRef.current && currentPath) {
        const viewState = editorRef.current.saveViewState();
        fileViewStates.set(currentPath, viewState);
        const scrollTop = editorRef.current.getScrollTop();
        setFileScrollPosition(currentPath, scrollTop);
      }
    };
  }, [setFileScrollPosition]);

  if (openFiles.length === 0) {
    return (
      <div className="code-editor-empty">
        <div className="welcome-content">
          <h2>🌙 Kimi Code Web Assistant</h2>
          <p>打开文件开始编辑</p>
          <div className="shortcuts">
            <div className="shortcut">
              <kbd>Ctrl+P</kbd>
              <span>快速打开文件</span>
            </div>
            <div className="shortcut">
              <kbd>Ctrl+Shift+F</kbd>
              <span>搜索</span>
            </div>
            <div className="shortcut">
              <kbd>Ctrl+L</kbd>
              <span>打开 AI 助手</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const activeFile = openFiles.find(f => f.path === activeFilePath);

  // 二进制文件显示特殊界面
  if (activeFile?.isBinary) {
    return (
      <div className="code-editor">
        {/* Tabs */}
        <div className="editor-tabs">
          {openFiles.map(file => (
            <div
              key={file.path}
              className={`editor-tab ${activeFilePath === file.path ? 'active' : ''} ${file.isDirty ? 'dirty' : ''}`}
              onClick={() => setActiveFile(file.path)}
            >
              <span className="tab-name">{file.path.split('/').pop()}</span>
              {file.isDirty && <span className="tab-dirty">●</span>}
              <button
                className="tab-close"
                onClick={(e) => {
                  e.stopPropagation();
                  handleCloseFile(file.path);
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        {/* Binary File Display */}
        <div className="editor-container" style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          background: 'var(--bg-secondary)'
        }}>
          <div style={{ 
            textAlign: 'center', 
            padding: '40px',
            color: 'var(--text-secondary)'
          }}>
            <div style={{ fontSize: '64px', marginBottom: '20px' }}>📦</div>
            <h3>二进制文件</h3>
            <p>该文件是二进制文件，无法直接编辑。</p>
            <p style={{ fontSize: '12px', marginTop: '10px', opacity: 0.7 }}>
              {activeFile.path}
            </p>
          </div>
        </div>

        {/* Status Bar */}
        <div className="editor-status-bar">
          <div className="status-left">
            <span>{activeFile.path}</span>
            <span style={{ color: 'var(--warning-color, #e5a50a)' }}>BINARY</span>
          </div>
          <div className="status-right">
            <span>UTF-8</span>
            <span>LF</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="code-editor">
      {/* Tabs */}
      <div className="editor-tabs">
        {openFiles.map(file => (
          <div
            key={file.path}
            className={`editor-tab ${activeFilePath === file.path ? 'active' : ''} ${file.isDirty ? 'dirty' : ''}`}
            onClick={() => setActiveFile(file.path)}
          >
            <span className="tab-name">{file.path.split('/').pop()}</span>
            {file.isDirty && <span className="tab-dirty">●</span>}
            <button
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation();
                handleCloseFile(file.path);
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {/* Editor */}
      <div className="editor-container">
        {activeFile && (
          <Editor
            height="100%"
            language={activeFile.language}
            value={activeFile.content}
            theme={monacoTheme}
            onChange={(value) => handleEditorChange(value, activeFile.path)}
            onMount={handleEditorMount}
            options={{
              minimap: { enabled: true },
              fontSize: 14,
              fontFamily: 'JetBrains Mono, Consolas, monospace',
              wordWrap: 'on',
              automaticLayout: true,
              tabSize: 2,
              insertSpaces: true,
              formatOnPaste: true,
              formatOnType: true,
              scrollBeyondLastLine: false,
              renderWhitespace: 'selection',
              bracketPairColorization: { enabled: true },
              guides: {
                bracketPairs: true,
                indentation: true
              }
            }}
          />
        )}
      </div>

      {/* Status Bar */}
      {activeFile && (
        <div className="editor-status-bar">
          <div className="status-left">
            <span>{activeFile.path}</span>
            {activeFile.isDirty && <span className="unsaved">未保存</span>}
          </div>
          <div className="status-right">
            <span>{activeFile.language.toUpperCase()}</span>
            <span>UTF-8</span>
            <span>LF</span>
          </div>
        </div>
      )}
    </div>
  );
}
