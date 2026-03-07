/**
 * LLM Service Index
 * LLM 服务索引
 * 
 * @module services/llm
 */

export {
  LLMService,
  LLMMessage,
  LLMMessageRole,
  LLMRequestOptions,
  LLMResponse,
  LLMStreamChunk,
  LLMStreamChunkType,
  LLMRequestContext,
  LLMTool,
  LLMContentType
} from './types.js';

export { LLMServiceImpl } from './LLMServiceImpl.js';
export { KimiLLMService, createKimiLLMService } from './KimiLLMService.js';

/**
 * 工厂函数
 */
export function createLLMService(type = 'kimi', config = {}) {
  switch (type) {
    case 'kimi':
      return new (KimiLLMService)(config);
    default:
      return new LLMServiceImpl(config);
  }
}
