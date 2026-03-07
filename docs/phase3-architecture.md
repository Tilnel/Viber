# Phase 3 架构文档

## 后端服务架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Backend Services                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────────┐     │
│  │   Audio Input   │───▶│  Speech Detect  │───▶│    ASR Service      │     │
│  │   (Listener)    │    │   (Detector)    │    │  (Volcano/CosyVoice)│     │
│  └─────────────────┘    └─────────────────┘    └─────────────────────┘     │
│           │                                              │                   │
│           │ WebSocket                                    │ Text              │
│           ▼                                              ▼                   │
│  ┌─────────────────┐                            ┌─────────────────┐         │
│  │  Frontend       │◀───────────────────────────│  LLM Service    │         │
│  │  (Recorder)     │    SSE (structured stream) │                 │         │
│  └─────────────────┘                            │  ┌───────────┐  │         │
│           ▲                                      │  │ Thinking  │  │         │
│           │ WebSocket                            │  │ Processor │  │         │
│           │ (TTS audio)                          │  └───────────┘  │         │
│  ┌─────────────────┐                            │        │        │         │
│  │   Frontend      │◀───────────────────────────│        ▼        │         │
│  │   (Speaker)     │     Audio stream           │  ┌───────────┐  │         │
│  └─────────────────┘                            │  │  Speaker  │  │         │
│                                                  │  │ Controller│  │         │
│                                                  │  └───────────┘  │         │
│                                                  │        │        │         │
│                                                  └────────┼────────┘         │
│                                                           │                  │
│                                                           ▼                  │
│                                                  ┌─────────────────┐         │
│                                                  │   TTS Service   │         │
│                                                  │  (Volcano TTS)  │         │
│                                                  └─────────────────┘         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 组件说明

### 1. Listener (RefactoredListener)
- **职责**: 只负责音频输入
- **输入**: PCM 音频数据（WebSocket）
- **输出**: 音量信息（用于前端可视化）、ASR 识别结果
- **依赖**: SpeechDetector（VAD）、ASRService

### 2. SpeechDetector
- **VolumeBasedSpeechDetector**: 音量阈值检测
- **EnergyBasedSpeechDetector**: 能量检测（WebRTC VAD 包装）
- **输出**: DetectionResult { isSpeech, confidence, reason }

### 3. SpeakerController
- **职责**: TTS 队列管理
- **功能**: 
  - 任务优先级管理
  - 串行播放保证
  - 缓存机制
  - speak/stop/skip/pause/resume 指令

### 4. LLMService
- **核心方法**: `request(messages, options)` 流式，`stop(requestId)` 停止
- **流程管道**: 
  - 分离 thinking 和 text 块
  - 集成 ThinkingProcessor
  - 可选 TTS 播报 thinking
- **结构化输出**: thinking | text | tool_use | tool_result | done | error

## 数据流

### 完整对话流程

```
1. 用户说话
   Frontend Recorder ──WebSocket──▶ Listener
   
2. 语音检测
   Listener ──PCM──▶ SpeechDetector
   SpeechDetector ──isSpeech──▶ Listener
   
3. ASR 识别
   Listener ──PCM──▶ ASRService
   ASRService ──text──▶ Listener
   Listener ──text──▶ LLMService
   
4. LLM 处理
   LLMService.request(messages)
   ├─▶ 流式输出 chunks
   │   ├─ thinking chunk ──▶ ThinkingProcessor.clean()
   │   │                    └─▶ optional TTS
   │   ├─ text chunk ────────▶ SSE to Frontend
   │   ├─ tool_use chunk ────▶ Tool execution
   │   └─ done chunk
   
5. TTS 播报
   LLMService ──text──▶ SpeakerController.enqueue()
   SpeakerController ──task──▶ TTSService.synthesize()
   TTSService ──audio──▶ SpeakerController
   SpeakerController ──play cmd──▶ Frontend Speaker
```

### 打断流程

```
新语音输入 ──▶ Listener
     │
     ▼
Listener.emit('speechStart') 
     │
     ▼
Orchestrator.interrupt()
     │
     ├──▶ LLMService.stopAll()     // 停止 LLM 生成
     │
     └──▶ SpeakerController.stop() // 清空 TTS 队列
```

## 接口标准化

### ASR
```javascript
interface ASRService {
  createSession(options): ASRSession
}
interface ASRSession {
  sendAudio(buffer): void
  close(): void
  events: 'interim' | 'final' | 'error' | 'close'
}
```

### TTS
```javascript
interface TTSService {
  synthesize(text, options): Promise<{audioData, duration}>
  cancel(taskId): void
  cancelAll(): void
}
```

### SpeechDetector
```javascript
interface SpeechDetector {
  detect(audioContext): DetectionResult
  reset(): void
}
```

### LLM
```javascript
interface LLMService {
  request(messages, options): AsyncGenerator<LLMStreamChunk>
  stop(requestId): boolean
  stopAll(): void
}
```

### ThinkingProcessor
```javascript
interface ThinkingProcessor {
  clean(text): Promise<string>
}
```

## Phase 3 完成状态

| 任务 | 状态 | 说明 |
|-----|------|-----|
| Task 8: Speaker Controller | ✅ | TTS 队列、speak/stop 指令 |
| Task 9: Refactor Listener | ✅ | 使用 SpeechDetector，纯音频输入 |
| Task 10: LLM Service 骨架 | ✅ | request/stop 方法 |
| Task 11: Process Pipeline | ✅ | 集成 ThinkingProcessor |
| Task 12: Streaming Output | ✅ | 结构化数据 (thinking/text/tool) |

## 下一步 (Phase 4)

1. **Orchestrator**: 协调整合所有服务
2. **WebSocket Server**: 前端通信
3. **Session Management**: 对话历史管理
4. **Error Handling**: 全局错误处理策略
5. **Configuration**: 统一配置管理
