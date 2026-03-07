-- TTS 配置表（用户级）
CREATE TABLE IF NOT EXISTS user_settings (
  id SERIAL PRIMARY KEY,
  user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  tts_engine VARCHAR(20) DEFAULT 'volcano',
  tts_voice VARCHAR(50) DEFAULT 'BV001_streaming',
  tts_speed DECIMAL(3,2) DEFAULT 1.0,
  tts_volume DECIMAL(3,2) DEFAULT 1.0,
  auto_speak_ai_response BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON user_settings(user_id);

-- 插入默认设置（给现有用户）
INSERT INTO user_settings (user_id, tts_engine, tts_voice, tts_speed, auto_speak_ai_response)
SELECT id, 'volcano', 'BV001_streaming', 1.0, true FROM users
ON CONFLICT (user_id) DO NOTHING;

-- 更新触发器
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_user_settings_updated_at ON user_settings;
CREATE TRIGGER update_user_settings_updated_at
  BEFORE UPDATE ON user_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
