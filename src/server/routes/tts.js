// TTS 代理路由 - 解决 CORS 问题
import { Router } from 'express';
import https from 'https';

const router = Router();

// Edge TTS 配置
const EDGE_TTS_ENDPOINT = 'southeastasia.api.speech.microsoft.com';
const EDGE_TTS_PATH = '/accfreetrial/texttospeech/acc/v3.0-beta1/vcg/speak';

// 请求队列和限流
const requestQueue = [];
let isProcessing = false;
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 500; // 最小请求间隔 500ms

// 语音列表
const VOICES = [
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

// 获取语音列表
router.get('/voices', (req, res) => {
  res.json({ voices: VOICES });
});

// 睡眠函数
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 重试函数
async function fetchWithRetry(ssml, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      // 限流：确保请求间隔
      const now = Date.now();
      const timeSinceLastRequest = now - lastRequestTime;
      if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
        await sleep(MIN_REQUEST_INTERVAL - timeSinceLastRequest);
      }
      lastRequestTime = Date.now();

      const result = await doTTSRequest(ssml);
      return result;
    } catch (error) {
      console.error(`[TTS] Attempt ${i + 1} failed:`, error.message);
      
      // 429 错误增加等待时间
      if (error.message.includes('429') && i < retries - 1) {
        const waitTime = delay * (i + 1);
        console.log(`[TTS] Rate limited, waiting ${waitTime}ms...`);
        await sleep(waitTime);
      } else {
        throw error;
      }
    }
  }
  throw new Error('Max retries reached');
}

// 实际 TTS 请求
function doTTSRequest(ssml) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: EDGE_TTS_ENDPOINT,
      path: EDGE_TTS_PATH,
      method: 'POST',
      headers: {
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
        'Accept': '*/*',
        'Accept-Encoding': 'identity',
        'Connection': 'close',
      },
    };

    const ttsReq = https.request(options, (ttsRes) => {
      if (ttsRes.statusCode !== 200) {
        let errorData = '';
        ttsRes.on('data', chunk => errorData += chunk);
        ttsRes.on('end', () => {
          console.error('[TTS] API error:', ttsRes.statusCode, errorData.substring(0, 200));
          reject(new Error(`TTS API error: ${ttsRes.statusCode}`));
        });
        return;
      }

      const chunks = [];
      ttsRes.on('data', chunk => chunks.push(chunk));
      ttsRes.on('end', () => {
        const buffer = Buffer.concat(chunks);
        console.log('[TTS] Received audio:', buffer.length, 'bytes');
        resolve(buffer);
      });
    });

    ttsReq.on('error', (error) => {
      console.error('[TTS] Request error:', error);
      reject(error);
    });

    ttsReq.write(ssml);
    ttsReq.end();
  });
}

// 语音合成代理
router.post('/synthesize', async (req, res) => {
  try {
    const { text, voice = 'zh-CN-XiaoxiaoNeural', rate = '+20%', volume = '+0%', pitch = '+0Hz' } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    // 限制文本长度
    const MAX_LENGTH = 3000;
    if (text.length > MAX_LENGTH) {
      return res.status(400).json({ error: `Text too long (max ${MAX_LENGTH} chars)` });
    }

    // 构建 SSML
    const ssml = `<?xml version="1.0" encoding="UTF-8"?>
<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN">
  <voice name="${voice}">
    <prosody rate="${rate}" volume="${volume}" pitch="${pitch}">
      ${escapeXml(text)}
    </prosody>
  </voice>
</speak>`;

    console.log('[TTS] Synthesizing:', text.substring(0, 50) + '...');

    // 使用重试机制
    const audioBuffer = await fetchWithRetry(ssml);

    // 设置响应头并返回音频
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', audioBuffer.length);
    res.send(audioBuffer);

  } catch (error) {
    console.error('[TTS] Error:', error);
    
    // 返回合适的错误码
    if (error.message.includes('429')) {
      res.status(429).json({ error: 'Rate limited', message: 'Too many requests, please try again later' });
    } else {
      res.status(500).json({ error: 'TTS synthesis failed', message: error.message });
    }
  }
});

function escapeXml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export default router;
