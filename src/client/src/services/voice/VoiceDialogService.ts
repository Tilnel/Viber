/**
 * 语音对话服务 - 整合 STT、AI、TTS 的完整对话流程
 * 
 * 职责：
 * 1. 管理语音对话的完整生命周期
 * 2. 协调 STT、AI、TTS 三个模块
 * 3. 处理打断和连续对话
 */

import { VoiceStateManager, VoicePhase, getVoiceStateManager, resetVoiceStateManager } from './VoiceStateManager';
import { VolcanoSTTService } from '../volcanoSTT';
import { volcanoTTSService } from '../volcanoTTS';
import { piperTTSService } from '../piperTTS';
import { loadVoiceConfig } from '../voiceConfig';
import { chatAPI } from '../api';
import { useProjectStore } from '../../stores/project';

interface VoiceDialogOptions {
  sessionId: number;
  projectId: number;
  onPhaseChange?: (phase: VoicePhase) => void;
  onTranscript?: (text: string, isFinal: boolean) => void;
  onAIResponse?: (text: string) => void;
  onError?: (error: string) => void;
}

export class VoiceDialogService {
  private stateManager: VoiceStateManager;
  private sttService: VolcanoSTTService | null = null;
  private options: VoiceDialogOptions;
  private abortController: AbortController | null = null;
  private isRunning = false;

  constructor(options: VoiceDialogOptions) {
    this.options = options;
    
    // 重置全局状态管理器
    resetVoiceStateManager();
    
    this.stateManager = getVoiceStateManager({
      onPhaseChange: (phase) => {
        this.options.onPhaseChange?.(phase);
      },
      onTranscript: (text, isFinal) => {
        this.options.onTranscript?.(text, isFinal);
      },
      onUserSpeech: (text) => {
        this.handleUserSpeech(text);
      },
      onAIResponse: (text) => {
        this.options.onAIResponse?.(text);
      },
      onError: (error) => {
        this.options.onError?.(error);
        this.stop();
      }
    });
  }

  // 启动语音对话
  async start(): Promise<boolean> {
    if (this.isRunning) {
      console.log('[VoiceDialogService] Already running');
      return true;
    }

    console.log('[VoiceDialogService] Starting...');
    
    // 初始化 STT
    this.sttService = new VolcanoSTTService({
      onText: (text, isFinal) => {
        if (isFinal) {
          this.stateManager.updateTranscript(text, true);
        }
      },
      onError: (error) => {
        console.error('[VoiceDialogService] STT error:', error);
        this.stateManager.setError(error);
      },
      onConnected: () => {
        console.log('[VoiceDialogService] STT connected');
      },
      onDisconnected: () => {
        console.log('[VoiceDialogService] STT disconnected');
      }
    });

    const success = await this.sttService.start();
    if (!success) {
      this.options.onError?.('无法启动语音识别');
      return false;
    }

    this.isRunning = true;
    this.stateManager.startListening();
    
    // 启动语音检测循环
    this.startSpeechDetection();
    
    return true;
  }

  // 语音检测循环 - 检测用户说话结束
  private speechCheckInterval: NodeJS.Timeout | null = null;
  private lastTranscript = '';
  private transcriptStableTime = 0;
  private readonly STABILITY_THRESHOLD = 1000; // 1秒稳定期
  private readonly MIN_SPEECH_LENGTH = 5; // 最少5个字符

  private startSpeechDetection(): void {
    this.speechCheckInterval = setInterval(() => {
      const currentPhase = this.stateManager.getPhase();
      
      if (currentPhase !== 'listening') {
        return;
      }

      const transcript = this.stateManager.getTranscript();
      const now = Date.now();

      // 如果转录内容变化，重置稳定计时器
      if (transcript !== this.lastTranscript) {
        this.lastTranscript = transcript;
        this.transcriptStableTime = now;
        return;
      }

      // 检查是否满足结束条件
      const stableDuration = now - this.transcriptStableTime;
      const hasEnoughContent = transcript.trim().length >= this.MIN_SPEECH_LENGTH;
      
      if (hasEnoughContent && stableDuration > this.STABILITY_THRESHOLD) {
        // 用户说话结束，开始处理
        this.stateManager.finalizeUserSpeech();
      }
    }, 100);
  }

  // 处理用户语音输入
  private async handleUserSpeech(text: string): Promise<void> {
    console.log('[VoiceDialogService] User speech:', text);

    // 进入 AI 处理阶段
    this.stateManager.startAIResponse();

    // 停止 STT（避免识别 AI 说话）
    this.sttService?.stop();

    // 获取项目上下文
    const { activeFilePath } = useProjectStore.getState();
    const context = {
      currentFile: activeFilePath || undefined,
      selectedCode: undefined
    };

    // 创建 AbortController 用于打断
    this.abortController = new AbortController();

    let aiResponseText = '';

    try {
      await chatAPI.sendMessageStream(
        this.options.sessionId,
        text,
        context,
        this.abortController.signal,
        {
          onTextDelta: (text) => {
            aiResponseText += text;
            this.stateManager.updateAIResponse(text);
          },
          onToolCall: () => {
            // 工具调用不处理
          },
          onToolResult: () => {
            // 工具结果不处理
          },
          onComplete: () => {
            // 播放 TTS
            this.playTTS(aiResponseText);
          },
          onError: (error) => {
            console.error('[VoiceDialogService] AI error:', error);
            this.stateManager.setError(error);
          }
        }
      );
    } catch (error) {
      console.error('[VoiceDialogService] Failed to get AI response:', error);
      this.stateManager.setError('获取 AI 回复失败');
    }
  }

  // 播放 TTS
  private async playTTS(text: string): Promise<void> {
    const voiceConfig = loadVoiceConfig();
    
    if (!text.trim()) {
      // 没有内容，直接回到聆听状态
      this.returnToListening();
      return;
    }

    // 等待 TTS 播放完成
    const onTTSEnd = () => {
      this.returnToListening();
    };

    if (voiceConfig.ttsEngine === 'volcano') {
      await volcanoTTSService.synthesize(text, {
        voice: voiceConfig.ttsVoice,
        speed: voiceConfig.ttsSpeed
      });
      onTTSEnd();
    } else if (voiceConfig.ttsEngine === 'piper') {
      await piperTTSService.speak(text);
      onTTSEnd();
    } else {
      // 浏览器 TTS
      onTTSEnd();
    }
  }

  // 回到聆听状态
  private async returnToListening(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    console.log('[VoiceDialogService] Returning to listening...');

    // 重置状态
    this.stateManager.stop();
    
    // 重新启动 STT
    if (this.sttService) {
      this.sttService.stop();
      await new Promise(r => setTimeout(r, 500));
    }

    this.sttService = new VolcanoSTTService({
      onText: (text, isFinal) => {
        if (isFinal) {
          this.stateManager.updateTranscript(text, true);
        }
      },
      onError: (error) => {
        console.error('[VoiceDialogService] STT error:', error);
      },
      onConnected: () => {
        console.log('[VoiceDialogService] STT reconnected');
      },
      onDisconnected: () => {
        console.log('[VoiceDialogService] STT disconnected');
      }
    });

    const success = await this.sttService.start();
    if (success) {
      this.stateManager.startListening();
    } else {
      this.options.onError?.('无法重启语音识别');
      this.stop();
    }
  }

  // 打断 AI
  interrupt(): void {
    console.log('[VoiceDialogService] Interrupting...');
    
    // 中止 AI 请求
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    // 停止 TTS
    const voiceConfig = loadVoiceConfig();
    if (voiceConfig.ttsEngine === 'volcano') {
      volcanoTTSService.stop();
    } else if (voiceConfig.ttsEngine === 'piper') {
      piperTTSService.stop();
    }

    // 回到聆听
    this.returnToListening();
  }

  // 停止服务
  stop(): void {
    console.log('[VoiceDialogService] Stopping...');
    
    this.isRunning = false;

    // 清除定时器
    if (this.speechCheckInterval) {
      clearInterval(this.speechCheckInterval);
      this.speechCheckInterval = null;
    }

    // 中止 AI 请求
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    // 停止 STT
    this.sttService?.stop();
    this.sttService = null;

    // 停止状态管理
    this.stateManager.stop();

    // 重置全局状态
    resetVoiceStateManager();
  }

  getCurrentPhase(): VoicePhase {
    return this.stateManager.getPhase();
  }
}
