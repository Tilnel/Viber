/**
 * Volume Based Speech Detector
 * 基于音量的语音检测器实现
 * 
 * 简单、快速、无需 ML 模型
 * 适用于安静环境和实时场景
 * 
 * @phase 2
 * @implements {SpeechDetector}
 */

import {
  SpeechDetector,
  DetectionResult,
  DetectorState,
  AudioContext,
  AudioChunk,
  DefaultDetectorConfig,
  SpeechDetectorFactory,
  AudioUtils
} from './types.js';

/**
 * 基于音量的语音检测器
 */
export class VolumeBasedSpeechDetector extends SpeechDetector {
  constructor(config = {}) {
    super('volume-based', { ...DefaultDetectorConfig, ...config });
    
    this.config = {
      volumeThreshold: 0.02,        // 音量阈值 0-1
      minSpeechDuration: 300,       // 最小语音时长(ms)
      minSilenceDuration: 800,      // 最小静音时长(ms) - 用于判断语音结束
      maxSpeechDuration: 60000,     // 最大语音时长(ms) - 强制结束
      
      // 自适应配置
      adaptiveThreshold: false,     // 是否启用自适应阈值
      noiseAdaptationRate: 0.1,     // 噪音适应速率
      
      ...config
    };
    
    // 内部状态
    this._effectiveThreshold = this.config.volumeThreshold;
    this._speechStartTime = null;
    this._isSpeaking = false;
  }
  
  /**
   * 检测是否为有效语音
   * @param {AudioContext} context 
   * @returns {DetectionResult}
   */
  detect(context) {
    const currentVolume = context.currentVolume;
    const frameDuration = context.recentChunks.length > 0 
      ? context.recentChunks[context.recentChunks.length - 1].duration 
      : 0;
    
    // 更新自适应阈值
    if (this.config.adaptiveThreshold) {
      this._updateAdaptiveThreshold(context);
    }
    
    // 音量判断
    const isLoud = currentVolume > this._effectiveThreshold;
    
    // 状态机处理
    if (!this._isSpeaking) {
      // 当前未在语音中
      if (isLoud) {
        // 检测到可能的声音开始
        if (context.speechDuration >= this.config.minSpeechDuration) {
          // 确认是语音（持续时间足够）
          this._isSpeaking = true;
          this._speechStartTime = Date.now() - context.speechDuration;
          
          return DetectionResult.yes('speech_start', this._calculateConfidence(currentVolume));
        }
        // 声音还不够长，继续观察
        return DetectionResult.no('potential_speech', 0.5);
      }
      
      // 静音状态
      return DetectionResult.no('silence', 1.0);
      
    } else {
      // 当前在语音中
      const speechDuration = Date.now() - this._speechStartTime;
      
      // 检查是否超时
      if (speechDuration >= this.config.maxSpeechDuration) {
        this._isSpeaking = false;
        return DetectionResult.no('max_duration_reached', 1.0, { 
          speechDuration,
          reason: 'timeout' 
        });
      }
      
      // 检查是否静音太久
      if (!isLoud && context.silenceDuration >= this.config.minSilenceDuration) {
        this._isSpeaking = false;
        return DetectionResult.no('silence_timeout', 1.0, {
          speechDuration,
          silenceDuration: context.silenceDuration,
          reason: 'speech_end'
        });
      }
      
      // 仍在语音中
      if (isLoud) {
        return DetectionResult.yes('speaking', this._calculateConfidence(currentVolume));
      } else {
        // 短暂静音（可能是停顿）
        return DetectionResult.yes('speaking_pause', 0.8);
      }
    }
  }
  
  /**
   * 自适应阈值调整
   * @param {AudioContext} context 
   */
  adapt(context) {
    if (!this.config.adaptiveThreshold) return;
    
    this._updateAdaptiveThreshold(context);
  }
  
  /**
   * 更新自适应阈值
   * @private
   */
  _updateAdaptiveThreshold(context) {
    // 只在静音时更新噪音基底
    if (context.currentState === DetectorState.SILENCE) {
      const currentVolume = context.currentVolume;
      
      // 指数移动平均更新噪音基底
      this.config.noiseFloor = 
        this.config.noiseFloor * (1 - this.config.noiseAdaptationRate) +
        currentVolume * this.config.noiseAdaptationRate;
      
      // 更新有效阈值 = 噪音基底 * 3
      this._effectiveThreshold = Math.max(
        0.01,
        this.config.noiseFloor * 3
      );
    }
  }
  
  /**
   * 计算置信度
   * @private
   */
  _calculateConfidence(volume) {
    // 音量越大置信度越高
    const ratio = volume / this._effectiveThreshold;
    return Math.min(1, 0.5 + ratio * 0.5);
  }
  
  /**
   * 重置状态
   */
  reset() {
    super.reset();
    this._isSpeaking = false;
    this._speechStartTime = null;
    this._effectiveThreshold = this.config.volumeThreshold;
  }
  
  /**
   * 获取当前状态信息
   */
  getStatus() {
    return {
      ...this.getInfo(),
      effectiveThreshold: this._effectiveThreshold,
      isSpeaking: this._isSpeaking,
      speechStartTime: this._speechStartTime
    };
  }
}

/**
 * 基于能量的语音检测器（进阶版）
 * 使用 WebRTC VAD 算法的简化版
 */
export class EnergyBasedSpeechDetector extends SpeechDetector {
  constructor(config = {}) {
    super('energy-based', config);
    
    this.config = {
      // 能量阈值
      energyThreshold: 0.01,
      
      // 过零率阈值（区分清音/浊音）
      zcrThreshold: 0.1,
      
      // 时间阈值
      minSpeechFrames: 3,
      minSilenceFrames: 15,
      
      ...config
    };
    
    this._frames = [];
    this._isSpeaking = false;
  }
  
  /**
   * 检测是否为有效语音
   * @param {AudioContext} context 
   * @returns {DetectionResult}
   */
  detect(context) {
    const currentChunk = context.recentChunks[context.recentChunks.length - 1];
    if (!currentChunk) {
      return DetectionResult.no('no_data');
    }
    
    // 计算特征
    const volume = currentChunk.volume;
    const zcr = AudioUtils.calculateZeroCrossingRate(currentChunk.data);
    
    // 判断是否为语音帧
    // 条件：音量足够 且 过零率适中（语音的过零率通常比噪音低）
    const isSpeechFrame = volume > this.config.energyThreshold && 
                          zcr < this.config.zcrThreshold;
    
    // 记录帧
    this._frames.push(isSpeechFrame);
    if (this._frames.length > 50) {
      this._frames.shift();
    }
    
    // 统计
    const recentFrames = this._frames.slice(-10);
    const speechFrameCount = recentFrames.filter(f => f).length;
    
    if (!this._isSpeaking) {
      // 未在语音中
      if (speechFrameCount >= this.config.minSpeechFrames) {
        this._isSpeaking = true;
        return DetectionResult.yes('energy_start', speechFrameCount / 10);
      }
      return DetectionResult.no('silence', 1 - speechFrameCount / 10);
    } else {
      // 在语音中
      const silenceFrameCount = recentFrames.filter(f => !f).length;
      
      if (silenceFrameCount >= this.config.minSilenceFrames) {
        this._isSpeaking = false;
        return DetectionResult.no('energy_end', 1.0, { silenceFrameCount });
      }
      
      return DetectionResult.yes('energy_speaking', speechFrameCount / 10);
    }
  }
  
  reset() {
    super.reset();
    this._frames = [];
    this._isSpeaking = false;
  }
}

// 注册到工厂
SpeechDetectorFactory.register('volume', VolumeBasedSpeechDetector);
SpeechDetectorFactory.register('energy', EnergyBasedSpeechDetector);

export default VolumeBasedSpeechDetector;
