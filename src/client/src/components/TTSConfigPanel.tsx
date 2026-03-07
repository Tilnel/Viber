import { useState, useEffect, useRef } from 'react';
import { ttsService } from '../services/tts';
import type { TTSVoice, TTSProvider } from '../services/tts/types';
import './TTSConfigPanel.css';

interface TTSConfigPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function TTSConfigPanel({ isOpen, onClose }: TTSConfigPanelProps) {
  const [currentProvider, setCurrentProvider] = useState<TTSProvider>('edge');
  const [voices, setVoices] = useState<TTSVoice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<TTSVoice | null>(null);
  const [rate, setRate] = useState(1.0);
  const [volume, setVolume] = useState(1.0);
  const [isTesting, setIsTesting] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // 加载配置
  useEffect(() => {
    const provider = ttsService.getCurrentProvider();
    setCurrentProvider(provider);
    
    const availableVoices = ttsService.getVoices();
    setVoices(availableVoices);
    
    // 从 localStorage 加载保存的配置
    const savedConfig = localStorage.getItem('tts-config');
    if (savedConfig) {
      try {
        const config = JSON.parse(savedConfig);
        if (config.voiceId) {
          const voice = availableVoices.find(v => v.id === config.voiceId);
          if (voice) setSelectedVoice(voice);
        }
        if (config.rate) setRate(config.rate);
        if (config.volume) setVolume(config.volume);
      } catch {
        // 忽略解析错误
      }
    }
    
    // 如果没有选中的音色，默认选择第一个
    if (!selectedVoice && availableVoices.length > 0) {
      setSelectedVoice(availableVoices[0]);
    }
  }, [isOpen]);

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  // 切换提供商
  const handleProviderChange = async (provider: TTSProvider) => {
    const success = await ttsService.setProvider(provider);
    if (success) {
      setCurrentProvider(provider);
      const newVoices = ttsService.getVoices();
      setVoices(newVoices);
      if (newVoices.length > 0) {
        setSelectedVoice(newVoices[0]);
      }
    }
  };

  // 测试音色
  const handleTestVoice = async () => {
    if (!selectedVoice || isTesting) return;
    
    setIsTesting(true);
    try {
      await ttsService.speak(
        `你好，我是${selectedVoice.name}，这是测试语音。`,
        {
          voice: selectedVoice,
          rate,
          volume
        }
      );
    } catch (error) {
      console.error('TTS test failed:', error);
    } finally {
      setIsTesting(false);
    }
  };

  // 保存配置
  const handleSave = () => {
    if (selectedVoice) {
      localStorage.setItem('tts-config', JSON.stringify({
        provider: currentProvider,
        voiceId: selectedVoice.id,
        rate,
        volume
      }));
    }
    onClose();
  };

  // 停止测试
  const handleStop = () => {
    ttsService.stop();
    setIsTesting(false);
  };

  if (!isOpen) return null;

  return (
    <div className="tts-config-overlay">
      <div className="tts-config-panel" ref={panelRef}>
        <div className="tts-config-header">
          <h3>🔊 语音设置</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="tts-config-content">
          {/* 提供商选择 */}
          <div className="config-section">
            <label>语音引擎</label>
            <div className="provider-options">
              <button
                className={`provider-btn ${currentProvider === 'edge' ? 'active' : ''}`}
                onClick={() => handleProviderChange('edge')}
              >
                <span className="provider-icon">🎵</span>
                <span className="provider-name">Edge TTS</span>
                <span className="provider-desc">微软 Azure，音质好</span>
              </button>
              <button
                className={`provider-btn ${currentProvider === 'browser' ? 'active' : ''}`}
                onClick={() => handleProviderChange('browser')}
              >
                <span className="provider-icon">🔊</span>
                <span className="provider-name">浏览器 TTS</span>
                <span className="provider-desc">系统自带，无需网络</span>
              </button>
            </div>
          </div>

          {/* 音色选择 */}
          <div className="config-section">
            <label>选择音色</label>
            <select
              className="voice-select"
              value={selectedVoice?.id || ''}
              onChange={(e) => {
                const voice = voices.find(v => v.id === e.target.value);
                if (voice) setSelectedVoice(voice);
              }}
            >
              {voices.map(voice => (
                <option key={voice.id} value={voice.id}>
                  {voice.name} {voice.gender === 'female' ? '👩' : voice.gender === 'male' ? '👨' : '👤'}
                </option>
              ))}
            </select>
            
            {selectedVoice && (
              <div className="voice-info">
                <span className="quality-badge">{selectedVoice.quality === 'high' ? '高品质' : '标准'}</span>
                <span className="lang-badge">{selectedVoice.lang}</span>
              </div>
            )}
          </div>

          {/* 语速调节 */}
          <div className="config-section">
            <label>
              语速
              <span className="value-display">{rate.toFixed(1)}x</span>
            </label>
            <input
              type="range"
              min="0.5"
              max="2.0"
              step="0.1"
              value={rate}
              onChange={(e) => setRate(parseFloat(e.target.value))}
            />
            <div className="range-labels">
              <span>慢</span>
              <span>正常</span>
              <span>快</span>
            </div>
          </div>

          {/* 音量调节 */}
          <div className="config-section">
            <label>
              音量
              <span className="value-display">{Math.round(volume * 100)}%</span>
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
            />
          </div>

          {/* 测试按钮 */}
          <div className="config-section test-section">
            <button
              className={`test-btn ${isTesting ? 'testing' : ''}`}
              onClick={isTesting ? handleStop : handleTestVoice}
              disabled={!selectedVoice}
            >
              {isTesting ? (
                <>
                  <span className="stop-icon">⏹</span>
                  停止测试
                </>
              ) : (
                <>
                  <span className="play-icon">▶</span>
                  测试音色
                </>
              )}
            </button>
          </div>
        </div>

        <div className="tts-config-footer">
          <button className="save-btn" onClick={handleSave}>
            保存设置
          </button>
        </div>
      </div>
    </div>
  );
}
