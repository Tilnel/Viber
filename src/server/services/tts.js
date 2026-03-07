// Edge TTS 服务 - 使用 edge-tts 库
import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 语音列表
export const VOICES = [
  { name: 'zh-CN-XiaoxiaoNeural', desc: '晓晓 (女声，自然)', default: true },
  { name: 'zh-CN-YunxiNeural', desc: '云希 (男声，自然)' },
  { name: 'zh-CN-YunjianNeural', desc: '云健 (男声，新闻)' },
  { name: 'zh-CN-XiaoyiNeural', desc: '晓伊 (女声，温柔)' },
  { name: 'zh-CN-YunyangNeural', desc: '云扬 (男声，新闻)' },
  { name: 'zh-CN-XiaochenNeural', desc: '晓晨 (女声，活泼)' },
  { name: 'zh-CN-XiaohanNeural', desc: '晓涵 (女声，温柔)' },
  { name: 'zh-CN-XiaomengNeural', desc: '晓梦 (女声，甜美)' },
  { name: 'zh-CN-XiaomoNeural', desc: '晓墨 (女声，知性)' },
  { name: 'zh-CN-XiaoqiuNeural', desc: '晓秋 (女声，成熟)' },
  { name: 'zh-CN-XiaoruiNeural', desc: '晓睿 (女声，专业)' },
  { name: 'zh-CN-XiaoshuangNeural', desc: '晓双 (女声，可爱)' },
  { name: 'zh-CN-XiaoxuanNeural', desc: '晓萱 (女声，温柔)' },
  { name: 'zh-CN-XiaoyanNeural', desc: '晓妍 (女声，标准)' },
  { name: 'zh-CN-XiaoyouNeural', desc: '晓悠 (女声，童声)' },
  { name: 'zh-CN-XiaozhenNeural', desc: '晓甄 (女声，成熟)' },
  { name: 'zh-HK-HiuMaanNeural', desc: '晓曼 (粤语女声)' },
  { name: 'zh-HK-WanLungNeural', desc: '云龙 (粤语男声)' },
  { name: 'zh-TW-HsiaoChenNeural', desc: '晓臻 (台湾女声)' },
  { name: 'zh-TW-YunJheNeural', desc: '云哲 (台湾男声)' },
];

/**
 * 使用 edge-tts 命令行工具合成语音
 * @param {string} text - 要合成的文本
 * @param {string} voice - 语音名称
 * @param {string} rate - 语速 (-50% 到 +50%)
 * @param {string} volume - 音量
 * @param {string} pitch - 音调
 * @returns {Promise<Buffer>} - 音频数据
 */
export async function synthesizeSpeech(text, voice = 'zh-CN-XiaoxiaoNeural', rate = '+0%', volume = '+0%', pitch = '+0Hz') {
  // 限制文本长度
  const MAX_LENGTH = 3000;
  if (text.length > MAX_LENGTH) {
    throw new Error(`Text too long (max ${MAX_LENGTH} chars)`);
  }

  // 生成临时文件名
  const tempFile = join(tmpdir(), `tts-${randomUUID()}.mp3`);
  
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    console.log('[TTS] Starting synthesis:', text.substring(0, 50) + '...');
    
    // 构建 edge-tts 命令参数
    const args = [
      '--voice', voice,
      '--text', text,
      '--write-media', tempFile,
      '--rate', rate,
      '--volume', volume,
    ];
    
    // 使用 npx 运行 edge-tts
    const process = spawn('npx', ['edge-tts', ...args], {
      timeout: 30000, // 30秒超时
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    });
    
    let stderr = '';
    
    process.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    process.on('close', async (code) => {
      const duration = Date.now() - startTime;
      
      if (code !== 0) {
        console.error('[TTS] Process failed:', code, stderr);
        // 清理临时文件
        try { await fs.unlink(tempFile); } catch {}
        reject(new Error(`TTS process failed: ${stderr || 'Unknown error'}`));
        return;
      }
      
      try {
        // 读取生成的音频文件
        const audioBuffer = await fs.readFile(tempFile);
        console.log(`[TTS] Success: ${audioBuffer.length} bytes in ${duration}ms`);
        
        // 清理临时文件
        await fs.unlink(tempFile);
        
        resolve(audioBuffer);
      } catch (error) {
        console.error('[TTS] Error reading output:', error);
        // 清理临时文件
        try { await fs.unlink(tempFile); } catch {}
        reject(error);
      }
    });
    
    process.on('error', (error) => {
      console.error('[TTS] Process error:', error);
      reject(error);
    });
  });
}

/**
 * 带重试的语音合成
 */
export async function synthesizeWithRetry(text, voice, rate, volume, pitch, retries = 2) {
  let lastError;
  
  for (let i = 0; i < retries; i++) {
    try {
      // 简单限流
      if (i > 0) {
        await new Promise(r => setTimeout(r, 500 * i));
      }
      
      return await synthesizeSpeech(text, voice, rate, volume, pitch);
    } catch (error) {
      lastError = error;
      console.error(`[TTS] Attempt ${i + 1} failed:`, error.message);
      
      // 不是可重试的错误，直接抛出
      if (error.message.includes('too long') || error.message.includes('ENOENT')) {
        throw error;
      }
    }
  }
  
  throw lastError;
}
