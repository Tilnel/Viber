/**
 * Thinking Processor Types
 * 思考内容处理器标准接口定义
 * 
 * @phase 2
 * @module services/processor
 */

/**
 * 清洗策略配置
 */
export const DefaultCleanStrategy = {
  // 内容过滤
  filters: {
    removeMarkdown: true,        // 去掉 markdown 格式（**bold**, `code`）
    removeCodeBlocks: true,      // 去掉代码块
    removeXmlTags: true,         // 去掉 <tool> <path> 等标签
    removeUrls: false,           // 是否去掉 URL
    maxLength: 200,              // 最大长度
    truncationStrategy: 'tail'   // 'tail' | 'head' | 'summary'
  },
  
  // 口语化增强
  enhancement: {
    addFillers: false,           // 添加填充词（"嗯..." "让我想想..."）
    simplifyTechnicalTerms: false, // 简化技术术语
    convertToFirstPerson: true,  // 转为第一人称（"AI 认为" → "我觉得"）
    addTransitions: false        // 添加过渡词
  },
  
  // 模型配置
  model: {
    provider: 'kimi',
    modelId: 'kimi-fast',        // 使用快速模型
    temperature: 0.3,            // 低温度，稳定输出
    maxTokens: 150,              // 短输出，快速响应
    timeout: 5000                // 5秒超时
  }
};

/**
 * 处理结果
 */
export class ProcessResult {
  constructor(data) {
    this.originalText = data.originalText;      // 原始文本
    this.processedText = data.processedText;    // 处理后文本
    this.success = data.success;                // 是否成功
    this.error = data.error || null;            // 错误信息
    
    // 性能数据
    this.latency = data.latency;                // 处理耗时(ms)
    this.tokensUsed = data.tokensUsed || 0;     // Token 使用量
    
    // 处理详情
    this.appliedFilters = data.appliedFilters || []; // 应用的过滤器
    this.wasTruncated = data.wasTruncated || false;  // 是否被截断
  }
  
  /**
   * 快速创建成功结果
   */
  static success(original, processed, metadata = {}) {
    return new ProcessResult({
      originalText: original,
      processedText: processed,
      success: true,
      ...metadata
    });
  }
  
  /**
   * 快速创建失败结果
   */
  static error(original, errorMessage) {
    return new ProcessResult({
      originalText: original,
      processedText: original, // 失败时返回原文
      success: false,
      error: errorMessage
    });
  }
}

/**
 * Thinking Processor 接口定义
 */
export class ThinkingProcessor {
  /**
   * @param {string} name - 处理器名称
   * @param {Object} config - 配置
   */
  constructor(name, config = {}) {
    this.name = name;
    this.config = { ...DefaultCleanStrategy, ...config };
    this.stats = {
      totalProcessed: 0,
      totalErrors: 0,
      avgLatency: 0
    };
  }
  
  /**
   * 清洗思考内容（主要方法）
   * @param {string} rawThinking - 原始思考内容
   * @returns {Promise<ProcessResult>}
   */
  async clean(rawThinking) {
    throw new Error('Not implemented');
  }
  
  /**
   * 流式清洗（用于长思考）
   * @param {ReadableStream} rawStream - 原始内容流
   * @returns {ReadableStream<string>}
   */
  cleanStream(rawStream) {
    throw new Error('Not implemented');
  }
  
  /**
   * 批量处理
   * @param {string[]} texts 
   * @returns {Promise<ProcessResult[]>}
   */
  async batchClean(texts) {
    return Promise.all(texts.map(t => this.clean(t)));
  }
  
  /**
   * 预热/初始化
   */
  async warmup() {
    // 可选实现
  }
  
  /**
   * 获取统计信息
   */
  getStats() {
    return { ...this.stats };
  }
  
  /**
   * 重置统计
   */
  resetStats() {
    this.stats = {
      totalProcessed: 0,
      totalErrors: 0,
      avgLatency: 0
    };
  }
}

/**
 * 基于规则的简单处理器（无需 LLM）
 * 用于快速处理或作为 fallback
 */
export class RuleBasedThinkingProcessor extends ThinkingProcessor {
  constructor(config = {}) {
    super('rule-based', config);
  }
  
  /**
   * 使用规则快速清洗
   */
  async clean(rawThinking) {
    const startTime = Date.now();
    
    try {
      let text = rawThinking;
      const appliedFilters = [];
      
      // 移除 XML 标签
      if (this.config.filters.removeXmlTags) {
        text = text.replace(/<[^>]+>/g, '');
        appliedFilters.push('xml_tags');
      }
      
      // 移除 Markdown
      if (this.config.filters.removeMarkdown) {
        text = text.replace(/\*\*/g, '');  // **bold**
        text = text.replace(/`/g, '');     // `code`
        text = text.replace(/#{1,6}\s/g, ''); // # headers
        appliedFilters.push('markdown');
      }
      
      // 移除代码块
      if (this.config.filters.removeCodeBlocks) {
        text = text.replace(/```[\s\S]*?```/g, '[代码]');
        text = text.replace(/`[^`]+`/g, '[代码]');
        appliedFilters.push('code_blocks');
      }
      
      // 转为第一人称
      if (this.config.enhancement.convertToFirstPerson) {
        text = text.replace(/AI\s+(?:认为|觉得|想)/g, '我觉得');
        text = text.replace(/模型\s+(?:认为|觉得|想)/g, '我觉得');
        text = text.replace(/系统\s+(?:认为|觉得|想)/g, '我觉得');
        appliedFilters.push('first_person');
      }
      
      // 截断
      let wasTruncated = false;
      const maxLen = this.config.filters.maxLength;
      if (text.length > maxLen) {
        if (this.config.filters.truncationStrategy === 'tail') {
          text = text.substring(0, maxLen) + '...';
        } else if (this.config.filters.truncationStrategy === 'head') {
          text = '...' + text.substring(text.length - maxLen);
        }
        wasTruncated = true;
        appliedFilters.push('truncated');
      }
      
      // 清理多余空白
      text = text.trim().replace(/\s+/g, ' ');
      
      const latency = Date.now() - startTime;
      this._updateStats(latency, true);
      
      return ProcessResult.success(rawThinking, text, {
        latency,
        appliedFilters,
        wasTruncated
      });
      
    } catch (error) {
      const latency = Date.now() - startTime;
      this._updateStats(latency, false);
      return ProcessResult.error(rawThinking, error.message);
    }
  }
  
  _updateStats(latency, success) {
    this.stats.totalProcessed++;
    if (!success) this.stats.totalErrors++;
    
    // 更新平均延迟
    this.stats.avgLatency = 
      (this.stats.avgLatency * (this.stats.totalProcessed - 1) + latency) / 
      this.stats.totalProcessed;
  }
}

/**
 * 处理器工厂
 */
export class ThinkingProcessorFactory {
  static processors = new Map();
  
  static register(name, processorClass) {
    ThinkingProcessorFactory.processors.set(name, processorClass);
  }
  
  static create(name, config = {}) {
    const ProcessorClass = ThinkingProcessorFactory.processors.get(name);
    if (!ProcessorClass) {
      throw new Error(`Unknown processor: ${name}`);
    }
    return new ProcessorClass(config);
  }
  
  static getAvailable() {
    return Array.from(ThinkingProcessorFactory.processors.keys());
  }
}

// 注册基于规则的处理器
ThinkingProcessorFactory.register('rule', RuleBasedThinkingProcessor);
