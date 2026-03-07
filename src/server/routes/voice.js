// 统一语音路由 - 处理 TTS/STT 相关 API
import { Router } from 'express';
import WebSocket from 'ws';
import crypto from 'crypto';
import { getVolcanoTTSService } from '../services/tts/VolcanoTTSService.js';

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


// 火山引擎 TTS - 使用 VolcanoTTSService
async function synthesizeVolcano(text, voice, speed) {
  const ttsService = getVolcanoTTSService({
    voice: voice || 'BV001_streaming'
  });
  
  const result = await ttsService.synthesize(text, { voice, speed });
  return result.audioData;
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
