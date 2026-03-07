/**
 * LLM Service Implementation
 * LLM 服务实现
 * 
 * @phase 3
 * @implements {LLMService}
 */

import {
  LLMService,
  LLMRequestOptions,
  LLMRequestContext,
  LLMStreamChunk,
  LLMStreamChunkType,
  LLMResponse,
  LLMMessage,
  LLMMessageRole
} from './types.js';

/**
 * LLM Service 实现
 * 支持流程管道和结构化流式输出
 */
export class LLMServiceImpl extends LLMService {
  constructor(config = {}) {
    super(config);
    
    // API 客户端（由子类或工厂注入）
    this.apiClient = null;
    
    // 默认组件
    this.defaultThinkingProcessor = null;
    this.defaultSpeakerController = null;
    
    console.log('[LLMService] Initialized');
  }
  
  /**
   * 设置 API 客户端
   */
  setAPIClient(client) {
    this.apiClient = client;
  }
  
  /**
   * 设置默认组件
   */
  setDefaultComponents({ thinkingProcessor, speakerController }) {
    this.defaultThinkingProcessor = thinkingProcessor;
    this.defaultSpeakerController = speakerController;
  }
  
  /**
   * 流式请求
   * 核心方法：request
   */
  async *request(messages, options = {}) {
    const opts = new LLMRequestOptions({ ...this.config, ...options });
    const context = this._createContext(opts);
    
    // 设置组件
    context.setComponents({
      thinkingProcessor: opts.processPipeline?.thinkingProcessor 
        ? this.defaultThinkingProcessor 
        : null,
      speakerController: opts.processPipeline?.enableTTS 
        ? this.defaultSpeakerController 
        : null
    });
    
    console.log(`[LLMService] Starting request ${context.requestId}`);
    context.state = 'streaming';
    
    try {
      // 调用实际 API
      const stream = this._callAPI(messages, opts, context);
      
      // 处理流程管道
      for await (const chunk of this._processPipeline(stream, context)) {
        yield chunk;
      }
      
      context.complete();
      this.emit('completed', { requestId: context.requestId, context });
      
    } catch (error) {
      console.error(`[LLMService] Request ${context.requestId} failed:`, error);
      context.error(error);
      
      const errorChunk = LLMStreamChunk.error(error);
      errorChunk.index = context.chunks.length;
      yield errorChunk;
      
      this.emit('error', { requestId: context.requestId, error });
    } finally {
      this.activeRequests.delete(context.requestId);
    }
  }
  
  /**
   * 非流式请求
   */
  async requestSync(messages, options = {}) {
    const chunks = [];
    const opts = new LLMRequestOptions({ ...options, streaming: false });
    
    for await (const chunk of this.request(messages, opts)) {
      chunks.push(chunk);
    }
    
    // 组装响应
    const text = chunks
      .filter(c => c.type === LLMStreamChunkType.TEXT)
      .map(c => c.data.text)
      .join('');
    
    const thinking = chunks
      .filter(c => c.type === LLMStreamChunkType.THINKING)
      .map(c => c.data.text)
      .join('');
    
    const toolCalls = chunks
      .filter(c => c.type === LLMStreamChunkType.TOOL_USE)
      .map(c => c.data);
    
    const errorChunk = chunks.find(c => c.type === LLMStreamChunkType.ERROR);
    if (errorChunk) {
      throw new Error(errorChunk.data.message);
    }
    
    return new LLMResponse({
      id: `resp-${Date.now()}`,
      model: options.model || this.config.defaultModel,
      content: text,
      thinking,
      toolCalls,
      finishReason: 'stop'
    });
  }
  
  /**
   * 调用 LLM API（由子类实现）
   * @protected
   */
  async *_callAPI(messages, options, context) {
    throw new Error('_callAPI must be implemented by subclass');
  }
  
  /**
   * 处理流程管道
   * 将思考内容和正文分开处理，支持 TTS 播报
   * @protected
   */
  async *_processPipeline(sourceStream, context) {
    let buffer = '';
    let inThinkingBlock = false;
    let thinkingBuffer = '';
    
    // 思考块标记（支持多种格式）
    const THINKING_START_MARKERS = ['<think>', '```thinking'];
    const THINKING_END_MARKERS = ['</think>', '```'];
    
    for await (const rawChunk of sourceStream) {
      // 检查取消
      if (context.abortController.signal.aborted) {
        console.log(`[LLMService] Request ${context.requestId} cancelled`);
        return;
      }
      
      let text = this._extractText(rawChunk);
      if (!text) continue;
      
      buffer += text;
      
      // 处理思考块
      while (buffer.length > 0) {
        if (!inThinkingBlock) {
          // 查找思考块开始
          const startIdx = this._findMarker(buffer, THINKING_START_MARKERS);
          
          if (startIdx !== -1) {
            // 输出思考块之前的文本
            const beforeThinking = buffer.substring(0, startIdx);
            if (beforeThinking) {
              const chunk = LLMStreamChunk.text(beforeThinking);
              context.addChunk(chunk);
              yield chunk;
            }
            
            // 进入思考块
            inThinkingBlock = true;
            const marker = this._getMatchedMarker(buffer, THINKING_START_MARKERS, startIdx);
            buffer = buffer.substring(startIdx + marker.length);
            thinkingBuffer = '';
            
          } else {
            // 没有找到开始标记，输出全部作为文本
            // 但保留可能的标记前缀
            const keepLength = Math.max(...THINKING_START_MARKERS.map(m => m.length)) - 1;
            const output = buffer.substring(0, buffer.length - keepLength);
            if (output) {
              const chunk = LLMStreamChunk.text(output);
              context.addChunk(chunk);
              yield chunk;
            }
            buffer = buffer.substring(buffer.length - keepLength);
            break;
          }
          
        } else {
          // 查找思考块结束
          const endIdx = this._findMarker(buffer, THINKING_END_MARKERS);
          
          if (endIdx !== -1) {
            // 思考块结束
            thinkingBuffer += buffer.substring(0, endIdx);
            const marker = this._getMatchedMarker(buffer, THINKING_END_MARKERS, endIdx);
            buffer = buffer.substring(endIdx + marker.length);
            inThinkingBlock = false;
            
            // 处理思考内容
            const processedThinking = await this._processThinking(
              thinkingBuffer, 
              context
            );
            
            const chunk = LLMStreamChunk.thinking(processedThinking);
            context.addChunk(chunk);
            yield chunk;
            
            thinkingBuffer = '';
            
          } else {
            // 还在思考块中
            // 保留可能的结束标记前缀
            const keepLength = Math.max(...THINKING_END_MARKERS.map(m => m.length)) - 1;
            thinkingBuffer += buffer.substring(0, buffer.length - keepLength);
            buffer = buffer.substring(buffer.length - keepLength);
            break;
          }
        }
      }
    }
    
    // 处理剩余内容
    if (inThinkingBlock && thinkingBuffer) {
      const processedThinking = await this._processThinking(thinkingBuffer, context);
      const chunk = LLMStreamChunk.thinking(processedThinking);
      context.addChunk(chunk);
      yield chunk;
    }
    
    if (buffer) {
      const chunk = LLMStreamChunk.text(buffer);
      context.addChunk(chunk);
      yield chunk;
    }
    
    // 发送完成标记
    const doneChunk = LLMStreamChunk.done({
      duration: context.getDuration()
    });
    context.addChunk(doneChunk);
    yield doneChunk;
  }
  
  /**
   * 处理思考内容
   * @protected
   */
  async _processThinking(thinking, context) {
    const { thinkingProcessor, speakerController } = context;
    
    // 1. 清理思考内容
    let processed = thinking;
    if (thinkingProcessor) {
      processed = await thinkingProcessor.clean(thinking);
    }
    
    // 2. 可选：TTS 播报
    if (speakerController && context.options.processPipeline?.enableTTS) {
      const { SpeakTask, SpeakTaskType } = await import('../speaker/types.js');
      const task = new SpeakTask({
        type: SpeakTaskType.THINKING,
        text: processed,
        priority: 3  // LOW
      });
      speakerController.enqueue(task);
    }
    
    return processed;
  }
  
  /**
   * 从原始 chunk 提取文本
   * @protected
   */
  _extractText(rawChunk) {
    // 子类可以覆盖以适配不同 API 格式
    if (typeof rawChunk === 'string') {
      return rawChunk;
    }
    if (rawChunk.choices?.[0]?.delta?.content) {
      return rawChunk.choices[0].delta.content;
    }
    if (rawChunk.content) {
      return rawChunk.content;
    }
    return '';
  }
  
  /**
   * 查找标记位置
   * @private
   */
  _findMarker(text, markers) {
    for (const marker of markers) {
      const idx = text.indexOf(marker);
      if (idx !== -1) return idx;
    }
    return -1;
  }
  
  /**
   * 获取匹配的标记
   * @private
   */
  _getMatchedMarker(text, markers, position) {
    for (const marker of markers) {
      if (text.substring(position, position + marker.length) === marker) {
        return marker;
      }
    }
    return '';
  }
  
  /**
   * 获取活跃请求状态
   */
  getActiveRequests() {
    return Array.from(this.activeRequests.values()).map(ctx => ({
      requestId: ctx.requestId,
      state: ctx.state,
      duration: ctx.getDuration(),
      textLength: ctx.accumulatedText.length,
      thinkingLength: ctx.accumulatedThinking.length
    }));
  }
}

export default LLMServiceImpl;
