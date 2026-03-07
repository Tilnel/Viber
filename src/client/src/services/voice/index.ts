/**
 * Voice Service Index
 * 语音服务索引
 * 
 * @phase 4/5
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

// Voice Socket Service（WebSocket 通信 - Phase 4）
// 注意：Phase 5 推荐使用 ViberSocket
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

// Voice Service（统一入口 - Phase 4）
export {
  VoiceService,
  type VoiceServiceState,
  type VoiceServiceOptions,
  getVoiceService,
  resetVoiceService
} from './VoiceService';

// Viber Unified Socket（统一 WebSocket - Phase 5）
// 推荐使用此服务替代 VoiceSocketService
export {
  ViberSocket,
  ViberMessageType,
  type ViberMessage,
  type ViberSocketOptions,
  type ConnectionState,
  getViberSocket,
  resetViberSocket
} from '../viberSocket';

// New Voice Service（新版语音服务 - Phase 5）
// 前端纯采集 + 后端 VAD 处理
export {
  NewVoiceService,
  type NewVoiceState,
  type NewVoiceServiceOptions,
  getNewVoiceService,
  resetNewVoiceService
} from './NewVoiceService';
