/**
 * Speaker Controller Implementation
 * 语音播报控制器实现
 * 
 * @phase 3
 * @implements {SpeakerController}
 */

import {
  SpeakerController,
  SpeakTask,
  SpeakTaskType,
  SpeakPriority,
  SpeakerEvent
} from './types.js';

/**
 * Speaker Controller 实现
 */
export class SpeakerControllerImpl extends SpeakerController {
  constructor(config = {}) {
    super(config);
    
    // 播放状态
    this._playPromise = null;     // 当前播放的 Promise
    this._stopRequested = false;  // 是否请求停止
    this._pauseRequested = false; // 是否请求暂停
    
    // 缓存
    this._cache = new Map();
    this._cacheMaxSize = 100;
    
    console.log('[SpeakerController] Initialized');
  }
  
  /**
   * 添加播报任务到队列
   */
  async enqueue(task) {
    // 检查队列长度
    if (this.queue.length >= this.config.maxQueueSize) {
      // 移除低优先级的旧任务
      const lowPriorityIndex = this.queue.findIndex(
        t => t.priority >= SpeakPriority.LOW && t.type === SpeakTaskType.THINKING
      );
      if (lowPriorityIndex !== -1) {
        const removed = this.queue.splice(lowPriorityIndex, 1)[0];
        removed.markCancelled();
        this.emit(SpeakerEvent.TASK_CANCELLED, { task: removed, reason: 'queue_full' });
      } else {
        throw new Error('Queue full');
      }
    }
    
    // 检查缓存
    const cacheKey = this._getCacheKey(task.text, task.ttsOptions);
    if (this.config.enableCache && this._cache.has(cacheKey)) {
      const cached = this._cache.get(cacheKey);
      task.audioData = cached.audioData;
      task.duration = cached.duration;
      task.state = 'ready';
      console.log(`[SpeakerController] Cache hit for task ${task.id}`);
    }
    
    // 按优先级插入队列
    const insertIndex = this.queue.findIndex(t => t.priority > task.priority);
    if (insertIndex === -1) {
      this.queue.push(task);
    } else {
      this.queue.splice(insertIndex, 0, task);
    }
    
    this.emit(SpeakerEvent.TASK_ADDED, { task, queueLength: this.queue.length });
    
    // 如果空闲，立即开始播放
    if (this.state === 'idle') {
      this._processQueue();
    }
    
    return task.id;
  }
  
  /**
   * 停止所有播报
   */
  stop() {
    console.log('[SpeakerController] Stop requested');
    
    this._stopRequested = true;
    
    // 取消队列中的所有任务
    for (const task of this.queue) {
      task.markCancelled();
      this.emit(SpeakerEvent.TASK_CANCELLED, { task, reason: 'stop' });
      this._updateStats(task);
    }
    this.queue = [];
    
    // 取消当前任务
    if (this.currentTask) {
      this.currentTask.markCancelled();
      this.emit(SpeakerEvent.TASK_CANCELLED, { 
        task: this.currentTask, 
        reason: 'stop' 
      });
      this._updateStats(this.currentTask);
      this.currentTask = null;
    }
    
    this.state = 'idle';
    this._stopRequested = false;
    
    this.emit(SpeakerEvent.QUEUE_CLEARED, {});
    this.emit(SpeakerEvent.STATE_CHANGED, { state: 'idle' });
  }
  
  /**
   * 跳过当前任务
   */
  skip() {
    if (this.currentTask) {
      console.log(`[SpeakerController] Skip task ${this.currentTask.id}`);
      
      this.currentTask.markCancelled();
      this.emit(SpeakerEvent.TASK_CANCELLED, { 
        task: this.currentTask, 
        reason: 'skip' 
      });
      this._updateStats(this.currentTask);
      
      this.currentTask = null;
      this._playPromise = null;
      
      // 继续播放下一个
      this._processQueue();
    }
  }
  
  /**
   * 暂停播放
   */
  pause() {
    if (this.state === 'playing') {
      console.log('[SpeakerController] Pause');
      this._pauseRequested = true;
      this.state = 'paused';
      this.emit(SpeakerEvent.STATE_CHANGED, { state: 'paused' });
    }
  }
  
  /**
   * 恢复播放
   */
  resume() {
    if (this.state === 'paused') {
      console.log('[SpeakerController] Resume');
      this._pauseRequested = false;
      this.state = 'playing';
      this.emit(SpeakerEvent.STATE_CHANGED, { state: 'playing' });
      
      // 继续处理队列
      if (!this.currentTask && this.queue.length > 0) {
        this._processQueue();
      }
    }
  }
  
  /**
   * 处理队列
   * @private
   */
  async _processQueue() {
    if (this.state === 'playing' || this.state === 'paused') {
      return; // 已经在播放中
    }
    
    if (this.queue.length === 0) {
      this.state = 'idle';
      this.emit(SpeakerEvent.STATE_CHANGED, { state: 'idle' });
      return;
    }
    
    // 取下一个任务
    const task = this.queue.shift();
    this.currentTask = task;
    
    // 合成音频（如果还没有）
    if (!task.audioData && this.ttsService) {
      task.state = 'synthesizing';
      try {
        const result = await this._synthesize(task);
        task.audioData = result.audioData;
        task.duration = result.duration;
      } catch (error) {
        console.error(`[SpeakerController] TTS failed for task ${task.id}:`, error);
        task.markCancelled();
        this.emit(SpeakerEvent.TASK_CANCELLED, { task, reason: 'tts_error' });
        this._updateStats(task);
        this.currentTask = null;
        
        // 继续下一个
        this._processQueue();
        return;
      }
    }
    
    // 开始播放
    task.markStarted();
    this.state = 'playing';
    this.emit(SpeakerEvent.TASK_STARTED, { task });
    this.emit(SpeakerEvent.STATE_CHANGED, { state: 'playing' });
    
    // 执行播放
    this._playPromise = this._play(task);
    
    try {
      await this._playPromise;
      
      // 播放完成
      if (task.state !== 'cancelled') {
        task.markCompleted();
        this.emit(SpeakerEvent.TASK_COMPLETED, { task });
        this._updateStats(task);
        
        // 添加到缓存
        this._addToCache(task);
      }
    } catch (error) {
      console.error(`[SpeakerController] Play failed for task ${task.id}:`, error);
      task.markCancelled();
      this.emit(SpeakerEvent.TASK_CANCELLED, { task, reason: 'play_error' });
      this._updateStats(task);
    } finally {
      this.currentTask = null;
      this._playPromise = null;
      
      // 继续下一个
      if (!this._stopRequested) {
        this._processQueue();
      }
    }
  }
  
  /**
   * 合成音频
   * @private
   */
  async _synthesize(task) {
    if (!this.ttsService) {
      throw new Error('TTS service not set');
    }
    
    const result = await this.ttsService.synthesize(task.text, {
      voiceId: task.ttsOptions.voiceId,
      speed: task.ttsOptions.speed,
      volume: task.ttsOptions.volume,
      ...task.ttsOptions
    });
    
    return result;
  }
  
  /**
   * 播放音频
   * @private
   */
  async _play(task) {
    // 这里实现具体的播放逻辑
    // 对于后端，通常是向前端发送指令
    // 实际播放由前端完成
    
    console.log(`[SpeakerController] Playing task ${task.id}: "${task.text.substring(0, 50)}..."`);
    
    // 向前端发送播放指令
    this.emit('play', {
      taskId: task.id,
      audioData: task.audioData,
      format: task.format,
      duration: task.duration
    });
    
    // 等待播放完成（或停止/跳过）
    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        // 检查是否请求停止
        if (this._stopRequested || task.state === 'cancelled') {
          clearInterval(checkInterval);
          resolve(); // 正常结束，不算错误
          return;
        }
        
        // 检查播放是否超时（实际应由前端通知）
        const playDuration = task.getPlayDuration();
        if (playDuration > (task.duration * 1000 + 5000)) {
          // 播放时间超过预期 + 5s 缓冲
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
      
      // 前端应该调用 completed 来通知完成
      this.once(`completed:${task.id}`, () => {
        clearInterval(checkInterval);
        resolve();
      });
    });
  }
  
  /**
   * 标记任务播放完成（由前端调用）
   * @param {string} taskId 
   */
  markCompleted(taskId) {
    this.emit(`completed:${taskId}`, {});
  }
  
  /**
   * 获取缓存键
   * @private
   */
  _getCacheKey(text, options) {
    const key = `${text}|${options.voiceId || ''}|${options.speed || 1}|${options.pitch || 0}`;
    // 简单哈希
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      const char = key.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return String(hash);
  }
  
  /**
   * 添加到缓存
   * @private
   */
  _addToCache(task) {
    if (!this.config.enableCache || !task.audioData) return;
    
    const key = this._getCacheKey(task.text, task.ttsOptions);
    
    // LRU: 如果缓存满了，删除最早的一个
    if (this._cache.size >= this._cacheMaxSize) {
      const firstKey = this._cache.keys().next().value;
      this._cache.delete(firstKey);
    }
    
    this._cache.set(key, {
      audioData: task.audioData,
      duration: task.duration,
      timestamp: Date.now()
    });
  }
  
  /**
   * 清理缓存
   */
  clearCache() {
    this._cache.clear();
  }
  
  /**
   * 获取缓存统计
   */
  getCacheStats() {
    return {
      size: this._cache.size,
      maxSize: this._cacheMaxSize,
      hitRate: this._calculateCacheHitRate()
    };
  }
  
  _calculateCacheHitRate() {
    // 简化实现
    return 0;
  }
  
  /**
   * 一次性事件监听辅助
   */
  once(event, callback) {
    const wrapper = (data) => {
      this.off(event, wrapper);
      callback(data);
    };
    this.on(event, wrapper);
  }
}

export default SpeakerControllerImpl;
