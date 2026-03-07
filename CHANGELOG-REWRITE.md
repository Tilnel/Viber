# viber 架构重构 CHANGELOG（大重写专用）

> **范围：** 本次文档仅用于指导 v2.0 架构重写（Phase 1-7），记录可能对后续阶段有用的技术细节和决策点。
> 
> **时间：** 2024-03-07  
> **目标版本：** v2.0-ARCH  
> **核心原则：** 后端重、前端轻 - 所有业务逻辑后移，前端只做采集和展示

---

## 🏗️ 架构核心变更

### 1. 职责重新划分

| 职责 | 旧架构 | 新架构 | 说明 |
|------|--------|--------|------|
| **VAD/语音检测** | 前端 (`simpleVoiceManager`) | 后端 (`Listener` + `SpeechDetector`) | 前端只传原始音频 |
| **语音识别** | 前端调用 API | 后端统一处理 | 火山/其他 ASR 对前端透明 |
| **语音合成** | 前端直接调用多个服务 | 后端 `Speaker Controller` 统一队列 | 前端只接收播放指令 |
| **打断判断** | 分散在各组件 | 后端 `Listener` 集中判断 | 统一的打断信号 |
| **LLM 流式** | 前端直接接收 | 后端 `LLM Service` 处理+分发 | 包含思考过程清洗 |

### 2. 通信协议统一

```
旧架构：
- HTTP REST (文件/Git/设置)
- Socket.io (STT)
- SSE (Chat 流式)
- HTTP POST (TTS)

新架构：
- WebSocket (所有实时双向通信)
  ├── 上行：音频流 (binary) + 控制信号 (json)
  └── 下行：识别状态 + LLM 数据 + 语音指令
- HTTP REST (仅文件/Git等无状态操作，保留)
```

**决策理由：** WebSocket 支持真正的服务器推送（打断信号），避免前端轮询。

---

## 📋 Phase 1: 标准化接口（当前阶段）

### 1.1 Volcano ASR 标准接口

```typescript
// 输入：严格限制格式，避免后端处理复杂度
interface ASRInputStream {
  format: 'pcm' | 'wav';      // 目前只支持 pcm
  sampleRate: 16000;          // 强制 16kHz
  bits: 16;                   // 强制 16bit
  channel: 1;                 // 强制单声道
  encoding: 'raw' | 'opus';   // 默认 raw，未来支持 opus 压缩
}

// 输出：统一事件格式
interface ASREvent {
  type: 'started' | 'interim' | 'final' | 'error';
  sessionId: string;
  timestamp: number;
  
  // type='interim' | 'final' 时有
  text?: string;
  confidence?: number;
  
  // type='error' 时有
  errorCode?: number;
  errorMessage?: string;
}
```

**Phase 1 任务：**
- [ ] 封装现有 `volcanoSTT.js` 为 `VolcanoASRService` 类
- [ ] 实现 `ASRService` 接口（便于以后换百度/讯飞）
- [ ] 输入数据格式验证（拒绝非法格式，提前报错）

**⚠️ 对后续阶段的重要信息：**
- PCM 数据 endianness：小端 (Little Endian)，与火山协议一致
- 音频分片大小：建议 100-200ms（4096 samples @ 16kHz = 256ms）
- 火山协议细节：`msgType=0x2` 音频包，`sequence` 从 1 递增，最后一包负序号

### 1.2 Volcano TTS 标准接口

```typescript
// 输入
interface TTSRequest {
  text: string;
  voiceId: string;            // 音色 ID
  speed: number;              // 0.5 - 2.0，默认 1.0
  volume: number;             // 0 - 100，默认 100
  
  // 流式控制
  streaming: boolean;         // 默认 true
  
  // 高级（可选）
  pitch?: number;
  emotion?: 'neutral' | 'happy' | 'sad' | 'angry';
}

// 输出：支持两种模式
interface TTSResponse {
  mode: 'stream' | 'url';
  
  // mode='stream' 时
  audioStream?: ReadableStream<Uint8Array>;
  
  // mode='url' 时（用于长文本缓存）
  audioUrl?: string;
  
  format: 'mp3' | 'wav' | 'pcm';
  duration: number;           // 预估时长（秒）
  taskId: string;             // 用于 cancel
}

// 控制接口
interface TTSService {
  synthesize(request: TTSRequest): Promise<TTSResponse>;
  cancel(taskId: string): Promise<void>;
  cancelAll(): Promise<void>;
  getVoices(): Promise<VoiceInfo[]>;
}
```

**Phase 1 任务：**
- [ ] 封装现有 `volcanoTTS.js` 为 `VolcanoTTSService` 类
- [ ] 实现 `TTSService` 通用接口
- [ ] 支持多引擎配置（Volcano / Edge / Piper）

**⚠️ 对后续阶段的重要信息：**
- 火山 TTS 分两种 API：长文本合成（异步）和流式合成（WebSocket）
- 当前使用长文本 API，未来应迁移到 WebSocket 流式以支持打断
- Edge TTS 是微软免费服务，限制 50 请求/分钟，需要 rate limit
- Piper TTS 是本地服务，通过 HTTP 调用本地端口

### 1.3 多引擎 TTS 路由策略

```typescript
// 策略配置
interface TTSEngineStrategy {
  primary: 'volcano' | 'edge' | 'piper';
  fallback: ('volcano' | 'edge' | 'piper')[];
  
  // 选择逻辑
  rules: {
    // 网络差时用本地 Piper
    offlineUse: 'piper';
    // 长文本用火山（支持 SSML）
    longTextThreshold: 500; // chars
    longTextEngine: 'volcano';
    // 快速响应用 Edge（延迟低）
    shortTextEngine: 'edge';
  };
}
```

**Phase 1 预留：** 先实现单个引擎，接口支持多引擎，Phase 3 再实现策略逻辑。

---

## 🔧 Phase 2-7 关键设计预留

### Phase 2: Speech Detector API（预留设计）

```typescript
// 输入上下文（每 20-50ms 更新）
interface AudioContext {
  // 原始数据
  recentChunks: AudioChunk[];      // 最近 10-20 个分片（约 2-5s）
  
  // 特征（由后端计算）
  volumeHistory: number[];         // 音量归一化 0-1
  zeroCrossingRate: number[];      // 过零率（区分噪音/语音）
  spectralCentroid?: number[];     // 频谱质心（需要 FFT）
  
  // 状态累计
  currentState: 'silence' | 'speech' | 'noise';
  stateDuration: number;           // 当前状态持续时间
  totalDuration: number;           // 总会话时长
  
  // 历史决策
  lastResult: boolean;
  confidenceHistory: number[];
}

// 输出
interface DetectionResult {
  isSpeech: boolean;
  confidence: number;              // 0-1，用于调试
  reason: 'volume' | 'duration' | 'model'; // 决策原因
}

// 接口
interface SpeechDetector {
  detect(context: AudioContext): DetectionResult;
  adapt?(context: AudioContext): void; // 自适应噪音环境
}
```

**给 Phase 2 的提示：**
- 简单实现：音量阈值 + 持续时间（已够用）
- 进阶实现：基于能量的 VAD（WebRTC VAD 算法）
- 高级实现：轻量 ML 模型（ONNX runtime，~1MB）

### Phase 3: Thinking Processor（预留设计）

```typescript
interface ThinkingProcessor {
  // 快速清洗
  clean(rawThinking: string): Promise<string>;
  
  // 流式清洗（用于长思考）
  cleanStream(input: ReadableStream): ReadableStream<string>;
}

// 处理策略
interface CleanStrategy {
  // 内容过滤
  filters: {
    removeMarkdown: boolean;
    removeCodeBlocks: boolean;
    removeXmlTags: boolean;      // <tool> <path> 等
    maxLength: number;           // 超长则截断或总结
  };
  
  // 口语化增强
  enhancement: {
    addFillers: boolean;         // "嗯..." "让我想想..."
    simplifyTechnicalTerms: boolean; // "递归" → "循环调用自己"
    convertToFirstPerson: boolean;   // "AI 认为" → "我觉得"
  };
  
  // 模型选择
  model: {
    provider: 'kimi' | 'openai' | 'local';
    modelId: 'kimi-fast' | 'gpt-3.5-turbo' | string;
    temperature: 0.3;            // 低温度，稳定输出
    maxTokens: 150;              // 短输出，快速响应
  };
}
```

**给 Phase 3 的提示：**
- Kimi Fast 模型足够（响应快，成本低）
- Prompt 模板需要调试，预留 A/B 测试接口
- 缓存常见思考模式（"让我看看文件结构" → "我看看文件结构"）

### Phase 4: Speaker Controller（预留设计）

```typescript
interface SpeakerController {
  // 任务队列（按 LLM 输出顺序）
  queue: SpeakTask[];
  
  // 状态
  state: 'idle' | 'speaking' | 'paused';
  currentTask?: SpeakTask;
  
  // 控制方法
  enqueue(task: SpeakTask): void;
  pause(): void;           // 用户打断时
  resume(): void;
  stop(): void;            // 清空队列
  skip(): void;            // 跳过当前，播放下一个
  
  // 优先级管理
  setPriority(taskId: string, priority: 'high' | 'normal' | 'low'): void;
}

interface SpeakTask {
  id: string;
  type: 'thinking' | 'response' | 'tool_result';
  text: string;
  audioData?: Buffer;       // 预合成的音频
  priority: number;
  timestamp: number;
}
```

**关键决策：**
- Response 优先级 > Thinking 优先级（新回复打断旧思考）
- 同类型任务排队，不同类型可插队（但 Response 不插队另一个 Response）

### Phase 5: WebSocket 协议规范（预留设计）

**命名空间：** `/v2/realtime`（与旧版 `/volcano-stt` 区分）

**上行消息（Client → Server）：**

```json
// 1. 音频数据（binary frame，非 JSON）
// 格式：{type: 'audio', data: Uint8Array}

// 2. 控制信号
{
  "type": "control",
  "action": "start_recording" | "stop_recording" | "interrupt",
  "timestamp": 1710000000000
}

// 3. 配置（连接后发送）
{
  "type": "config",
  "asrEngine": "volcano",
  "ttsEngine": "auto",
  "enableThinkingTTS": true
}
```

**下行消息（Server → Client）：**

```json
// 1. 识别状态
{
  "type": "recognition",
  "status": "started" | "interim" | "final" | "error",
  "text": "识别到的文字",
  "confidence": 0.95
}

// 2. LLM 输出
{
  "type": "llm",
  "subtype": "thinking" | "text" | "tool_call" | "tool_result" | "done",
  "content": "内容",
  "toolInfo?: { "name": "read_file", "args": {} }
}

// 3. 语音指令
{
  "type": "audio",
  "action": "speak" | "stop",
  "taskId": "uuid",
  "audioData?": "base64...",  // speak 时
  "format": "mp3"
}

// 4. 系统信号
{
  "type": "system",
  "event": "interrupt" | "error" | "connected",
  "message": "描述"
}
```

---

## 🗑️ 废弃清单（逐步移除）

| 文件 | 组件 | 替换为 | 移除时机 |
|------|------|--------|----------|
| `simpleVoiceManager.ts` | 前端语音管理 | `Recorder` (精简版) | Phase 4 |
| `voiceConversation.ts` | 对话逻辑 | `Speaker` 部件 | Phase 4 |
| `volcanoSTT.ts` (前端) | STT 服务调用 | WebSocket 统一接口 | Phase 4 |
| `piperTTS.ts` (前端) | TTS 调用 | 后端 `Speaker Controller` | Phase 4 |
| `voiceManager.ts` | 旧管理器 | 新架构 | Phase 4 |
| `conversationManager.ts` | 对话管理 | `LLM Service` | Phase 4 |

**注意：** Phase 1-3 保持旧代码可用，通过 feature flag 切换。

---

## ⚙️ 配置变更（新增环境变量）

```bash
# === ASR 配置 ===
ASR_ENGINE=volcano              # volcano | baidu | xunfei
ASR_WEBSOCKET_URL=wss://...
ASR_MAX_SESSION_DURATION=60000  # ms，防止无限占用

# === TTS 配置 ===
TTS_PRIMARY_ENGINE=volcano      # volcano | edge | piper
TTS_FALLBACK_ENGINES=edge,piper
TTS_ENABLE_CACHING=true         # 缓存常用语句
TTS_CACHE_DIR=./data/tts_cache

# === 语音检测配置 ===
VAD_ENGINE=volume               # volume | webrtc | ml
VAD_VOLUME_THRESHOLD=0.02
VAD_MIN_SPEECH_DURATION=300     # ms
VAD_MIN_SILENCE_DURATION=800    # ms

# === Thinking Processor 配置 ===
THINKING_PROCESSOR_MODEL=kimi-fast
THINKING_MAX_LENGTH=200         # 思考内容最大长度
THINKING_ENABLE_TTS=true        # 是否播报思考

# === WebSocket 配置 ===
WS_MAX_CONNECTIONS=100
WS_HEARTBEAT_INTERVAL=30000     # ms
WS_MESSAGE_SIZE_LIMIT=10485760  # 10MB，用于音频
```

---

## 🔄 向后兼容策略

### 过渡期（Phase 1-3）
- 保留旧 API 路由（`/api/chat/sessions` 等）
- 新增 `/api/v2/*` 路由
- 前端通过 feature flag 切换：`window.USE_NEW_ARCH = true`

### 切换期（Phase 4-5）
- 默认使用新架构
- 旧架构代码标记 `@deprecated`
- 保留 1-2 个版本后移除

### 数据库兼容
- 无 schema 变更
- 新增表 `tts_tasks`、`asr_sessions` 用于调试/统计

---

## 📝 开发记录（实时更新）

### 2024-03-07
- [x] 创建 CHANGELOG-REWRITE.md
- [x] Phase 1 完成：标准化 Volcano ASR/TTS 接口
  - [x] `src/server/services/asr/` 模块
  - [x] `src/server/services/tts/` 模块
- [x] Phase 2 完成：提取独立组件
  - [x] `src/server/services/detector/` - Speech Detector API
    - [x] `types.js` - 接口定义（AudioContext, DetectionResult）
    - [x] `VolumeBasedSpeechDetector.js` - 音量检测实现
    - [x] `test.js` - 单元测试
  - [x] `src/server/services/processor/` - Thinking Processor
    - [x] `types.js` - 接口定义（RuleBasedProcessor）
    - [x] `KimiThinkingProcessor.js` - Kimi Fast 实现
    - [x] `test.js` - 单元测试

### 待办
- [ ] Phase 3: 后端服务重构（Listener, Speaker, LLM Service）
- [ ] Phase 4: 前端部件重构（Recorder, Speaker）
- [ ] Phase 5: 通信层统一（WebSocket 协议规范）

---

## ❓ 待决策问题

1. **TTS 音频格式：** MP3（压缩，延迟高）vs PCM（原始，延迟低）？
   - 建议：网络好用 MP3，网络差用 PCM 或 Opus
   
2. **WebSocket 库：** Socket.io（兼容性好）vs ws（轻量）vs 原生 WebSocket？
   - 建议：保持 Socket.io，已在使用

3. **思考过程是否打断？** 用户说新语音打断所有，但思考被打断是否重新生成？
   - 建议：打断思考 → 停止当前 LLM 请求 → 用新语音重新 request

4. **多设备登录？** 同一账号多浏览器登录如何处理？
   - 建议：v2.0 暂不考虑，单设备单连接

---

**维护者：** @Tilnel  
**评审状态：** 待评审  
**最后更新：** 2024-03-07
