import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSettingsStore } from '../stores/settings';
import './SettingsPage.css';

export default function SettingsPage() {
  const navigate = useNavigate();
  const { settings, updateSettings } = useSettingsStore();
  const [activeTab, setActiveTab] = useState<'general' | 'editor' | 'voice'>('general');

  const handleSettingChange = (key: string, value: any) => {
    updateSettings({ [key]: value });
  };

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
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
