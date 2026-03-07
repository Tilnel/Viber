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

/**
 * 工厂函数
 */
export function createLLMService(config = {}) {
  return new LLMServiceImpl(config);
}
