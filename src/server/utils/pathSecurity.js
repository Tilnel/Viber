import path from 'path';
import fs from 'fs/promises';

class PathSecurity {
  constructor(rootDir) {
    this.rootDir = path.resolve(rootDir || '/path/to/your/code');
    console.log(`🔒 Path security initialized with root: ${this.rootDir}`);
  }

  // 设置根目录
  setRootDir(rootDir) {
    this.rootDir = path.resolve(rootDir);
    console.log(`🔒 Root directory updated to: ${this.rootDir}`);
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

// 单例实例
export const pathSecurity = new PathSecurity();

// 工厂函数（用于测试）
export function createPathSecurity(rootDir) {
  return new PathSecurity(rootDir);
}
