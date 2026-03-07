import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import { getPathSecurity, getPathSecurityOrNull } from '../utils/pathSecurity.js';

// 检测文件是否为二进制文件
async function isBinaryFile(filePath) {
  try {
    // 方法1: 使用 file 命令（如果可用）
    try {
      const output = execSync(`file -b --mime-type "${filePath}"`, { encoding: 'utf8' });
      const mimeType = output.trim();
      // 如果不是 text/* 或 application/json 等文本类型，认为是二进制
      if (!mimeType.startsWith('text/') && 
          !mimeType.startsWith('message/') &&
          mimeType !== 'application/json' &&
          mimeType !== 'application/javascript' &&
          mimeType !== 'application/xml' &&
          mimeType !== 'application/x-httpd-php' &&
          mimeType !== 'application/x-sh' &&
          mimeType !== 'application/x-shellscript' &&
          mimeType !== 'application/x-perl' &&
          mimeType !== 'application/x-python-code' &&
          mimeType !== 'application/x-ruby' &&
          !mimeType.includes('empty')) {
        return true;
      }
    } catch {
      // file 命令失败，使用备用方法
    }
    
    // 方法2: 读取文件头部检测 null 字节或控制字符
    const buffer = await fs.readFile(filePath, { length: 8000 });
    
    // 检查 null 字节
    if (buffer.includes(0)) {
      return true;
    }
    
    // 检查控制字符比例
    let controlChars = 0;
    for (let i = 0; i < buffer.length; i++) {
      const byte = buffer[i];
      // 0x00-0x08, 0x0B-0x0C, 0x0E-0x1F 是控制字符
      if ((byte < 0x09 || (byte > 0x0A && byte < 0x0D) || (byte > 0x0D && byte < 0x20))) {
        controlChars++;
      }
    }
    
    // 如果控制字符超过 10%，认为是二进制
    if (buffer.length > 0 && controlChars / buffer.length > 0.1) {
      return true;
    }
    
    return false;
  } catch (err) {
    console.error('Failed to detect binary file:', err);
    return false; // 出错时默认可读
  }
}

const router = Router();

// 中间件：检查项目是否已初始化（服务器重启后需要重新 openProject）
router.use((req, res, next) => {
  const projectId = req.query.projectId || req.body?.projectId;
  
  // 如果有 projectId，检查是否已初始化
  if (projectId) {
    const pathSecurity = getPathSecurityOrNull(projectId);
    if (!pathSecurity) {
      return res.status(409).json({
        error: 'Project not initialized',
        message: 'Server restarted, please reopen the project',
        code: 'PROJECT_NOT_INITIALIZED'
      });
    }
  }
  
  next();
});

// 辅助函数：从请求中获取 projectId 和对应的 PathSecurity 实例
function getProjectContext(req) {
  // 从查询参数或请求体中获取 projectId
  const projectId = req.query.projectId || req.body?.projectId;
  const pathSecurity = getPathSecurity(projectId);
  return { projectId, pathSecurity };
}

// 列出目录内容
router.get('/list', async (req, res, next) => {
  try {
    const dirPath = req.query.path || '.';
    const { pathSecurity } = getProjectContext(req);
    const safePath = pathSecurity.sanitizePath(dirPath);
    
    const entries = await fs.readdir(safePath, { withFileTypes: true });
    
    const items = await Promise.all(
      entries.map(async (entry) => {
        const itemPath = path.join(safePath, entry.name);
        const relativePath = pathSecurity.getRelativePath(itemPath);
        
        let size = null;
        let mtime = null;
        
        try {
          const stat = await fs.stat(itemPath);
          size = stat.size;
          mtime = stat.mtime.toISOString();
        } catch {
          // 忽略无法访问的文件
        }
        
        return {
          name: entry.name,
          path: relativePath,
          type: entry.isDirectory() ? 'directory' : 'file',
          size,
          mtime
        };
      })
    );
    
    // 排序：目录在前，然后按名称排序
    items.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
    
    res.json({
      path: pathSecurity.getRelativePath(safePath),
      items
    });
  } catch (err) {
    next(err);
  }
});

// 读取文件
router.get('/read', async (req, res, next) => {
  try {
    const filePath = req.query.path;
    if (!filePath) {
      return res.status(400).json({ error: 'Path is required' });
    }
    
    const { pathSecurity } = getProjectContext(req);
    const safePath = pathSecurity.sanitizePath(filePath);
    
    // 检查是否为文件
    const stat = await fs.stat(safePath);
    if (stat.isDirectory()) {
      return res.status(400).json({ error: 'Path is a directory' });
    }
    
    // 检查文件大小（限制 10MB）
    const MAX_SIZE = 10 * 1024 * 1024; // 10MB
    if (stat.size > MAX_SIZE) {
      return res.status(413).json({ 
        error: 'File too large',
        message: `File size (${stat.size} bytes) exceeds limit (${MAX_SIZE} bytes)`
      });
    }
    
    // 检测是否为二进制文件
    const isBinary = await isBinaryFile(safePath);
    
    if (isBinary) {
      return res.json({
        path: pathSecurity.getRelativePath(safePath),
        content: `[Binary File]\n\n该文件是二进制文件，无法直接编辑。\n文件大小: ${stat.size} bytes`,
        encoding: 'utf-8',
        mtime: stat.mtime.toISOString(),
        size: stat.size,
        isBinary: true
      });
    }
    
    const content = await fs.readFile(safePath, 'utf-8');
    
    res.json({
      path: pathSecurity.getRelativePath(safePath),
      content,
      encoding: 'utf-8',
      mtime: stat.mtime.toISOString(),
      size: stat.size,
      isBinary: false
    });
  } catch (err) {
    next(err);
  }
});

// 写入文件
router.post('/write', async (req, res, next) => {
  try {
    const { path: filePath, content, encoding = 'utf-8', projectId } = req.body;
    
    if (!filePath) {
      return res.status(400).json({ error: 'Path is required' });
    }
    
    if (content === undefined) {
      return res.status(400).json({ error: 'Content is required' });
    }
    
    const pathSecurity = getPathSecurity(projectId);
    const safePath = pathSecurity.sanitizePath(filePath);
    
    // 确保目录存在
    const dir = path.dirname(safePath);
    await fs.mkdir(dir, { recursive: true });
    
    // 写入文件
    await fs.writeFile(safePath, content, encoding);
    
    const stat = await fs.stat(safePath);
    
    res.json({
      path: pathSecurity.getRelativePath(safePath),
      mtime: stat.mtime.toISOString(),
      size: stat.size,
      success: true
    });
  } catch (err) {
    next(err);
  }
});

// 文件操作（创建、删除、重命名、移动）
router.post('/operation', async (req, res, next) => {
  try {
    const { operation, source, target, type = 'file', projectId } = req.body;
    
    if (!operation || !source) {
      return res.status(400).json({ error: 'Operation and source are required' });
    }
    
    const pathSecurity = getPathSecurity(projectId);
    const safeSource = pathSecurity.sanitizePath(source);
    
    switch (operation) {
      case 'create': {
        if (type === 'directory') {
          await fs.mkdir(safeSource, { recursive: true });
        } else {
          const dir = path.dirname(safeSource);
          await fs.mkdir(dir, { recursive: true });
          await fs.writeFile(safeSource, '', 'utf-8');
        }
        break;
      }
      
      case 'delete': {
        const stat = await fs.stat(safeSource);
        if (stat.isDirectory()) {
          await fs.rmdir(safeSource, { recursive: true });
        } else {
          await fs.unlink(safeSource);
        }
        break;
      }
      
      case 'rename':
      case 'move': {
        if (!target) {
          return res.status(400).json({ error: 'Target is required for rename/move' });
        }
        const safeTarget = pathSecurity.sanitizePath(target);
        await fs.rename(safeSource, safeTarget);
        break;
      }
      
      default:
        return res.status(400).json({ error: `Unknown operation: ${operation}` });
    }
    
    res.json({
      success: true,
      operation,
      source: pathSecurity.getRelativePath(safeSource),
      target: target ? pathSecurity.getRelativePath(pathSecurity.sanitizePath(target)) : undefined
    });
  } catch (err) {
    next(err);
  }
});

// 路径补全建议
router.get('/complete', async (req, res, next) => {
  try {
    const { query, limit = 20, projectId } = req.query;
    
    if (!query || typeof query !== 'string') {
      return res.json({ suggestions: [] });
    }
    
    // 解析查询路径
    let searchPath = query;
    let searchPrefix = '';
    
    // 如果查询以 / 结尾，表示在目录内搜索
    // 否则，提取目录部分和文件名前缀
    if (!query.endsWith('/')) {
      const lastSlashIndex = query.lastIndexOf('/');
      if (lastSlashIndex >= 0) {
        searchPath = query.substring(0, lastSlashIndex + 1);
        searchPrefix = query.substring(lastSlashIndex + 1).toLowerCase();
      }
    }
    
    try {
      const pathSecurity = getPathSecurity(projectId);
      const safePath = pathSecurity.sanitizePath(searchPath);
      const entries = await fs.readdir(safePath, { withFileTypes: true });
      
      let suggestions = [];
      
      for (const entry of entries) {
        // 过滤：只显示目录和以搜索前缀开头的文件
        if (searchPrefix && !entry.name.toLowerCase().startsWith(searchPrefix)) {
          continue;
        }
        
        const entryPath = path.join(searchPath, entry.name);
        
        suggestions.push({
          name: entry.name,
          path: entryPath,
          type: entry.isDirectory() ? 'directory' : 'file',
          displayPath: entryPath
        });
      }
      
      // 排序：目录在前，然后按名称排序
      suggestions.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'directory' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
      
      // 限制数量
      suggestions = suggestions.slice(0, parseInt(limit));
      
      res.json({ 
        suggestions,
        query,
        currentPath: searchPath
      });
      
    } catch (err) {
      // 路径不存在或无法访问，返回空列表
      res.json({ 
        suggestions: [],
        query,
        error: err.message
      });
    }
  } catch (err) {
    next(err);
  }
});

// 搜索文件内容
router.get('/search', async (req, res, next) => {
  try {
    const { q, path: searchPath = '.', glob = '*', maxResults = 100, projectId } = req.query;
    
    if (!q) {
      return res.status(400).json({ error: 'Query is required' });
    }
    
    // 这里可以集成更复杂的搜索，如 ripgrep
    // 目前简单实现
    res.json({
      query: q,
      results: [],
      message: 'Search not fully implemented yet - will integrate ripgrep'
    });
  } catch (err) {
    next(err);
  }
});

export default router;
