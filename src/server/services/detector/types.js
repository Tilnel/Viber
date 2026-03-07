/**
 * Speech Detector Types
 * 语音检测器标准接口定义
 * 
 * @phase 2
 * @module services/detector
 */

/**
 * 检测器状态
 */
export const DetectorState = {
  SILENCE: 'silence',     // 静音
  SPEECH: 'speech',       // 有语音
  NOISE: 'noise',         // 噪音（有声音但不是语音）
  UNKNOWN: 'unknown'      // 未知/初始状态
};

/**
 * 音频分片数据结构
 */
export class AudioChunk {
  constructor(data, timestamp = Date.now()) {
    this.data = data;                    // PCM Buffer
    this.timestamp = timestamp;          // 时间戳
    this.duration = data.length / 2 / 16; // 时长(ms): bytes / 2(16bit) / 16(sampleRate/1000)
    
    // 预计算特征（可选，由检测器填充）
    this.volume = 0;                     // 音量 0-1
    this.features = {};                  // 其他特征
  }
}

/**
 * 音频上下文
 * 用于 SpeechDetector.detect() 的输入
 */
export class AudioContext {
  constructor() {
    // 原始数据
    this.recentChunks = [];              // 最近 N 个音频分片
    this.maxChunks = 100;                // 最大保留分片数（约 2.5s @ 16kHz, 256ms/chunk）
    
    // 特征历史
    this.volumeHistory = [];             // 音量历史
    this.maxHistoryLength = 50;          // 最大历史长度
    
    // VAD 分数（由高级检测器填充）
    this.vadScores = [];                 // VAD 模型输出 0-1
    
    // 状态累计
    this.currentState = DetectorState.UNKNOWN;
    this.stateDuration = 0;              // 当前状态持续时间(ms)
    this.silenceDuration = 0;            // 当前连续静音时长
    this.speechDuration = 0;             // 当前连续语音时长
    this.totalDuration = 0;              // 总会话时长
    
    // 历史决策
    this.lastResult = false;
    this.detectionHistory = [];          // 最近 N 次检测结果
    this.maxDetectionHistory = 20;
    
    // 环境噪音水平（用于自适应阈值）
    this.noiseFloor = 0.01;              // 噪音基底
  }
  
  /**
   * 添加新的音频分片
   * @param {AudioChunk} chunk 
   */
  addChunk(chunk) {
    this.recentChunks.push(chunk);
    if (this.recentChunks.length > this.maxChunks) {
      this.recentChunks.shift();
    }
    
    // 添加音量历史
    this.volumeHistory.push(chunk.volume);
    if (this.volumeHistory.length > this.maxHistoryLength) {
      this.volumeHistory.shift();
    }
    
    // 更新时间
    this.totalDuration += chunk.duration;
  }
  
  /**
   * 更新检测状态
   * @param {boolean} isSpeech 
   * @param {number} duration 
   */
  updateState(isSpeech, duration) {
    const newState = isSpeech ? DetectorState.SPEECH : DetectorState.SILENCE;
    
    if (newState === this.currentState) {
      this.stateDuration += duration;
      if (isSpeech) {
        this.speechDuration += duration;
        this.silenceDuration = 0;
      } else {
        this.silenceDuration += duration;
        this.speechDuration = 0;
      }
    } else {
      // 状态切换
      this.currentState = newState;
      this.stateDuration = duration;
      if (isSpeech) {
        this.speechDuration = duration;
        this.silenceDuration = 0;
      } else {
        this.silenceDuration = duration;
        this.speechDuration = 0;
      }
    }
    
    // 记录历史
    this.lastResult = isSpeech;
    this.detectionHistory.push({
      result: isSpeech,
      timestamp: Date.now(),
      state: newState
    });
    if (this.detectionHistory.length > this.maxDetectionHistory) {
      this.detectionHistory.shift();
    }
  }
  
  /**
   * 获取当前音量
   */
  get currentVolume() {
    return this.volumeHistory.length > 0 
      ? this.volumeHistory[this.volumeHistory.length - 1] 
      : 0;
  }
  
  /**
   * 获取平均音量（最近 N 帧）
   * @param {number} n 
   */
  getAverageVolume(n = 10) {
    const samples = this.volumeHistory.slice(-n);
    if (samples.length === 0) return 0;
    return samples.reduce((a, b) => a + b, 0) / samples.length;
  }
  
  /**
   * 获取音量变化趋势（上升/下降/平稳）
   */
  getVolumeTrend() {
    if (this.volumeHistory.length < 5) return 'flat';
    
    const recent = this.volumeHistory.slice(-5);
    const prev = this.volumeHistory.slice(-10, -5);
    
    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const prevAvg = prev.length > 0 ? prev.reduce((a, b) => a + b, 0) / prev.length : recentAvg;
    
    const diff = recentAvg - prevAvg;
    if (diff > 0.05) return 'rising';
    if (diff < -0.05) return 'falling';
    return 'flat';
  }
}

/**
 * 检测结果
 */
export class DetectionResult {
  constructor(isSpeech, confidence = 1.0, reason = 'unknown', metadata = {}) {
    this.isSpeech = isSpeech;            // boolean
    this.confidence = confidence;        // 0-1
    this.reason = reason;                // 决策原因
    this.timestamp = Date.now();
    this.metadata = metadata;            // 额外信息
  }
  
  /**
   * 快速创建肯定结果
   */
  static yes(reason, confidence = 1.0) {
    return new DetectionResult(true, confidence, reason);
  }
  
  /**
   * 快速创建否定结果
   */
  static no(reason, confidence = 1.0) {
    return new DetectionResult(false, confidence, reason);
  }
}

/**
 * SpeechDetector 接口定义
 * 所有语音检测器必须实现此接口
 */
export class SpeechDetector {
  /**
   * @param {string} name - 检测器名称
   * @param {Object} config - 配置选项
   */
  constructor(name, config = {}) {
    this.name = name;
    this.config = config;
    this.state = DetectorState.UNKNOWN;
  }
  
  /**
   * 检测是否为有效语音
   * @param {AudioContext} context - 音频上下文
   * @returns {DetectionResult}
   */
  detect(context) {
    throw new Error('Not implemented');
  }
  
  /**
   * 自适应调整（可选）
   * 根据环境噪音动态调整参数
   * @param {AudioContext} context 
   */
  adapt(context) {
    // 可选实现
  }
  
  /**
   * 重置状态
   */
  reset() {
    this.state = DetectorState.UNKNOWN;
  }
  
  /**
   * 获取检测器信息
   */
  getInfo() {
    return {
      name: this.name,
      config: this.config,
      state: this.state
    };
  }
}

/**
 * 检测器配置（基类默认配置）
 */
export const DefaultDetectorConfig = {
  // 音量阈值 0-1
  volumeThreshold: 0.02,
  
  // 时间阈值（帧数）
  minSpeechFrames: 5,       // 最少连续语音帧数（约 1.25s @ 256ms/frame）
  minSilenceFrames: 20,     // 静音多少帧判定结束（约 5s）
  maxSpeechFrames: 200,     // 最大语音帧数（约 50s）
  
  // 自适应配置
  adaptiveThreshold: false,  // 是否启用自适应阈值
  noiseAdaptationRate: 0.1  // 噪音适应速率
};

/**
 * 检测器工厂
 */
export class SpeechDetectorFactory {
  static detectors = new Map();
  
  /**
   * 注册检测器
   * @param {string} name 
   * @param {typeof SpeechDetector} detectorClass 
   */
  static register(name, detectorClass) {
    SpeechDetectorFactory.detectors.set(name, detectorClass);
  }
  
  /**
   * 创建检测器实例
   * @param {string} name 
   * @param {Object} config 
   * @returns {SpeechDetector}
   */
  static create(name, config = {}) {
    const DetectorClass = SpeechDetectorFactory.detectors.get(name);
    if (!DetectorClass) {
      throw new Error(`Unknown detector: ${name}`);
    }
    return new DetectorClass(config);
  }
  
  /**
   * 获取可用检测器列表
   */
  static getAvailable() {
    return Array.from(SpeechDetectorFactory.detectors.keys());
  }
}

/**
 * 音量计算工具函数
 */
export class AudioUtils {
  /**
   * 计算 PCM 数据的音量（RMS）
   * @param {Buffer} pcmData - 16bit PCM
   * @returns {number} 音量 0-1
   */
  static calculateVolume(pcmData) {
    if (pcmData.length < 2) return 0;
    
    let sum = 0;
    let samples = 0;
    
    // 16bit 小端序
    for (let i = 0; i < pcmData.length - 1; i += 2) {
      const sample = pcmData.readInt16LE(i);
      sum += sample * sample;
      samples++;
    }
    
    if (samples === 0) return 0;
    
    const rms = Math.sqrt(sum / samples);
    // 归一化到 0-1（16bit 最大值为 32768）
    return Math.min(1, rms / 32768);
  }
  
  /**
   * 计算过零率（用于区分噪音/语音）
   * @param {Buffer} pcmData 
   * @returns {number}
   */
  static calculateZeroCrossingRate(pcmData) {
    if (pcmData.length < 4) return 0;
    
    let crossings = 0;
    let prevSample = pcmData.readInt16LE(0);
    
    for (let i = 2; i < pcmData.length - 1; i += 2) {
      const sample = pcmData.readInt16LE(i);
      if ((prevSample > 0 && sample < 0) || (prevSample < 0 && sample > 0)) {
        crossings++;
      }
      prevSample = sample;
    }
    
    return crossings / (pcmData.length / 2);
  }
  
  /**
   * 计算动态阈值
   * @param {number[]} volumeHistory 
   * @returns {number}
   */
  static calculateDynamicThreshold(volumeHistory) {
    if (volumeHistory.length < 10) return 0.02;
    
    // 取最近 10 帧的最小值作为噪音基底
    const recent = volumeHistory.slice(-10);
    const noiseFloor = Math.min(...recent);
    
    // 阈值 = 噪音基底 * 3
    return Math.max(0.01, noiseFloor * 3);
  }
}
