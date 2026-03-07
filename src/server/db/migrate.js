import { query, testConnection } from './index.js';

const migrations = [
  {
    version: 1,
    name: 'Create initial tables',
    sql: `
      -- 项目表（最近打开的项目）
      CREATE TABLE IF NOT EXISTS projects (
        id SERIAL PRIMARY KEY,
        path VARCHAR(2048) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        icon VARCHAR(50) DEFAULT '📁',
        last_opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        opened_count INTEGER DEFAULT 1,
        is_pinned BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_projects_last_opened ON projects(last_opened_at DESC);
      CREATE INDEX IF NOT EXISTS idx_projects_pinned ON projects(is_pinned DESC, last_opened_at DESC);

      -- 会话表（每个项目的对话会话）
      CREATE TABLE IF NOT EXISTS sessions (
        id SERIAL PRIMARY KEY,
        project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
        name VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        message_count INTEGER DEFAULT 0,
        is_archived BOOLEAN DEFAULT FALSE
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);

      -- 消息表
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
        role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        token_count INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);

      -- 文件变更记录（用于 Diff 展示）
      CREATE TABLE IF NOT EXISTS file_changes (
        id SERIAL PRIMARY KEY,
        session_id INTEGER REFERENCES sessions(id),
        file_path TEXT NOT NULL,
        original_content TEXT,
        proposed_content TEXT,
        diff_content TEXT,
        status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'rejected')),
        applied_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_file_changes_session ON file_changes(session_id);

      -- 用户设置（单用户模式，只有一条记录）
      CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        theme VARCHAR(20) DEFAULT 'system',
        font_size INTEGER DEFAULT 14,
        tab_size INTEGER DEFAULT 2,
        word_wrap BOOLEAN DEFAULT TRUE,
        minimap_enabled BOOLEAN DEFAULT TRUE,
        auto_save BOOLEAN DEFAULT TRUE,
        auto_save_delay INTEGER DEFAULT 1000,
        voice_enabled BOOLEAN DEFAULT TRUE,
        voice_input_device VARCHAR(255),
        voice_output_device VARCHAR(255),
        voice_language VARCHAR(10) DEFAULT 'zh-CN',
        voice_speed REAL DEFAULT 1.0,
        default_model VARCHAR(50) DEFAULT 'kimi-latest',
        context_window INTEGER DEFAULT 10,
        root_directory VARCHAR(2048) DEFAULT '/path/to/your/code',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- 插入默认设置
      INSERT INTO settings (id) VALUES (1) ON CONFLICT DO NOTHING;

      -- 快捷键配置
      CREATE TABLE IF NOT EXISTS keybindings (
        command VARCHAR(100) PRIMARY KEY,
        keybinding VARCHAR(100) NOT NULL
      );

      -- 插入默认快捷键
      INSERT INTO keybindings (command, keybinding) VALUES
        ('file.quickOpen', 'Ctrl+P'),
        ('file.save', 'Ctrl+S'),
        ('edit.search', 'Ctrl+Shift+F'),
        ('ai.focusChat', 'Ctrl+L'),
        ('ai.voiceToggle', 'Ctrl+M'),
        ('view.toggleSidebar', 'Ctrl+B'),
        ('view.togglePanel', 'Ctrl+J'),
        ('git.commit', 'Ctrl+Enter')
      ON CONFLICT DO NOTHING;
    `
  },
  {
    version: 2,
    name: 'Add voice settings fields',
    sql: `
      -- 添加 TTS 和 VAD 设置字段
      ALTER TABLE settings 
        ADD COLUMN IF NOT EXISTS tts_engine VARCHAR(20) DEFAULT 'volcano',
        ADD COLUMN IF NOT EXISTS tts_voice VARCHAR(50) DEFAULT 'BV001_streaming',
        ADD COLUMN IF NOT EXISTS vad_threshold REAL DEFAULT 0.025,
        ADD COLUMN IF NOT EXISTS vad_silence_timeout INTEGER DEFAULT 2000;
    `
  }
];

async function runMigrations() {
  console.log('🔄 Running database migrations...\n');
  
  // 测试连接
  const connected = await testConnection();
  if (!connected) {
    process.exit(1);
  }

  // 创建迁移记录表
  await query(`
    CREATE TABLE IF NOT EXISTS migrations (
      version INTEGER PRIMARY KEY,
      name VARCHAR(255),
      executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 获取已执行的迁移
  const { rows: executedMigrations } = await query(
    'SELECT version FROM migrations ORDER BY version'
  );
  const executedVersions = new Set(executedMigrations.map(m => m.version));

  // 执行未执行的迁移
  for (const migration of migrations) {
    if (executedVersions.has(migration.version)) {
      console.log(`  ✓ Migration ${migration.version}: ${migration.name} (already executed)`);
      continue;
    }

    console.log(`  → Executing migration ${migration.version}: ${migration.name}`);
    
    try {
      await query(migration.sql);
      await query(
        'INSERT INTO migrations (version, name) VALUES ($1, $2)',
        [migration.version, migration.name]
      );
      console.log(`  ✓ Migration ${migration.version} completed`);
    } catch (err) {
      console.error(`  ✗ Migration ${migration.version} failed:`, err.message);
      process.exit(1);
    }
  }

  console.log('\n✅ All migrations completed successfully!');
  process.exit(0);
}

runMigrations();
