import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSettingsStore } from '../stores/settings';
import { volcanoVoices, piperVoices, browserVoices, type TTSEngine } from '../services/voiceConfig';
import VoiceVolumeVisualizer from '../components/VoiceVolumeVisualizer';
import './SettingsPage.css';

export default function SettingsPage() {
  const navigate = useNavigate();
  const { settings, updateSettings } = useSettingsStore();
  const [activeTab, setActiveTab] = useState<'general' | 'editor' | 'voice'>('general');
  
  // 用于音量可视化的 audio context
  const [visualizerAnalyser, setVisualizerAnalyser] = useState<AnalyserNode | null>(null);
  const [isVisualizerActive, setIsVisualizerActive] = useState(false);
  
  // TTS 试听
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const handleSettingChange = (key: string, value: any) => {
    updateSettings({ [key]: value });
  };

  // 获取当前引擎可用的音色列表
  const getAvailableVoices = (engine: TTSEngine) => {
    switch (engine) {
      case 'volcano':
        return volcanoVoices;
      case 'piper':
        return piperVoices;
      case 'browser':
        return browserVoices;
      default:
        return volcanoVoices;
    }
  };

  // 启动音量可视化
  const startVisualizer = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        }
      });
      
      const audioContext = new AudioContext({ sampleRate: 16000 });
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      
      setVisualizerAnalyser(analyser);
      setIsVisualizerActive(true);
    } catch (error) {
      console.error('Failed to start visualizer:', error);
    }
  };

  // 停止音量可视化
  const stopVisualizer = () => {
    setVisualizerAnalyser(null);
    setIsVisualizerActive(false);
  };

  // TTS 试听
  const playVoicePreview = async () => {
    try {
      setIsPlayingPreview(true);
      
      const response = await fetch('/api/voice/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: '你好，我是你的语音助手，我会为你提供语音服务。',
          engine: settings.ttsEngine,
          voice: settings.ttsVoice,
          speed: settings.voiceSpeed
        })
      });
      
      if (!response.ok) {
        throw new Error('Failed to synthesize');
      }
      
      const blob = await response.blob();
      const audioUrl = URL.createObjectURL(blob);
      
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      
      const audio = new Audio(audioUrl);
      audioRef.current = audio;
      
      audio.addEventListener('ended', () => {
        setIsPlayingPreview(false);
        URL.revokeObjectURL(audioUrl);
      });
      
      audio.addEventListener('error', () => {
        setIsPlayingPreview(false);
        URL.revokeObjectURL(audioUrl);
      });
      
      await audio.play();
    } catch (error) {
      console.error('Failed to play preview:', error);
      setIsPlayingPreview(false);
      alert('试听失败: ' + (error as Error).message);
    }
  };

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      stopVisualizer();
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, []);

  return (
    <div className="settings-page">
      <header className="settings-header">
        <button className="btn btn-icon" onClick={() => navigate(-1)}>🔙</button>
        <h1>设置</h1>
      </header>

      <div className="settings-content">
        <nav className="settings-nav">
          <button 
            className={activeTab === 'general' ? 'active' : ''}
            onClick={() => setActiveTab('general')}
          >
            通用
          </button>
          <button 
            className={activeTab === 'editor' ? 'active' : ''}
            onClick={() => setActiveTab('editor')}
          >
            编辑器
          </button>
          <button 
            className={activeTab === 'voice' ? 'active' : ''}
            onClick={() => setActiveTab('voice')}
          >
            语音
          </button>
        </nav>

        <div className="settings-panel">
          {activeTab === 'general' && (
            <div className="settings-section">
              <h2>通用设置</h2>
              
              <div className="setting-item">
                <label>主题</label>
                <select 
                  value={settings.theme}
                  onChange={(e) => handleSettingChange('theme', e.target.value)}
                >
                  <option value="system">跟随系统</option>
                  <option value="light">浅色</option>
                  <option value="dark">深色</option>
                </select>
              </div>

              <div className="setting-item">
                <label>代码根目录</label>
                <input 
                  type="text" 
                  value={settings.rootDirectory}
                  onChange={(e) => handleSettingChange('rootDirectory', e.target.value)}
                />
              </div>
            </div>
          )}

          {activeTab === 'editor' && (
            <div className="settings-section">
              <h2>编辑器设置</h2>
              
              <div className="setting-item">
                <label>字体大小</label>
                <input 
                  type="number" 
                  min={10} 
                  max={24}
                  value={settings.fontSize}
                  onChange={(e) => handleSettingChange('fontSize', parseInt(e.target.value))}
                />
              </div>

              <div className="setting-item">
                <label>Tab 大小</label>
                <input 
                  type="number" 
                  min={2} 
                  max={8}
                  value={settings.tabSize}
                  onChange={(e) => handleSettingChange('tabSize', parseInt(e.target.value))}
                />
              </div>

              <div className="setting-item">
                <label>
                  <input 
                    type="checkbox"
                    checked={settings.wordWrap}
                    onChange={(e) => handleSettingChange('wordWrap', e.target.checked)}
                  />
                  自动换行
                </label>
              </div>

              <div className="setting-item">
                <label>
                  <input 
                    type="checkbox"
                    checked={settings.autoSave}
                    onChange={(e) => handleSettingChange('autoSave', e.target.checked)}
                  />
                  自动保存
                </label>
              </div>
            </div>
          )}

          {activeTab === 'voice' && (
            <div className="settings-section">
              <h2>语音设置</h2>
              
              <div className="setting-item">
                <label>
                  <input 
                    type="checkbox"
                    checked={settings.voiceEnabled}
                    onChange={(e) => handleSettingChange('voiceEnabled', e.target.checked)}
                  />
                  启用语音
                </label>
              </div>

              <h3>语音识别 (STT)</h3>
              
              <div className="setting-item">
                <label>语音识别语言</label>
                <select 
                  value={settings.voiceLanguage}
                  onChange={(e) => handleSettingChange('voiceLanguage', e.target.value)}
                >
                  <option value="zh-CN">中文（简体）</option>
                  <option value="en-US">English (US)</option>
                  <option value="ja-JP">日本語</option>
                </select>
              </div>

              <h3>语音合成 (TTS)</h3>
              
              <div className="setting-item">
                <label>TTS 引擎</label>
                <select 
                  value={settings.ttsEngine}
                  onChange={(e) => {
                    const engine = e.target.value as TTSEngine;
                    handleSettingChange('ttsEngine', engine);
                    // 重置为默认音色
                    const voices = getAvailableVoices(engine);
                    if (voices.length > 0) {
                      handleSettingChange('ttsVoice', voices[0].id);
                    }
                  }}
                >
                  <option value="volcano">火山引擎（推荐）</option>
                  <option value="piper">Piper（本地）</option>
                  <option value="browser">浏览器（备用）</option>
                </select>
              </div>

              <div className="setting-item">
                <label>音色</label>
                <div className="voice-select-row">
                  <select 
                    value={settings.ttsVoice}
                    onChange={(e) => handleSettingChange('ttsVoice', e.target.value)}
                    className="voice-select"
                  >
                    {getAvailableVoices(settings.ttsEngine).map(voice => (
                      <option key={voice.id} value={voice.id}>
                        {voice.name} - {voice.desc}
                      </option>
                    ))}
                  </select>
                  <button 
                    className="btn btn-preview"
                    onClick={playVoicePreview}
                    disabled={isPlayingPreview}
                    title="试听当前音色"
                  >
                    {isPlayingPreview ? '🔊 播放中...' : '▶️ 试听'}
                  </button>
                </div>
              </div>

              <div className="setting-item">
                <label>语音速度: {settings.voiceSpeed}x</label>
                <input 
                  type="range" 
                  min={0.5}
                  max={2}
                  step={0.1}
                  value={settings.voiceSpeed}
                  onChange={(e) => handleSettingChange('voiceSpeed', parseFloat(e.target.value))}
                />
              </div>

              <h3>语音检测 (VAD)</h3>
              
              <div className="setting-item">
                <label>静音阈值: {(settings.vadThreshold * 100).toFixed(1)}%</label>
                <input 
                  type="range" 
                  min={0.01}
                  max={0.2}
                  step={0.005}
                  value={settings.vadThreshold}
                  onChange={(e) => handleSettingChange('vadThreshold', parseFloat(e.target.value))}
                />
                <small>越小越敏感，建议 2%-5%</small>
              </div>

              <div className="setting-item">
                <label>静音超时: {settings.vadSilenceTimeout}ms</label>
                <input 
                  type="range" 
                  min={500}
                  max={5000}
                  step={100}
                  value={settings.vadSilenceTimeout}
                  onChange={(e) => handleSettingChange('vadSilenceTimeout', parseInt(e.target.value))}
                />
                <small>检测到静音后多久认为说话结束</small>
              </div>

              <h3>麦克风测试</h3>
              
              <div className="setting-item">
                <button 
                  className="btn btn-primary"
                  onClick={isVisualizerActive ? stopVisualizer : startVisualizer}
                >
                  {isVisualizerActive ? '停止测试' : '开始麦克风测试'}
                </button>
                <small>测试麦克风音量并调节 VAD 阈值</small>
              </div>

              {isVisualizerActive && visualizerAnalyser && (
                <VoiceVolumeVisualizer
                  analyser={visualizerAnalyser}
                  threshold={settings.vadThreshold}
                  onThresholdChange={(threshold) => handleSettingChange('vadThreshold', threshold)}
                  isActive={isVisualizerActive}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
