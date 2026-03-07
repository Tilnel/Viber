// 火山引擎流式语音识别 (STT) 代理
// 使用官方二进制协议

import { Router } from 'express';
import WebSocket from 'ws';
import crypto from 'crypto';

const router = Router();

const CONFIG = {
  APPID: process.env.VOLCANO_APP_ID,
  TOKEN: process.env.VOLCANO_ACCESS_TOKEN,
  CLUSTER: 'volcengine_streaming_common',
  VOLC_ASR_WS: 'wss://openspeech.bytedance.com/api/v2/asr'
};

function checkConfig() {
  if (!CONFIG.APPID || !CONFIG.TOKEN) {
    return { valid: false, error: '火山引擎未配置' };
  }
  return { valid: true };
}

/**
 * 构建4字节Header
 * 官方协议: https://www.volcengine.com/docs/6561/80818
 * Byte 0: version(4bits) + header_size(4bits)
 * Byte 1: msg_type(4bits) + flags(4bits)
 * Byte 2: serialization(4bits) + compression(4bits)
 * Byte 3: reserved
 */
function buildHeader(msgType = 0x1, flags = 0x0, serialization = 0x1, compression = 0x0) {
  const header = Buffer.alloc(4);
  header.writeUInt8(0x11, 0);  // version=1, headerSize=1
  header.writeUInt8((msgType << 4) | flags, 1);
  header.writeUInt8((serialization << 4) | compression, 2);
  header.writeUInt8(0x00, 3);
  return header;
}

/**
 * 构建全量客户端请求
 */
function buildFullClientRequest(reqid) {
  const payload = JSON.stringify({
    app: {
      appid: CONFIG.APPID,
      token: CONFIG.TOKEN,
      cluster: CONFIG.CLUSTER
    },
    user: {
      uid: `user_${Date.now()}`
    },
    audio: {
      format: 'raw',  // raw PCM without header
      rate: 16000,
      bits: 16,
      channel: 1,
      language: 'zh-CN'
      // codec defaults to pcm
    },
    request: {
      reqid,
      sequence: 1,
      show_utterances: true,
      result_type: 'single'
    }
  });

  const payloadBuf = Buffer.from(payload, 'utf8');
  const header = buildHeader(0x1);
  const lengthBuf = Buffer.alloc(4);
  lengthBuf.writeUInt32BE(payloadBuf.length, 0);

  return Buffer.concat([header, lengthBuf, payloadBuf]);
}

/**
 * 构建音频数据请求
 * 官方协议: payload = sequence(4B) + audio data
 * 最后一包 flags = 0b0010 (2)，其他 flags = 0b0000 (0)
 */
function buildAudioRequest(audioData, sequence, isLast = false) {
  const flags = isLast ? 0x2 : 0x0;  // 0b0010 for last packet
  const header = buildHeader(0x2, flags, 0x0, 0x0);  // serialization=0 (raw), compression=0

  // Payload = sequence(4 bytes) + audio data
  const seqBuf = Buffer.alloc(4);
  seqBuf.writeInt32BE(sequence, 0);

  const payload = Buffer.concat([seqBuf, audioData]);

  const lengthBuf = Buffer.alloc(4);
  lengthBuf.writeUInt32BE(payload.length, 0);

  return Buffer.concat([header, lengthBuf, payload]);
}

/**
 * 解析服务器响应
 * 注意：Error message (msgType=15) 有特殊格式
 * Header(4B) | Error code(4B) | Error msg size(4B) | Error msg(UTF8)
 */
function parseResponse(buffer) {
  if (buffer.length < 8) return { partial: true };

  const msgType = (buffer[1] >> 4) & 0x0F;

  // Error message 特殊格式
  if (msgType === 0xF) {
    if (buffer.length < 12) return { partial: true };
    const errorCode = buffer.readUInt32BE(4);
    const errorMsgSize = buffer.readUInt32BE(8);
    const totalLen = 12 + errorMsgSize;
    
    if (buffer.length < totalLen) return { partial: true };
    
    const errorMsg = buffer.slice(12, totalLen).toString('utf8');
    const remaining = buffer.slice(totalLen);
    return { error: true, errorCode, errorMsg, remaining };
  }

  // 普通响应格式: Header(4B) | Payload size(4B) | Payload
  const payloadLen = buffer.readUInt32BE(4);
  const totalLen = 8 + payloadLen;

  if (buffer.length < totalLen) return { partial: true };

  const payload = buffer.slice(8, totalLen);
  const remaining = buffer.slice(totalLen);

  try {
    const result = JSON.parse(payload.toString('utf8'));
    return { result, remaining };
  } catch (e) {
    return { parseError: true, payload: payload.toString('utf8').slice(0, 200), remaining };
  }
}

// HTTP 状态接口
router.get('/status', (req, res) => {
  const config = checkConfig();
  res.json({ available: config.valid, error: config.error });
});

// Socket.io 处理器
export function setupVolcanoSTTSocket(io) {
  const config = checkConfig();

  io.of('/volcano-stt').on('connection', (socket) => {
    console.log('[VolcanoSTT] Client connected, socket id:', socket.id);

    // 监听所有事件用于调试
    socket.onAny((eventName, ...args) => {
      console.log('[VolcanoSTT] Received event:', eventName, 'args:', typeof args[0]);
    });

    if (!config.valid) {
      socket.emit('error', { message: config.error });
      socket.disconnect();
      return;
    }

    let reqid = crypto.randomUUID().replace(/-/g, '');
    let sequence = 1;
    let volcWs = null;
    let responseBuffer = Buffer.alloc(0);
    let hasReceivedAudio = false;
    let isVolcanoConnected = false;
    const pendingAudio = [];

    function connectVolcano() {
      console.log('[VolcanoSTT] Setting up Volcano WebSocket...');
      
      volcWs = new WebSocket(CONFIG.VOLC_ASR_WS, {
        headers: { 'Authorization': `Bearer;${CONFIG.TOKEN}` }
      });

      volcWs.on('open', () => {
        console.log('[VolcanoSTT] Connected to Volcano, sending full request');
        const fullReq = buildFullClientRequest(reqid);
        console.log('[VolcanoSTT] Full request size:', fullReq.length);
        volcWs.send(fullReq);
        isVolcanoConnected = true;
        console.log('[VolcanoSTT] Volcano ready, emitting to client, pending audio:', pendingAudio.length);
        socket.emit('connected');
        
        // 发送缓存的音频
        while (pendingAudio.length > 0) {
          const audioData = pendingAudio.shift();
          sendAudioToVolcano(audioData);
        }
      });

      volcWs.on('message', (data) => {
        if (!Buffer.isBuffer(data)) {
          console.log('[VolcanoSTT] Received non-buffer data:', typeof data);
          return;
        }

        console.log('[VolcanoSTT] Received raw response, size:', data.length);
        
        // 打印前16字节用于调试
        const hexPreview = data.slice(0, Math.min(16, data.length)).toString('hex');
        console.log('[VolcanoSTT] First 16 bytes (hex):', hexPreview);

        responseBuffer = Buffer.concat([responseBuffer, data]);

        while (responseBuffer.length >= 8) {
          const msgType = (responseBuffer[1] >> 4) & 0x0F;
          const payloadLen = responseBuffer.readUInt32BE(4);
          console.log('[VolcanoSTT] Parsing response - msgType:', msgType, 'payloadLen:', payloadLen, 'bufferLen:', responseBuffer.length);

          const parsed = parseResponse(responseBuffer);
          if (parsed.partial) {
            console.log('[VolcanoSTT] Partial response, need more data. Buffer:', responseBuffer.length);
            break;
          }
          
          // 处理错误消息 (msgType=15)
          if (parsed.error) {
            console.error('[VolcanoSTT] Server error:', parsed.errorCode, parsed.errorMsg);
            socket.emit('error', { code: parsed.errorCode, message: parsed.errorMsg });
            responseBuffer = parsed.remaining || Buffer.alloc(0);
            continue;
          }

          // 处理 JSON 解析错误
          if (parsed.parseError) {
            console.log('[VolcanoSTT] JSON parse error, raw:', parsed.payload);
            responseBuffer = parsed.remaining || Buffer.alloc(0);
            continue;
          }

          const result = parsed.result;
          responseBuffer = parsed.remaining || Buffer.alloc(0);

          console.log('[VolcanoSTT] Parsed result:', JSON.stringify(result).slice(0, 200));

          if (result.code === 1000 && result.result) {
            const utterances = result.result[0]?.utterances || [];
            const last = utterances[utterances.length - 1];
            if (last && last.text) {
              console.log('[VolcanoSTT] Result:', last.text, 'final:', !!last.definite);
              socket.emit('result', {
                text: last.text,
                isFinal: !!last.definite
              });
            }
          } else if (result.code !== 1000) {
            console.error('[VolcanoSTT] ASR error:', result.code, result.message);
          }
        }
      });

      volcWs.on('error', (err) => {
        console.error('[VolcanoSTT] WebSocket error:', err.message);
      });

      volcWs.on('close', () => {
        console.log('[VolcanoSTT] Connection closed');
      });
    }

    connectVolcano();

    // 发送音频到 Volcano 的辅助函数
    function sendAudioToVolcano(pcmBuf, isLast = false) {
      try {
        sequence++;
        hasReceivedAudio = true;
        const audioReq = buildAudioRequest(pcmBuf, sequence, isLast);
        volcWs.send(audioReq);
        console.log('[VolcanoSTT] Sent audio chunk #' + sequence, 'size:', pcmBuf.length, 'last:', isLast);
      } catch (err) {
        console.error('[VolcanoSTT] Send audio error:', err);
      }
    }

    // 接收音频
    socket.on('audio', (data) => {
      console.log('[VolcanoSTT] Received audio event, volcano connected:', isVolcanoConnected);
      
      if (!data || !data.audio) {
        console.log('[VolcanoSTT] Invalid audio data');
        return;
      }

      try {
        const pcmBuf = Buffer.from(data.audio, 'base64');
        if (pcmBuf.length === 0) {
          console.log('[VolcanoSTT] Empty audio data');
          return;
        }
        
        // 检查音频数据是否有效（不是全静音）
        let maxVal = 0;
        for (let i = 0; i < pcmBuf.length; i += 2) {
          const val = pcmBuf.readInt16LE(i);
          maxVal = Math.max(maxVal, Math.abs(val));
        }
        
        console.log('[VolcanoSTT] Decoded audio size:', pcmBuf.length, 'max amplitude:', maxVal);

        if (!isVolcanoConnected) {
          // 缓存音频直到连接完成
          pendingAudio.push(pcmBuf);
          console.log('[VolcanoSTT] Buffering audio, total pending:', pendingAudio.length);
          return;
        }

        sendAudioToVolcano(pcmBuf);
      } catch (err) {
        console.error('[VolcanoSTT] Process audio error:', err);
      }
    });

    // 结束当前识别
    socket.on('finalize', () => {
      console.log('[VolcanoSTT] Received finalize, has audio:', hasReceivedAudio, 'seq:', sequence);
      
      if (!volcWs || volcWs.readyState !== WebSocket.OPEN) {
        console.log('[VolcanoSTT] Cannot finalize: WebSocket not open');
        return;
      }
      if (!hasReceivedAudio) {
        console.log('[VolcanoSTT] Cannot finalize: no audio received');
        return;
      }

      // 发送最后一包音频（flag=0b0010, payload为空, sequence为负数）
      sequence++;
      const header = buildHeader(0x2, 0x2, 0x0, 0x0);  // msgType=2, flags=2 (last), serialization=0, compression=0
      const seqBuf = Buffer.alloc(4);
      seqBuf.writeInt32BE(-sequence, 0);  // 负序列号表示结束
      const payload = seqBuf;  // 只有序列号，没有音频数据
      const lengthBuf = Buffer.alloc(4);
      lengthBuf.writeUInt32BE(payload.length, 0);

      volcWs.send(Buffer.concat([header, lengthBuf, payload]));
      console.log('[VolcanoSTT] Sent last audio marker with seq:', -sequence);

      // 重置状态
      hasReceivedAudio = false;
      sequence = 1;
      reqid = crypto.randomUUID().replace(/-/g, '');
    });

    // 停止（断开连接）
    socket.on('stop', () => {
      if (volcWs) volcWs.close();
    });

    // 断开
    socket.on('disconnect', () => {
      console.log('[VolcanoSTT] Client disconnected');
      if (volcWs) volcWs.close();
    });
  });
}

export default router;
