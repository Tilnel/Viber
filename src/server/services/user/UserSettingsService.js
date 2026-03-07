/**
 * User Settings Service
 * 用户设置服务 - 管理 TTS 等用户级配置
 * 
 * @phase 5
 */

import { query } from '../../db/index.js';

// 默认配置
const DEFAULT_SETTINGS = {
  ttsEngine: 'volcano',
  ttsVoice: 'BV001_streaming',
  ttsSpeed: 1.0,
  ttsVolume: 1.0,
  autoSpeakAIResponse: true
};

/**
 * 获取用户设置
 */
export async function getUserSettings(userId) {
  try {
    const { rows } = await query(`
      SELECT tts_engine, tts_voice, tts_speed, tts_volume, auto_speak_ai_response
      FROM user_settings
      WHERE user_id = $1
    `, [userId]);
    
    if (rows.length > 0) {
      const row = rows[0];
      return {
        ttsEngine: row.tts_engine,
        ttsVoice: row.tts_voice,
        ttsSpeed: parseFloat(row.tts_speed),
        ttsVolume: parseFloat(row.tts_volume),
        autoSpeakAIResponse: row.auto_speak_ai_response
      };
    }
    
    // 没有设置，创建默认
    await createDefaultSettings(userId);
    return { ...DEFAULT_SETTINGS };
  } catch (error) {
    console.error('[UserSettingsService] getUserSettings error:', error);
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * 创建默认设置
 */
async function createDefaultSettings(userId) {
  try {
    await query(`
      INSERT INTO user_settings (user_id, tts_engine, tts_voice, tts_speed, tts_volume, auto_speak_ai_response)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (user_id) DO NOTHING
    `, [
      userId,
      DEFAULT_SETTINGS.ttsEngine,
      DEFAULT_SETTINGS.ttsVoice,
      DEFAULT_SETTINGS.ttsSpeed,
      DEFAULT_SETTINGS.ttsVolume,
      DEFAULT_SETTINGS.autoSpeakAIResponse
    ]);
  } catch (error) {
    console.error('[UserSettingsService] createDefaultSettings error:', error);
  }
}

/**
 * 更新用户设置
 */
export async function updateUserSettings(userId, settings) {
  try {
    const updates = [];
    const values = [];
    let paramIndex = 1;
    
    if (settings.ttsEngine !== undefined) {
      updates.push(`tts_engine = $${paramIndex++}`);
      values.push(settings.ttsEngine);
    }
    if (settings.ttsVoice !== undefined) {
      updates.push(`tts_voice = $${paramIndex++}`);
      values.push(settings.ttsVoice);
    }
    if (settings.ttsSpeed !== undefined) {
      updates.push(`tts_speed = $${paramIndex++}`);
      values.push(settings.ttsSpeed);
    }
    if (settings.ttsVolume !== undefined) {
      updates.push(`tts_volume = $${paramIndex++}`);
      values.push(settings.ttsVolume);
    }
    if (settings.autoSpeakAIResponse !== undefined) {
      updates.push(`auto_speak_ai_response = $${paramIndex++}`);
      values.push(settings.autoSpeakAIResponse);
    }
    
    if (updates.length === 0) {
      return { success: true, message: 'No changes' };
    }
    
    values.push(userId);
    
    await query(`
      INSERT INTO user_settings (user_id, tts_engine, tts_voice, tts_speed, tts_volume, auto_speak_ai_response)
      VALUES ($${paramIndex}, $1, $2, $3, $4, $5)
      ON CONFLICT (user_id) DO UPDATE SET
        ${updates.join(', ')},
        updated_at = CURRENT_TIMESTAMP
    `, values);
    
    return { success: true };
  } catch (error) {
    console.error('[UserSettingsService] updateUserSettings error:', error);
    throw error;
  }
}

/**
 * 获取用户 TTS 配置（简化版）
 */
export async function getUserTTSConfig(userId) {
  const settings = await getUserSettings(userId);
  return {
    voice: settings.ttsVoice,
    speed: settings.ttsSpeed,
    volume: settings.ttsVolume,
    engine: settings.ttsEngine,
    autoSpeak: settings.autoSpeakAIResponse
  };
}

export default {
  getUserSettings,
  updateUserSettings,
  getUserTTSConfig
};
