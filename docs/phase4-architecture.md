# Phase 4 前端架构文档

## 前端部件重构

### 架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Frontend                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────┐    WebSocket    ┌─────────────────┐                   │
│  │  SimpleRecorder │ ───────────────▶│ VoiceSocketSvc  │◀──── Backend      │
│  │                 │   audio:frame   │                 │                   │
│  │  - 纯音频采集    │                 │  - 消息路由      │    speaker:play   │
│  │  - 无 VAD 逻辑   │                 │  - 协议转换      │◀────────────────  │
│  │  - 实时推送      │                 │                 │                   │
│  └─────────────────┘                 └────────┬────────┘                   │
│           │                                   │                            │
│           │ onVolume                            │ onSpeakerTask            │
│           │ (前端展示)                          │                          │
│           ▼                                   ▼                            │
│  ┌─────────────────┐                 ┌─────────────────┐                   │
│  │ Volume Display  │                 │ SpeakerController│                  │
│  │  (UI 组件)       │                 │                  │                  │
│  │                 │                 │  - 播放队列管理   │                  │
│  │                 │                 │  - 音频解码播放   │                  │
│  │                 │                 │  - 状态控制      │                  │
│  └─────────────────┘                 └────────┬────────┘                   │
│                                               │                            │
│                                               │ onComplete                 │
│                                               ▼                            │
│                                      ┌─────────────────┐                   │
│                                      │  AudioContext   │                   │
│                                      │                 │                   │
│                                      │  - decodeAudioData                   │
│                                      │  - createBufferSource                │
│                                      │  - 播放控制      │                   │
│                                      └─────────────────┘                   │
│                                                                             │
│  ═══════════════════════════════════════════════════════════════════════   │
│                                                                             │
│  ┌─────────────────┐                                                      │
│  │  VoiceService   │  ← 统一入口，整合以上所有组件                          │
│  │                 │                                                      │
│  │  start()  ──────┼──▶ 初始化所有服务并开始录音                            │
│  │  stop()   ──────┼──▶ 停止录音和播放                                      │
│  │  interrupt() ───┼──▶ 打断当前播放                                        │
│  │                 │                                                      │
│  └─────────────────┘                                                      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 组件职责

### 1. SimpleRecorder
- **文件**: `src/client/src/services/voice/SimpleRecorder.ts`
- **职责**: 纯音频采集
- **特点**:
  - 无 VAD 逻辑（后端处理）
  - 实时推送音频帧到 VoiceSocketService
  - 提供音量回调（仅用于前端展示）
- **状态**: `idle` | `recording`

### 2. SpeakerController
- **文件**: `src/client/src/services/voice/SpeakerController.ts`
- **职责**: 语音播报队列管理
- **功能**:
  - 接收后端播放指令
  - 管理音频播放队列
  - 音频解码和播放（Web Audio API）
  - 播放控制（play/pause/stop/skip）
- **状态**: `idle` | `playing` | `paused`

### 3. VoiceSocketService
- **文件**: `src/client/src/services/voice/VoiceSocketService.ts`
- **职责**: WebSocket 通信管理
- **消息类型**:
  ```typescript
  // 上行（Frontend → Backend）
  audio:frame    - 音频帧数据
  audio:start    - 开始录音
  audio:stop     - 停止录音
  speaker:completed - 播放完成通知
  
  // 下行（Backend → Frontend）
  speaker:play   - 播放指令
  speaker:stop   - 停止指令
  speaker:pause  - 暂停指令
  speaker:resume - 恢复指令
  asr:interim    - ASR 临时结果
  asr:final      - ASR 最终结果
  volume:update  - 音量更新
  state:change   - 状态变化
  ```

### 4. VoiceService
- **文件**: `src/client/src/services/voice/VoiceService.ts`
- **职责**: 统一语音服务入口
- **整合**: Recorder + Speaker + Socket
- **状态**: `idle` | `listening` | `processing` | `speaking`

## 与后端的协议

### WebSocket 消息格式

```typescript
// 音频帧（上行）
interface AudioFrameMessage {
  type: 'audio:frame';
  data: string;      // base64 encoded Int16 PCM
  timestamp: number;
  seq: number;
}

// 播报任务（下行）
interface SpeakerTaskMessage {
  type: 'speaker:play';
  taskId: string;
  taskType: 'thinking' | 'response' | 'tool_result' | 'notification';
  text?: string;
  audioData?: string;  // base64 encoded audio
  audioUrl?: string;
  format: string;
  duration?: number;
}

// ASR 结果（下行）
interface ASRResultMessage {
  type: 'asr:interim' | 'asr:final';
  text: string;
  isFinal: boolean;
}
```

## 使用方式

```typescript
import { VoiceService } from './services/voice';

const voiceService = new VoiceService({
  onStateChange: (state) => {
    console.log('State:', state); // idle | listening | processing | speaking
  },
  onTranscript: (text, isFinal) => {
    console.log(isFinal ? 'Final:' : 'Interim:', text);
  },
  onError: (error) => {
    console.error('Error:', error);
  }
});

// 开始
await voiceService.start();

// 打断
voiceService.interrupt();

// 停止
voiceService.stop();
```

## Phase 4 完成状态

| 任务 | 状态 | 说明 |
|-----|------|-----|
| Task 13: Speaker 部件 | ✅ | SpeakerController 实现播放队列管理 |
| Task 14: 简化 Recorder | ✅ | SimpleRecorder 移除 VAD，纯采集推送 |
| Task 15: WebSocket 协议 | ✅ | VoiceSocketService 统一消息格式 |
| 验收标准 | ✅ | 前端语音功能可用，职责清晰 |

## 优势

1. **职责清晰**:
   - Recorder: 只负责采集
   - Speaker: 只负责播放
   - Socket: 只负责通信

2. **后端主导**:
   - VAD 逻辑在后端
   - ASR 处理在后端
   - 业务逻辑在后端

3. **前端简化**:
   - 无需复杂 VAD
   - 无需处理 ASR 细节
   - 只需"眼睛和耳朵"

## 下一步 (Phase 5)

1. **UI 组件更新**: 更新 VoiceButton、VoiceConversationButton 使用新服务
2. **后端 Socket Handler**: 实现 /voice namespace 的消息处理
3. **集成测试**: 端到端语音对话测试
