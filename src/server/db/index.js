import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'kimi_assistant',
  password: process.env.DB_PASSWORD || 'haruhikage',
  port: parseInt(process.env.DB_PORT || '5432'),
});

// 测试连接
pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err);
});

export async function testConnection() {
  try {
    const result = await pool.query('SELECT NOW()');
    console.log('✅ PostgreSQL connected:', result.rows[0].now);
    return true;
  } catch (err) {
    console.error('❌ PostgreSQL connection failed:', err.message);
    console.log('\n💡 提示: 如果需要配置 PostgreSQL 访问，请运行以下命令:');
    console.log('   sudo -u postgres psql -c "ALTER USER postgres WITH PASSWORD \'haruhikage\';"');
    console.log('   sudo -u postgres psql -c "CREATE DATABASE kimi_assistant;"');
    console.log('   sudo nano /etc/postgresql/*/main/pg_hba.conf  # 改为 md5 认证');
    console.log('   sudo systemctl restart postgresql');
    return false;
  }
}

export async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log('Executed query', { text: text.substring(0, 50), duration, rows: result.rowCount });
    return result;
  } catch (err) {
    console.error('Query error:', err);
    throw err;
  }
}

export async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export { pool };
