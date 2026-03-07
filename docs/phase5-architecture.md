# Phase 5 架构文档

## 通信层统一

### 目标

将所有实时通信统一到一个 WebSocket 通道，替代分散的 Socket.io 命名空间和 SSE。

### 架构图

```
Before (Phase 4):
┌─────────────────────────────────────────────────────────────┐
│                          Frontend                            │
├─────────────┬─────────────┬─────────────┬───────────────────┤
│ / (default) │/volcano-stt │   SSE       │  HTTP Streaming   │
│  - chat     │  - ASR      │  - LLM      │   - TTS           │
│  - terminal │             │             │                   │
└──────┬──────┴──────┬──────┴──────┬──────┴─────────┬─────────┘
       │             │             │                │
       └─────────────┴─────────────┴────────────────┘
                         │
                   Backend Server

After (Phase 5):
┌─────────────────────────────────────────────────────────────┐
│                          Frontend                            │
│                     ┌───────────────┐                        │
│                     │  ViberSocket  │                        │
│                     │  (unified)    │                        │
│                     └───────┬───────┘                        │
└─────────────────────────────┼───────────────────────────────┘
                              │
                       /viber namespace
                              │
┌─────────────────────────────┼───────────────────────────────┐
│                      Backend Server                          │
│                 ┌───────────┴───────────┐                    │
│                 │  ViberSocketManager   │                    │
│                 └───────────┬───────────┘                    │
│         ┌───────────────────┼───────────────────┐            │
│    voice: handlers   chat: handlers    terminal: handlers    │
└─────────────────────────────────────────────────────────────┘
```

## 统一协议

### 消息格式

```typescript
interface ViberMessage {
  type: string;        // 消息类型，格式 "domain:action"
  data?: any;          // 消息数据
  id?: string;         // 消息 ID
  timestamp?: number;  // 时间戳
  error?: ErrorInfo;   // 错误信息
}
```

### 命名规范

| 类型格式 | 说明 | 示例 |
|---------|------|------|
| `domain:action` | 客户端→服务端请求 | `voice:start`, `chat:send` |
| `domain:actioned` | 服务端→客户端响应 | `voice:started`, `chat:delta` |
| `domain:sub:action` | 子类型消息 | `voice:asr:final`, `chat:tool:call` |

### 域划分

- `auth:*` - 认证相关
- `voice:*` - 语音对话（录音、ASR）
- `speaker:*` - 语音播报（TTS）
- `chat:*` - LLM 对话
- `terminal:*` - 终端
- `fs:*` - 文件系统监控
- `room:*` - 房间管理

## 后端实现

### 文件结构

```
src/server/socket/
├── viber.js           # ViberSocketManager - 核心管理器
├── setup.js           # 统一设置入口
├── handlers/
│   ├── voice.js       # 语音处理器
│   └── terminal.js    # 终端处理器
└── index.js           # 旧版兼容
```

### ViberSocketManager

核心功能：
- 连接管理（认证、心跳、断开处理）
- 房间管理
- 消息路由
- 处理器注册

```javascript
const manager = new ViberSocketManager(io);
manager.registerHandler('voice:start', handleVoiceStart);
manager.emitToUser(userId, { type: 'voice:volume', data: { volume: 0.5 } });
manager.emitToRoom('chat:123', { type: 'chat:delta', data: { content: '...' } });
```

## 前端实现

### 文件结构

```
src/client/src/services/
├── viberSocket.ts     # ViberSocket - 统一客户端
└── voice/
    ├── SimpleRecorder.ts
    ├── SpeakerController.ts
    ├── VoiceSocketService.ts   # Phase 4 (deprecated)
    ├── VoiceService.ts           # Phase 4 (deprecated)
    └── index.ts
```

### ViberSocket 使用

```typescript
import { ViberSocket, ViberMessageType } from './services/viberSocket';

const socket = new ViberSocket({
  token: 'your-token',
  onConnect: () => console.log('Connected'),
  onMessage: (msg) => console.log('Received:', msg)
});

await socket.connect();

// 语音
socket.startVoice(sessionId);
socket.sendAudio(streamId, int16Data, seq);
socket.stopVoice(streamId);

// 聊天
const msgId = socket.sendChat(sessionId, 'Hello');
socket.on(ViberMessageType.CHAT_DELTA, (data) => {
  console.log(data.content);
});

// 房间
socket.joinRoom('chat:123');
```

## 向后兼容

### Phase 5.1 (过渡期)
- 保留旧版 `/volcano-stt` namespace
- 新旧协议并行运行
- 前端逐步迁移

### Phase 5.2 (迁移完成)
- 移除旧版 namespace
- 仅保留 `/viber`

## Phase 5 完成状态

| 任务 | 状态 | 说明 |
|-----|------|-----|
| Task 16: 协议规范 | ✅ | `docs/websocket-protocol.md` |
| Task 17: 后端服务 | ✅ | `src/server/socket/viber.js` + handlers |
| Task 18: 前端客户端 | ✅ | `src/client/src/services/viberSocket.ts` |
| Task 19: SSE 迁移 | ⏸️ | 可选任务，待后续实现 |
| 验收标准 | ✅ | 统一通道 `/viber`，协议文档完整 |

## 下一步

1. **迁移现有代码**: 将 `volcanoSTT.ts` 等旧代码迁移到 ViberSocket
2. **集成测试**: 端到端测试语音对话流程
3. **性能优化**: 消息压缩、批量发送
4. **SSE 迁移** (可选): 将 LLM 流从 SSE 迁移到 WebSocket
