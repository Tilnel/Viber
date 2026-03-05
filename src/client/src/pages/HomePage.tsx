import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { projectAPI } from '../services/api';
import OpenProjectModal from '../components/OpenProjectModal';
import type { Project } from '../../../shared/types';
import './HomePage.css';

export default function HomePage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      setIsLoading(true);
      const data = await projectAPI.getRecentProjects();
      setProjects(data.projects);
    } catch (error) {
      toast.error('Failed to load projects');
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenProject = async (project: Project) => {
    if (!project.exists) {
      toast.error('Project path no longer exists');
      return;
    }
    navigate(`/project/${project.id}`);
  };

  const handleRemoveProject = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await projectAPI.deleteProject(id);
      setProjects(projects.filter(p => p.id !== id));
      toast.success('Project removed from list');
    } catch (error) {
      toast.error('Failed to remove project');
    }
  };

  const handlePinProject = async (project: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await projectAPI.updateProject(project.id, { isPinned: !project.isPinned });
      loadProjects();
    } catch (error) {
      toast.error('Failed to update project');
    }
  };

  const handleShowOpenModal = () => {
    setIsModalOpen(true);
  };

  const handleProjectOpened = () => {
    loadProjects();
  };

  const filteredProjects = projects.filter(p =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.path.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const pinnedProjects = filteredProjects.filter(p => p.isPinned);
  const recentProjects = filteredProjects.filter(p => !p.isPinned);

  return (
    <div className="home-page">
      <main className="home-content">
        <div className="search-bar">
          <input
            type="text"
            className="input search-input"
            placeholder="🔍 搜索项目..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {isLoading ? (
          <div className="loading">加载中...</div>
        ) : (
          <>
            {pinnedProjects.length > 0 && (
              <section className="project-section">
                <h2>📌 固定项目</h2>
                <div className="project-grid">
                  {pinnedProjects.map(project => (
                    <ProjectCard
                      key={project.id}
                      project={project}
                      onOpen={() => handleOpenProject(project)}
                      onRemove={(e) => handleRemoveProject(project.id, e)}
                      onPin={(e) => handlePinProject(project, e)}
                    />
                  ))}
                </div>
              </section>
            )}

            <section className="project-section">
              <div className="section-header">
                <h2>📁 最近打开的项目</h2>
                <button className="btn btn-primary" onClick={handleShowOpenModal}>
                  + 打开项目
                </button>
              </div>
              
              {recentProjects.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">📂</div>
                  <p>还没有打开过项目</p>
                  <button className="btn btn-primary" onClick={handleShowOpenModal}>
                    打开项目
                  </button>
                </div>
              ) : (
                <div className="project-list">
                  {recentProjects.map(project => (
                    <ProjectListItem
                      key={project.id}
                      project={project}
                      onOpen={() => handleOpenProject(project)}
                      onRemove={(e) => handleRemoveProject(project.id, e)}
                      onPin={(e) => handlePinProject(project, e)}
                    />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>

      <OpenProjectModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={handleProjectOpened}
      />
    </div>
  );
}

// 项目卡片组件
function ProjectCard({ 
  project, 
  onOpen, 
  onRemove, 
  onPin 
}: { 
  project: Project; 
  onOpen: () => void;
  onRemove: (e: React.MouseEvent) => void;
  onPin: (e: React.MouseEvent) => void;
}) {
  return (
    <div className="project-card" onClick={onOpen}>
      <div className="project-card-header">
        <span className="project-icon">{project.icon || '📁'}</span>
        <div className="project-actions">
          <button className="btn btn-icon" onClick={onPin} title="取消固定">
            📌
          </button>
          <button className="btn btn-icon" onClick={onRemove} title="移除">
            ✕
          </button>
        </div>
      </div>
      <h3 className="project-name">{project.name}</h3>
      <p className="project-path" title={project.path}>{project.path}</p>
      <div className="project-meta">
        <span>打开 {project.openedCount} 次</span>
        <span>{formatRelativeTime(project.lastOpenedAt)}</span>
      </div>
      {!project.exists && <div className="project-error">路径不存在</div>}
    </div>
  );
}

// 项目列表项组件
function ProjectListItem({ 
  project, 
  onOpen, 
  onRemove, 
  onPin 
}: { 
  project: Project; 
  onOpen: () => void;
  onRemove: (e: React.MouseEvent) => void;
  onPin: (e: React.MouseEvent) => void;
}) {
  return (
    <div className="project-list-item" onClick={onOpen}>
      <span className="project-icon">{project.icon || '📁'}</span>
      <div className="project-info">
        <span className="project-name">{project.name}</span>
        <span className="project-path">{project.path}</span>
      </div>
      <div className="project-meta">
        <span>{formatRelativeTime(project.lastOpenedAt)}</span>
      </div>
      <div className="project-actions">
        <button className="btn btn-icon" onClick={onPin} title="固定到首页">
          📌
        </button>
        <button className="btn btn-icon" onClick={onRemove} title="移除">
          🗑️
        </button>
      </div>
      {!project.exists && <span className="project-error-badge">!</span>}
    </div>
  );
}

// 格式化相对时间
function formatRelativeTime(dateString: string): string {
  if (!dateString) return '未知时间';
  
  // 处理 PostgreSQL 日期格式
  // PostgreSQL 可能返回: "2024-03-05T10:30:00.000Z" 或 "2024-03-05 10:30:00+00"
  let normalizedDate = dateString;
  
  // 如果没有时区信息，添加 Z
  if (!dateString.includes('T') && dateString.includes(' ')) {
    normalizedDate = dateString.replace(' ', 'T') + 'Z';
  }
  
  const date = new Date(normalizedDate);
  
  // 检查日期是否有效
  if (isNaN(date.getTime())) {
    console.warn('Invalid date:', dateString);
    return '未知时间';
  }
  
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  
  // 如果时间是未来，显示具体日期
  if (diffMs < 0) {
    return date.toLocaleDateString('zh-CN');
  }
  
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return '刚刚';
  if (diffMins < 60) return `${diffMins} 分钟前`;
  if (diffHours < 24) return `${diffHours} 小时前`;
  if (diffDays < 7) return `${diffDays} 天前`;
  return date.toLocaleDateString('zh-CN');
}
