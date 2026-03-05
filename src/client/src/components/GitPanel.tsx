import { useState, useEffect } from 'react';
import { gitAPI } from '../services/api';
import type { GitStatus, GitFileStatus } from '../../../shared/types';
import './GitPanel.css';

interface GitPanelProps {
  projectPath: string;
}

export default function GitPanel({ projectPath }: GitPanelProps) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    loadStatus();
    const interval = setInterval(loadStatus, 5000);
    return () => clearInterval(interval);
  }, [projectPath]);

  const loadStatus = async () => {
    try {
      const data = await gitAPI.getStatus(projectPath);
      setStatus(data);
    } catch (error) {
      console.error('Failed to load git status:', error);
    }
  };

  const handleStage = async (file: GitFileStatus) => {
    try {
      await gitAPI.add(projectPath, [file.path]);
      loadStatus();
    } catch (error) {
      console.error('Failed to stage file:', error);
    }
  };

  const handleCommit = async () => {
    if (!commitMessage.trim()) return;
    setIsLoading(true);
    try {
      await gitAPI.commit(projectPath, commitMessage);
      setCommitMessage('');
      loadStatus();
    } catch (error) {
      console.error('Failed to commit:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (!status?.isGitRepo) {
    return (
      <div className="git-panel">
        <div className="git-empty">
          <p>不是 Git 仓库</p>
          <p className="git-hint">在项目目录中运行 git init</p>
        </div>
      </div>
    );
  }

  const unstagedFiles = status.files?.filter(f => !f.staged) || [];
  const stagedFiles = status.files?.filter(f => f.staged) || [];

  return (
    <div className="git-panel">
      <div className="git-header">
        <div className="git-branch">
          <span className="branch-icon">🌿</span>
          <span className="branch-name">{status.branch}</span>
        </div>
        {status.ahead > 0 && <span className="git-ahead">↑{status.ahead}</span>}
        {status.behind > 0 && <span className="git-behind">↓{status.behind}</span>}
      </div>

      {unstagedFiles.length > 0 && (
        <div className="git-section">
          <div className="section-title">更改 ({unstagedFiles.length})</div>
          <div className="git-files">
            {unstagedFiles.map(file => (
              <div key={file.path} className={`git-file ${file.status}`}>
                <button 
                  className="stage-btn" 
                  onClick={() => handleStage(file)}
                  title="暂存"
                >
                  +
                </button>
                <span className="file-status">{getStatusIcon(file.status)}</span>
                <span className="file-name">{file.path}</span>
              </div>
            ))}
          </div>
          <button className="btn btn-secondary" onClick={() => gitAPI.add(projectPath)}>
            暂存所有更改
          </button>
        </div>
      )}

      {stagedFiles.length > 0 && (
        <div className="git-section">
          <div className="section-title">暂存的更改 ({stagedFiles.length})</div>
          <div className="git-files">
            {stagedFiles.map(file => (
              <div key={file.path} className={`git-file ${file.status} staged`}>
                <span className="file-status">{getStatusIcon(file.status)}</span>
                <span className="file-name">{file.path}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="git-commit">
        <textarea
          className="commit-input"
          placeholder="输入提交消息..."
          value={commitMessage}
          onChange={(e) => setCommitMessage(e.target.value)}
          rows={3}
        />
        <button 
          className="btn btn-primary commit-btn"
          onClick={handleCommit}
          disabled={!commitMessage.trim() || stagedFiles.length === 0 || isLoading}
        >
          {isLoading ? '...' : '提交'}
        </button>
      </div>

      {status.recentCommits && status.recentCommits.length > 0 && (
        <div className="git-section">
          <div className="section-title">最近提交</div>
          <div className="git-commits">
            {status.recentCommits.slice(0, 5).map(commit => (
              <div key={commit.hash} className="git-commit-item">
                <span className="commit-hash">{commit.hash}</span>
                <span className="commit-message" title={commit.message}>
                  {commit.message.split('\n')[0]}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function getStatusIcon(status: string): string {
  const icons: Record<string, string> = {
    'modified': '📝',
    'added': '➕',
    'deleted': '🗑️',
    'renamed': '✏️',
    'untracked': '❓'
  };
  return icons[status] || '📄';
}
