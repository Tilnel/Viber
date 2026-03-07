import { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'react-toastify';
import TTSControl from './TTSControl';
import VoiceConversationButton from './VoiceConversationButton';
import { volcanoTTSService } from '../services/volcanoTTS';
import { piperTTSService } from '../services/piperTTS';
import './ResizableInputArea.css';

interface ResizableInputAreaProps {
  inputText: string;
  setInputText: (text: string) => void;
  inputRef: React.RefObject<HTMLTextAreaElement>;
  isStreaming: boolean;
  handleSend: () => void;
  handleKeyDown: (e: React.KeyboardEvent) => void;
  stopGeneration: () => void;
  handleVoiceTranscript: (text: string) => void;
}

export default function ResizableInputArea({
  inputText,
  setInputText,
  inputRef,
  isStreaming,
  handleSend,
  handleKeyDown,
  stopGeneration,
  handleVoiceTranscript
}: ResizableInputAreaProps) {
  // 输入区域高度状态
  const [inputHeight, setInputHeight] = useState(80); // 默认高度 80px
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);

  // 处理拖动开始
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    startYRef.current = e.clientY;
    startHeightRef.current = inputHeight;
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
  }, [inputHeight]);

  // 处理拖动中
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      
      const deltaY = startYRef.current - e.clientY;
      const newHeight = Math.max(60, Math.min(400, startHeightRef.current + deltaY));
      setInputHeight(newHeight);
    };

    const handleMouseUp = () => {
      if (isResizing) {
        setIsResizing(false);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  // 自动调整 textarea 高度
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, inputHeight - 20)}px`;
    }
  }, [inputText, inputHeight, inputRef]);

  return (
    <div className="chat-input-container" ref={containerRef}>
      {/* 拖动调整高度手柄 */}
      <div 
        className={`resize-handle ${isResizing ? 'resizing' : ''}`}
        onMouseDown={handleResizeStart}
        title="拖动调整高度"
      >
        <div className="resize-handle-bar"></div>
      </div>

      <div className="context-hint">
        {inputText.length > 0 && (
          <span className="char-count">{inputText.length} 字符</span>
        )}
      </div>
      
      <div className="chat-input-wrapper" style={{ height: inputHeight }}>
        <textarea
          ref={inputRef}
          className="chat-input"
          placeholder="输入消息... (Ctrl+Enter 发送)"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isStreaming}
        />
        
        <div className="chat-actions-vertical">
          <div className="action-buttons-top">
            <TTSControl />
            <VoiceConversationButton 
              onUserSpeech={handleVoiceTranscript}
              onInterrupt={() => {
                console.log('[ChatPanel] User interrupted, stopping generation');
                stopGeneration();
              }}
            />
          </div>
          
          <div className="action-buttons-bottom">
            {isStreaming ? (
              <button 
                className="btn btn-danger send-btn"
                onClick={stopGeneration}
                title="停止生成"
              >
                ⏹
              </button>
            ) : (
              <button 
                className="btn btn-primary send-btn"
                onClick={handleSend}
                disabled={!inputText.trim()}
                title="发送消息"
              >
                ➤
              </button>
            )}
          </div>
        </div>
      </div>
      
      <div className="input-hint">
        <span>Ctrl + Enter 发送</span>
        <span className="resize-hint">拖拽上方横线调整高度</span>
      </div>
    </div>
  );
}
