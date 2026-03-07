/**
 * Listener Service Index
 * 监听服务索引
 * 
 * @module services/listener
 */

export {
  RefactoredListener,
  ListenerState
} from './RefactoredListener.js';

/**
 * 工厂函数
 */
export function createListener(config = {}) {
  return new RefactoredListener(config);
}
