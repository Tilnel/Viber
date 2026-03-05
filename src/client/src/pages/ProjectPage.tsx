import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { toast } from 'react-toastify';
import FileTree from '../components/FileTree';
import CodeEditor from '../components/CodeEditor';
import ChatPanel from '../components/ChatPanel';
import GitPanel from '../components/GitPanel';
import TerminalPanel from '../components/TerminalPanel';
import { useProjectStore } from '../stores/project';
import './ProjectPage.css';

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { currentProject, loadProject, isLoading } = useProjectStore();
  
  const [showGitPanel, setShowGitPanel] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [showChatPanel, setShowChatPanel] = useState(true);

  useEffect(() => {
    if (projectId) {
      loadProject(parseInt(projectId)).catch(() => {
        toast.error('Failed to load project');
        navigate('/');
      });
    }
  }, [projectId]);

  if (isLoading) {
    return <div className="project-loading">加载项目中...</div>;
  }

  if (!currentProject) {
    return <div className="project-error">项目不存在</div>;
  }

  return (
    <div className="project-page">
      {/* Header */}
      <header className="project-header">
        <div className="header-left">
          <button 
            className="btn btn-icon" 
            onClick={() => navigate('/')}
            title="返回首页"
          >
            🔙
          </button>
          <button 
            className="btn btn-icon" 
            onClick={() => setShowSidebar(!showSidebar)}
            title="切换侧边栏"
          >
            ☰
          </button>
          <span className="project-title">{currentProject.name}</span>
        </div>
        
        <div className="header-center">
          <button 
            className={`btn btn-icon ${showGitPanel ? 'active' : ''}`}
            onClick={() => setShowGitPanel(!showGitPanel)}
            title="Git"
          >
            🔀
          </button>
          <button 
            className={`btn btn-icon ${showTerminal ? 'active' : ''}`}
            onClick={() => setShowTerminal(!showTerminal)}
            title="终端"
          >
            💻
          </button>
        </div>
        
        <div className="header-right">
          <button 
            className="btn btn-icon"
            onClick={() => setShowChatPanel(!showChatPanel)}
            title="AI 助手"
          >
            🤖
          </button>
          <button 
            className="btn btn-icon"
            onClick={() => navigate('/settings')}
            title="设置"
          >
            ⚙️
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="project-main">
        <PanelGroup direction="horizontal">
          {/* Sidebar */}
          {showSidebar && (
            <>
              <Panel defaultSize={20} minSize={15} maxSize={30} className="project-sidebar">
                {showGitPanel ? (
                  <GitPanel projectPath={currentProject.absolutePath || currentProject.path} />
                ) : (
                  <FileTree 
                    projectPath={currentProject.absolutePath || currentProject.path}
                    projectId={currentProject.id}
                  />
                )}
              </Panel>
              <PanelResizeHandle className="resize-handle" />
            </>
          )}

          {/* Editor */}
          <Panel className="project-editor">
            <CodeEditor />
            {showTerminal && (
              <TerminalPanel 
                projectPath={currentProject.absolutePath || currentProject.path}
                onClose={() => setShowTerminal(false)}
              />
            )}
          </Panel>

          {/* Chat Panel */}
          {showChatPanel && (
            <>
              <PanelResizeHandle className="resize-handle" />
              <Panel 
                defaultSize={25} 
                minSize={20} 
                maxSize={40}
                className="project-chat"
              >
                <ChatPanel projectId={currentProject.id} />
              </Panel>
            </>
          )}
        </PanelGroup>
      </div>
    </div>
  );
}
