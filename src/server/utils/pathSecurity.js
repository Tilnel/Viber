import path from 'path';
import fs from 'fs/promises';

// 默认根目录
const DEFAULT_ROOT_DIR = process.env.ROOT_DIR || '/path/to/your/code';

class PathSecurity {
  constructor(rootDir) {
    this.rootDir = path.resolve(rootDir || DEFAULT_ROOT_DIR);
  }

  // 设置根目录
  setRootDir(rootDir) {
    this.rootDir = path.resolve(rootDir);
  }

  // 验证并规范化路径
  sanitizePath(inputPath) {
    if (!inputPath || typeof inputPath !== 'string') {
      throw new Error('Invalid path: path must be a non-empty string');
    }

    // 1. 规范化路径
    const normalized = path.normalize(inputPath);
    
    // 2. 解析为绝对路径
    let absolute;
    if (path.isAbsolute(normalized)) {
      absolute = normalized;
    } else {
      absolute = path.join(this.rootDir, normalized);
    }
    
    // 3. 检查路径穿越攻击
    const relative = path.relative(this.rootDir, absolute);
    // 空字符串表示路径等于 rootDir（在根目录内）
    // 如果以 .. 开头或是绝对路径，表示在根目录外
    const isOutside = relative !== '' && (relative.startsWith('..') || path.isAbsolute(relative));
    
    if (isOutside) {
      throw new Error(`Access denied: Path "${inputPath}" is outside root directory`);
    }
    
    // 4. 检查禁止访问的文件模式
    const forbiddenPatterns = [
      { pattern: /\.\./, desc: 'contains ..' },
      { pattern: /\/\.env[^/]*$/, desc: 'environment file' },
      { pattern: /\/\.ssh\//, desc: 'SSH directory' },
      { pattern: /\/\.gnupg\//, desc: 'GPG directory' },
      { pattern: /\.pem$/, desc: 'PEM certificate' },
      { pattern: /\.key$/, desc: 'private key' },
      { pattern: /id_rsa/, desc: 'RSA key' },
      { pattern: /id_ed25519/, desc: 'ED25519 key' },
      { pattern: /shadow$/, desc: 'system password file' },
      { pattern: /passwd$/, desc: 'system password file' },
    ];
    
    for (const { pattern, desc } of forbiddenPatterns) {
      if (pattern.test(absolute)) {
        throw new Error(`Access denied: Path "${inputPath}" matches forbidden pattern (${desc})`);
      }
    }
    
    return absolute;
  }

  // 检查路径是否存在且在根目录内
  async exists(inputPath) {
    try {
      const safePath = this.sanitizePath(inputPath);
      await fs.access(safePath);
      return true;
    } catch {
      return false;
    }
  }

  // 检查是否为目录
  async isDirectory(inputPath) {
    try {
      const safePath = this.sanitizePath(inputPath);
      const stat = await fs.stat(safePath);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }

  // 获取相对于根目录的路径
  getRelativePath(absolutePath) {
    return path.relative(this.rootDir, absolutePath);
  }

  // 获取绝对路径（不验证）
  getAbsolutePath(relativePath) {
    return path.join(this.rootDir, relativePath);
  }
}

// 项目路径映射表：projectId -> PathSecurity 实例
const projectPathSecurityMap = new Map();

// 默认实例（用于没有特定项目的场景）
const defaultPathSecurity = new PathSecurity(DEFAULT_ROOT_DIR);

/**
 * 获取项目的 PathSecurity 实例
 * @param {string} projectId - 项目ID（可选）
 * @param {string} rootDir - 项目根目录（可选，用于首次创建）
 * @returns {PathSecurity} PathSecurity 实例
 */
export function getPathSecurity(projectId, rootDir) {
  // 如果没有 projectId，返回默认实例
  if (!projectId) {
    return defaultPathSecurity;
  }
  
  // 如果该项目的实例不存在，创建一个新的
  if (!projectPathSecurityMap.has(projectId)) {
    const instance = new PathSecurity(rootDir || DEFAULT_ROOT_DIR);
    projectPathSecurityMap.set(projectId, instance);
    console.log(`🔒 PathSecurity created for project ${projectId}: ${instance.rootDir}`);
  }
  
  return projectPathSecurityMap.get(projectId);
}

/**
 * 设置项目的根目录
 * @param {string} projectId - 项目ID
 * @param {string} rootDir - 项目根目录
 */
export function setProjectRootDir(projectId, rootDir) {
  const instance = getPathSecurity(projectId, rootDir);
  instance.setRootDir(rootDir);
  console.log(`🔒 Root directory updated for project ${projectId}: ${rootDir}`);
}

/**
 * 清除项目的 PathSecurity 实例（项目关闭时调用）
 * @param {string} projectId - 项目ID
 */
export function clearPathSecurity(projectId) {
  if (projectId && projectPathSecurityMap.has(projectId)) {
    projectPathSecurityMap.delete(projectId);
    console.log(`🔒 PathSecurity cleared for project ${projectId}`);
  }
}

// 向后兼容：导出默认实例
export const pathSecurity = defaultPathSecurity;

// 工厂函数（用于测试）
export function createPathSecurity(rootDir) {
  return new PathSecurity(rootDir);
}
