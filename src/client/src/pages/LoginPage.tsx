import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './LoginPage.css';

export default function LoginPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });

      if (response.ok) {
        const data = await response.json();
        localStorage.setItem('auth_token', data.token);
        navigate('/');
      } else {
        const data = await response.json().catch(() => ({}));
        setError(data.error || '密码错误');
      }
    } catch (err) {
      setError('登录服务不可用，请稍后重试');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-container">
        <div className="login-logo">
          <span className="logo-icon">🌙</span>
          <h1>viber</h1>
        </div>
        
        <form className="login-form" onSubmit={handleLogin}>
          <div className="form-group">
            <label htmlFor="password">密码</label>
            <input
              id="password"
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="输入访问密码"
              disabled={isLoading}
              autoFocus
            />
          </div>
          
          {error && <div className="login-error">{error}</div>}
          
          <button 
            type="submit" 
            className="btn btn-primary login-btn"
            disabled={isLoading || !password}
          >
            {isLoading ? '登录中...' : '登录'}
          </button>
        </form>

        <div className="login-hint">
          <p>💡 密码设置位置：</p>
          <p>1. 环境变量: <code>AUTH_PASSWORD</code></p>
          <p>2. 或 .env 文件: <code>AUTH_PASSWORD=your_password</code></p>
        </div>
      </div>
    </div>
  );
}
