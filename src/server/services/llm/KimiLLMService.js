/**
 * Kimi LLM Service
 * 月之暗面 Kimi API 实现
 * 
 * @phase 5
 * @implements {LLMService}
 */

import { LLMServiceImpl } from './LLMServiceImpl.js';
import { LLMStreamChunk, LLMStreamChunkType } from './types.js';

/**
 * Kimi Fast API 配置
 */
const KIMI_CONFIG = {
  API_KEY: process.env.KIMI_API_KEY,
  BASE_URL: 'https://api.moonshot.cn/v1',
  DEFAULT_MODEL: 'kimi-latest',
  MAX_TOKENS: 4096,
  TEMPERATURE: 0.7
};

/**
 * Kimi LLM Service 实现
 */
export class KimiLLMService extends LLMServiceImpl {
  constructor(config = {}) {
    super({
      defaultModel: config.model || KIMI_CONFIG.DEFAULT_MODEL,
      defaultTimeout: config.timeout || 60000,
      maxRetries: config.maxRetries || 3,
      ...config
    });

    this.apiKey = config.apiKey || KIMI_CONFIG.API_KEY;
    this.baseUrl = config.baseUrl || KIMI_CONFIG.BASE_URL;

    if (!this.apiKey) {
      console.warn('[KimiLLMService] Warning: KIMI_API_KEY not set');
    }

    console.log('[KimiLLMService] Initialized with model:', this.config.defaultModel);
  }

  /**
   * 调用 Kimi API
   * @protected
   */
  async *_callAPI(messages, options, context) {
    if (!this.apiKey) {
      throw new Error('KIMI_API_KEY not configured');
    }

    const url = `${this.baseUrl}/chat/completions`;
    
    const body = {
      model: options.model || this.config.defaultModel,
      messages: messages.map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : this._formatContent(m.content)
      })),
      temperature: options.temperature ?? KIMI_CONFIG.TEMPERATURE,
      max_tokens: options.maxTokens || KIMI_CONFIG.MAX_TOKENS,
      stream: true
    };

    // 添加工具（如果有）
    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools.map(t => t.toJSON ? t.toJSON() : t);
      body.tool_choice = options.toolChoice || 'auto';
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: context.abortController.signal
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
      throw new Error(error.error?.message || `HTTP ${response.status}`);
    }

    // 解析 SSE 流
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // 保留不完整的行

        for (const line of lines) {
          if (line.trim().startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') {
              yield { done: true };
              return;
            }

            try {
              const chunk = JSON.parse(data);
              yield this._transformChunk(chunk);
            } catch (e) {
              // 忽略解析错误
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * 转换 Kimi chunk 为标准格式
   * @private
   */
  _transformChunk(chunk) {
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) return null;

    // 工具调用
    if (delta.tool_calls) {
      const toolCall = delta.tool_calls[0];
      return {
        type: LLMStreamChunkType.TOOL_USE,
        data: {
          id: toolCall.id,
          name: toolCall.function?.name,
          input: JSON.parse(toolCall.function?.arguments || '{}')
        }
      };
    }

    // 文本内容
    if (delta.content) {
      return {
        type: LLMStreamChunkType.TEXT,
        data: { text: delta.content }
      };
    }

    return null;
  }

  /**
   * 格式化多模态内容
   * @private
   */
  _formatContent(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content.map(block => {
        if (block.type === 'text') return block.text;
        if (block.type === 'image_url') return block.image_url;
        return '';
      }).join('');
    }
    return '';
  }
}

/**
 * 创建 Kimi LLM Service
 */
export function createKimiLLMService(config = {}) {
  return new KimiLLMService(config);
}

export default KimiLLMService;
