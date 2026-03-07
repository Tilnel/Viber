import { Router } from 'express';
import { query } from '../db/index.js';
import { pathSecurity } from '../utils/pathSecurity.js';

const router = Router();

// 数据库字段到前端字段的映射
const fieldMapping = {
  // snake_case -> camelCase
  theme: 'theme',
  font_size: 'fontSize',
  tab_size: 'tabSize',
  word_wrap: 'wordWrap',
  minimap_enabled: 'minimapEnabled',
  auto_save: 'autoSave',
  auto_save_delay: 'autoSaveDelay',
  voice_enabled: 'voiceEnabled',
  voice_input_device: 'voiceInputDevice',
  voice_output_device: 'voiceOutputDevice',
  voice_language: 'voiceLanguage',
  voice_speed: 'voiceSpeed',
  tts_engine: 'ttsEngine',
  tts_voice: 'ttsVoice',
  vad_threshold: 'vadThreshold',
  vad_silence_timeout: 'vadSilenceTimeout',
  default_model: 'defaultModel',
  context_window: 'contextWindow',
  root_directory: 'rootDirectory',
  updated_at: 'updatedAt'
};

// 前端字段到数据库字段的反向映射
const reverseFieldMapping = Object.fromEntries(
  Object.entries(fieldMapping).map(([db, front]) => [front, db])
);

// 转换数据库设置到前端格式
function convertSettingsToFrontend(dbSettings) {
  const result = {};
  for (const [dbKey, value] of Object.entries(dbSettings)) {
    const frontKey = fieldMapping[dbKey];
    if (frontKey) {
      result[frontKey] = value;
    }
  }
  return result;
}

// 获取设置
router.get('/', async (req, res, next) => {
  try {
    const { rows: [settings] } = await query(`
      SELECT * FROM settings WHERE id = 1
    `);
    
    // 获取快捷键
    const { rows: keybindings } = await query(`
      SELECT command, keybinding FROM keybindings
    `);
    
    res.json({
      settings: convertSettingsToFrontend(settings || {}),
      keybindings: keybindings.reduce((acc, { command, keybinding }) => {
        acc[command] = keybinding;
        return acc;
      }, {})
    });
  } catch (err) {
    next(err);
  }
});

// 更新设置
router.patch('/', async (req, res, next) => {
  try {
    const updates = req.body;
    console.log('[Settings] PATCH received:', updates);
    
    // 允许的数据库字段
    const allowedDbFields = [
      'theme', 'font_size', 'tab_size', 'word_wrap',
      'minimap_enabled', 'auto_save', 'auto_save_delay',
      'voice_enabled', 'voice_input_device', 'voice_output_device',
      'voice_language', 'voice_speed', 'default_model', 'context_window',
      'root_directory',
      // TTS 和 VAD 设置
      'tts_engine', 'tts_voice', 'vad_threshold', 'vad_silence_timeout'
    ];
    
    // 转换前端字段名到数据库字段名
    const dbUpdates = {};
    for (const [frontKey, value] of Object.entries(updates)) {
      const dbKey = reverseFieldMapping[frontKey] || frontKey;
      console.log(`[Settings] Mapping ${frontKey} -> ${dbKey}`);
      if (allowedDbFields.includes(dbKey)) {
        dbUpdates[dbKey] = value;
      } else {
        console.log(`[Settings] Field ${dbKey} not in allowed list`);
      }
    }
    
    console.log('[Settings] dbUpdates:', dbUpdates);
    
    const fields = [];
    const values = [];
    let paramIndex = 1;
    
    for (const [key, value] of Object.entries(dbUpdates)) {
      fields.push(`${key} = $${paramIndex++}`);
      values.push(value);
    }
    
    if (fields.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }
    
    fields.push(`updated_at = CURRENT_TIMESTAMP`);
    
    const sql = `
      UPDATE settings 
      SET ${fields.join(', ')}
      WHERE id = 1
      RETURNING *
    `;
    console.log('[Settings] SQL:', sql);
    console.log('[Settings] Values:', values);
    
    const { rows } = await query(sql, values);
    
    // 如果更新了根目录，更新 pathSecurity
    if (dbUpdates.root_directory) {
      pathSecurity.setRootDir(dbUpdates.root_directory);
    }
    
    // 返回转换后的前端格式
    res.json({ settings: convertSettingsToFrontend(rows[0]) });
  } catch (err) {
    console.error('[Settings] PATCH error:', err);
    next(err);
  }
});

// 更新快捷键
router.post('/keybindings', async (req, res, next) => {
  try {
    const { command, keybinding } = req.body;
    
    if (!command || !keybinding) {
      return res.status(400).json({ error: 'Command and keybinding are required' });
    }
    
    await query(`
      INSERT INTO keybindings (command, keybinding)
      VALUES ($1, $2)
      ON CONFLICT (command) DO UPDATE
      SET keybinding = EXCLUDED.keybinding
    `, [command, keybinding]);
    
    res.json({ success: true, command, keybinding });
  } catch (err) {
    next(err);
  }
});

// 获取可用的语音输入设备（浏览器端处理，这里返回空）
router.get('/voice/devices', async (req, res) => {
  // 语音设备由浏览器枚举，服务端只存储用户选择
  res.json({ message: 'Voice devices are enumerated on the client side' });
});

export default router;
