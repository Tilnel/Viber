import { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'react-toastify';
import { VoiceConversation, VoiceConversationState, createVoiceConversation } from '../services/voiceConversation';
import { ttsService } from '../services/tts';
import './VoiceConversationButton.css';

interface VoiceConversationButtonProps {
  // 当用户说完话后的回调
  onUserSpeech: (text: string) => void;
  // AI回复时的回调（用于显示文字）
  onAIResponse?: (text: string) => void;
  // AI回复完成
  onAIComplete?: () => void;
  // 是否禁用
  disabled?: boolean;
  // 当前是否正在AI回复中（用于控制打断）
  isAIResponding?: boolean;
}

export default function VoiceConversationButton({
  onUserSpeech,
  onAIResponse,
  onAIComplete,
  disabled,
  isAIResponding
}: VoiceConversationButtonProps) {
  const [state, setState] = useState<VoiceConversationState>('idle');
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [volume, setVolume] = useState(0);
  
  const conversationRef = useRef<VoiceConversation | null>(null);
  const volumeIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // 初始化语音对话
  const initializeConversation = useCallback(async () => {
    if (conversationRef.current) return true;

    const conversation = createVoiceConversation({
      silenceThreshold: 0.03,
      silenceTimeout: 1200,
      minSpeechDuration: 200,
      
      onStateChange: (newState) => {
        setState(newState);
        
        // 状态变化时显示提示
        switch (newState) {
          case 'listening':
            // toast.info('正在聆听...', { autoClose: 1000 });
            break;
          case 'processing':
            toast.info('思考中...', { autoClose: 2000 });
            break;
          case 'speaking':
            // toast.info('AI 正在说话...', { autoClose: 1000 });
            break;
        }
      },
      
      onTranscript: (text, isFinal) => {
        if (isFinal) {
          setTranscript(text);
          setInterimTranscript('');
        } else {
          setInterimTranscript(text.replace(transcript, ''));
        }
      },
      
      onUserSpeechStart: () => {
        setTranscript('');
        setInterimTranscript('');
      },
      
      onUserSpeechEnd: (text) => {
        if (text.trim()) {
          onUserSpeech(text);
        }
      },
      
      onAIResponse: (text) => {
        onAIResponse?.(text);
      },
      
      onAIResponseComplete: () => {
        onAIComplete?.();
      },
      
      onError: (error) => {
        console.error('[VoiceConversation] Error:', error);
        toast.error(`语音错误: ${error}`);
        stopConversation();
      }
    });

    const initialized = await conversation.initialize();
    if (initialized) {
      conversationRef.current = conversation;
      return true;
    }
    return false;
  }, [onUserSpeech, onAIResponse, onAIComplete]);

  // 开始/停止对话
  const toggleConversation = useCallback(async () => {
    if (state === 'idle') {
      // 开始对话
      const initialized = await initializeConversation();
      if (initialized) {
        conversationRef.current?.start();
        toast.success('语音对话已开启，请说话', { autoClose: 2000 });
        
        // 启动音量可视化
        startVolumeVisualization();
      }
    } else {
      // 停止对话
      stopConversation();
    }
  }, [state, initializeConversation]);

  // 打断AI说话
  const interrupt = useCallback(() => {
    if (state === 'speaking') {
      conversationRef.current?.interrupt();
      toast.info('已打断', { autoClose: 500 });
    }
  }, [state]);

  // 停止对话
  const stopConversation = useCallback(() => {
    conversationRef.current?.stop();
    conversationRef.current = null;
    
    if (volumeIntervalRef.current) {
      clearInterval(volumeIntervalRef.current);
      volumeIntervalRef.current = null;
    }
    
    setTranscript('');
    setInterimTranscript('');
    setVolume(0);
    setState('idle');
  }, []);

  // 音量可视化
  const startVolumeVisualization = () => {
    volumeIntervalRef.current = setInterval(() => {
      // 这里可以通过conversation获取实时音量，简化处理用随机值模拟
      if (state === 'listening') {
        setVolume(Math.random() * 0.5 + 0.2);
      } else if (state === 'speaking') {
        setVolume(Math.random() * 0.3 + 0.1);
      } else {
        setVolume(0);
      }
    }, 100);
  };

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      stopConversation();
    };
  }, [stopConversation]);

  // 处理AI回复的流式TTS
  useEffect(() => {
    // 外部传入isAIResponding变化时，可以在这里处理
    // 实际TTS播放由调用方通过conversation.speak()控制
  }, [isAIResponding]);

  const getButtonIcon = () => {
    switch (state) {
      case 'listening': return '🎤';
      case 'processing': return '🤔';
      case 'speaking': return '🔊';
      case 'error': return '⚠️';
      default: return '🎙️';
    }
  };

  const getStatusText = () => {
    switch (state) {
      case 'listening': return '聆听中...';
      case 'processing': return '思考中...';
      case 'speaking': return 'AI 说话中...';
      case 'error': return '错误';
      default: return '点击开始语音对话';
    }
  };

  return (
    <div className="voice-conversation-control">
      {/* 主按钮 */}
      <button
        className={`voice-conversation-button ${state} ${isAIResponding ? 'can-interrupt' : ''}`}
        onClick={state === 'speaking' ? interrupt : toggleConversation}
        disabled={disabled}
        title={state === 'speaking' ? '点击打断' : (state === 'idle' ? '开始语音对话' : '停止')}
      >
        <span className="voice-icon">{getButtonIcon()}</span>
        
        {/* 音量波纹动画 */}
        {state !== 'idle' && (
          <span className="voice-waves">
            <span className="wave" style={{ transform: `scale(${1 + volume})` }} />
            <span className="wave" style={{ transform: `scale(${1 + volume * 0.8})` }} />
            <span className="wave" style={{ transform: `scale(${1 + volume * 0.6})` }} />
          </span>
        )}
        
        {/* 打断提示 */}
        {state === 'speaking' && (
          <span className="interrupt-hint">点击打断</span>
        )}
      </button>

      {/* 状态面板 */}
      {state !== 'idle' && (
        <div className="voice-status-panel">
          <div className="status-header">
            <span className={`status-dot ${state}`} />
            <span className="status-text">{getStatusText()}</span>
          </div>
          
          {/* 实时转录显示 */}
          {(transcript || interimTranscript) && (
            <div className="transcript-box">
              <span className="final-text">{transcript}</span>
              <span className="interim-text">{interimTranscript}</span>
            </div>
          )}
          
          {/* 提示 */}
          <div className="voice-hints">
            {state === 'listening' && (
              <span className="hint">🗣️ 说话后停顿1秒自动发送</span>
            )}
            {state === 'speaking' && (
              <span className="hint interrupt">👆 点击按钮或说话打断</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// 导出TTS服务，供ChatPanel使用
export { ttsService };
