/**
 * Speaker Controller Types
 * 语音播报控制器类型定义
 * 
 * @phase 3
 * @module services/speaker
 */

/**
 * 播报任务类型
 */
export const SpeakTaskType = {
  THINKING: 'thinking',     // AI 思考过程
  RESPONSE: 'response',     // AI 回复
  TOOL_RESULT: 'tool_result', // 工具执行结果
  NOTIFICATION: 'notification' // 系统通知
};

/**
 * 播报任务优先级
 */
export const SpeakPriority = {
  CRITICAL: 0,      // 紧急（打断一切）
  HIGH: 1,          // 高（新回复）
  NORMAL: 2,        // 普通
  LOW: 3            // 低（思考过程）
};

/**
 * 播报任务
 */
export class SpeakTask {
  constructor(data) {
    this.id = data.id || generateTaskId();
    this.type = data.type || SpeakTaskType.RESPONSE;
    this.text = data.text;
    
    // 优先级（可以覆盖）
    this.priority = data.priority ?? this._getDefaultPriority();
    
    // 音频数据
    this.audioData = data.audioData || null;  // Buffer/Uint8Array
    this.audioUrl = data.audioUrl || null;    // URL（如果已缓存）
    this.format = data.format || 'mp3';
    this.duration = data.duration || 0;       // 预估时长（秒）
    
    // TTS 请求选项
    this.ttsOptions = data.ttsOptions || {};
    
    // 元数据
    this.createdAt = Date.now();
    this.startedAt = null;
    this.completedAt = null;
    
    // 状态
    this.state = 'pending'; // pending | synthesizing | playing | completed | cancelled
    
    // 关联信息
    this.sessionId = data.sessionId;      // 所属会话
    this.messageId = data.messageId;      // 关联消息
  }
  
  /**
   * 获取默认优先级
   */
  _getDefaultPriority() {
    switch (this.type) {
      case SpeakTaskType.THINKING:
        return SpeakPriority.LOW;
      case SpeakTaskType.RESPONSE:
        return SpeakPriority.HIGH;
      case SpeakTaskType.TOOL_RESULT:
        return SpeakPriority.NORMAL;
      case SpeakTaskType.NOTIFICATION:
        return SpeakPriority.CRITICAL;
      default:
        return SpeakPriority.NORMAL;
    }
  }
  
  /**
   * 标记开始播放
   */
  markStarted() {
    this.state = 'playing';
    this.startedAt = Date.now();
  }
  
  /**
   * 标记完成
   */
  markCompleted() {
    this.state = 'completed';
    this.completedAt = Date.now();
  }
  
  /**
   * 标记取消
   */
  markCancelled() {
    this.state = 'cancelled';
    this.completedAt = Date.now();
  }
  
  /**
   * 获取等待时间
   */
  getWaitTime() {
    if (this.startedAt) {
      return this.startedAt - this.createdAt;
    }
    return Date.now() - this.createdAt;
  }
  
  /**
   * 获取播放耗时
   */
  getPlayDuration() {
    if (this.completedAt && this.startedAt) {
      return this.completedAt - this.startedAt;
    }
    if (this.startedAt) {
      return Date.now() - this.startedAt;
    }
    return 0;
  }
}

/**
 * Speaker Controller 接口
 * 管理 TTS 队列，保证串行播放
 */
export class SpeakerController {
  constructor(config = {}) {
    this.config = {
      maxQueueSize: 10,           // 最大队列长度
      defaultTTSEngine: 'volcano', // 默认 TTS 引擎
      enableCache: true,          // 启用缓存
      ...config
    };
    
    // 队列
    this.queue = [];              // 等待中的任务
    this.currentTask = null;      // 当前播放的任务
    this.history = [];            // 已完成任务历史（保留最近 N 个）
    this.maxHistorySize = 50;
    
    // 状态
    this.state = 'idle';          // idle | playing | paused
    
    // 统计
    this.stats = {
      totalTasks: 0,
      completedTasks: 0,
      cancelledTasks: 0,
      totalPlayDuration: 0,
      avgWaitTime: 0
    };
    
    // 事件监听
    this.listeners = new Map();
    
    // TTS 服务（由外部注入）
    this.ttsService = null;
  }
  
  /**
   * 设置 TTS 服务
   * @param {TTSService} ttsService 
   */
  setTTSService(ttsService) {
    this.ttsService = ttsService;
  }
  
  /**
   * 添加播报任务
   * @param {SpeakTask} task 
   * @returns {string} taskId
   */
  async enqueue(task) {
    throw new Error('Not implemented');
  }
  
  /**
   * 停止当前播放并清空队列
   */
  stop() {
    throw new Error('Not implemented');
  }
  
  /**
   * 跳过当前任务，播放下一个
   */
  skip() {
    throw new Error('Not implemented');
  }
  
  /**
   * 暂停播放
   */
  pause() {
    throw new Error('Not implemented');
  }
  
  /**
   * 恢复播放
   */
  resume() {
    throw new Error('Not implemented');
  }
  
  /**
   * 获取当前状态
   */
  getStatus() {
    return {
      state: this.state,
      queueLength: this.queue.length,
      currentTask: this.currentTask ? {
        id: this.currentTask.id,
        type: this.currentTask.type,
        text: this.currentTask.text.substring(0, 50) + '...',
        progress: this.currentTask.getPlayDuration() / (this.currentTask.duration * 1000)
      } : null,
      stats: { ...this.stats }
    };
  }
  
  /**
   * 注册事件监听
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
  }
  
  /**
   * 移除事件监听
   */
  off(event, callback) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.delete(callback);
    }
  }
  
  /**
   * 触发事件
   */
  emit(event, data) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach(cb => cb(data));
    }
  }
  
  /**
   * 更新统计
   */
  _updateStats(task) {
    this.stats.totalTasks++;
    if (task.state === 'completed') {
      this.stats.completedTasks++;
      this.stats.totalPlayDuration += task.getPlayDuration();
    } else if (task.state === 'cancelled') {
      this.stats.cancelledTasks++;
    }
    
    // 更新平均等待时间
    const waitTime = task.getWaitTime();
    this.stats.avgWaitTime = 
      (this.stats.avgWaitTime * (this.stats.totalTasks - 1) + waitTime) / 
      this.stats.totalTasks;
  }
}

/**
 * 前端指令类型
 * 用于向后端发送控制命令
 */
export const SpeakerCommand = {
  SPEAK: 'speak',           // 请求播报
  STOP: 'stop',             // 停止所有
  SKIP: 'skip',             // 跳过当前
  PAUSE: 'pause',           // 暂停
  RESUME: 'resume'          // 恢复
};

/**
 * 后端事件类型
 * 用于向前端发送状态更新
 */
export const SpeakerEvent = {
  TASK_ADDED: 'task_added',           // 任务加入队列
  TASK_STARTED: 'task_started',       // 开始播放
  TASK_COMPLETED: 'task_completed',   // 播放完成
  TASK_CANCELLED: 'task_cancelled',   // 任务取消
  QUEUE_CLEARED: 'queue_cleared',     // 队列清空
  STATE_CHANGED: 'state_changed'      // 状态变化
};

/**
 * 生成任务 ID
 */
function generateTaskId() {
  return `speak-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export default SpeakerController;
