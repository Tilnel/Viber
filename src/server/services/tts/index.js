/**
 * TTS Services Index
 * 语音合成服务统一导出
 * 
 * @module services/tts
 */

export * from './types.js';
export { VolcanoTTSService } from './VolcanoTTSService.js';

import { VolcanoTTSService } from './VolcanoTTSService.js';

/**
 * 创建火山引擎 TTS 服务实例
 * @param {Object} config - 配置选项
 * @returns {VolcanoTTSService} TTS 服务实例
 */
export function createVolcanoTTSService(config = {}) {
  return new VolcanoTTSService(config);
}

// 默认导出
export { VolcanoTTSService as default } from './VolcanoTTSService.js';
