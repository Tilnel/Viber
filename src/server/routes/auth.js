import { Router } from 'express';
import jwt from 'jsonwebtoken';

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key';
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || 'admin';

// 登录
router.post('/login', (req, res) => {
  const { password } = req.body;
  
  // 开发模式：如果密码为空或匹配环境变量密码
  if (process.env.NODE_ENV === 'development') {
    if (!password || password === AUTH_PASSWORD || password === 'dev') {
      const token = jwt.sign({ env: 'dev' }, JWT_SECRET, { expiresIn: '7d' });
      return res.json({ token, message: 'Login successful (dev mode)' });
    }
  }
  
  // 生产模式：验证密码
  if (password === AUTH_PASSWORD) {
    const token = jwt.sign({ env: 'production' }, JWT_SECRET, { expiresIn: '1d' });
    return res.json({ token, message: 'Login successful' });
  }
  
  res.status(401).json({ error: 'Invalid password' });
});

// 验证 token
router.get('/verify', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    res.json({ valid: true, decoded });
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

export default router;
