// 语音对话按钮 - 使用简化版 SimpleVoiceManager
import { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'react-toastify';
import { SimpleVoiceManager } from '../services/simpleVoiceManager';
import { useSettingsStore } from '../stores/settings';
import './VoiceConversationButton.css';

interface VoiceConversationButtonProps {
  onUserSpeech: (text: string) => void;
  onInterrupt?: () => void;
  disabled?: boolean;
}

export default function VoiceConversationButton({
  onUserSpeech,
  onInterrupt,
  disabled
}: VoiceConversationButtonProps) {
  const [isListening, setIsListening] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  
  const managerRef = useRef<SimpleVoiceManager | null>(null);
  const settings = useSettingsStore(state => state.settings);

  // 初始化
  const startListening = useCallback(async () => {
    if (managerRef.current) return true;

    const manager = new SimpleVoiceManager({
      speechThreshold: settings.vadThreshold,
      
      onStateChange: (state) => {
        setIsListening(state === 'listening');
      },
      
      onTranscript: (text) => {
        console.log('[VoiceButton] Transcript:', text);
        onUserSpeech(text);
      },
      
      onError: (error) => {
        console.error('[VoiceButton] Error:', error);
        toast.error(`语音错误: ${error}`);
        stopListening();
      }
    });

    const success = await manager.start();
    if (success) {
      managerRef.current = manager;
      toast.success('语音助手已启动，请说话...', { autoClose: 2000 });
      return true;
    }
    return false;
  }, [onUserSpeech, settings.vadThreshold]);

  const stopListening = useCallback(() => {
    managerRef.current?.stop();
    managerRef.current = null;
    setIsListening(false);
    setIsRecording(false);
  }, []);

  const toggle = useCallback(async () => {
    if (isListening) {
      stopListening();
    } else {
      const success = await startListening();
      if (!success) {
        toast.error('启动失败，请检查麦克风权限');
      }
    }
  }, [isListening, startListening, stopListening]);

  // 组件卸载时停止
  useEffect(() => {
    return () => {
      stopListening();
    };
  }, []);

  return (
    <div className="voice-conversation-wrapper">
      <button
        className={`voice-conversation-btn ${isListening ? 'active' : ''}`}
        onClick={toggle}
        disabled={disabled}
        title={isListening ? '点击停止' : '点击开始语音'}
      >
        <span className="voice-icon">
          {isListening ? '🎤' : '🎙️'}
        </span>
        <span className="voice-status-text">
          {isListening ? ' listening...' : '语音'}
        </span>
      </button>
    </div>
  );
}

import { piperTTSService as piperService } from '../services/piperTTS';
import { volcanoTTSService as volcanoService } from '../services/volcanoTTS';

export { piperService as piperTTSService };
export { volcanoService as volcanoTTSService };
