import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { query } from '../db/index.js';
import { pathSecurity, setProjectRootDir } from '../utils/pathSecurity.js';

const router = Router();

// 获取默认根目录（用于首页检查）
const DEFAULT_ROOT_DIR = process.env.ROOT_DIR || '/path/to/your/code';

// 获取最近打开的项目列表
router.get('/', async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    
    const { rows: projects } = await query(`
      SELECT id, path, name, description, icon, 
             last_opened_at, opened_count, is_pinned,
             created_at
      FROM projects
      ORDER BY is_pinned DESC, last_opened_at DESC
      LIMIT $1
    `, [limit]);
    
    // 验证项目路径是否仍然存在
    // 注意：使用默认根目录，而不是当前可能被修改的 rootDir
    const defaultPathSecurity = pathSecurity; // 使用当前实例，但会基于当前 rootDir 检查
    
    const validProjects = await Promise.all(
      projects.map(async (project) => {
        try {
          // 尝试将存储的相对路径解析为绝对路径
          // 项目路径存储的是相对于默认根目录的路径
          // 处理路径：如果是绝对路径直接使用，否则拼接根目录
          const absolutePath = path.isAbsolute(project.path) 
            ? project.path 
            : path.join(DEFAULT_ROOT_DIR, project.path);
          await fs.access(absolutePath);
          return { 
            id: project.id,
            path: project.path,
            name: project.name,
            description: project.description,
            icon: project.icon,
            lastOpenedAt: project.last_opened_at,
            openedCount: project.opened_count,
            isPinned: project.is_pinned,
            exists: true,
            absolutePath // 返回绝对路径供前端使用
          };
        } catch {
          return { 
            id: project.id,
            path: project.path,
            name: project.name,
            description: project.description,
            icon: project.icon,
            lastOpenedAt: project.last_opened_at,
            openedCount: project.opened_count,
            isPinned: project.is_pinned,
            exists: false,
            absolutePath: path.isAbsolute(project.path) 
              ? project.path 
              : path.join(DEFAULT_ROOT_DIR, project.path)
          };
        }
      })
    );
    
    res.json({
      projects: validProjects,
      total: validProjects.length
    });
  } catch (err) {
    next(err);
  }
});

// 打开项目（记录到最近列表）
router.post('/open', async (req, res, next) => {
  try {
    const { path: projectPath } = req.body;
    
    if (!projectPath) {
      return res.status(400).json({ error: 'Path is required' });
    }
    
    // 检查路径是否存在且为目录
    let absolutePath;
    let relativePath;
    
    try {
      if (path.isAbsolute(projectPath)) {
        absolutePath = path.normalize(projectPath);
        // 计算相对于默认根目录的路径
        relativePath = path.relative(DEFAULT_ROOT_DIR, absolutePath);
        // 检查是否在允许范围内
        if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
          return res.status(403).json({ 
            error: 'Access denied', 
            message: `Path "${projectPath}" is outside root directory` 
          });
        }
      } else {
        // 相对路径，先拼接再验证
        const tempPath = path.join(DEFAULT_ROOT_DIR, projectPath);
        absolutePath = path.normalize(tempPath);
        relativePath = projectPath;
      }
      
      const stat = await fs.stat(absolutePath);
      if (!stat.isDirectory()) {
        return res.status(400).json({ error: 'Path is not a directory' });
      }
    } catch (err) {
      return res.status(404).json({ error: 'Path does not exist' });
    }
    
    const name = path.basename(absolutePath);
    
    // 插入或更新项目记录
    const { rows } = await query(`
      INSERT INTO projects (path, name, last_opened_at, opened_count)
      VALUES ($1, $2, CURRENT_TIMESTAMP, 1)
      ON CONFLICT (path) DO UPDATE SET
        last_opened_at = CURRENT_TIMESTAMP,
        opened_count = projects.opened_count + 1,
        name = EXCLUDED.name
      RETURNING id, path, name, last_opened_at, opened_count
    `, [relativePath, name]);
    
    const project = rows[0];
    
    // 加载项目会话列表
    const { rows: sessions } = await query(`
      SELECT id, name, created_at, updated_at, message_count, is_archived
      FROM sessions
      WHERE project_id = $1 AND is_archived = false
      ORDER BY updated_at DESC
      LIMIT 20
    `, [project.id]);
    
    res.json({
      project: {
        id: project.id,
        path: project.path,
        name: project.name,
        lastOpenedAt: project.last_opened_at,
        openedCount: project.opened_count,
        exists: true,
        absolutePath // 返回绝对路径给客户端
      },
      sessions: sessions.map(s => ({
        id: s.id,
        name: s.name,
        createdAt: s.created_at,
        updatedAt: s.updated_at,
        messageCount: s.message_count,
        isArchived: s.is_archived
      }))
    });
  } catch (err) {
    next(err);
  }
});

// 更新项目信息（如固定到首页）
router.patch('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { isPinned, description, icon } = req.body;
    
    const updates = [];
    const values = [];
    let paramIndex = 1;
    
    if (isPinned !== undefined) {
      updates.push(`is_pinned = $${paramIndex++}`);
      values.push(isPinned);
    }
    
    if (description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(description);
    }
    
    if (icon !== undefined) {
      updates.push(`icon = $${paramIndex++}`);
      values.push(icon);
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    values.push(id);
    
    const { rows } = await query(`
      UPDATE projects 
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `, values);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    res.json({ project: rows[0] });
  } catch (err) {
    next(err);
  }
});

// 删除项目记录（仅从列表移除，不删除文件）
router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const { rows } = await query(`
      DELETE FROM projects WHERE id = $1 RETURNING id
    `, [id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    res.json({ success: true, deletedId: id });
  } catch (err) {
    next(err);
  }
});

// 获取项目统计信息
router.get('/:id/stats', async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const { rows: [project] } = await query(`
      SELECT id, path, name FROM projects WHERE id = $1
    `, [id]);
    
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    // 使用默认根目录解析项目路径
    // 处理路径：如果是绝对路径直接使用，否则拼接根目录
    const absolutePath = path.isAbsolute(project.path) 
      ? project.path 
      : path.join(DEFAULT_ROOT_DIR, project.path);
    
    // 统计文件数量
    let fileCount = 0;
    try {
      async function countFiles(dir) {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
              await countFiles(path.join(dir, entry.name));
            }
          } else {
            fileCount++;
          }
        }
      }
      
      await countFiles(absolutePath);
    } catch {
      // 忽略统计错误
    }
    
    // 统计会话和消息数量
    const { rows: [stats] } = await query(`
      SELECT 
        COUNT(DISTINCT s.id) as session_count,
        SUM(s.message_count) as total_messages
      FROM sessions s
      WHERE s.project_id = $1
    `, [id]);
    
    res.json({
      projectId: id,
      fileCount,
      sessionCount: parseInt(stats.session_count) || 0,
      totalMessages: parseInt(stats.total_messages) || 0
    });
  } catch (err) {
    next(err);
  }
});

export default router;
