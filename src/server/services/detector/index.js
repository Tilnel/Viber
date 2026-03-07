/**
 * Speech Detector Services Index
 * 语音检测服务统一导出
 * 
 * @module services/detector
 */

export * from './types.js';

import { VolumeBasedSpeechDetector } from './VolumeBasedSpeechDetector.js';

export { VolumeBasedSpeechDetector } from './VolumeBasedSpeechDetector.js';

// 默认导出
export { VolumeBasedSpeechDetector as default } from './VolumeBasedSpeechDetector.js';

/**
 * 创建检测器工厂函数
 * @param {Object} options
 * @param {string} options.type - 'volume' | 'energy'
 * @returns {SpeechDetector}
 */
export function createDetector(options = {}) {
  const type = options.type || 'volume';
  
  switch (type) {
    case 'volume':
      return new VolumeBasedSpeechDetector(options);
    default:
      throw new Error(`Unknown detector type: ${type}`);
  }
}
