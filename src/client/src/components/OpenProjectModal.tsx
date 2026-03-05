import { useState } from 'react';
import { toast } from 'react-toastify';
import PathInput from './PathInput';
import { projectAPI } from '../services/api';
import './OpenProjectModal.css';

interface OpenProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function OpenProjectModal({ isOpen, onClose, onSuccess }: OpenProjectModalProps) {
  const [path, setPath] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!path.trim()) {
      toast.error('请输入路径');
      return;
    }

    setIsLoading(true);
    try {
      const data = await projectAPI.openProject(path.trim());
      toast.success(`已打开项目: ${data.project.name}`);
      onSuccess();
      onClose();
    } catch (error: any) {
      toast.error(error.message || '打开项目失败');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePathSelect = (selectedPath: string) => {
    setPath(selectedPath);
  };

  // 常用路径快捷方式
  const quickPaths = [
    { label: 'Home', path: '~' },
    { label: 'Code', path: '/path/to/your/code' },
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>📂 打开项目</h2>
          <button className="btn btn-icon" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label>项目路径</label>
              <PathInput
                value={path}
                onChange={setPath}
                onSelect={handlePathSelect}
                placeholder="输入目录路径，如: /path/to/your/code/my-project"
                autoFocus
              />
              <span className="input-hint">
                支持 Tab 键自动补全，输入 / 查看目录内容
              </span>
            </div>

            <div className="quick-paths">
              <label>快捷路径</label>
              <div className="quick-paths-list">
                {quickPaths.map(({ label, path: quickPath }) => (
                  <button
                    key={quickPath}
                    type="button"
                    className="btn btn-secondary quick-path-btn"
                    onClick={() => setPath(quickPath)}
                  >
                    {label}: {quickPath}
                  </button>
                ))}
              </div>
            </div>

            <div className="path-tips">
              <h4>💡 提示</h4>
              <ul>
                <li>输入路径时按 <kbd>Tab</kbd> 自动补全</li>
                <li>使用 <kbd>↑</kbd> <kbd>↓</kbd> 键盘导航建议列表</li>
                <li>按 <kbd>Enter</kbd> 选择高亮项或确认路径</li>
                <li>路径以 <code>/</code> 结尾表示目录</li>
              </ul>
            </div>
          </div>

          <div className="modal-footer">
            <button 
              type="button" 
              className="btn btn-secondary"
              onClick={onClose}
              disabled={isLoading}
            >
              取消
            </button>
            <button 
              type="submit" 
              className="btn btn-primary"
              disabled={isLoading || !path.trim()}
            >
              {isLoading ? '打开中...' : '打开项目'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
