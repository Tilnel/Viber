/**
 * Speech Detector Services Index
 * 语音检测服务统一导出
 * 
 * @module services/detector
 */

export * from './types.js';
export { 
  VolumeBasedSpeechDetector,
  EnergyBasedSpeechDetector 
} from './VolumeBasedSpeechDetector.js';

// 默认导出
export { VolumeBasedSpeechDetector as default } from './VolumeBasedSpeechDetector.js';
