/**
 * Voice Service Index
 * 语音服务索引
 * 
 * @phase 4
 */

// Simple Recorder（纯采集，无 VAD）
export {
  SimpleRecorder,
  type RecorderState,
  type RecorderOptions,
  getRecorder,
  resetRecorder
} from './SimpleRecorder';

// Speaker Controller（前端播报控制）
export {
  SpeakerController,
  type SpeakerState,
  type SpeakerTask,
  type SpeakerOptions,
  getSpeakerController,
  resetSpeakerController
} from './SpeakerController';

// Voice Socket Service（WebSocket 通信）
export {
  VoiceSocketService,
  VoiceMessageType,
  type VoiceSocketOptions,
  type AudioFrameMessage,
  type SpeakerTaskMessage,
  type ASRResultMessage,
  getVoiceSocket,
  resetVoiceSocket
} from './VoiceSocketService';

// Voice Service（统一入口）
export {
  VoiceService,
  type VoiceServiceState,
  type VoiceServiceOptions,
  getVoiceService,
  resetVoiceService
} from './VoiceService';
