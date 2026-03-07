/**
 * Speaker Service Index
 * 语音播报服务索引
 * 
 * @module services/speaker
 */

export {
  SpeakerController,
  SpeakTask,
  SpeakTaskType,
  SpeakPriority,
  SpeakerCommand,
  SpeakerEvent
} from './types.js';

export { SpeakerControllerImpl } from './SpeakerControllerImpl.js';

/**
 * 工厂函数
 */
export function createSpeakerController(config = {}) {
  return new SpeakerControllerImpl(config);
}
