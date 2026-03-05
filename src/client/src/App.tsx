import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useSettingsStore } from './stores/settings';
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
  
  useEffect(() => {
    loadSettings();
  }, []);
  
  // Apply theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', settings.theme);
  }, [settings.theme]);
  
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
