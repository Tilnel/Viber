/**
 * Volcano TTS Service
 * 火山引擎语音合成服务
 * 
 * @phase 5
 * @implements {TTSService}
 */

import WebSocket from 'ws';
import crypto from 'crypto';

/**
 * 火山引擎配置
 */
const CONFIG = {
  APPID: process.env.VOLCANO_APP_ID,
  TOKEN: process.env.VOLCANO_ACCESS_TOKEN,
  DEFAULT_VOICE: 'BV001_streaming',
  WS_URL: 'wss://openspeech.bytedance.com/api/v1/tts/ws_binary'
};

/**
 * 火山引擎 TTS 服务
 */
export class VolcanoTTSService {
  constructor(config = {}) {
    this.appId = config.appId || CONFIG.APPID;
    this.token = config.token || CONFIG.TOKEN;
    this.defaultVoice = config.voice || CONFIG.DEFAULT_VOICE;
    this.baseUrl = config.baseUrl || CONFIG.WS_URL;

    if (!this.appId || !this.token) {
      console.warn('[VolcanoTTSService] Warning: VOLCANO_APP_ID or VOLCANO_ACCESS_TOKEN not set');
    }
  }

  /**
   * 合成语音
   * @param {string} text - 要合成的文本
   * @param {Object} options - 选项
   * @returns {Promise<{audioData: Buffer, format: string, duration: number}>}
   */
  async synthesize(text, options = {}) {
    console.log(`[VolcanoTTSService] synthesize() called, text length: ${text?.length}, appId: ${this.appId ? 'set' : 'NOT SET'}, token: ${this.token ? 'set' : 'NOT SET'}`);
    
    if (!this.appId || !this.token) {
      throw new Error('Volcano TTS not configured - check VOLCANO_APP_ID and VOLCANO_ACCESS_TOKEN env vars');
    }

    return new Promise((resolve, reject) => {
      const voice = options.voice || this.defaultVoice;
      const speed = options.speed || 1.0;
      
      console.log(`[VolcanoTTSService] Using voice: ${voice}, speed: ${speed}`);
      
      // 构建请求
      const reqid = crypto.randomUUID();
      const payload = JSON.stringify({
        app: {
          appid: this.appId,
          token: this.token,
          cluster: 'volcano_tts'
        },
        user: {
          uid: `user_${Date.now()}`
        },
        audio: {
          voice_type: voice,
          encoding: 'mp3',
          speed_ratio: speed
        },
        request: {
          reqid,
          text,
          text_type: 'plain',
          operation: 'submit'
        }
      });

      console.log(`[VolcanoTTSService] Request payload length: ${payload.length}, reqid: ${reqid}`);

      // 构建二进制请求
      const payloadBuf = Buffer.from(payload, 'utf8');
      const header = Buffer.alloc(4);
      header.writeUInt8(0x11, 0);  // version=1, headerSize=1
      header.writeUInt8(0x01, 1);  // msgType=1, flags=0
      header.writeUInt8(0x01, 2);  // serialization=1, compression=0
      header.writeUInt8(0x00, 3);  // reserved
      
      const lengthBuf = Buffer.alloc(4);
      lengthBuf.writeUInt32BE(payloadBuf.length, 0);
      
      const requestBuffer = Buffer.concat([header, lengthBuf, payloadBuf]);

      // WebSocket 连接
      const wsUrl = `${this.baseUrl}?appid=${this.appId}`;
      console.log(`[VolcanoTTSService] Connecting to WebSocket: ${wsUrl.substring(0, 60)}...`);
      
      const ws = new WebSocket(wsUrl, {
        headers: { 'Authorization': `Bearer;${this.token}` },
        skipUTF8Validation: true
      });

      const audioChunks = [];
      let isCompleted = false;
      let messageCount = 0;

      ws.on('open', () => {
        console.log(`[VolcanoTTSService] WebSocket connected, sending request...`);
        ws.send(requestBuffer);
      });

      ws.on('message', (data) => {
        messageCount++;
        if (!Buffer.isBuffer(data) || data.length < 8) {
          console.log(`[VolcanoTTSService] Received invalid message #${messageCount}, length: ${data?.length}`);
          return;
        }

        const seqSigned = data.readInt32BE(4);
        const msgType = (data[1] >> 4) & 0x0f;
        const isLast = seqSigned < 0;

        console.log(`[VolcanoTTSService] Message #${messageCount}: type=0x${msgType.toString(16)}, seq=${seqSigned}, isLast=${isLast}, dataLen=${data.length}`);

        // 错误消息
        if (msgType === 0x0f) {
          const errorText = data.slice(8).toString('utf8');
          console.error(`[VolcanoTTSService] TTS error from server: ${errorText}`);
          reject(new Error(`TTS error: ${errorText}`));
          ws.close();
          return;
        }

        // 音频数据
        if (msgType === 0x0b || msgType === 0x00) {
          const audioData = data.slice(8);
          if (audioData.length > 0) {
            audioChunks.push(audioData);
            console.log(`[VolcanoTTSService] Audio chunk received: ${audioData.length} bytes, total chunks: ${audioChunks.length}`);
          }

          if (isLast) {
            console.log(`[VolcanoTTSService] Last message received, closing WebSocket`);
            ws.close();
          }
        }
      });

      ws.on('close', () => {
        console.log(`[VolcanoTTSService] WebSocket closed, isCompleted=${isCompleted}, audioChunks=${audioChunks.length}`);
        if (!isCompleted) {
          isCompleted = true;
          if (audioChunks.length > 0) {
            const finalBuffer = Buffer.concat(audioChunks);
            console.log(`[VolcanoTTSService] Resolving with ${finalBuffer.length} bytes of audio`);
            resolve({
              audioData: finalBuffer,
              format: 'mp3',
              duration: this.estimateDuration(text)
            });
          } else {
            console.error(`[VolcanoTTSService] No audio chunks received!`);
            reject(new Error('No audio received'));
          }
        }
      });

      ws.on('error', (err) => {
        console.error(`[VolcanoTTSService] WebSocket error:`, err.message);
        if (!isCompleted) {
          isCompleted = true;
          reject(err);
        }
      });

      // 超时
      setTimeout(() => {
        if (!isCompleted) {
          console.error(`[VolcanoTTSService] TTS timeout after 30s`);
          isCompleted = true;
          ws.close();
          reject(new Error('TTS timeout'));
        }
      }, 30000);
    });
  }

  /**
   * 估算音频时长（粗略估计）
   * @private
   */
  estimateDuration(text) {
    // 中文：每秒约 4-5 个字
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const otherChars = text.length - chineseChars;
    
    // 中文字符 0.25s/字，其他字符 0.1s/字符
    return Math.ceil(chineseChars * 0.25 + otherChars * 0.1);
  }
}

/**
 * 创建火山 TTS 服务
 */
export function createVolcanoTTSService(config = {}) {
  return new VolcanoTTSService(config);
}

export default VolcanoTTSService;
