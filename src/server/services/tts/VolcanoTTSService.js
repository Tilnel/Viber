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
 * 火山引擎配置 - 与前端 voiceConfig.ts 保持一致
 */
const CONFIG = {
  APPID: process.env.VOLCANO_APP_ID,
  TOKEN: process.env.VOLCANO_ACCESS_TOKEN,
  DEFAULT_VOICE: process.env.VOLCANO_TTS_VOICE || 'BV001_streaming',
  DEFAULT_SPEED: parseFloat(process.env.VOLCANO_TTS_SPEED) || 1.0,
  WS_URL: 'wss://openspeech.bytedance.com/api/v1/tts/ws_binary',
  // 文本分段配置（与前端保持一致）
  MAX_CHARS_PER_SEGMENT: 300,
  MAX_BYTES_PER_SEGMENT: 900
};

/**
 * 火山引擎 TTS 服务
 */
export class VolcanoTTSService {
  constructor(config = {}) {
    this.appId = config.appId || CONFIG.APPID;
    this.token = config.token || CONFIG.TOKEN;
    this.defaultVoice = config.voice || CONFIG.DEFAULT_VOICE;
    this.defaultSpeed = config.speed || CONFIG.DEFAULT_SPEED;
    this.baseUrl = config.baseUrl || CONFIG.WS_URL;

    if (!this.appId || !this.token) {
      console.warn('[VolcanoTTSService] Warning: VOLCANO_APP_ID or VOLCANO_ACCESS_TOKEN not set');
    }
    
    console.log(`[VolcanoTTSService] Initialized with voice: ${this.defaultVoice}, speed: ${this.defaultSpeed}`);
  }

  /**
   * 将长文本拆分成多个片段（避免超过1024字节限制）
   * 与前端 splitTextForTTS 保持一致
   */
  splitTextForTTS(text) {
    const maxChars = CONFIG.MAX_CHARS_PER_SEGMENT;
    const maxBytes = CONFIG.MAX_BYTES_PER_SEGMENT;
    const segments = [];
    
    // 计算UTF-8字节长度
    const byteLength = (str) => Buffer.byteLength(str, 'utf8');
    
    // 按句子拆分（优先在句号、问号、感叹号处分割）
    const sentences = text.split(/([。！？.!?；;\n]+)/);
    let currentSegment = '';
    
    for (let i = 0; i < sentences.length; i++) {
      const part = sentences[i];
      if (!part) continue;
      
      const combined = currentSegment + part;
      // 检查字符数和字节数
      if (combined.length <= maxChars && byteLength(combined) <= maxBytes) {
        currentSegment = combined;
      } else {
        // 当前段已满，保存并开始新段
        if (currentSegment.trim()) {
          segments.push(currentSegment.trim());
        }
        // 如果单段就超限，需要强制拆分
        if (part.length > maxChars || byteLength(part) > maxBytes) {
          let subSegment = '';
          for (const char of part) {
            const test = subSegment + char;
            if (test.length > maxChars || byteLength(test) > maxBytes) {
              if (subSegment.trim()) {
                segments.push(subSegment.trim());
              }
              subSegment = char;
            } else {
              subSegment = test;
            }
          }
          currentSegment = subSegment;
        } else {
          currentSegment = part;
        }
      }
    }
    
    // 添加最后一段
    if (currentSegment.trim()) {
      segments.push(currentSegment.trim());
    }
    
    // 最终检查：确保每段都不超限
    return segments.map(s => {
      if (s.length > maxChars || byteLength(s) > maxBytes) {
        // 强制截断
        let result = '';
        for (const char of s) {
          const test = result + char;
          if (test.length > maxChars || byteLength(test) > maxBytes) {
            break;
          }
          result = test;
        }
        return result;
      }
      return s;
    }).filter(s => s.length > 0);
  }

  /**
   * 合成单段语音（内部方法）
   * @private
   */
  async _synthesizeSegment(text, options = {}) {
    return new Promise((resolve, reject) => {
      const voice = options.voice || this.defaultVoice;
      const speed = options.speed || this.defaultSpeed;
      
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
          encoding: 'pcm',
          sample_rate: 24000,
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

      // 构建二进制请求 - 火山引擎 V1 协议
      // 协议格式: header(4) + length(4) + payload
      // 参考 routes/voice.js 的实现
      const payloadBuf = Buffer.from(payload, 'utf8');
      const header = Buffer.alloc(4);
      header.writeUInt8(0x11, 0);   // version=1, headerSize=1
      header.writeUInt8(0x10, 1);   // msgType=1 (0x1 << 4 = 0x10), flags=0
      header.writeUInt8(0x10, 2);   // serialization=1 (0x1 << 4 = 0x10), compression=0
      header.writeUInt8(0x00, 3);   // reserved
      
      const lengthBuf = Buffer.alloc(4);
      lengthBuf.writeUInt32BE(payloadBuf.length, 0);
      
      const requestBuffer = Buffer.concat([header, lengthBuf, payloadBuf]);
      
      console.log(`[VolcanoTTSService] Request header: ${header.toString('hex')}, payload length: ${payloadBuf.length}`);

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
              format: 'pcm',
              sampleRate: 24000,
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
   * 合成语音（支持长文本自动分段）
   * @param {string} text - 要合成的文本
   * @param {Object} options - 选项 { voice, speed }
   * @returns {Promise<{audioData: Buffer, format: string, duration: number}>}
   */
  async synthesize(text, options = {}) {
    if (!text || !text.trim()) {
      throw new Error('Text is required for TTS synthesis');
    }
    
    const trimmedText = text.trim();
    
    // 使用默认配置
    const voice = options.voice || this.defaultVoice;
    const speed = options.speed || this.defaultSpeed;
    
    console.log(`[VolcanoTTSService] synthesize() called: ${trimmedText.length} chars, voice: ${voice}, speed: ${speed}`);
    
    if (!this.appId || !this.token) {
      throw new Error('Volcano TTS not configured - check VOLCANO_APP_ID and VOLCANO_ACCESS_TOKEN env vars');
    }
    
    // 分段处理
    const segments = this.splitTextForTTS(trimmedText);
    console.log(`[VolcanoTTSService] Text split into ${segments.length} segments`);
    
    if (segments.length === 0) {
      throw new Error('No valid text segments for TTS');
    }
    
    // 单段直接合成
    if (segments.length === 1) {
      return this._synthesizeSegment(segments[0], { voice, speed });
    }
    
    // 多段顺序合成并合并
    const audioBuffers = [];
    let totalDuration = 0;
    
    for (let i = 0; i < segments.length; i++) {
      console.log(`[VolcanoTTSService] Synthesizing segment ${i + 1}/${segments.length}: "${segments[i].substring(0, 30)}..."`);
      try {
        const result = await this._synthesizeSegment(segments[i], { voice, speed });
        audioBuffers.push(result.audioData);
        totalDuration += result.duration;
      } catch (err) {
        console.error(`[VolcanoTTSService] Segment ${i + 1} failed:`, err.message);
        // 继续合成剩余段落，不中断
      }
    }
    
    if (audioBuffers.length === 0) {
      throw new Error('All TTS segments failed');
    }
    
    // 合并音频
    const mergedAudio = Buffer.concat(audioBuffers);
    console.log(`[VolcanoTTSService] Merged ${audioBuffers.length} segments, total: ${mergedAudio.length} bytes`);
    
    return {
      audioData: mergedAudio,
      format: 'pcm',
      sampleRate: 24000,
      duration: totalDuration
    };
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

// 单例实例（用于 routes/voice.js 复用）
let volcanoTTSServiceInstance = null;

export function getVolcanoTTSService(config = {}) {
  if (!volcanoTTSServiceInstance) {
    volcanoTTSServiceInstance = new VolcanoTTSService(config);
  }
  return volcanoTTSServiceInstance;
}

export default VolcanoTTSService;
