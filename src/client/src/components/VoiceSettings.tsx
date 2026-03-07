import React, { useState, useEffect } from 'react';
import {
  VoiceConfig,
  loadVoiceConfig,
  saveVoiceConfig,
  volcanoVoices,
  piperVoices,
  getAvailableVoices,
  checkVolcanoAvailable,
  autoSelectEngine,
  TTSEngine,
  STTEngine,
} from '../services/voiceConfig';
import { volcanoTTSService } from '../services/volcanoTTS';

interface VoiceSettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

export const VoiceSettings: React.FC<VoiceSettingsProps> = ({ isOpen, onClose }) => {
  const [config, setConfig] = useState<VoiceConfig>(loadVoiceConfig());
  const [volcanoAvailable, setVolcanoAvailable] = useState<boolean>(false);
  const [isTesting, setIsTesting] = useState(false);

  useEffect(() => {
    checkVolcanoAvailable().then(setVolcanoAvailable);
  }, []);

  const handleSave = () => {
    saveVoiceConfig(config);
    onClose();
  };

  const handleAutoSelect = async () => {
    const best = await autoSelectEngine();
    setConfig({
      ...config,
      ttsEngine: best.tts,
      sttEngine: best.stt,
    });
  };

  const handleTestTTS = async () => {
    setIsTesting(true);
    await volcanoTTSService.synthesize(
      '你好，我是火山引擎语音合成，测试语音播放正常。',
      {
        voice: config.ttsVoice,
        speed: config.ttsSpeed,
        volume: config.ttsVolume,
      }
    );
    setIsTesting(false);
  };

  if (!isOpen) return null;

  const voices = getAvailableVoices(config.ttsEngine);

  return (
    <div className="voice-settings-overlay" onClick={onClose}>
      <div className="voice-settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="voice-settings-header">
          <h3>🎙️ 语音设置</h3>
          <button className="close-btn" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="voice-settings-content">
          {/* 状态提示 */}
          {!volcanoAvailable ? (
            <div className="warning-banner">
              ⚠️ 火山引擎未配置，将使用本地 Piper TTS 和浏览器 STT
              <div style={{marginTop: 8, fontSize: 12}}>
                配置方法：设置环境变量 VOLCANO_APP_ID 和 VOLCANO_ACCESS_TOKEN 后重启服务
              </div>
            </div>
          ) : (
            <div className="info-banner">
              ✅ 火山引擎已配置（Cluster: {config.ttsEngine === 'volcano' ? 'volcengine_streaming_common' : '—'}）
              <div style={{marginTop: 4, fontSize: 12}}>
                如遇 "服务未开通" 错误，请前往
                <a href="https://www.volcengine.com/docs/6561/1354869" target="_blank" rel="noopener" style={{color: '#3b82f6'}}>
                  火山引擎控制台
                </a>
                开通语音识别服务
              </div>
            </div>
          )}

          {/* 自动选择 */}
          <div className="setting-section">
            <button className="auto-select-btn" onClick={handleAutoSelect}>
              🔧 自动选择最佳引擎
            </button>
          </div>

          {/* TTS 引擎 */}
          <div className="setting-section">
            <label>语音合成 (TTS) 引擎</label>
            <div className="engine-options">
              <label className={`radio-label ${!volcanoAvailable ? 'disabled' : ''}`}>
                <input
                  type="radio"
                  value="volcano"
                  checked={config.ttsEngine === 'volcano'}
                  onChange={(e) =>
                    setConfig({ ...config, ttsEngine: e.target.value as TTSEngine })
                  }
                  disabled={!volcanoAvailable}
                />
                <span>火山引擎 ☁️</span>
                <small>云端高质量，多种音色</small>
              </label>
              <label className="radio-label">
                <input
                  type="radio"
                  value="piper"
                  checked={config.ttsEngine === 'piper'}
                  onChange={(e) =>
                    setConfig({ ...config, ttsEngine: e.target.value as TTSEngine })
                  }
                />
                <span>Piper 🖥️</span>
                <small>本地运行，无需联网</small>
              </label>
            </div>
          </div>

          {/* STT 引擎 */}
          <div className="setting-section">
            <label>语音识别 (STT) 引擎</label>
            <div className="engine-options">
              <label className={`radio-label ${!volcanoAvailable ? 'disabled' : ''}`}>
                <input
                  type="radio"
                  value="volcano"
                  checked={config.sttEngine === 'volcano'}
                  onChange={(e) =>
                    setConfig({ ...config, sttEngine: e.target.value as STTEngine })
                  }
                  disabled={!volcanoAvailable}
                />
                <span>火山引擎 ☁️</span>
                <small>云端识别，准确率高</small>
              </label>
              <label className="radio-label">
                <input
                  type="radio"
                  value="browser"
                  checked={config.sttEngine === 'browser'}
                  onChange={(e) =>
                    setConfig({ ...config, sttEngine: e.target.value as STTEngine })
                  }
                />
                <span>浏览器 🌐</span>
                <small>本地识别，免费使用</small>
              </label>
            </div>
          </div>

          {/* 音色选择 */}
          {config.ttsEngine === 'volcano' && (
            <div className="setting-section">
              <label>选择音色</label>
              <select
                value={config.ttsVoice}
                onChange={(e) => setConfig({ ...config, ttsVoice: e.target.value })}
                className="voice-select"
              >
                {volcanoVoices.map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.name} - {voice.desc}
                  </option>
                ))}
              </select>
              <button
                className="test-btn"
                onClick={handleTestTTS}
                disabled={isTesting || !volcanoAvailable}
              >
                {isTesting ? '🔊 播放中...' : '▶️ 测试音色'}
              </button>
            </div>
          )}

          {/* 语速设置 */}
          <div className="setting-section">
            <label>语速: {config.ttsSpeed.toFixed(1)}x</label>
            <input
              type="range"
              min="0.5"
              max="2.0"
              step="0.1"
              value={config.ttsSpeed}
              onChange={(e) =>
                setConfig({ ...config, ttsSpeed: parseFloat(e.target.value) })
              }
              className="slider"
            />
          </div>

          {/* 音量设置 */}
          <div className="setting-section">
            <label>音量: {Math.round(config.ttsVolume * 100)}%</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={config.ttsVolume}
              onChange={(e) =>
                setConfig({ ...config, ttsVolume: parseFloat(e.target.value) })
              }
              className="slider"
            />
          </div>

          {/* 自动朗读 AI 回复 */}
          <div className="setting-section">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={config.autoSpeakAIResponse}
                onChange={(e) =>
                  setConfig({ ...config, autoSpeakAIResponse: e.target.checked })
                }
              />
              <span>🔊 自动朗读 AI 回复</span>
            </label>
            <small style={{ display: 'block', marginTop: 4, color: 'var(--text-secondary)' }}>
              打字发送后，AI 回复会自动朗读（需 TTS 引擎支持）
            </small>
          </div>

          {/* VAD 设置 */}
          <div className="setting-section vad-section">
            <label>🎤 语音检测 (VAD)</label>
            <div className="vad-settings">
              <div>
                <label>静音阈值: {config.silenceThreshold}</label>
                <input
                  type="range"
                  min="0.005"
                  max="0.05"
                  step="0.005"
                  value={config.silenceTimeout}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      silenceThreshold: parseFloat(e.target.value),
                    })
                  }
                  className="slider"
                />
                <small>越小越敏感</small>
              </div>
              <div>
                <label>静音超时: {config.silenceTimeout}ms</label>
                <input
                  type="range"
                  min="300"
                  max="2000"
                  step="100"
                  value={config.silenceTimeout}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      silenceTimeout: parseInt(e.target.value),
                    })
                  }
                  className="slider"
                />
                <small>停顿多久认为说完</small>
              </div>
            </div>
          </div>
        </div>

        <div className="voice-settings-footer">
          <button className="cancel-btn" onClick={onClose}>
            取消
          </button>
          <button className="save-btn" onClick={handleSave}>
            保存设置
          </button>
        </div>
      </div>

      <style>{`
        .voice-settings-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
        }

        .voice-settings-modal {
          background: var(--bg-primary, #fff);
          border-radius: 12px;
          width: 90%;
          max-width: 480px;
          max-height: 80vh;
          overflow: hidden;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
        }

        .voice-settings-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px 20px;
          border-bottom: 1px solid var(--border-color, #e5e7eb);
        }

        .voice-settings-header h3 {
          margin: 0;
          font-size: 18px;
        }

        .close-btn {
          background: none;
          border: none;
          font-size: 24px;
          cursor: pointer;
          color: var(--text-secondary);
        }

        .voice-settings-content {
          padding: 20px;
          overflow-y: auto;
          max-height: 60vh;
        }

        .warning-banner {
          background: #fef3c7;
          color: #92400e;
          padding: 12px;
          border-radius: 8px;
          margin-bottom: 16px;
          font-size: 14px;
        }

        .info-banner {
          background: #d1fae5;
          color: #065f46;
          padding: 12px;
          border-radius: 8px;
          margin-bottom: 16px;
          font-size: 14px;
        }

        .info-banner a {
          text-decoration: underline;
          margin-left: 4px;
        }

        .setting-section {
          margin-bottom: 20px;
        }

        .setting-section > label {
          display: block;
          font-weight: 600;
          margin-bottom: 8px;
          font-size: 14px;
        }

        .engine-options {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .radio-label {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px;
          border: 2px solid var(--border-color, #e5e7eb);
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .radio-label:hover:not(.disabled) {
          border-color: var(--primary-color, #3b82f6);
        }

        .radio-label.disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .radio-label input[type="radio"] {
          width: 18px;
          height: 18px;
        }

        .radio-label span {
          font-weight: 500;
          flex: 1;
        }

        .radio-label small {
          color: var(--text-secondary, #6b7280);
          font-size: 12px;
        }

        .checkbox-label {
          display: flex;
          align-items: center;
          gap: 10px;
          cursor: pointer;
          font-weight: 500;
        }

        .checkbox-label input[type="checkbox"] {
          width: 18px;
          height: 18px;
          cursor: pointer;
        }

        .voice-select {
          width: 100%;
          padding: 10px;
          border: 2px solid var(--border-color, #e5e7eb);
          border-radius: 8px;
          font-size: 14px;
          margin-bottom: 10px;
        }

        .slider {
          width: 100%;
          margin: 8px 0;
        }

        .vad-section {
          background: var(--bg-secondary, #f9fafb);
          padding: 16px;
          border-radius: 8px;
        }

        .vad-settings > div {
          margin-bottom: 16px;
        }

        .vad-settings > div:last-child {
          margin-bottom: 0;
        }

        .vad-settings label {
          display: block;
          font-size: 13px;
          margin-bottom: 4px;
        }

        .vad-settings small {
          color: var(--text-secondary);
          font-size: 11px;
        }

        .test-btn,
        .auto-select-btn {
          width: 100%;
          padding: 10px;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-size: 14px;
          transition: all 0.2s;
        }

        .test-btn {
          background: var(--primary-color, #3b82f6);
          color: white;
        }

        .test-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .auto-select-btn {
          background: var(--bg-secondary, #f3f4f6);
          color: var(--text-primary);
        }

        .voice-settings-footer {
          display: flex;
          gap: 12px;
          padding: 16px 20px;
          border-top: 1px solid var(--border-color, #e5e7eb);
          justify-content: flex-end;
        }

        .cancel-btn,
        .save-btn {
          padding: 10px 20px;
          border-radius: 8px;
          font-size: 14px;
          cursor: pointer;
          border: none;
        }

        .cancel-btn {
          background: var(--bg-secondary, #f3f4f6);
          color: var(--text-primary);
        }

        .save-btn {
          background: var(--primary-color, #3b82f6);
          color: white;
        }
      `}</style>
    </div>
  );
};

export default VoiceSettings;
