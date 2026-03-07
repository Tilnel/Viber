/**
 * LLM Service Types
 * LLM 服务类型定义
 * 
 * @phase 3
 * @module services/llm
 */

/**
 * LLM 消息角色
 */
export const LLMMessageRole = {
  SYSTEM: 'system',
  USER: 'user',
  ASSISTANT: 'assistant',
  TOOL: 'tool'
};

/**
 * LLM 内容块类型
 * 支持混合内容（文本 + 图片）
 */
export const LLMContentType = {
  TEXT: 'text',
  IMAGE: 'image_url',
  TOOL_USE: 'tool_use',
  TOOL_RESULT: 'tool_result'
};

/**
 * 工具定义
 */
export class LLMTool {
  constructor(data) {
    this.name = data.name;
    this.description = data.description;
    this.parameters = data.parameters || {};  // JSON Schema
    this.required = data.required || [];
  }
  
  toJSON() {
    return {
      type: 'function',
      function: {
        name: this.name,
        description: this.description,
        parameters: this.parameters
      }
    };
  }
}

/**
 * LLM 消息
 */
export class LLMMessage {
  constructor(role, content) {
    this.role = role;
    this.content = content;  // string | Array<ContentBlock>
    this.timestamp = Date.now();
  }
  
  /**
   * 创建文本消息
   */
  static text(role, text) {
    return new LLMMessage(role, text);
  }
  
  /**
   * 创建多模态消息
   */
  static multimodal(role, blocks) {
    return new LLMMessage(role, blocks);
  }
  
  /**
   * 创建工具调用消息
   */
  static toolUse(toolName, toolInput, toolUseId) {
    return new LLMMessage(LLMMessageRole.ASSISTANT, [{
      type: LLMContentType.TOOL_USE,
      id: toolUseId,
      name: toolName,
      input: toolInput
    }]);
  }
  
  /**
   * 创建工具结果消息
   */
  static toolResult(toolUseId, result, isError = false) {
    return new LLMMessage(LLMMessageRole.TOOL, {
      tool_use_id: toolUseId,
      content: result,
      is_error: isError
    });
  }
}

/**
 * LLM 请求选项
 */
export class LLMRequestOptions {
  constructor(options = {}) {
    this.model = options.model || 'default';
    this.temperature = options.temperature ?? 0.7;
    this.maxTokens = options.maxTokens || 4096;
    this.tools = options.tools || [];  // LLMTool[]
    this.toolChoice = options.toolChoice || 'auto'; // 'auto' | 'none' | {type: 'function', name: string}
    this.system = options.system || '';  // 系统提示词
    this.streaming = options.streaming ?? true;
    this.timeout = options.timeout || 60000;
    
    // 流程控制选项
    this.processPipeline = options.processPipeline ?? {
      thinkingProcessor: true,    // 是否使用思考处理器
      enableTTS: false,           // 是否启用 TTS 播报思考
      interruptOnNewInput: true   // 新输入是否中断
    };
  }
}

/**
 * LLM 流式输出块类型
 */
export const LLMStreamChunkType = {
  THINKING: 'thinking',           // 思考过程
  TEXT: 'text',                   // 文本回复
  TOOL_USE: 'tool_use',           // 工具调用
  TOOL_RESULT: 'tool_result',     // 工具结果
  DONE: 'done',                   // 完成
  ERROR: 'error'                  // 错误
};

/**
 * LLM 流式输出块
 */
export class LLMStreamChunk {
  constructor(type, data) {
    this.type = type;           // StreamChunkType
    this.data = data;           // 具体内容
    this.timestamp = Date.now();
    this.index = 0;             // 块序号
  }
  
  /**
   * 创建思考块
   */
  static thinking(text, raw = false) {
    return new LLMStreamChunk(LLMStreamChunkType.THINKING, { text, raw });
  }
  
  /**
   * 创建文本块
   */
  static text(text) {
    return new LLMStreamChunk(LLMStreamChunkType.TEXT, { text });
  }
  
  /**
   * 创建工具调用块
   */
  static toolUse(name, input, id) {
    return new LLMStreamChunk(LLMStreamChunkType.TOOL_USE, { name, input, id });
  }
  
  /**
   * 创建工具结果块
   */
  static toolResult(id, result, isError = false) {
    return new LLMStreamChunk(LLMStreamChunkType.TOOL_RESULT, { id, result, isError });
  }
  
  /**
   * 创建完成块
   */
  static done(usage = {}) {
    return new LLMStreamChunk(LLMStreamChunkType.DONE, { usage });
  }
  
  /**
   * 创建错误块
   */
  static error(error) {
    return new LLMStreamChunk(LLMStreamChunkType.ERROR, { 
      message: error.message,
      code: error.code || 'UNKNOWN'
    });
  }
  
  /**
   * 序列化为 JSON
   */
  toJSON() {
    return {
      type: this.type,
      data: this.data,
      timestamp: this.timestamp,
      index: this.index
    };
  }
  
  /**
   * 序列化为 SSE 格式
   */
  toSSE() {
    return `data: ${JSON.stringify(this.toJSON())}\n\n`;
  }
}

/**
 * LLM 响应（非流式）
 */
export class LLMResponse {
  constructor(data) {
    this.id = data.id;
    this.model = data.model;
    this.content = data.content;      // string | Array<ContentBlock>
    this.thinking = data.thinking || '';  // 思考内容（如果有）
    this.toolCalls = data.toolCalls || []; // 工具调用
    this.usage = data.usage || {};     // token 使用情况
    this.finishReason = data.finishReason || 'stop';
    this.timestamp = Date.now();
  }
}

/**
 * LLM 请求上下文
 * 用于管理单次对话的完整流程
 */
export class LLMRequestContext {
  constructor(requestId, options) {
    this.requestId = requestId;
    this.options = options;
    this.messages = [];           // 对话历史
    this.chunks = [];             // 所有流式块
    this.accumulatedText = '';    // 累积的文本
    this.accumulatedThinking = ''; // 累积的思考
    this.toolCalls = [];          // 工具调用列表
    this.state = 'pending';       // pending | streaming | tool_pending | completed | error | cancelled
    this.startTime = Date.now();
    this.endTime = null;
    
    // 流程组件
    this.thinkingProcessor = null;  // 思考处理器
    this.speakerController = null;  // 播报控制器
    
    // 控制器
    this.abortController = new AbortController();
  }
  
  /**
   * 添加流式块
   */
  addChunk(chunk) {
    chunk.index = this.chunks.length;
    this.chunks.push(chunk);
    
    switch (chunk.type) {
      case LLMStreamChunkType.TEXT:
        this.accumulatedText += chunk.data.text;
        break;
      case LLMStreamChunkType.THINKING:
        this.accumulatedThinking += chunk.data.text;
        break;
      case LLMStreamChunkType.TOOL_USE:
        this.toolCalls.push(chunk.data);
        break;
    }
    
    return chunk;
  }
  
  /**
   * 设置组件
   */
  setComponents({ thinkingProcessor, speakerController }) {
    this.thinkingProcessor = thinkingProcessor;
    this.speakerController = speakerController;
  }
  
  /**
   * 标记完成
   */
  complete() {
    this.state = 'completed';
    this.endTime = Date.now();
  }
  
  /**
   * 标记错误
   */
  error(error) {
    this.state = 'error';
    this.error = error;
    this.endTime = Date.now();
  }
  
  /**
   * 标记取消
   */
  cancel() {
    this.state = 'cancelled';
    this.abortController.abort();
    this.endTime = Date.now();
  }
  
  /**
   * 获取耗时
   */
  getDuration() {
    return (this.endTime || Date.now()) - this.startTime;
  }
}

/**
 * LLM Service 接口
 * 核心：request 和 stop 方法
 */
export class LLMService {
  constructor(config = {}) {
    this.config = {
      defaultModel: config.defaultModel || 'default',
      defaultTimeout: config.defaultTimeout || 60000,
      maxRetries: config.maxRetries || 3,
      ...config
    };
    
    // 活跃请求
    this.activeRequests = new Map();  // requestId -> LLMRequestContext
    this.requestCounter = 0;
    
    // 事件监听
    this.listeners = new Map();
  }
  
  /**
   * 发送请求（流式）
   * @param {LLMMessage[]} messages - 对话历史
   * @param {LLMRequestOptions} options - 请求选项
   * @returns {AsyncGenerator<LLMStreamChunk>} 流式生成器
   */
  async *request(messages, options = {}) {
    throw new Error('Not implemented');
  }
  
  /**
   * 发送请求（非流式）
   * @param {LLMMessage[]} messages 
   * @param {LLMRequestOptions} options 
   * @returns {Promise<LLMResponse>}
   */
  async requestSync(messages, options = {}) {
    throw new Error('Not implemented');
  }
  
  /**
   * 停止指定请求
   * @param {string} requestId 
   */
  stop(requestId) {
    const context = this.activeRequests.get(requestId);
    if (context) {
      console.log(`[LLMService] Stopping request ${requestId}`);
      context.cancel();
      this.activeRequests.delete(requestId);
      return true;
    }
    return false;
  }
  
  /**
   * 停止所有请求
   */
  stopAll() {
    console.log(`[LLMService] Stopping all ${this.activeRequests.size} requests`);
    for (const [requestId, context] of this.activeRequests) {
      context.cancel();
    }
    this.activeRequests.clear();
  }
  
  /**
   * 创建请求上下文
   * @protected
   */
  _createContext(options) {
    const requestId = `llm-${++this.requestCounter}-${Date.now()}`;
    const context = new LLMRequestContext(requestId, options);
    this.activeRequests.set(requestId, context);
    return context;
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
}

export default LLMService;
