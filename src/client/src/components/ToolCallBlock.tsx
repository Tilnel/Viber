import { useState } from 'react';
import './ToolCallBlock.css';

interface ToolCallBlockProps {
  operation: string;  // 如 "ReadFile", "Shell"
  target: string;     // 如 "src/index.js", "npm install"
  result: string;     // 操作结果内容
  defaultExpanded?: boolean;
}

// 工具名称映射
const toolNameMap: Record<string, string> = {
  'ReadFile': '📄 读取文件',
  'WriteFile': '✏️ 写入文件', 
  'StrReplaceFile': '🔄 替换文件',
  'Shell': '💻 执行命令',
  'Glob': '🔍 查找文件',
  'Grep': '🔎 搜索内容',
  'SearchWeb': '🌐 搜索',
  'FetchURL': '📥 获取网页',
};

// 工具图标
const toolIconMap: Record<string, string> = {
  'ReadFile': '📄',
  'WriteFile': '✏️',
  'StrReplaceFile': '🔄',
  'Shell': '💻',
  'Glob': '🔍',
  'Grep': '🔎',
  'SearchWeb': '🌐',
  'FetchURL': '📥',
};

export default function ToolCallBlock({ 
  operation, 
  target, 
  result, 
  defaultExpanded = false 
}: ToolCallBlockProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  
  const displayName = toolNameMap[operation] || `${toolIconMap[operation] || '🔧'} ${operation}`;
  const icon = toolIconMap[operation] || '🔧';
  
  // 格式化目标显示（截断过长的）
  const displayTarget = target ? (target.length > 60 ? target.substring(0, 60) + '...' : target) : '';
  
  return (
    <div className="tool-call-block">
      <div 
        className="tool-call-header"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span className="tool-call-toggle">
          {isExpanded ? '▼' : '▶'}
        </span>
        <span className="tool-call-icon">{icon}</span>
        <span className="tool-call-title" title={target}>
          {displayName}: {displayTarget}
        </span>
      </div>
      
      {isExpanded && (
        <div className="tool-call-content">
          <div className="tool-call-result">
            <pre className="tool-call-result-content">{result || '执行中...'}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
