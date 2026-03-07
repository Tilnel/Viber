import { useState, useEffect } from 'react';
import { piperTTSService } from '../services/piperTTS';
import './TTSSettings.css';

interface TTSControlProps {
  className?: string;
}

export default function TTSControl({ className }: TTSControlProps) {
  const [isSpeaking, setIsSpeaking] = useState(false);

  useEffect(() => {
    const unsubscribe = piperTTSService.onStateChange((state) => {
      setIsSpeaking(state === 'playing');
    });
    return () => unsubscribe();
  }, []);

  const handleClick = () => {
    if (isSpeaking) {
      piperTTSService.stop();
    }
  };

  if (!isSpeaking) return null;

  return (
    <div className={`tts-control-fab ${className || ''}`}>
      <button
        className="tts-control-button speaking"
        onClick={handleClick}
        title="点击打断语音"
      >
        🔊
      </button>
    </div>
  );
}
