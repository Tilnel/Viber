import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useSettingsStore } from './stores/settings';
import { useProjectStore } from './stores/project';
import HomePage from './pages/HomePage';
import ProjectPage from './pages/ProjectPage';
import SettingsPage from './pages/SettingsPage';
import LoginPage from './pages/LoginPage';
import Header from './components/Header';

// 检查是否已登录
const isAuthenticated = () => {
  return localStorage.getItem('auth_token') !== null;
};

// 保护路由组件
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [authenticated, setAuthenticated] = useState(isAuthenticated());
  
  useEffect(() => {
    setAuthenticated(isAuthenticated());
  }, [location]);
  
  if (!authenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  
  return <>{children}</>;
}

function App() {
  const { settings, loadSettings } = useSettingsStore();
  const { currentProject, loadProject } = useProjectStore();
  const [isRestoring, setIsRestoring] = useState(true);
  
  useEffect(() => {
    loadSettings();
  }, []);
  
  // 恢复之前的项目状态
  useEffect(() => {
    const restoreProject = async () => {
      // 从持久化存储中恢复（zustand persist 会自动恢复，但我们需要重新加载项目数据）
      const state = JSON.parse(localStorage.getItem('kimi-project-store') || '{}');
      const savedProject = state?.state?.currentProject;
      
      if (savedProject?.id && !currentProject) {
        try {
          await loadProject(savedProject.id);
        } catch (error) {
          console.error('Failed to restore project:', error);
        }
      }
      setIsRestoring(false);
    };
    
    restoreProject();
  }, []);
  
  // Apply theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', settings.theme);
  }, [settings.theme]);
  
  // 恢复项目时显示加载状态
  if (isRestoring) {
    return (
      <div className="app-loading" style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        height: '100vh'
      }}>
        <span>加载中...</span>
      </div>
    );
  }
  
  return (
    <div className="app">
      <Header />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={
          <ProtectedRoute>
            <HomePage />
          </ProtectedRoute>
        } />
        <Route path="/project/:projectId/*" element={
          <ProtectedRoute>
            <ProjectPage />
          </ProtectedRoute>
        } />
        <Route path="/settings/*" element={
          <ProtectedRoute>
            <SettingsPage />
          </ProtectedRoute>
        } />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

export default App;
