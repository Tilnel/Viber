/**
 * Voice Services Index
 * 语音服务索引
 * 
 * @module services/voice
 */

export { VoiceOrchestrator, VoiceDialogContext } from './VoiceOrchestrator.js';

// 工厂函数
let globalOrchestrator = null;

export function createVoiceOrchestrator(options) {
  globalOrchestrator = new (await import('./VoiceOrchestrator.js')).VoiceOrchestrator(options);
  return globalOrchestrator;
}

export function getVoiceOrchestrator() {
  return globalOrchestrator;
}

export function resetVoiceOrchestrator() {
  globalOrchestrator = null;
}
