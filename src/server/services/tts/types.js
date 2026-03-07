/**
 * TTS (Text-to-Speech) Service Types
 * 语音合成服务标准接口定义
 * 
 * @phase 1
 * @module services/tts
 */

/**
 * TTS 事件类型
 */
export const TTSEventType = {
  QUEUED: 'queued',       // 任务进入队列
  STARTED: 'started',     // 开始合成
  PROGRESS: 'progress',   // 合成进度（流式）
  COMPLETED: 'completed', // 合成完成
  ERROR: 'error',         // 合成错误
  CANCELLED: 'cancelled'  // 任务被取消
};

/**
 * 音频输出格式
 */
export const AudioOutputFormat = {
  MP3: 'mp3',     // 压缩，兼容性最好，延迟稍高
  WAV: 'wav',     // 无损，文件大
  PCM: 'pcm',     // 原始，延迟最低
  OPUS: 'opus'    // 压缩率高，适合网络传输
};

/**
 * TTS 配置选项
 */
export const DefaultTTSConfig = {
  // 默认音色
  voiceId: 'zh-CN-XiaoxiaoNeural',  // Edge TTS 默认
  
  // 语速：0.5 - 2.0，1.0 为正常
  speed: 1.0,
  
  // 音量：0 - 100
  volume: 100,
  
  // 音调：-20 - 20，0 为正常
  pitch: 0,
  
  // 输出格式
  outputFormat: AudioOutputFormat.MP3,
  
  // 采样率
  sampleRate: 24000,
  
  // 是否流式输出
  streaming: true,
  
  // 引擎特定配置
  engineConfig: {
    // 火山引擎
    volcano: {
      voiceType: 'BV001_streaming',  // 默认音色
      encoding: 'mp3',
      language: 'zh'
    },
    // Edge TTS
    edge: {
      // Edge 使用 voiceId 选择音色
    },
    // Piper
    piper: {
      speakerId: 0,  // 多说话人模型的说话人 ID
      lengthScale: 1.0,  // 语速调节
      noiseScale: 0.667,
      noiseW: 0.8
    }
  }
};

/**
 * TTS 服务接口定义
 * 所有 TTS 引擎必须实现此接口
 */
export class TTSService {
  /**
   * @param {Object} config - 服务配置
   */
  constructor(config = {}) {
    this.config = { ...DefaultTTSConfig, ...config };
    this.name = 'base'; // 引擎名称，子类覆盖
  }
  
  /**
   * 合成语音（异步，返回完整音频）
   * @param {string} text - 要合成的文本
   * @param {Object} options - 合成选项
   * @returns {Promise<TTSResult>} 合成结果
   */
  async synthesize(text, options = {}) {
    throw new Error('Not implemented');
  }
  
  /**
   * 流式合成（实时返回音频流）
   * @param {string} text - 要合成的文本
   * @param {Object} options - 合成选项
   * @returns {Promise<ReadableStream>} 音频流
   */
  async synthesizeStream(text, options = {}) {
    throw new Error('Not implemented');
  }
  
  /**
   * 取消指定任务
   * @param {string} taskId - 任务 ID
   */
  async cancel(taskId) {
    throw new Error('Not implemented');
  }
  
  /**
   * 取消所有任务
   */
  async cancelAll() {
    throw new Error('Not implemented');
  }
  
  /**
   * 获取支持的音色列表
   * @returns {Promise<VoiceInfo[]>}
   */
  async getVoices() {
    throw new Error('Not implemented');
  }
  
  /**
   * 获取服务状态
   * @returns {Promise<ServiceStatus>}
   */
  async getStatus() {
    throw new Error('Not implemented');
  }
  
  /**
   * 预热/初始化引擎
   * 某些引擎（如 Piper）需要预热
   */
  async warmup() {
    // 可选实现
  }
}

/**
 * TTS 任务信息
 */
export class TTSTask {
  constructor(text, options = {}) {
    this.id = options.taskId || generateTaskId();
    this.text = text;
    this.options = { ...DefaultTTSConfig, ...options };
    
    this.state = 'pending'; // pending | synthesizing | completed | error | cancelled
    this.createdAt = Date.now();
    this.startedAt = null;
    this.completedAt = null;
    
    this.audioData = null;      // 完整音频数据（非流式）
    this.audioDuration = 0;     // 预估时长（秒）
    this.error = null;
    
    // 事件监听
    this.listeners = new Map();
  }
  
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
  }
  
  off(event, callback) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.delete(callback);
    }
  }
  
  emit(event, data) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach(cb => cb(data));
    }
  }
}

/**
 * TTS 合成结果
 */
export class TTSResult {
  constructor(data) {
    this.taskId = data.taskId;
    this.text = data.text;
    
    // 音频数据（二选一）
    this.audioData = data.audioData;      // Buffer/Uint8Array
    this.audioUrl = data.audioUrl;        // URL（缓存场景）
    
    // 元数据
    this.format = data.format;            // mp3 | wav | pcm
    this.duration = data.duration;        // 秒
    this.sampleRate = data.sampleRate;
    
    // 使用的音色
    this.voiceId = data.voiceId;
    
    // 性能数据
    this.latency = data.latency;          // 首包延迟（ms）
    this.totalTime = data.totalTime;      // 总耗时（ms）
  }
}

/**
 * 音色信息
 */
export class VoiceInfo {
  constructor(data) {
    this.id = data.id;                    // 唯一标识
    this.name = data.name;                // 显示名称
    this.language = data.language;        // 语言代码
    this.gender = data.gender;            // male | female | neutral
    this.engine = data.engine;            // 所属引擎
    
    // 风格标签
    this.styles = data.styles || [];      // ['calm', 'cheerful', 'serious']
    
    // 预览文本
    this.previewText = data.previewText || '你好，这是一个语音示例。';
    
    // 限制
    this.supportsSpeed = data.supportsSpeed !== false;
    this.supportsPitch = data.supportsPitch !== false;
    this.supportsVolume = data.supportsVolume !== false;
    this.maxTextLength = data.maxTextLength || 5000;
  }
}

/**
 * TTS 服务工厂
 */
export class TTSServiceFactory {
  static engines = new Map();
  static defaultEngine = 'edge';
  
  /**
   * 注册 TTS 引擎
   * @param {string} name - 引擎名称
   * @param {typeof TTSService} engineClass - 引擎类
   */
  static register(name, engineClass) {
    TTSServiceFactory.engines.set(name, engineClass);
  }
  
  /**
   * 创建 TTS 服务实例
   * @param {string} name - 引擎名称，不传则使用默认
   * @param {Object} config - 配置
   * @returns {TTSService}
   */
  static create(name, config = {}) {
    const engineName = name || TTSServiceFactory.defaultEngine;
    const EngineClass = TTSServiceFactory.engines.get(engineName);
    if (!EngineClass) {
      throw new Error(`Unknown TTS engine: ${engineName}`);
    }
    return new EngineClass(config);
  }
  
  /**
   * 设置默认引擎
   * @param {string} name 
   */
  static setDefault(name) {
    TTSServiceFactory.defaultEngine = name;
  }
  
  /**
   * 获取支持的引擎列表
   * @returns {string[]}
   */
  static getAvailableEngines() {
    return Array.from(TTSServiceFactory.engines.keys());
  }
}

/**
 * 生成任务 ID
 */
function generateTaskId() {
  return `tts-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * 服务状态
 */
export class ServiceStatus {
  constructor() {
    this.online = false;
    this.latency = -1;
    this.activeTasks = 0;
    this.queueLength = 0;
    this.totalRequests = 0;
    this.errorRate = 0;
    this.lastChecked = null;
    
    // TTS 特有
    this.avgSynthesisTime = 0;  // 平均合成时间
    this.cacheHitRate = 0;      // 缓存命中率
  }
}

/**
 * TTS 队列管理器（用于 Speaker Controller）
 */
export class TTSQueue {
  constructor(maxConcurrent = 1) {
    this.maxConcurrent = maxConcurrent;
    this.queue = [];          // 等待中的任务
    this.active = new Map();  // 进行中的任务
    this.completed = [];      // 已完成的任务（保留最近 N 个）
    
    this.listeners = new Map();
  }
  
  /**
   * 添加任务到队列
   * @param {TTSTask} task 
   * @param {number} priority - 优先级（数字越小优先级越高）
   */
  enqueue(task, priority = 0) {
    const item = { task, priority, enqueuedAt: Date.now() };
    
    // 按优先级插入
    const index = this.queue.findIndex(i => i.priority > priority);
    if (index === -1) {
      this.queue.push(item);
    } else {
      this.queue.splice(index, 0, item);
    }
    
    task.state = 'pending';
    this.emit('queued', task);
    
    // 尝试执行
    this._tryExecute();
  }
  
  /**
   * 取消指定任务
   * @param {string} taskId 
   */
  cancel(taskId) {
    // 从队列中移除
    const queueIndex = this.queue.findIndex(i => i.task.id === taskId);
    if (queueIndex !== -1) {
      const { task } = this.queue.splice(queueIndex, 1)[0];
      task.state = 'cancelled';
      task.emit('cancelled');
      this.emit('cancelled', task);
      return true;
    }
    
    // 取消进行中的任务
    const activeTask = this.active.get(taskId);
    if (activeTask) {
      activeTask.state = 'cancelled';
      activeTask.emit('cancelled');
      this.emit('cancelled', activeTask);
      this.active.delete(taskId);
      this._tryExecute();
      return true;
    }
    
    return false;
  }
  
  /**
   * 取消所有任务
   */
  cancelAll() {
    // 取消队列中的
    while (this.queue.length > 0) {
      const { task } = this.queue.shift();
      task.state = 'cancelled';
      task.emit('cancelled');
    }
    
    // 取消进行中的
    for (const [id, task] of this.active) {
      task.state = 'cancelled';
      task.emit('cancelled');
    }
    this.active.clear();
    
    this.emit('cancelled_all');
  }
  
  /**
   * 获取队列状态
   */
  getStatus() {
    return {
      queued: this.queue.length,
      active: this.active.size,
      completed: this.completed.length
    };
  }
  
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
  }
  
  emit(event, data) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach(cb => cb(data));
    }
  }
  
  _tryExecute() {
    // 子类实现具体执行逻辑
  }
}
