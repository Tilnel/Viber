/**
 * ASR (Automatic Speech Recognition) Service Types
 * 语音识别服务标准接口定义
 * 
 * @phase 1
 * @module services/asr
 */

/**
 * 音频格式规范
 * 输入音频必须严格符合此格式
 */
export const AudioFormat = {
  SAMPLE_RATE: 16000,    // 16kHz
  BITS: 16,              // 16bit
  CHANNELS: 1,           // Mono
  ENDIAN: 'LE',          // Little Endian
  
  // 验证音频格式
  validate(buffer) {
    // PCM 格式检查：长度必须是 2 的倍数（16bit = 2 bytes）
    if (buffer.length % 2 !== 0) {
      return { valid: false, error: 'Invalid PCM buffer length (must be even)' };
    }
    return { valid: true };
  }
};

/**
 * ASR 事件类型
 */
export const ASREventType = {
  STARTED: 'started',     // 识别会话开始
  INTERIM: 'interim',     // 中间结果（会变化）
  FINAL: 'final',         // 最终结果
  ERROR: 'error',         // 识别错误
  ENDED: 'ended'          // 识别会话结束
};

/**
 * ASR 配置选项
 */
export const DefaultASRConfig = {
  // 音频参数（通常不需要修改）
  sampleRate: AudioFormat.SAMPLE_RATE,
  bits: AudioFormat.BITS,
  channels: AudioFormat.CHANNELS,
  
  // 语言设置
  language: 'zh-CN',
  
  // 引擎特定配置（火山引擎）
  engineConfig: {
    cluster: 'volcengine_streaming_common',
    enablePunctuation: true,
    enableITN: true,
    showUtterances: true
  },
  
  // 超时配置
  timeout: {
    connect: 5000,        // 连接超时 5s
    maxSessionDuration: 60000,  // 最大会话时长 60s
    silenceTimeout: 3000  // 静音超时 3s（由后端控制，非 ASR）
  }
};

/**
 * ASR 服务接口定义
 * 所有 ASR 引擎必须实现此接口
 */
export class ASRService {
  /**
   * 创建识别会话
   * @param {string} sessionId - 会话唯一标识
   * @param {Object} config - 配置选项
   * @returns {Promise<ASRSession>} 会话对象
   */
  async createSession(sessionId, config = {}) {
    throw new Error('Not implemented');
  }
  
  /**
   * 关闭识别会话
   * @param {string} sessionId 
   */
  async closeSession(sessionId) {
    throw new Error('Not implemented');
  }
  
  /**
   * 获取支持的语音列表
   * @returns {Promise<LanguageInfo[]>}
   */
  async getSupportedLanguages() {
    throw new Error('Not implemented');
  }
  
  /**
   * 获取服务状态
   * @returns {Promise<ServiceStatus>}
   */
  async getStatus() {
    throw new Error('Not implemented');
  }
}

/**
 * ASR 会话接口
 * 表示一个正在进行的识别会话
 */
export class ASRSession {
  constructor(sessionId, config) {
    this.sessionId = sessionId;
    this.config = { ...DefaultASRConfig, ...config };
    this.state = 'idle'; // idle | listening | processing | ended
    this.createdAt = Date.now();
    this.lastActivityAt = Date.now();
  }
  
  /**
   * 发送音频数据
   * @param {Buffer} audioData - PCM 格式音频数据
   * @returns {Promise<void>}
   */
  async sendAudio(audioData) {
    throw new Error('Not implemented');
  }
  
  /**
   * 结束音频输入，请求最终结果
   * @returns {Promise<void>}
   */
  async finalize() {
    throw new Error('Not implemented');
  }
  
  /**
   * 强制结束会话
   */
  async terminate() {
    throw new Error('Not implemented');
  }
  
  /**
   * 注册事件回调
   * @param {ASREventType} event - 事件类型
   * @param {Function} callback - 回调函数
   */
  on(event, callback) {
    throw new Error('Not implemented');
  }
  
  /**
   * 移除事件回调
   * @param {ASREventType} event 
   * @param {Function} callback 
   */
  off(event, callback) {
    throw new Error('Not implemented');
  }
}

/**
 * ASR 事件数据结构
 */
export class ASREvent {
  constructor(type, data = {}) {
    this.type = type;           // ASREventType
    this.sessionId = data.sessionId;
    this.timestamp = Date.now();
    
    // 识别结果（interim/final 时有）
    this.text = data.text || '';
    this.confidence = data.confidence || 0;
    this.utterances = data.utterances || []; // 详细分句信息
    
    // 错误信息（error 时有）
    this.errorCode = data.errorCode;
    this.errorMessage = data.errorMessage;
    
    // 元数据
    this.duration = data.duration;  // 音频时长（ms）
  }
}

/**
 * 语音分句信息（火山引擎特有）
 */
export class UtteranceInfo {
  constructor(data) {
    this.text = data.text;
    this.definite = data.definite;        // 是否是确定结果
    this.startTime = data.start_time;     // 开始时间（ms）
    this.endTime = data.end_time;         // 结束时间（ms）
    this.confidence = data.confidence;
    this.words = data.words || [];        // 词级别信息
  }
}

/**
 * 服务状态
 */
export class ServiceStatus {
  constructor() {
    this.online = false;
    this.latency = -1;        // 延迟（ms）
    this.activeSessions = 0;  // 当前活跃会话数
    this.totalRequests = 0;   // 总请求数
    this.errorRate = 0;       // 错误率（0-1）
    this.lastChecked = null;
  }
}

/**
 * ASR 服务工厂
 * 用于创建不同引擎的 ASR 服务实例
 */
export class ASRServiceFactory {
  static engines = new Map();
  
  /**
   * 注册 ASR 引擎
   * @param {string} name - 引擎名称
   * @param {typeof ASRService} engineClass - 引擎类
   */
  static register(name, engineClass) {
    ASRServiceFactory.engines.set(name, engineClass);
  }
  
  /**
   * 创建 ASR 服务实例
   * @param {string} name - 引擎名称
   * @param {Object} config - 配置
   * @returns {ASRService}
   */
  static create(name, config = {}) {
    const EngineClass = ASRServiceFactory.engines.get(name);
    if (!EngineClass) {
      throw new Error(`Unknown ASR engine: ${name}`);
    }
    return new EngineClass(config);
  }
  
  /**
   * 获取支持的引擎列表
   * @returns {string[]}
   */
  static getAvailableEngines() {
    return Array.from(ASRServiceFactory.engines.keys());
  }
}
