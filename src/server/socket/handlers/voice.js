/**
 * Voice Handlers
 * 语音相关消息处理器
 * 
 * 集成：
 * - RefactoredListener (音频接收)
 * - SpeechDetector (VAD)
 * - ASRService (语音识别)
 * - VoiceOrchestrator (LLM + TTS)
 * 
 * @phase 5
 */

import { getViberSocketManager } from '../viber.js';
import { createDetector } from '../../services/detector/index.js';
import { ASRServiceFactory } from '../../services/asr/index.js';
import { SpeakerControllerImpl } from '../../services/speaker/index.js';

/**
 * 创建语音处理器
 * @param {VoiceOrchestrator} voiceOrchestrator - 语音协调器
 */
export function createVoiceHandlers(voiceOrchestrator) {
  // 初始化服务
  const detector = createDetector({ type: 'volume' });
  const asrService = ASRServiceFactory.create('volcano');
  const speakerController = new SpeakerControllerImpl({
    maxQueueSize: 10,
    enableCache: true
  });
  
  // 活跃的音频流
  const activeStreams = new Map(); // streamId -> streamInfo
  
  const manager = getViberSocketManager();

  return {
    /**
     * 开始录音
     */
    'voice:start': async (socket, data) => {
      const { sessionId, config } = data || {};
      const streamId = `stream_${Date.now()}_${socket.id}`;
      
      console.log(`[VoiceHandler] Start stream ${streamId} for session ${sessionId}`);
      
      let asrSession;
      try {
        // 创建 ASR 会话 (注意：createSession 是 async 的，会连接火山引擎)
        asrSession = await asrService.createSession(streamId, {
          sampleRate: config?.sampleRate || 16000,
          language: config?.language || 'zh-CN'
        });
      } catch (error) {
        console.error(`[VoiceHandler] Failed to create ASR session:`, error);
        return socket.emit('message', {
          type: 'error',
          data: {
            code: 'ASR_CONNECT_FAILED',
            message: '无法连接语音识别服务',
            context: { streamId, error: error.message }
          }
        });
      }
      
      // 存储流信息（包含 TTS 配置）
      const streamInfo = {
        id: streamId,
        sessionId,
        socketId: socket.id,
        userId: socket.userId,
        asrSession,
        config,
        ttsConfig: {
          voice: config?.ttsVoice || 'BV001_streaming',
          speed: config?.ttsSpeed || 1.0
        },
        startTime: Date.now(),
        audioBuffer: [],
        transcript: '',
        isRecording: true
      };
      
      activeStreams.set(streamId, streamInfo);
      
      // 更新连接信息
      const conn = manager.connections.get(socket.id);
      if (conn) {
        conn.streams.set(streamId, streamInfo);
      }
      
      // 创建语音对话上下文（用于后端 LLM + TTS 流程）
      if (voiceOrchestrator) {
        voiceOrchestrator.createDialog(streamId, {
          sessionId,
          socketId: socket.id,
          userId: socket.userId,
          ttsConfig: streamInfo.ttsConfig
        });
      }
      
      // 设置 ASR 回调
      asrSession.on('interim', (result) => {
        socket.emit('message', {
          type: 'voice:asr:interim',
          data: {
            streamId,
            text: result.text
          }
        });
      });
      
      asrSession.on('final', (result) => {
        console.log(`[VoiceHandler] ASR final: "${result.text}"`);
        streamInfo.transcript = result.text;
        
        // 发送给前端显示
        socket.emit('message', {
          type: 'voice:asr:final',
          data: {
            streamId,
            text: result.text,
            confidence: result.confidence
          }
        });
        
        // 交给 VoiceOrchestrator 处理后端 LLM + TTS 流程
        if (voiceOrchestrator) {
          voiceOrchestrator.handleASRResult(streamId, result.text);
        }
      });
      
      asrSession.on('ended', () => {
        console.log(`[VoiceHandler] ASR session ended for ${streamId}`);
        // ASR 会话结束（火山引擎可能自动结束）
        // 通知前端
        socket.emit('message', {
          type: 'voice:ended',
          data: { streamId, reason: 'asr_session_ended' }
        });
      });
      
      asrSession.on('error', (error) => {
        console.error(`[VoiceHandler] ASR error for ${streamId}:`, error);
        socket.emit('message', {
          type: 'error',
          data: {
            code: 'ASR_ERROR',
            message: error.message,
            context: { streamId }
          }
        });
      });
      
      // 响应客户端
      socket.emit('message', {
        type: 'voice:started',
        data: { streamId }
      });
    },

    /**
     * 接收音频数据
     */
    'voice:audio': async (socket, data) => {
      const { streamId, seq, audio, timestamp } = data;
      
      const stream = activeStreams.get(streamId);
      if (!stream) {
        console.warn(`[VoiceHandler] Stream not found: ${streamId}`);
        return socket.emit('message', {
          type: 'error',
          data: {
            code: 'STREAM_NOT_FOUND',
            message: 'Stream not found',
            context: { streamId }
          }
        });
      }
      
      if (!stream.isRecording) {
        console.log(`[VoiceHandler] Stream ${streamId} not recording, dropping frame`);
        return; // 忽略非录音状态的音频
      }
      
      try {
        // Base64 → Buffer (PCM Int16 data)
        const pcmBuffer = Buffer.from(audio, 'base64');
        
        // 计算音量（用于前端可视化）
        const volume = calculateVolume(pcmBuffer);
        
        // 每50帧发送一次音量反馈
        if (seq % 50 === 0) {
          socket.emit('message', {
            type: 'voice:volume',
            data: { streamId, volume }
          });
        }
        
        // 发送到 ASR (必须 await，否则未处理的异常会导致连接断开)
        await stream.asrSession.sendAudio(pcmBuffer);
        
      } catch (error) {
        console.error('[VoiceHandler] Process audio error:', error.message);
        // 不要断开连接，只发送错误通知
        socket.emit('message', {
          type: 'error',
          data: {
            code: 'AUDIO_PROCESS_ERROR',
            message: error.message,
            context: { streamId }
          }
        });
      }
    },

    /**
     * 停止录音
     */
    'voice:stop': async (socket, data) => {
      const { streamId } = data;
      const stream = activeStreams.get(streamId);
      
      if (!stream) {
        return;
      }
      
      console.log(`[VoiceHandler] Stop stream ${streamId}`);
      
      stream.isRecording = false;
      
      // 关闭 ASR 会话 (使用 terminate 方法)
      try {
        await stream.asrSession.terminate();
      } catch (err) {
        console.error(`[VoiceHandler] Error terminating ASR session:`, err);
      }
      
      // 清理
      activeStreams.delete(streamId);
      
      const conn = manager.connections.get(socket.id);
      if (conn) {
        conn.streams.delete(streamId);
      }
      
      // 清理 VoiceOrchestrator
      if (voiceOrchestrator) {
        voiceOrchestrator.endDialog(streamId);
      }
      
      socket.emit('message', {
        type: 'voice:stopped',
        data: { streamId }
      });
    },

    /**
     * 打断
     */
    'voice:interrupt': async (socket, data) => {
      const { streamId } = data;
      
      console.log(`[VoiceHandler] Interrupt from ${socket.id}`);
      
      // 停止所有播放
      speakerController.stop();
      
      // 通知 VoiceOrchestrator 打断
      if (voiceOrchestrator) {
        voiceOrchestrator.interrupt(streamId);
      }
      
      // 通知客户端
      socket.emit('message', {
        type: 'speaker:stop',
        data: { reason: 'interrupted' }
      });
    },

    /**
     * 播放完成通知
     */
    'speaker:completed': async (socket, data) => {
      const { taskId } = data;
      
      console.log(`[VoiceHandler] Task ${taskId} completed by client`);
      
      // 通知 speaker controller
      speakerController.markCompleted(taskId);
    },

    /**
     * 房间管理
     */
    'room:join': async (socket, data) => {
      const { room, metadata } = data;
      const memberCount = manager.roomManager.join(socket, room, metadata);
      
      socket.emit('message', {
        type: 'room:joined',
        data: { room, members: memberCount }
      });
    },

    'room:leave': async (socket, data) => {
      const { room } = data;
      manager.roomManager.leave(socket, room);
    }
  };
}

/**
 * 计算音量
 * @param {Buffer} pcmBuffer - Int16 PCM data
 */
function calculateVolume(pcmBuffer) {
  let sum = 0;
  // 读取 Int16 样本
  for (let i = 0; i < pcmBuffer.length; i += 2) {
    const sample = pcmBuffer.readInt16LE(i);
    sum += Math.abs(sample);
  }
  const avg = sum / (pcmBuffer.length / 2);
  // 转换为 0-1 范围
  return Math.min(1, avg / 32767);
}

export default createVoiceHandlers;
