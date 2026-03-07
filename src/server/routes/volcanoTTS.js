// 火山引擎语音合成 (TTS) 代理 - WebSocket 二进制协议
// https://www.volcengine.com/docs/6561/79821

import { Router } from 'express';
import WebSocket from 'ws';
import crypto from 'crypto';
import { cleanTextForTTS } from '../utils/textCleaner.js';

const router = Router();

// 配置
const CONFIG = {
  APPID: process.env.VOLCANO_APP_ID,
  TOKEN: process.env.VOLCANO_ACCESS_TOKEN,
  DEFAULT_VOICE_TYPE: 'BV001_streaming',
  SPEED: 1.0,
};

function checkConfig() {
  if (!CONFIG.APPID || !CONFIG.TOKEN) {
    return { valid: false, error: '火山引擎TTS未配置' };
  }
  return { valid: true };
}

/**
 * 构建4字节Header
 */
function buildHeader() {
  const header = Buffer.alloc(4);
  header.writeUInt8(0x11, 0);
  header.writeUInt8(0x10, 1);
  header.writeUInt8(0x10, 2);
  header.writeUInt8(0x00, 3);
  return header;
}

/**
 * 封装请求: Header + 4字节长度 + JSON
 */
function packBinaryRequest(text, voiceType = CONFIG.DEFAULT_VOICE_TYPE, speed = CONFIG.SPEED) {
  const configText = JSON.stringify({
    app: { appid: CONFIG.APPID, token: CONFIG.TOKEN, cluster: 'volcano_tts' },
    user: { uid: `user_${Date.now()}` },
    audio: { voice_type: voiceType, encoding: 'mp3', speed_ratio: speed },
    request: { reqid: crypto.randomUUID(), text, text_type: 'plain', operation: 'submit' }
  });

  const configBinary = Buffer.from(configText, 'utf8');
  const header = buildHeader();
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(configBinary.length, 0);
  
  return Buffer.concat([header, lengthBuffer, configBinary]);
}

/**
 * 解析响应
 * 格式: 4字节Header + 4字节序列号(有符号) + 音频数据
 * 注意：payload字段实际是序列号，音频数据从第8字节开始到结束
 */
function parseBinaryResponse(binaryData) {
  if (binaryData.length < 8) return null;
  
  // 前4字节是header，第4-7字节是序列号（有符号，负数表示最后一个块）
  const seqSigned = binaryData.readInt32BE(4);
  const msgType = (binaryData[1] >> 4) & 0x0f;
  const isLast = seqSigned < 0;
  const seq = Math.abs(seqSigned);
  
  console.log('[VolcanoTTS] Response type:', msgType, 'seq:', seq, 'isLast:', isLast, 'total:', binaryData.length);
  
  // 错误消息 (type = 15)
  if (msgType === 0x0f) {
    const errorText = binaryData.slice(8).toString('utf8');
    console.error('[VolcanoTTS] Server error:', errorText.substring(0, 200));
    return { type: 'error' };
  }
  
  // 音频消息 (type = 11) 或空消息
  if (msgType === 0x0b || msgType === 0x00) {
    // seq = 0: 空响应
    // seq < 0: 最后一个块
    
    // 音频数据从第8字节开始到结束（整个剩余部分）
    const audioData = binaryData.slice(8);
    
    if (audioData.length > 0) {
      return { type: 'audio', data: audioData, isLast };
    }
    return { type: 'empty', isLast };
  }
  
  return { type: 'unknown' };
}

/**
 * 执行TTS合成
 */
async function synthesize(text, voice = CONFIG.DEFAULT_VOICE_TYPE, speed = 1.0) {
  return new Promise((resolve, reject) => {
    const cleanedText = cleanTextForTTS(text);
    console.log('[VolcanoTTS] Cleaned text:', cleanedText.substring(0, 100));
    
    if (!cleanedText.trim()) {
      reject(new Error('文本为空'));
      return;
    }
    const audioChunks = [];
    let isCompleted = false;

    const wsUrl = `wss://openspeech.bytedance.com/api/v1/tts/ws_binary?appid=${CONFIG.APPID}`;
    const ws = new WebSocket(wsUrl, {
      headers: { 'Authorization': `Bearer;${CONFIG.TOKEN}` },
      skipUTF8Validation: true,
    });

    ws.on('open', () => {
      ws.send(packBinaryRequest(cleanedText, voice, speed));
    });

    ws.on('message', (data) => {
      if (!Buffer.isBuffer(data)) return;
      
      const result = parseBinaryResponse(data);
      
      if (result.type === 'error') {
        reject(new Error('TTS服务器错误'));
        ws.close();
      } else if (result.type === 'audio') {
        audioChunks.push(result.data);
        console.log('[VolcanoTTS] Audio chunk:', result.data.length, 'isLast:', result.isLast);
        
        if (result.isLast) {
          ws.close();
        }
      }
    });

    ws.on('close', () => {
      if (!isCompleted) {
        isCompleted = true;
        if (audioChunks.length > 0) {
          const finalBuffer = Buffer.concat(audioChunks);
          console.log('[VolcanoTTS] Final audio:', finalBuffer.length, 'bytes');
          console.log('[VolcanoTTS] First 16 bytes:', finalBuffer.slice(0, 16).toString('hex'));
          console.log('[VolcanoTTS] Last 16 bytes:', finalBuffer.slice(-16).toString('hex'));
          resolve(finalBuffer);
        } else {
          reject(new Error('未收到音频数据'));
        }
      }
    });

    ws.on('error', (err) => {
      console.error('[VolcanoTTS] Error:', err.message);
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

// 路由
router.get('/status', (req, res) => {
  const config = checkConfig();
  res.json({ available: config.valid, error: config.error });
});

router.get('/voices', (req, res) => {
  const voices = [
    // ===== 通用场景 =====
    { id: 'BV700_V2_streaming', name: '灿灿 2.0', category: '通用场景', desc: '22种情感/风格：通用、愉悦、抱歉、嗔怪、开心、愤怒、惊讶、厌恶、悲伤、害怕、哭腔、客服、专业、严肃、傲娇、安慰鼓励、绿茶、娇媚、情感电台、撒娇、瑜伽、讲故事' },
    { id: 'BV705_streaming', name: '炀炀', category: '通用场景', desc: '通用、自然对话、愉悦、抱歉、嗔怪、安慰鼓励、讲故事' },
    { id: 'BV701_V2_streaming', name: '擎苍 2.0', category: '通用场景', desc: '10种情感：旁白-舒缓、旁白-沉浸、平和、开心、悲伤、生气、害怕、厌恶、惊讶、哭腔' },
    { id: 'BV001_V2_streaming', name: '通用女声 2.0', category: '通用场景', desc: '通用女声2.0' },
    { id: 'BV700_streaming', name: '灿灿', category: '通用场景', desc: '22种情感，支持中/英/日/葡/西/印尼语' },
    { id: 'BV406_V2_streaming', name: '超自然音色-梓梓2.0', category: '通用场景', desc: '超自然音色梓梓2.0' },
    { id: 'BV406_streaming', name: '超自然音色-梓梓', category: '通用场景', desc: '7种情感：通用、开心、悲伤、生气、害怕、厌恶、惊讶' },
    { id: 'BV407_V2_streaming', name: '超自然音色-燃燃2.0', category: '通用场景', desc: '超自然音色燃燃2.0' },
    { id: 'BV407_streaming', name: '超自然音色-燃燃', category: '通用场景', desc: '超自然音色燃燃' },
    { id: 'BV001_streaming', name: '通用女声', category: '通用场景', desc: '12种情感：通用、开心、悲伤、生气、害怕、厌恶、惊讶、助手、客服、安慰鼓励、广告、讲故事' },
    { id: 'BV002_streaming', name: '通用男声', category: '通用场景', desc: '通用男声' },
    // ===== 有声阅读 =====
    { id: 'BV701_streaming', name: '擎苍', category: '有声阅读', desc: '10种情感：旁白-舒缓、旁白-沉浸、平和、开心、悲伤、生气、害怕、厌恶、惊讶、哭腔' },
    { id: 'BV123_streaming', name: '阳光青年', category: '有声阅读', desc: '7种情感：平和、开心、悲伤、生气、害怕、厌恶、惊讶' },
    { id: 'BV120_streaming', name: '反卷青年', category: '有声阅读', desc: '7种情感：平和、开心、悲伤、生气、害怕、厌恶、惊讶' },
    { id: 'BV119_streaming', name: '通用赘婿', category: '有声阅读', desc: '8种情感：旁白、平和、开心、悲伤、生气、害怕、厌恶、惊讶' },
    { id: 'BV115_streaming', name: '古风少御', category: '有声阅读', desc: '8种情感：旁白、平和、开心、悲伤、生气、害怕、厌恶、惊讶' },
    { id: 'BV107_streaming', name: '霸气青叔', category: '有声阅读', desc: '8种情感：旁白、平和、开心、悲伤、生气、害怕、厌恶、惊讶' },
    { id: 'BV100_streaming', name: '质朴青年', category: '有声阅读', desc: '8种情感：旁白、平和、开心、悲伤、生气、害怕、厌恶、惊讶' },
    { id: 'BV104_streaming', name: '温柔淑女', category: '有声阅读', desc: '8种情感：旁白、平和、开心、悲伤、生气、害怕、厌恶、惊讶' },
    { id: 'BV004_streaming', name: '开朗青年', category: '有声阅读', desc: '8种情感：旁白、平和、开心、悲伤、生气、害怕、厌恶、惊讶' },
    { id: 'BV113_streaming', name: '甜宠少御', category: '有声阅读', desc: '8种情感：旁白、平和、开心、悲伤、生气、害怕、厌恶、惊讶' },
    { id: 'BV102_streaming', name: '儒雅青年', category: '有声阅读', desc: '8种情感：旁白、平和、开心、悲伤、生气、害怕、厌恶、惊讶' },
    // ===== 智能助手 =====
    { id: 'BV405_streaming', name: '甜美小源', category: '智能助手', desc: '5种情感：通用、愉悦、抱歉、专业、严肃（详见：BV421天才少女）' },
    { id: 'BV007_streaming', name: '亲切女声', category: '智能助手', desc: '亲切女声' },
    { id: 'BV009_streaming', name: '知性女声', category: '智能助手', desc: '5种情感：通用、愉悦、抱歉、专业、严肃' },
    { id: 'BV419_streaming', name: '诚诚', category: '智能助手', desc: '诚诚' },
    { id: 'BV415_streaming', name: '童童', category: '智能助手', desc: '童童' },
    { id: 'BV008_streaming', name: '亲切男声', category: '智能助手', desc: '5种情感：通用、愉悦、抱歉、专业、严肃' },
    // ===== 视频配音 =====
    { id: 'BV408_streaming', name: '译制片男声', category: '视频配音', desc: '译制片男声' },
    { id: 'BV426_streaming', name: '懒小羊', category: '视频配音', desc: '懒小羊' },
    { id: 'BV428_streaming', name: '清新文艺女声', category: '视频配音', desc: '清新文艺女声' },
    { id: 'BV403_streaming', name: '鸡汤女声', category: '视频配音', desc: '鸡汤女声' },
    { id: 'BV158_streaming', name: '智慧老者', category: '视频配音', desc: '智慧老者' },
    { id: 'BV157_streaming', name: '慈爱姥姥', category: '视频配音', desc: '慈爱姥姥' },
    { id: 'BR001_streaming', name: '说唱小哥', category: '视频配音', desc: '说唱小哥' },
    { id: 'BV410_streaming', name: '活力解说男', category: '视频配音', desc: '活力解说男' },
    { id: 'BV411_streaming', name: '影视解说小帅', category: '视频配音', desc: '影视解说小帅' },
    { id: 'BV437_streaming', name: '解说小帅-多情感', category: '视频配音', desc: '7种情感：通用、开心、悲伤、生气、害怕、厌恶、惊讶' },
    { id: 'BV412_streaming', name: '影视解说小美', category: '视频配音', desc: '影视解说小美' },
    { id: 'BV159_streaming', name: '纨绔青年', category: '视频配音', desc: '纨绔青年' },
    { id: 'BV418_streaming', name: '直播一姐', category: '视频配音', desc: '直播一姐' },
    { id: 'BV142_streaming', name: '沉稳解说男', category: '视频配音', desc: '沉稳解说男' },
    { id: 'BV143_streaming', name: '潇洒青年', category: '视频配音', desc: '潇洒青年' },
    { id: 'BV056_streaming', name: '阳光男声', category: '视频配音', desc: '阳光男声' },
    { id: 'BV005_streaming', name: '活泼女声', category: '视频配音', desc: '活泼女声' },
    { id: 'BV064_streaming', name: '小萝莉', category: '视频配音', desc: '7种情感：通用、开心、悲伤、生气、害怕、厌恶、惊讶' },
    // ===== 特色音色 =====
    { id: 'BV051_streaming', name: '奶气萌娃', category: '特色音色', desc: '奶气萌娃' },
    { id: 'BV063_streaming', name: '动漫海绵', category: '特色音色', desc: '动漫海绵' },
    { id: 'BV417_streaming', name: '动漫海星', category: '特色音色', desc: '动漫海星' },
    { id: 'BV050_streaming', name: '动漫小新', category: '特色音色', desc: '动漫小新' },
    { id: 'BV061_streaming', name: '天才童声', category: '特色音色', desc: '天才童声' },
    // ===== 广告配音 =====
    { id: 'BV401_streaming', name: '促销男声', category: '广告配音', desc: '促销男声' },
    { id: 'BV402_streaming', name: '促销女声', category: '广告配音', desc: '促销女声' },
    { id: 'BV006_streaming', name: '磁性男声', category: '广告配音', desc: '磁性男声' },
    // ===== 新闻播报 =====
    { id: 'BV011_streaming', name: '新闻女声', category: '新闻播报', desc: '新闻女声' },
    { id: 'BV012_streaming', name: '新闻男声', category: '新闻播报', desc: '新闻男声' },
    // ===== 教育场景 =====
    { id: 'BV034_streaming', name: '知性姐姐-双语', category: '教育场景', desc: '知性姐姐-双语' },
    { id: 'BV033_streaming', name: '温柔小哥', category: '教育场景', desc: '温柔小哥' },
  ];
  res.json({ voices, available: checkConfig().valid });
});

router.post('/synthesize', async (req, res) => {
  const config = checkConfig();
  if (!config.valid) {
    return res.status(503).json({ error: config.error });
  }

  try {
    const { text, voice = CONFIG.DEFAULT_VOICE_TYPE, speed = 1.0 } = req.body;
    if (!text) return res.status(400).json({ error: 'Text is required' });

    const audioBuffer = await synthesize(text, voice, speed);
    
    res.setHeader('Content-Type', 'audio/mpeg');
    res.send(audioBuffer);

  } catch (error) {
    console.error('[VolcanoTTS] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 流式TTS
router.post('/synthesize-stream', async (req, res) => {
  const config = checkConfig();
  if (!config.valid) {
    return res.status(503).json({ error: config.error });
  }

  try {
    const { text, speed = 1.0 } = req.body;
    if (!text) return res.status(400).json({ error: 'Text is required' });

    const cleanedText = cleanTextForTTS(text);
    console.log('[VolcanoTTS] Stream request:', cleanedText.substring(0, 50));

    // 设置流式响应头
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');

    CONFIG.SPEED = speed;

    const wsUrl = `wss://openspeech.bytedance.com/api/v1/tts/ws_binary?appid=${CONFIG.APPID}`;
    const ws = new WebSocket(wsUrl, {
      headers: { 'Authorization': `Bearer;${CONFIG.TOKEN}` },
      skipUTF8Validation: true,
    });

    let isFirstChunk = true;

    ws.on('open', () => {
      ws.send(packBinaryRequest(cleanedText));
    });

    ws.on('message', (data) => {
      if (!Buffer.isBuffer(data)) return;
      
      const result = parseBinaryResponse(data);
      
      if (result.type === 'error') {
        if (!res.headersSent) {
          res.status(500).json({ error: 'TTS server error' });
        }
        ws.close();
      } else if (result.type === 'audio' && result.data.length > 0) {
        // 直接写入响应流
        res.write(result.data);
        
        if (result.isLast) {
          res.end();
          ws.close();
        }
      } else if (result.type === 'empty' && result.isLast) {
        res.end();
        ws.close();
      }
    });

    ws.on('error', (err) => {
      console.error('[VolcanoTTS] WebSocket error:', err.message);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      } else {
        res.end();
      }
    });

    ws.on('close', () => {
      res.end();
    });

    // 超时处理
    setTimeout(() => {
      if (!res.writableEnded) {
        res.end();
        ws.close();
      }
    }, 60000);

  } catch (error) {
    console.error('[VolcanoTTS] Stream error:', error.message);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    } else {
      res.end();
    }
  }
});

export default router;
