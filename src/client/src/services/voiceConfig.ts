// 语音服务配置
// 支持火山引擎 TTS/STT 和 Piper TTS

import { Voice } from './volcanoTTS';
import { useSettingsStore } from '../stores/settings';

export type TTSEngine = 'volcano' | 'piper' | 'browser';
export type STTEngine = 'volcano' | 'browser';

export interface VoiceConfig {
  // TTS 配置
  ttsEngine: TTSEngine;
  ttsVoice: string;
  ttsSpeed: number;
  ttsVolume: number;

  // STT 配置
  sttEngine: STTEngine;

  // VAD 配置
  silenceThreshold: number;
  silenceTimeout: number;
  minSpeechDuration: number;

  // 自动朗读 AI 回复（打字输入时也生效）
  autoSpeakAIResponse: boolean;
}

// 默认配置
export const defaultVoiceConfig: VoiceConfig = {
  ttsEngine: 'volcano',
  ttsVoice: 'BV001_streaming',
  ttsSpeed: 1.0,
  ttsVolume: 1.0,

  sttEngine: 'volcano',

  silenceThreshold: 0.015,
  silenceTimeout: 1500,  // 1.5秒静音才认为说话结束（原来800ms太灵敏）
  minSpeechDuration: 150,

  autoSpeakAIResponse: true, // 默认开启自动朗读
};

// 火山引擎音色列表 - 官方音色ID
// 参考: https://www.volcengine.com/docs/6561/97465
export const volcanoVoices: Voice[] = [
  // ===== 通用场景 =====
  { id: 'BV700_V2_streaming', name: '灿灿 2.0', category: '通用场景', desc: '22种情感/风格：通用、愉悦、抱歉、嗔怪、开心、愤怒、惊讶、厌恶、悲伤、害怕、哭腔、客服、专业、严肃、傲娇、安慰鼓励、绿茶、娇媚、情感电台、撒娇、瑜伽、讲故事' },
  { id: 'BV705_streaming', name: '炀炀', category: '通用场景', desc: '通用、自然对话、愉悦、抱歉、嗔怪、安慰鼓励、讲故事' },
  { id: 'BV701_V2_streaming', name: '擎苍 2.0', category: '通用场景', desc: '10种情感：旁白-舒缓、旁白-沉浸、平和、开心、悲伤、生气、害怕、厌恶、惊讶、哭腔' },
  { id: 'BV001_V2_streaming', name: '通用女声 2.0', category: '通用场景', desc: '通用女声2.0' },
  { id: 'BV700_streaming', name: '灿灿', category: '通用场景', desc: '22种情感，支持中/英/日/葡/西/印尼语' },
  { id: 'BV406_V2_streaming', name: '超自然音色-梓梓2.0', category: '通用场景', desc: '超自然音色梓梓2.0' },
  { id: 'BV406_streaming', name: '超自然音色-梓梓', category: '通用场景', desc: '7种情感：通用、开心、悲伤、生气、害怕、厌恶、惊讶' },
  { id: 'BV407_V2_streaming', name: '超自然音色-燃燃2.0', category: '通用场景', desc: '超自然音色燃燃2.0' },
  { id: 'BV407_streaming', name: '超自然音色-燃燃', category: '通用场景', desc: '超自然音色燃燃' },
  { id: 'BV001_streaming', name: '通用女声', category: '通用场景', desc: '12种情感：通用、开心、悲伤、生气、害怕、厌恶、惊讶、助手、客服、安慰鼓励、广告、讲故事' },
  { id: 'BV002_streaming', name: '通用男声', category: '通用场景', desc: '通用男声' },
  
  // ===== 有声阅读 =====
  { id: 'BV701_streaming', name: '擎苍', category: '有声阅读', desc: '10种情感：旁白-舒缓、旁白-沉浸、平和、开心、悲伤、生气、害怕、厌恶、惊讶、哭腔' },
  { id: 'BV123_streaming', name: '阳光青年', category: '有声阅读', desc: '7种情感：平和、开心、悲伤、生气、害怕、厌恶、惊讶' },
  { id: 'BV120_streaming', name: '反卷青年', category: '有声阅读', desc: '7种情感：平和、开心、悲伤、生气、害怕、厌恶、惊讶' },
  { id: 'BV119_streaming', name: '通用赘婿', category: '有声阅读', desc: '8种情感：旁白、平和、开心、悲伤、生气、害怕、厌恶、惊讶' },
  { id: 'BV115_streaming', name: '古风少御', category: '有声阅读', desc: '8种情感：旁白、平和、开心、悲伤、生气、害怕、厌恶、惊讶' },
  { id: 'BV107_streaming', name: '霸气青叔', category: '有声阅读', desc: '8种情感：旁白、平和、开心、悲伤、生气、害怕、厌恶、惊讶' },
  { id: 'BV100_streaming', name: '质朴青年', category: '有声阅读', desc: '8种情感：旁白、平和、开心、悲伤、生气、害怕、厌恶、惊讶' },
  { id: 'BV104_streaming', name: '温柔淑女', category: '有声阅读', desc: '8种情感：旁白、平和、开心、悲伤、生气、害怕、厌恶、惊讶' },
  { id: 'BV004_streaming', name: '开朗青年', category: '有声阅读', desc: '8种情感：旁白、平和、开心、悲伤、生气、害怕、厌恶、惊讶' },
  { id: 'BV113_streaming', name: '甜宠少御', category: '有声阅读', desc: '8种情感：旁白、平和、开心、悲伤、生气、害怕、厌恶、惊讶' },
  { id: 'BV102_streaming', name: '儒雅青年', category: '有声阅读', desc: '8种情感：旁白、平和、开心、悲伤、生气、害怕、厌恶、惊讶' },
  
  // ===== 智能助手 =====
  { id: 'BV405_streaming', name: '甜美小源', category: '智能助手', desc: '5种情感：通用、愉悦、抱歉、专业、严肃（详见：BV421天才少女）' },
  { id: 'BV007_streaming', name: '亲切女声', category: '智能助手', desc: '亲切女声' },
  { id: 'BV009_streaming', name: '知性女声', category: '智能助手', desc: '5种情感：通用、愉悦、抱歉、专业、严肃' },
  { id: 'BV419_streaming', name: '诚诚', category: '智能助手', desc: '诚诚' },
  { id: 'BV415_streaming', name: '童童', category: '智能助手', desc: '童童' },
  { id: 'BV008_streaming', name: '亲切男声', category: '智能助手', desc: '5种情感：通用、愉悦、抱歉、专业、严肃' },
  
  // ===== 视频配音 =====
  { id: 'BV408_streaming', name: '译制片男声', category: '视频配音', desc: '译制片男声' },
  { id: 'BV426_streaming', name: '懒小羊', category: '视频配音', desc: '懒小羊' },
  { id: 'BV428_streaming', name: '清新文艺女声', category: '视频配音', desc: '清新文艺女声' },
  { id: 'BV403_streaming', name: '鸡汤女声', category: '视频配音', desc: '鸡汤女声' },
  { id: 'BV158_streaming', name: '智慧老者', category: '视频配音', desc: '智慧老者' },
  { id: 'BV157_streaming', name: '慈爱姥姥', category: '视频配音', desc: '慈爱姥姥' },
  { id: 'BR001_streaming', name: '说唱小哥', category: '视频配音', desc: '说唱小哥' },
  { id: 'BV410_streaming', name: '活力解说男', category: '视频配音', desc: '活力解说男' },
  { id: 'BV411_streaming', name: '影视解说小帅', category: '视频配音', desc: '影视解说小帅' },
  { id: 'BV437_streaming', name: '解说小帅-多情感', category: '视频配音', desc: '7种情感：通用、开心、悲伤、生气、害怕、厌恶、惊讶' },
  { id: 'BV412_streaming', name: '影视解说小美', category: '视频配音', desc: '影视解说小美' },
  { id: 'BV159_streaming', name: '纨绔青年', category: '视频配音', desc: '纨绔青年' },
  { id: 'BV418_streaming', name: '直播一姐', category: '视频配音', desc: '直播一姐' },
  { id: 'BV142_streaming', name: '沉稳解说男', category: '视频配音', desc: '沉稳解说男' },
  { id: 'BV143_streaming', name: '潇洒青年', category: '视频配音', desc: '潇洒青年' },
  { id: 'BV056_streaming', name: '阳光男声', category: '视频配音', desc: '阳光男声' },
  { id: 'BV005_streaming', name: '活泼女声', category: '视频配音', desc: '活泼女声' },
  { id: 'BV064_streaming', name: '小萝莉', category: '视频配音', desc: '7种情感：通用、开心、悲伤、生气、害怕、厌恶、惊讶' },
  
  // ===== 特色音色 =====
  { id: 'BV051_streaming', name: '奶气萌娃', category: '特色音色', desc: '奶气萌娃' },
  { id: 'BV063_streaming', name: '动漫海绵', category: '特色音色', desc: '动漫海绵' },
  { id: 'BV417_streaming', name: '动漫海星', category: '特色音色', desc: '动漫海星' },
  { id: 'BV050_streaming', name: '动漫小新', category: '特色音色', desc: '动漫小新' },
  { id: 'BV061_streaming', name: '天才童声', category: '特色音色', desc: '天才童声' },
  
  // ===== 广告配音 =====
  { id: 'BV401_streaming', name: '促销男声', category: '广告配音', desc: '促销男声' },
  { id: 'BV402_streaming', name: '促销女声', category: '广告配音', desc: '促销女声' },
  { id: 'BV006_streaming', name: '磁性男声', category: '广告配音', desc: '磁性男声' },
  
  // ===== 新闻播报 =====
  { id: 'BV011_streaming', name: '新闻女声', category: '新闻播报', desc: '新闻女声' },
  { id: 'BV012_streaming', name: '新闻男声', category: '新闻播报', desc: '新闻男声' },
  
  // ===== 教育场景 =====
  { id: 'BV034_streaming', name: '知性姐姐-双语', category: '教育场景', desc: '知性姐姐-双语' },
  { id: 'BV033_streaming', name: '温柔小哥', category: '教育场景', desc: '温柔小哥' },
];

// Piper 音色（本地）
export const piperVoices: Voice[] = [
  { id: 'zh_CN-huayan-medium', name: '华妍（中速）', desc: '本地中文女声' },
];

// 浏览器语音（备用）
export const browserVoices: Voice[] = [
  { id: 'zh-CN', name: '浏览器默认', desc: '系统语音' },
];

// 获取当前可用的音色列表
export function getAvailableVoices(ttsEngine: TTSEngine): Voice[] {
  switch (ttsEngine) {
    case 'volcano':
      return volcanoVoices;
    case 'piper':
      return piperVoices;
    case 'browser':
      return browserVoices;
    default:
      return volcanoVoices;
  }
}

// 本地存储键 (兼容旧版本)
const STORAGE_KEY = 'kimi-voice-config';

// 从 Settings Store 加载配置
export function loadVoiceConfig(): VoiceConfig {
  try {
    // 优先从 Settings Store 获取
    const settingsStore = useSettingsStore.getState?.();
    if (settingsStore?.settings) {
      const { settings } = settingsStore;
      return {
        ...defaultVoiceConfig,
        ttsEngine: settings.ttsEngine || defaultVoiceConfig.ttsEngine,
        ttsVoice: settings.ttsVoice || defaultVoiceConfig.ttsVoice,
        ttsSpeed: settings.voiceSpeed || defaultVoiceConfig.ttsSpeed,
        silenceThreshold: settings.vadThreshold || defaultVoiceConfig.silenceThreshold,
        silenceTimeout: settings.vadSilenceTimeout || defaultVoiceConfig.silenceTimeout,
      };
    }
    
    // 回退到本地存储 (兼容旧版本)
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return { ...defaultVoiceConfig, ...parsed };
    }
  } catch {
    // 忽略解析错误
  }
  return { ...defaultVoiceConfig };
}

// 保存配置 (现在保存到 Settings Store)
export function saveVoiceConfig(config: VoiceConfig): void {
  try {
    const settingsStore = useSettingsStore.getState?.();
    if (settingsStore?.updateSettings) {
      settingsStore.updateSettings({
        ttsEngine: config.ttsEngine,
        ttsVoice: config.ttsVoice,
        voiceSpeed: config.ttsSpeed,
        vadThreshold: config.silenceThreshold,
        vadSilenceTimeout: config.silenceTimeout,
      });
    } else {
      // 回退到本地存储
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    }
  } catch {
    // 忽略存储错误
  }
}

// 检测火山引擎是否可用
export async function checkVolcanoAvailable(): Promise<boolean> {
  try {
    const response = await fetch('/api/volcano/stt/status');
    const data = await response.json();
    return data.available;
  } catch {
    return false;
  }
}

// 自动选择最佳引擎
export async function autoSelectEngine(): Promise<{ tts: TTSEngine; stt: STTEngine }> {
  const volcanoAvailable = await checkVolcanoAvailable();

  if (volcanoAvailable) {
    return { tts: 'volcano', stt: 'volcano' };
  }

  // 检测浏览器 STT
  const browserSTTAvailable = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;

  return {
    tts: 'piper', // 回退到 Piper
    stt: browserSTTAvailable ? 'browser' : 'volcano',
  };
}
