import { Router } from 'express';
import { query } from '../db/index.js';
import { pathSecurity } from '../utils/pathSecurity.js';

const router = Router();

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
      settings: settings || {},
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
    const allowedFields = [
      'theme', 'font_size', 'tab_size', 'word_wrap',
      'minimap_enabled', 'auto_save', 'auto_save_delay',
      'voice_enabled', 'voice_input_device', 'voice_output_device',
      'voice_language', 'voice_speed', 'default_model', 'context_window',
      'root_directory'
    ];
    
    const fields = [];
    const values = [];
    let paramIndex = 1;
    
    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        fields.push(`${key} = $${paramIndex++}`);
        values.push(value);
      }
    }
    
    if (fields.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }
    
    fields.push(`updated_at = CURRENT_TIMESTAMP`);
    
    const { rows } = await query(`
      UPDATE settings 
      SET ${fields.join(', ')}
      WHERE id = 1
      RETURNING *
    `, values);
    
    // 如果更新了根目录，更新 pathSecurity
    if (updates.root_directory) {
      pathSecurity.setRootDir(updates.root_directory);
    }
    
    res.json({ settings: rows[0] });
  } catch (err) {
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
