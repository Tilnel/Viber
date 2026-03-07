// 统一语音路由 - 处理 TTS/STT 相关 API
import { Router } from 'express';
import WebSocket from 'ws';
import crypto from 'crypto';

const router = Router();

// ============================================
// TTS 合成 - 支持多引擎
// ============================================

// 火山引擎配置
const VOLCANO_CONFIG = {
  APPID: process.env.VOLCANO_APP_ID,
  TOKEN: process.env.VOLCANO_ACCESS_TOKEN,
  DEFAULT_VOICE: 'BV001_streaming'
};

function checkVolcanoConfig() {
  if (!VOLCANO_CONFIG.APPID || !VOLCANO_CONFIG.TOKEN) {
    return { valid: false, error: '火山引擎未配置' };
  }
  return { valid: true };
}

// Edge TTS 配置
const EDGE_TTS_ENDPOINT = 'southeastasia.api.speech.microsoft.com';
const EDGE_TTS_PATH = '/accfreetrial/texttospeech/acc/v3.0-beta1/vcg/speak';

// 火山引擎 TTS
async function synthesizeVolcano(text, voice, speed) {
  return new Promise((resolve, reject) => {
    const audioChunks = [];
    let isCompleted = false;

    // 构建二进制请求
    const configText = JSON.stringify({
      app: { appid: VOLCANO_CONFIG.APPID, token: VOLCANO_CONFIG.TOKEN, cluster: 'volcano_tts' },
      user: { uid: `user_${Date.now()}` },
      audio: { voice_type: voice, encoding: 'mp3', speed_ratio: speed },
      request: { reqid: crypto.randomUUID(), text, text_type: 'plain', operation: 'submit' }
    });

    const configBinary = Buffer.from(configText, 'utf8');
    const header = Buffer.alloc(4);
    header.writeUInt8(0x11, 0);
    header.writeUInt8(0x10, 1);
    header.writeUInt8(0x10, 2);
    header.writeUInt8(0x00, 3);
    const lengthBuffer = Buffer.alloc(4);
    lengthBuffer.writeUInt32BE(configBinary.length, 0);
    const requestBuffer = Buffer.concat([header, lengthBuffer, configBinary]);

    const wsUrl = `wss://openspeech.bytedance.com/api/v1/tts/ws_binary?appid=${VOLCANO_CONFIG.APPID}`;
    const ws = new WebSocket(wsUrl, {
      headers: { 'Authorization': `Bearer;${VOLCANO_CONFIG.TOKEN}` },
      skipUTF8Validation: true,
    });

    ws.on('open', () => {
      ws.send(requestBuffer);
    });

    ws.on('message', (data) => {
      if (!Buffer.isBuffer(data) || data.length < 8) return;
      
      const seqSigned = data.readInt32BE(4);
      const msgType = (data[1] >> 4) & 0x0f;
      const isLast = seqSigned < 0;
      
      if (msgType === 0x0f) {
        reject(new Error('TTS服务器错误'));
        ws.close();
      } else if (msgType === 0x0b || msgType === 0x00) {
        const audioData = data.slice(8);
        if (audioData.length > 0) {
          audioChunks.push(audioData);
        }
        if (isLast) {
          ws.close();
        }
      }
    });

    ws.on('close', () => {
      if (!isCompleted) {
        isCompleted = true;
        if (audioChunks.length > 0) {
          resolve(Buffer.concat(audioChunks));
        } else {
          reject(new Error('未收到音频数据'));
        }
      }
    });

    ws.on('error', (err) => {
      if (!isCompleted) {
        isCompleted = true;
        reject(err);
      }
    });

    setTimeout(() => {
      if (!isCompleted) {
        ws.close();
        reject(new Error('TTS超时'));
      }
    }, 30000);
  });
}

// Edge TTS
async function synthesizeEdge(text, voice, speed) {
  const https = await import('https');
  
  return new Promise((resolve, reject) => {
    const rate = speed === 1.0 ? '+0%' : `${Math.round((speed - 1) * 100)}%`;
    const ssml = `<?xml version="1.0" encoding="UTF-8"?>
<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN">
  <voice name="${voice || 'zh-CN-XiaoxiaoNeural'}">
    <prosody rate="${rate}" volume="+0%" pitch="+0Hz">
      ${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}
    </prosody>
  </voice>
</speak>`;

    const options = {
      hostname: EDGE_TTS_ENDPOINT,
      path: EDGE_TTS_PATH,
      method: 'POST',
      headers: {
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
        'Accept-Encoding': 'identity',
        'Connection': 'close',
      },
    };

    const req = https.request(options, (res) => {
      if (res.statusCode !== 200) {
        let errorData = '';
        res.on('data', chunk => errorData += chunk);
        res.on('end', () => reject(new Error(`TTS API error: ${res.statusCode}`)));
        return;
      }

      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });

    req.on('error', reject);
    req.write(ssml);
    req.end();
  });
}

// 统一合成路由
router.post('/synthesize', async (req, res) => {
  try {
    const { text, engine, voice, speed = 1.0 } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    const MAX_LENGTH = 500;
    const previewText = text.length > MAX_LENGTH ? text.substring(0, MAX_LENGTH) : text;

    let audioBuffer;

    switch (engine) {
      case 'volcano': {
        const config = checkVolcanoConfig();
        if (!config.valid) {
          return res.status(503).json({ error: config.error });
        }
        audioBuffer = await synthesizeVolcano(previewText, voice || 'BV001_streaming', speed);
        break;
      }
      case 'piper': {
        return res.status(501).json({ error: 'Piper TTS 暂不支持试听' });
      }
      case 'browser':
      default: {
        // 默认使用 Edge TTS (免费，无需配置)
        audioBuffer = await synthesizeEdge(previewText, voice || 'zh-CN-XiaoxiaoNeural', speed);
        break;
      }
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', audioBuffer.length);
    res.send(audioBuffer);

  } catch (error) {
    console.error('[Voice] Synthesize error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;
