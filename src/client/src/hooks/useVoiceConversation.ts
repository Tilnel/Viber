// 语音对话 Hook
import { useCallback, useEffect, useRef, useState } from 'react';
import { ConversationManager } from '../services/conversationManager';
import { VoiceState } from '../services/voiceManager';

export interface UseVoiceConversationOptions {
  onAIResponse?: (text: string) => void;
  onAIResponseComplete?: () => void;
  onError?: (error: string) => void;
}

export function useVoiceConversation(options: UseVoiceConversationOptions = {}) {
  const [state, setState] = useState<VoiceState>('idle');
  const [transcript, setTranscript] = useState('');
  const [isListening, setIsListening] = useState(false);
  const managerRef = useRef<ConversationManager | null>(null);
  
  // 初始化管理器
  useEffect(() => {
    managerRef.current = new ConversationManager({
      onStateChange: (newState) => {
        setState(newState);
        setIsListening(newState !== 'idle');
      },
      onTranscript: (text, isFinal) => {
        setTranscript(text);
        if (isFinal) {
          setTranscript('');
        }
      },
      onAIResponse: options.onAIResponse,
      onAIResponseComplete: options.onAIResponseComplete,
      onError: options.onError
    });
    
    return () => {
      managerRef.current?.stop();
      managerRef.current = null;
    };
  }, []);
  
  const start = useCallback(async () => {
    const success = await managerRef.current?.start();
    if (success) {
      setIsListening(true);
    }
    return success;
  }, []);
  
  const stop = useCallback(() => {
    managerRef.current?.stop();
    setIsListening(false);
  }, []);
  
  return {
    state,
    transcript,
    isListening,
    start,
    stop
  };
}

export default useVoiceConversation;
