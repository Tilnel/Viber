import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Settings } from '../../../shared/types';

interface SettingsState {
  settings: Settings;
  keybindings: Record<string, string>;
  loadSettings: () => Promise<void>;
  updateSettings: (updates: Partial<Settings>) => Promise<void>;
  updateKeybinding: (command: string, keybinding: string) => Promise<void>;
}

const defaultSettings: Settings = {
  theme: 'system',
  fontSize: 14,
  tabSize: 2,
  wordWrap: true,
  minimapEnabled: true,
  autoSave: true,
  autoSaveDelay: 1000,
  voiceEnabled: true,
  voiceLanguage: 'zh-CN',
  voiceSpeed: 1.0,
  ttsEngine: 'volcano',
  ttsVoice: 'BV001_streaming',
  vadThreshold: 0.025,
  vadSilenceTimeout: 2000,
  defaultModel: 'kimi-latest',
  contextWindow: 10,
  rootDirectory: '/path/to/your/code'
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      settings: defaultSettings,
      keybindings: {},
      
      loadSettings: async () => {
        try {
          const response = await fetch('/api/settings');
          if (response.ok) {
            const data = await response.json();
            set({
              settings: { ...defaultSettings, ...data.settings },
              keybindings: data.keybindings || {}
            });
          }
        } catch (error) {
          console.error('Failed to load settings:', error);
        }
      },
      
      updateSettings: async (updates) => {
        try {
          const response = await fetch('/api/settings', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates)
          });
          
          if (response.ok) {
            const data = await response.json();
            set(state => ({
              settings: { ...state.settings, ...data.settings }
            }));
          }
        } catch (error) {
          console.error('Failed to update settings:', error);
        }
      },
      
      updateKeybinding: async (command, keybinding) => {
        try {
          const response = await fetch('/api/settings/keybindings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command, keybinding })
          });
          
          if (response.ok) {
            set(state => ({
              keybindings: { ...state.keybindings, [command]: keybinding }
            }));
          }
        } catch (error) {
          console.error('Failed to update keybinding:', error);
        }
      }
    }),
    {
      name: 'kimi-assistant-settings'
    }
  )
);
