import { useNavigate, useLocation } from 'react-router-dom';
import { toast } from 'react-toastify';
import './Header.css';

export default function Header() {
  const navigate = useNavigate();
  const location = useLocation();
  
  const isLoginPage = location.pathname === '/login';

  const handleLogout = () => {
    localStorage.removeItem('auth_token');
    toast.success('已退出登录');
    navigate('/login');
  };

  if (isLoginPage) {
    return null;
  }

  return (
    <header className="app-header">
      <div className="header-brand" onClick={() => navigate('/')}>
        <span className="brand-icon">🌙</span>
        <span className="brand-text">Kimi Code</span>
      </div>
      
      <div className="header-actions">
        <button 
          className="btn btn-icon" 
          onClick={() => navigate('/settings')}
          title="设置"
        >
          ⚙️
        </button>
        <button 
          className="btn btn-icon logout-btn" 
          onClick={handleLogout}
          title="退出登录"
        >
          🚪
        </button>
      </div>
    </header>
  );
}
