/**
 * Kimi Thinking Processor
 * 使用 Kimi Fast 模型清洗思考内容
 * 
 * @phase 2
 * @implements {ThinkingProcessor}
 */

import {
  ThinkingProcessor,
  ProcessResult,
  DefaultCleanStrategy,
  ThinkingProcessorFactory
} from './types.js';

/**
 * Kimi 思考处理器
 * 使用 Kimi Fast 模型进行智能清洗
 */
export class KimiThinkingProcessor extends ThinkingProcessor {
  constructor(config = {}) {
    super('kimi-fast', config);
    
    this.config = {
      ...DefaultCleanStrategy,
      model: {
        provider: 'kimi',
        modelId: 'kimi-fast',      // 使用快速模型
        temperature: 0.3,
        maxTokens: 150,
        timeout: 5000,
        ...config.model
      },
      ...config
    };
    
    // API 配置
    this.apiKey = process.env.KIMI_API_KEY;
    this.baseUrl = process.env.KIMI_BASE_URL || 'https://api.moonshot.cn/v1';
    
    // 缓存常见模式
    this.cache = new Map();
    this.cacheMaxSize = 100;
  }
  
  /**
   * 清洗思考内容
   */
  async clean(rawThinking) {
    const startTime = Date.now();
    
    try {
      // 空内容检查
      if (!rawThinking || rawThinking.trim().length === 0) {
        return ProcessResult.success(rawThinking, '');
      }
      
      // 先进行规则预处理（减少 LLM 负担）
      let preprocessed = this._preprocess(rawThinking);
      
      // 检查缓存
      const cacheKey = this._hash(preprocessed);
      if (this.cache.has(cacheKey)) {
        const cached = this.cache.get(cacheKey);
        return ProcessResult.success(rawThinking, cached, {
          latency: Date.now() - startTime,
          cached: true
        });
      }
      
      // 构建 Prompt
      const prompt = this._buildPrompt(preprocessed);
      
      // 调用 Kimi API
      const response = await this._callKimi(prompt);
      
      // 后处理
      let processed = this._postprocess(response);
      
      // 存入缓存
      this._addToCache(cacheKey, processed);
      
      const latency = Date.now() - startTime;
      this._updateStats(latency, true);
      
      return ProcessResult.success(rawThinking, processed, {
        latency,
        tokensUsed: response.tokensUsed || 0,
        appliedFilters: ['llm_clean']
      });
      
    } catch (error) {
      const latency = Date.now() - startTime;
      this._updateStats(latency, false);
      
      // 失败时返回规则处理结果（降级）
      const fallback = this._fallbackProcess(rawThinking);
      return ProcessResult.success(rawThinking, fallback, {
        latency,
        fallback: true,
        error: error.message
      });
    }
  }
  
  /**
   * 流式清洗
   * 对于长思考内容，分段处理
   */
  cleanStream(rawStream) {
    const self = this;
    let buffer = '';
    
    return new ReadableStream({
      async start(controller) {
        const reader = rawStream.getReader();
        
        try {
          while (true) {
            const { done, value } = await reader.read();
            
            if (done) {
              // 处理剩余内容
              if (buffer.trim()) {
                const result = await self.clean(buffer);
                controller.enqueue(result.processedText);
              }
              controller.close();
              break;
            }
            
            buffer += value;
            
            // 按句子分割处理（遇到句号、问号、感叹号）
            const sentences = buffer.split(/([。！？\.\!\?]+)/);
            
            // 保留最后不完整的部分
            buffer = sentences.pop() || '';
            
            // 处理完整的句子
            for (let i = 0; i < sentences.length - 1; i += 2) {
              const sentence = sentences[i] + (sentences[i + 1] || '');
              if (sentence.trim()) {
                const result = await self.clean(sentence);
                controller.enqueue(result.processedText);
              }
            }
          }
        } catch (error) {
          controller.error(error);
        } finally {
          reader.releaseLock();
        }
      }
    });
  }
  
  /**
   * 预热 - 发送一个简单的请求来初始化连接
   */
  async warmup() {
    try {
      await this._callKimi('预热');
      console.log('[KimiThinkingProcessor] Warmup completed');
    } catch (error) {
      console.warn('[KimiThinkingProcessor] Warmup failed:', error.message);
    }
  }
  
  /**
   * 预处理 - 规则清洗，减少 LLM 负担
   * @private
   */
  _preprocess(text) {
    // 移除 XML 标签
    if (this.config.filters.removeXmlTags) {
      text = text.replace(/<[^>]+>/g, '');
    }
    
    // 移除 markdown 代码块标记（保留内容）
    text = text.replace(/```(\w+)?\n/g, '');
    text = text.replace(/```/g, '');
    
    // 清理多余空白
    text = text.trim().replace(/\s+/g, ' ');
    
    // 截断过长内容（LLM 有长度限制）
    const maxLen = 500; // 预处理截断
    if (text.length > maxLen) {
      text = text.substring(0, maxLen) + '...';
    }
    
    return text;
  }
  
  /**
   * 构建 Prompt
   * @private
   */
  _buildPrompt(text) {
    const { filters, enhancement } = this.config;
    
    let instructions = [];
    
    if (filters.removeMarkdown) {
      instructions.push('1. 去掉 markdown 格式符号（**、*、` 等）');
    }
    
    if (enhancement.convertToFirstPerson) {
      instructions.push('2. 将第三人称转为第一人称（"AI认为"→"我觉得"）');
    }
    
    if (enhancement.simplifyTechnicalTerms) {
      instructions.push('3. 简化复杂技术术语，用口语化表达');
    }
    
    if (enhancement.addFillers) {
      instructions.push('4. 适当添加自然停顿词（"嗯..."、"让我想想..."）');
    }
    
    instructions.push(`5. 输出控制在 ${filters.maxLength} 字以内`);
    instructions.push('6. 只输出清洗后的文本，不要解释');
    
    return `请将以下AI思考过程转为适合语音播报的文本：

要求：
${instructions.join('\n')}

原文：
${text}

播报文本：`;
  }
  
  /**
   * 调用 Kimi API
   * @private
   */
  async _callKimi(prompt) {
    const { modelId, temperature, maxTokens, timeout } = this.config.model;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: modelId,
          messages: [
            { role: 'system', content: '你是一个文本清洗助手，将AI思考过程转为口语化播报文本。只输出结果，不解释。' },
            { role: 'user', content: prompt }
          ],
          temperature,
          max_tokens: maxTokens
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`Kimi API error: ${response.status}`);
      }
      
      const data = await response.json();
      
      return {
        text: data.choices[0]?.message?.content?.trim() || '',
        tokensUsed: data.usage?.total_tokens || 0
      };
      
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }
  
  /**
   * 后处理
   * @private
   */
  _postprocess(response) {
    let text = response.text;
    
    // 移除可能的引号
    text = text.replace(/^["']|["']$/g, '');
    
    // 清理
    text = text.trim();
    
    // 如果结果为空，返回原文
    if (!text) {
      return response.originalText || '';
    }
    
    return text;
  }
  
  /**
   * 降级处理 - 使用规则
   * @private
   */
  _fallbackProcess(text) {
    // 简单的规则处理
    text = text.replace(/<[^>]+>/g, '');
    text = text.replace(/\*\*/g, '');
    text = text.replace(/AI\s+(?:认为|觉得)/g, '我觉得');
    text = text.trim().replace(/\s+/g, ' ');
    
    if (text.length > this.config.filters.maxLength) {
      text = text.substring(0, this.config.filters.maxLength) + '...';
    }
    
    return text;
  }
  
  /**
   * 计算哈希（用于缓存）
   * @private
   */
  _hash(text) {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return String(hash);
  }
  
  /**
   * 添加到缓存
   * @private
   */
  _addToCache(key, value) {
    if (this.cache.size >= this.cacheMaxSize) {
      // LRU: 删除最早的一个
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }
  
  /**
   * 更新统计
   * @private
   */
  _updateStats(latency, success) {
    this.stats.totalProcessed++;
    if (!success) this.stats.totalErrors++;
    
    this.stats.avgLatency = 
      (this.stats.avgLatency * (this.stats.totalProcessed - 1) + latency) / 
      this.stats.totalProcessed;
  }
}

// 注册到工厂
ThinkingProcessorFactory.register('kimi', KimiThinkingProcessor);

export default KimiThinkingProcessor;
