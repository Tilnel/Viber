import { useState, useRef, useCallback, useEffect } from 'react';
import TTSControl from './TTSControl';
import VoiceButtonNew from './VoiceButtonNew';
import './ResizableInputArea.css';

interface ResizableInputAreaProps {
  inputText: string;
  setInputText: (text: string) => void;
  inputRef: React.RefObject<HTMLTextAreaElement>;
  isStreaming: boolean;
  handleSend: () => void;
  handleKeyDown: (e: React.KeyboardEvent) => void;
  stopGeneration: () => void;
  handleVoiceTranscript: (text: string) => void;  // 最终结果
  handleInterimVoiceTranscript?: (text: string) => void;  // 中间结果
  sessionId?: number | null;
}

const MIN_HEIGHT = 60;
const MAX_HEIGHT = 400;
const DEFAULT_HEIGHT = 120;

export default function ResizableInputArea({
  inputText,
  setInputText,
  inputRef,
  isStreaming,
  handleSend,
  handleKeyDown,
  stopGeneration,
  handleVoiceTranscript,
  handleInterimVoiceTranscript,
  sessionId
}: ResizableInputAreaProps) {
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);

  // 处理拖动开始
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    dragStartY.current = e.clientY;
    dragStartHeight.current = height;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, [height]);

  // 处理拖动
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const delta = dragStartY.current - e.clientY;
      const newHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, dragStartHeight.current + delta));
      setHeight(newHeight);
    };

    const handleMouseUp = () => {
      if (isDragging) {
        setIsDragging(false);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // 自动调整textarea高度 - 填满容器
  useEffect(() => {
    const textarea = inputRef.current;
    if (textarea) {
      // 重置高度以计算实际内容高度
      textarea.style.height = 'auto';
      const contentHeight = textarea.scrollHeight;
      // 容器可用高度（减去padding）
      const availableHeight = height - 16;
      // 取内容高度和可用高度的较大值，但不超出可用高度
      const targetHeight = Math.min(Math.max(contentHeight, 40), availableHeight);
      textarea.style.height = `${targetHeight}px`;
    }
  }, [inputText, height, inputRef]);

  return (
    <div className="resizable-input-container" ref={containerRef}>
      {/* 拖动调整手柄 */}
      <div 
        className={`resize-handle ${isDragging ? 'dragging' : ''}`}
        onMouseDown={handleMouseDown}
      >
        <div className="resize-indicator"></div>
      </div>

      {/* 主输入区域 */}
      <div className="input-area" style={{ height }}>
        <textarea
          ref={inputRef}
          className="main-textarea"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入消息... (Ctrl+Enter 发送)"
          disabled={isStreaming}
          rows={1}
        />
        
        {/* 右侧垂直按钮组 */}
        <div className="vertical-actions">
          <div className="action-group top">
            <TTSControl />
            <VoiceButtonNew 
              onUserSpeech={handleVoiceTranscript}
              onInterimSpeech={handleInterimVoiceTranscript}
              onInterrupt={stopGeneration}
              sessionId={sessionId}
            />
          </div>
          
          <div className="action-group bottom">
            {isStreaming ? (
              <button 
                className="btn btn-danger action-btn"
                onClick={stopGeneration}
                title="停止"
              >
                ⏹
              </button>
            ) : (
              <button 
                className="btn btn-primary action-btn"
                onClick={handleSend}
                disabled={!inputText.trim()}
                title="发送"
              >
                ➤
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 底部提示 */}
      <div className="input-footer">
        <span className="hint">{inputText.length} 字符 | Ctrl+Enter 发送</span>
        <span className="resize-hint">↑ 拖动调整高度</span>
      </div>
    </div>
  );
}
