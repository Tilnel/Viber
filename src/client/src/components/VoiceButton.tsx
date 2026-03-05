import { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'react-toastify';
import { useSettingsStore } from '../stores/settings';
import './VoiceButton.css';

interface VoiceButtonProps {
  onTranscript: (transcript: string) => void;
  disabled?: boolean;
}

type VoiceState = 'idle' | 'listening' | 'error';

export default function VoiceButton({ onTranscript, disabled }: VoiceButtonProps) {
  const { settings } = useSettingsStore();
  const [state, setState] = useState<VoiceState>('idle');
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  // Initialize speech recognition
  useEffect(() => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      console.warn('Web Speech API not supported');
      return;
    }

    const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognitionAPI();
    
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = settings.voiceLanguage;
    
    recognition.onstart = () => {
      setState('listening');
      setTranscript('');
      setInterimTranscript('');
    };
    
    recognition.onresult = (event) => {
      let interim = '';
      let final = '';
      
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += transcript;
        } else {
          interim += transcript;
        }
      }
      
      if (final) {
        setTranscript(prev => prev + final);
        onTranscript(final + ' ');
      }
      setInterimTranscript(interim);
    };
    
    recognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
      
      if (event.error === 'not-allowed') {
        toast.error('麦克风权限被拒绝，请在浏览器设置中允许访问麦克风');
        setState('error');
      } else if (event.error === 'no-speech') {
        // 没有检测到语音，自动重启
        setTimeout(() => {
          if (state === 'listening') {
            try {
              recognition.start();
            } catch {
              // ignore
            }
          }
        }, 100);
      } else {
        setState('error');
      }
    };
    
    recognition.onend = () => {
      // 如果仍在监听状态，自动重启
      if (state === 'listening') {
        setTimeout(() => {
          try {
            recognition.start();
          } catch {
            setState('idle');
          }
        }, 100);
      }
    };
    
    recognitionRef.current = recognition;
    
    return () => {
      try {
        recognition.stop();
      } catch {
        // ignore
      }
    };
  }, [settings.voiceLanguage, onTranscript, state]);

  // 主动请求麦克风权限
  const requestMicrophonePermission = useCallback(async (): Promise<boolean> => {
    try {
      // 检查是否在 HTTPS 或 localhost 环境
      const isSecureContext = window.isSecureContext;
      if (!isSecureContext) {
        toast.error('语音识别需要在 HTTPS 或 localhost 环境下运行');
        console.error('Web Speech API requires HTTPS or localhost');
        return false;
      }

      // 主动请求麦克风权限
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // 获取权限后立即停止轨道，避免占用麦克风
      stream.getTracks().forEach(track => track.stop());
      return true;
    } catch (err) {
      console.error('Microphone permission error:', err);
      if (err instanceof DOMException) {
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          toast.error('麦克风权限被拒绝，请在浏览器地址栏点击 🔒 图标允许麦克风访问');
        } else if (err.name === 'NotFoundError') {
          toast.error('未找到麦克风设备，请检查设备连接');
        } else if (err.name === 'NotReadableError') {
          toast.error('麦克风被其他应用占用，请关闭其他使用麦克风的应用');
        } else {
          toast.error(`麦克风错误: ${err.message}`);
        }
      } else {
        toast.error('无法访问麦克风，请检查浏览器权限设置');
      }
      return false;
    }
  }, []);

  const toggleListening = useCallback(async () => {
    if (!recognitionRef.current) {
      toast.error('您的浏览器不支持语音识别');
      return;
    }
    
    if (state === 'listening') {
      setState('idle');
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
    } else {
      // 先请求麦克风权限
      const hasPermission = await requestMicrophonePermission();
      if (!hasPermission) {
        setState('error');
        return;
      }

      try {
        recognitionRef.current.start();
      } catch (err) {
        console.error('Speech recognition start error:', err);
        toast.error('启动语音识别失败，请刷新页面后重试');
        setState('error');
      }
    }
  }, [state, requestMicrophonePermission]);

  const getButtonIcon = () => {
    switch (state) {
      case 'listening': return '🎤';
      case 'error': return '⚠️';
      default: return '🎙️';
    }
  };

  return (
    <div className="voice-control">
      <button
        className={`voice-button ${state}`}
        onClick={toggleListening}
        disabled={disabled}
        title={state === 'listening' ? '停止听写' : '语音输入'}
      >
        <span className="voice-icon">{getButtonIcon()}</span>
        {state === 'listening' && <span className="voice-pulse" />}
      </button>
      
      {state === 'listening' && (
        <div className="voice-status-popup">
          <div className="voice-waveform">
            <span className="bar" />
            <span className="bar" />
            <span className="bar" />
            <span className="bar" />
            <span className="bar" />
          </div>
          <span className="status-text">聆听中...</span>
          {(transcript || interimTranscript) && (
            <span className="live-transcript">
              {transcript}
              <span className="interim">{interimTranscript}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
