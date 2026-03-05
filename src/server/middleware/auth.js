// 单用户模式 - 简单的本地认证
// 在生产环境中，可以通过环境变量设置一个固定 token

const AUTH_TOKEN = process.env.AUTH_TOKEN || 'local-dev-token';

export function authMiddleware(req, res, next) {
  // 开发环境跳过认证
  if (process.env.NODE_ENV === 'development' && !process.env.REQUIRE_AUTH) {
    return next();
  }

  const token = req.headers.authorization?.replace('Bearer ', '') || 
                req.query.token;

  if (token !== AUTH_TOKEN) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or missing authentication token'
    });
  }

  next();
}

// 生成一个简单的 token 供用户使用
export function generateToken() {
  return AUTH_TOKEN;
}
