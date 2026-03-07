// 新版语音按钮 - 使用新的 VoiceManager
import { useState } from 'react';
import { useVoiceConversation } from '../hooks/useVoiceConversation';

export default function VoiceButton2() {
  const [aiResponse, setAiResponse] = useState('');
  const [isResponding, setIsResponding] = useState(false);
  
  const { state, transcript, isListening, start, stop } = useVoiceConversation({
    onAIResponse: (text) => {
      setAiResponse(text);
      setIsResponding(true);
    },
    onAIResponseComplete: () => {
      setIsResponding(false);
    },
    onError: (error) => {
      console.error('Voice error:', error);
    }
  });
  
  const handleClick = async () => {
    if (isListening) {
      stop();
    } else {
      const success = await start();
      if (success) {
        console.log('Voice started');
      }
    }
  };
  
  // 状态文本
  const getStateText = () => {
    switch (state) {
      case 'idle': return isListening ? '就绪' : '点击开始';
      case 'recording': return '录音中...';
      case 'waiting': return '识别中...';
      case 'appending': return '补充中...';
      case 'processing': return 'AI 思考中...';
      case 'speaking': return 'AI 说话中...';
      default: return '未知';
    }
  };
  
  return (
    <div className="voice-button-2">
      <button 
        onClick={handleClick}
        className={`voice-btn ${isListening ? 'active' : ''} ${state}`}
      >
        {isListening ? '🎤 停止' : '🎤 开始语音'}
      </button>
      
      <div className="voice-status">
        <span className="state">{getStateText()}</span>
        {transcript && (
          <span className="transcript">: {transcript}</span>
        )}
      </div>
      
      {isResponding && (
        <div className="ai-response">
          <strong>AI:</strong> {aiResponse}
        </div>
      )}
    </div>
  );
}
