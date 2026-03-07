// 新版语音按钮 - 使用统一 WebSocket，前端纯采集，后端处理 VAD
import { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'react-toastify';
import { NewVoiceService, getNewVoiceService } from '../services/voice/NewVoiceService';
import './VoiceConversationButton.css';

interface VoiceButtonNewProps {
  onUserSpeech: (text: string) => void;
  onInterimSpeech?: (text: string) => void;
  onInterrupt?: () => void;
  disabled?: boolean;
}

export default function VoiceButtonNew({
  onUserSpeech,
  onInterimSpeech,
  onInterrupt,
  disabled
}: VoiceButtonNewProps) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [volume, setVolume] = useState(0);
  const serviceRef = useRef<NewVoiceService | null>(null);

  // 初始化服务 - 只在组件挂载时执行一次
  useEffect(() => {
    // 使用 ref 存储回调，避免重新创建服务
    const callbacksRef = {
      onUserSpeech,
      onInterimSpeech
    };
    
    serviceRef.current = getNewVoiceService({
      onStateChange: (state) => {
        console.log('[VoiceButtonNew] State changed to:', state);
        setIsStreaming(state === 'streaming');
      },
      onVolume: (vol) => {
        setVolume(vol);
      },
      onTranscript: (text, isFinal) => {
        if (isFinal) {
          console.log('[VoiceButtonNew] Final transcript:', text);
          callbacksRef.onUserSpeech(text);
        } else {
          callbacksRef.onInterimSpeech?.(text);
        }
      },
      onError: (error) => {
        console.error('[VoiceButtonNew] Error:', error);
        toast.error(`语音错误: ${error || '未知错误'}`);
      }
    });

    // 组件卸载时才停止
    return () => {
      console.log('[VoiceButtonNew] Component unmounting, stopping voice...');
      serviceRef.current?.stop();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);  // 空依赖数组，只在挂载时执行

  const startStreaming = useCallback(async () => {
    const service = serviceRef.current;
    if (!service) return false;

    const success = await service.start();
    if (success) {
      toast.success('语音助手已启动', { autoClose: 1500 });
      return true;
    }
    return false;
  }, []);

  const stopStreaming = useCallback(() => {
    console.log('[VoiceButtonNew] stopStreaming called');
    serviceRef.current?.stop();
    setIsStreaming(false);
    setVolume(0);
  }, []);

  const toggle = useCallback(async () => {
    const currentService = serviceRef.current;
    const isCurrentlyStreaming = currentService?.isStreaming() || false;
    
    console.log('[VoiceButtonNew] Toggle clicked, currently streaming:', isCurrentlyStreaming);
    
    if (isCurrentlyStreaming) {
      stopStreaming();
    } else {
      const success = await startStreaming();
      if (!success) {
        toast.error('启动失败，请检查麦克风权限');
      }
    }
  }, [startStreaming, stopStreaming]);

  // 调试：检查实际类名
  const buttonClass = `voice-conversation-btn ${isStreaming ? 'active' : ''}`;
  console.log('[VoiceButtonNew] Button class:', buttonClass, 'isStreaming:', isStreaming);

  return (
    <div className="voice-conversation-wrapper">
      <button
        className={buttonClass}
        onClick={toggle}
        disabled={disabled}
        title={isStreaming ? '点击停止' : '点击开始语音'}
        data-streaming={isStreaming}
      >
        <span className={`voice-icon ${isStreaming ? 'active' : ''}`}>
          {isStreaming ? '🎤' : '🎙️'}
        </span>
        <span className="voice-status-text">
          {isStreaming ? ' listening...' : '语音'}
        </span>
      </button>
      
      {/* 音量指示器 - 活跃时显示 */}
      {isStreaming && (
        <div className="volume-indicator-wrapper">
          <div className="volume-dots">
            {[...Array(5)].map((_, i) => (
              <div 
                key={i}
                className="volume-dot"
                style={{
                  opacity: volume > (i * 0.2) ? 1 : 0.3,
                  transform: volume > (i * 0.2) ? 'scale(1.2)' : 'scale(1)',
                  backgroundColor: volume > 0.5 ? '#10b981' : (volume > 0.2 ? '#f59e0b' : '#64748b')
                }}
              />
            ))}
          </div>
          <div className="volume-bar-container">
            <div 
              className="volume-bar-fill" 
              style={{ 
                width: `${Math.min(100, volume * 150)}%`,
                background: volume > 0.5 
                  ? 'linear-gradient(90deg, #10b981, #34d399)' 
                  : 'linear-gradient(90deg, #f59e0b, #fbbf24)'
              }} 
            />
          </div>
        </div>
      )}
    </div>
  );
}
