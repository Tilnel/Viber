import { Router } from 'express';
import simpleGit from 'simple-git';
import { pathSecurity } from '../utils/pathSecurity.js';

const router = Router();

// 获取 Git 状态
router.get('/status', async (req, res, next) => {
  try {
    const { path: projectPath } = req.query;
    
    if (!projectPath) {
      return res.status(400).json({ error: 'Path is required' });
    }
    
    const safePath = pathSecurity.sanitizePath(projectPath);
    const git = simpleGit(safePath);
    
    // 检查是否为 Git 仓库
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      return res.json({ isGitRepo: false });
    }
    
    // 获取状态
    const status = await git.status();
    const branch = await git.branch();
    
    // 获取最近的提交
    const log = await git.log({ maxCount: 10 });
    
    res.json({
      isGitRepo: true,
      branch: status.current,
      tracking: status.tracking,
      ahead: status.ahead,
      behind: status.behind,
      files: [
        ...status.modified.map(f => ({ path: f, status: 'modified', staged: false })),
        ...status.staged.map(f => ({ path: f, status: 'modified', staged: true })),
        ...status.not_added.map(f => ({ path: f, status: 'untracked', staged: false })),
        ...status.created.map(f => ({ path: f, status: 'added', staged: true })),
        ...status.deleted.map(f => ({ path: f, status: 'deleted', staged: false })),
        ...status.renamed.map(f => ({ path: f.to, status: 'renamed', staged: true }))
      ],
      recentCommits: log.latest ? log.all.map(commit => ({
        hash: commit.hash.substring(0, 7),
        message: commit.message,
        author: commit.author_name,
        date: commit.date
      })) : [],
      branches: branch.all
    });
  } catch (err) {
    next(err);
  }
});

// 暂存文件
router.post('/add', async (req, res, next) => {
  try {
    const { path: projectPath, files } = req.body;
    
    if (!projectPath) {
      return res.status(400).json({ error: 'Path is required' });
    }
    
    const safePath = pathSecurity.sanitizePath(projectPath);
    const git = simpleGit(safePath);
    
    if (files && files.length > 0) {
      await git.add(files);
    } else {
      await git.add('.');
    }
    
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// 取消暂存
router.post('/unstage', async (req, res, next) => {
  try {
    const { path: projectPath, files } = req.body;
    
    if (!projectPath) {
      return res.status(400).json({ error: 'Path is required' });
    }
    
    const safePath = pathSecurity.sanitizePath(projectPath);
    const git = simpleGit(safePath);
    
    if (files && files.length > 0) {
      await git.reset(['HEAD', ...files]);
    } else {
      await git.reset(['HEAD']);
    }
    
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// 提交更改
router.post('/commit', async (req, res, next) => {
  try {
    const { path: projectPath, message } = req.body;
    
    if (!projectPath || !message) {
      return res.status(400).json({ error: 'Path and message are required' });
    }
    
    const safePath = pathSecurity.sanitizePath(projectPath);
    const git = simpleGit(safePath);
    
    const result = await git.commit(message);
    
    res.json({
      success: true,
      commit: {
        hash: result.commit,
        message: result.summary?.changes || message
      }
    });
  } catch (err) {
    next(err);
  }
});

// 推送
router.post('/push', async (req, res, next) => {
  try {
    const { path: projectPath, remote = 'origin', branch } = req.body;
    
    if (!projectPath) {
      return res.status(400).json({ error: 'Path is required' });
    }
    
    const safePath = pathSecurity.sanitizePath(projectPath);
    const git = simpleGit(safePath);
    
    const result = await git.push(remote, branch);
    
    res.json({
      success: true,
      pushed: result.pushed.length > 0
    });
  } catch (err) {
    next(err);
  }
});

// 拉取
router.post('/pull', async (req, res, next) => {
  try {
    const { path: projectPath, remote = 'origin', branch } = req.body;
    
    if (!projectPath) {
      return res.status(400).json({ error: 'Path is required' });
    }
    
    const safePath = pathSecurity.sanitizePath(projectPath);
    const git = simpleGit(safePath);
    
    const result = await git.pull(remote, branch);
    
    res.json({
      success: true,
      summary: result.summary
    });
  } catch (err) {
    next(err);
  }
});

// 切换分支
router.post('/checkout', async (req, res, next) => {
  try {
    const { path: projectPath, branch, create = false } = req.body;
    
    if (!projectPath || !branch) {
      return res.status(400).json({ error: 'Path and branch are required' });
    }
    
    const safePath = pathSecurity.sanitizePath(projectPath);
    const git = simpleGit(safePath);
    
    if (create) {
      await git.checkoutLocalBranch(branch);
    } else {
      await git.checkout(branch);
    }
    
    res.json({ success: true, branch });
  } catch (err) {
    next(err);
  }
});

// 获取文件 diff
router.get('/diff', async (req, res, next) => {
  try {
    const { path: projectPath, file } = req.query;
    
    if (!projectPath) {
      return res.status(400).json({ error: 'Path is required' });
    }
    
    const safePath = pathSecurity.sanitizePath(projectPath);
    const git = simpleGit(safePath);
    
    let diff;
    if (file) {
      diff = await git.diff(['--', file]);
    } else {
      diff = await git.diff();
    }
    
    res.json({ diff });
  } catch (err) {
    next(err);
  }
});

// 获取 stash 列表
router.get('/stash/list', async (req, res, next) => {
  try {
    const { path: projectPath } = req.query;
    
    if (!projectPath) {
      return res.status(400).json({ error: 'Path is required' });
    }
    
    const safePath = pathSecurity.sanitizePath(projectPath);
    const git = simpleGit(safePath);
    
    const stashList = await git.stashList();
    
    res.json({
      stashes: stashList.all.map((stash, index) => ({
        index,
        message: stash.message,
        hash: stash.hash
      }))
    });
  } catch (err) {
    next(err);
  }
});

export default router;
