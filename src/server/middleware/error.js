export function errorHandler(err, req, res, next) {
  console.error('Error:', err);

  // 路径安全错误
  if (err.message?.includes('Access denied') || err.message?.includes('Forbidden')) {
    return res.status(403).json({
      error: 'Access denied',
      message: err.message
    });
  }

  // 文件不存在
  if (err.code === 'ENOENT') {
    return res.status(404).json({
      error: 'Not found',
      message: 'File or directory not found'
    });
  }

  // 权限错误
  if (err.code === 'EACCES' || err.code === 'EPERM') {
    return res.status(403).json({
      error: 'Permission denied',
      message: 'Insufficient permissions to access this resource'
    });
  }

  // 通用错误
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
}
