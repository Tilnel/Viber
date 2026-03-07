# Viber WebSocket 协议规范 v1.0

## 概述

Viber (VoIce & Intelligence Backed EditoR) 使用统一的 WebSocket 通道进行前后端实时通信。

- **协议**: Socket.io
- **Namespace**: `/viber` (统一命名空间，替代之前的分散命名空间)
- **传输**: WebSocket (优先)
- **编码**: JSON (控制消息), Base64 (音频数据)

## 连接管理

### 1. 连接建立

```javascript
const socket = io('/viber', {
  transports: ['websocket'],
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000
});
```

### 2. 认证

连接建立后，客户端需在 5 秒内发送认证消息：

**Client → Server**
```json
{
  "type": "auth",
  "data": {
    "token": "<jwt_token>"
  }
}
```

**Server → Client**
```json
// 成功
{
  "type": "auth:success",
  "data": {
    "userId": "<user_id>",
    "sessionId": "<session_id>"
  }
}

// 失败
{
  "type": "auth:error",
  "data": {
    "code": "AUTH_FAILED",
    "message": "认证失败"
  }
}
```

### 3. 心跳保活

Socket.io 内置 ping/pong，无需额外实现。

### 4. 断开连接

**Client → Server**
```json
{
  "type": "disconnect",
  "data": {
    "reason": "user_logout"
  }
}
```

---

## 消息格式

### 通用消息结构

```typescript
interface WebSocketMessage {
  type: string;        // 消息类型
  data?: any;          // 消息数据
  id?: string;         // 消息 ID（用于追踪）
  timestamp?: number;  // 时间戳
  error?: ErrorInfo;   // 错误信息（如有）
}

interface ErrorInfo {
  code: string;
  message: string;
  details?: any;
}
```

---

## 房间管理

### 加入房间

**Client → Server**
```json
{
  "type": "room:join",
  "data": {
    "room": "chat:123",
    "metadata": {}
  }
}
```

**Server → Client**
```json
{
  "type": "room:joined",
  "data": {
    "room": "chat:123",
    "members": 5
  }
}
```

### 离开房间

**Client → Server**
```json
{
  "type": "room:leave",
  "data": {
    "room": "chat:123"
  }
}
```

---

## 语音对话 (Voice)

### 音频流控制

#### 开始录音

**Client → Server**
```json
{
  "type": "voice:start",
  "data": {
    "sessionId": "<chat_session_id>",
    "config": {
      "sampleRate": 16000,
      "language": "zh-CN"
    }
  }
}
```

**Server → Client**
```json
{
  "type": "voice:started",
  "data": {
    "streamId": "stream_xxx"
  }
}
```

#### 发送音频帧

**Client → Server**
```json
{
  "type": "voice:audio",
  "data": {
    "streamId": "stream_xxx",
    "seq": 1,
    "audio": "<base64_pcm_data>",
    "timestamp": 1234567890
  }
}
```

#### 停止录音

**Client → Server**
```json
{
  "type": "voice:stop",
  "data": {
    "streamId": "stream_xxx"
  }
}
```

### 音量反馈（用于前端可视化）

**Server → Client**
```json
{
  "type": "voice:volume",
  "data": {
    "streamId": "stream_xxx",
    "volume": 0.75
  }
}
```

### ASR 结果

**Server → Client**
```json
// 临时结果
{
  "type": "voice:asr:interim",
  "data": {
    "streamId": "stream_xxx",
    "text": "你好世界"
  }
}

// 最终结果
{
  "type": "voice:asr:final",
  "data": {
    "streamId": "stream_xxx",
    "text": "你好世界，这是最终识别结果。",
    "confidence": 0.95
  }
}
```

### 打断指令

**Client → Server** (用户说话时打断 AI)
```json
{
  "type": "voice:interrupt",
  "data": {
    "streamId": "stream_xxx"
  }
}
```

---

## 语音播报 (Speaker)

### 播放指令

**Server → Client**
```json
{
  "type": "speaker:play",
  "data": {
    "taskId": "task_xxx",
    "type": "thinking" | "response" | "tool_result" | "notification",
    "text": "可选的文本内容",
    "audio": "<base64_audio_data>",
    "format": "mp3",
    "duration": 3.5
  }
}
```

### 播放控制

**Client → Server**
```json
// 播放完成
{
  "type": "speaker:completed",
  "data": {
    "taskId": "task_xxx"
  }
}
```

**Server → Client**
```json
// 停止播放
{
  "type": "speaker:stop",
  "data": {}
}

// 暂停播放
{
  "type": "speaker:pause",
  "data": {}
}

// 恢复播放
{
  "type": "speaker:resume",
  "data": {}
}
```

---

## LLM 流式对话 (Chat)

### 发送消息

**Client → Server**
```json
{
  "type": "chat:send",
  "id": "msg_xxx",
  "data": {
    "sessionId": "<chat_session_id>",
    "content": "用户消息",
    "context": {
      "currentFile": "/path/to/file",
      "selectedCode": "optional code snippet"
    }
  }
}
```

### 流式响应

**Server → Client**
```json
// 思考过程
{
  "type": "chat:thinking",
  "data": {
    "messageId": "msg_xxx",
    "content": "AI 思考过程..."
  }
}

// 文本内容
{
  "type": "chat:delta",
  "data": {
    "messageId": "msg_xxx",
    "content": "增量文本内容"
  }
}

// 工具调用
{
  "type": "chat:tool:call",
  "data": {
    "messageId": "msg_xxx",
    "tool": "tool_name",
    "input": {}
  }
}

// 工具结果
{
  "type": "chat:tool:result",
  "data": {
    "messageId": "msg_xxx",
    "tool": "tool_name",
    "output": {}
  }
}

// 完成
{
  "type": "chat:complete",
  "data": {
    "messageId": "msg_xxx",
    "usage": {
      "promptTokens": 100,
      "completionTokens": 200
    }
  }
}

// 错误
{
  "type": "chat:error",
  "data": {
    "messageId": "msg_xxx",
    "error": {
      "code": "RATE_LIMIT",
      "message": "请求过于频繁"
    }
  }
}
```

### 停止生成

**Client → Server**
```json
{
  "type": "chat:stop",
  "data": {
    "messageId": "msg_xxx"
  }
}
```

---

## 终端 (Terminal)

### 创建终端

**Client → Server**
```json
{
  "type": "terminal:create",
  "data": {
    "id": "term_xxx",
    "cwd": "/project/path"
  }
}
```

**Server → Client**
```json
{
  "type": "terminal:created",
  "data": {
    "id": "term_xxx",
    "status": "ready"
  }
}
```

### 输入数据

**Client → Server**
```json
{
  "type": "terminal:input",
  "data": {
    "id": "term_xxx",
    "data": "ls -la\n"
  }
}
```

### 输出数据

**Server → Client**
```json
{
  "type": "terminal:output",
  "data": {
    "id": "term_xxx",
    "data": "<terminal_output>"
  }
}
```

### 调整大小

**Client → Server**
```json
{
  "type": "terminal:resize",
  "data": {
    "id": "term_xxx",
    "cols": 80,
    "rows": 24
  }
}
```

### 关闭终端

**Client → Server**
```json
{
  "type": "terminal:close",
  "data": {
    "id": "term_xxx"
  }
}
```

---

## 文件系统监控 (FS)

### 开始监控

**Client → Server**
```json
{
  "type": "fs:watch",
  "data": {
    "path": "/project/path"
  }
}
```

### 文件变更通知

**Server → Client**
```json
{
  "type": "fs:change",
  "data": {
    "path": "/project/path/file.txt",
    "type": "modify" | "create" | "delete" | "rename",
    "timestamp": 1234567890
  }
}
```

---

## 状态同步

### 全局状态更新

**Server → Client**
```json
{
  "type": "state:update",
  "data": {
    "voice": "idle" | "listening" | "processing" | "speaking",
    "connection": "connected" | "reconnecting" | "disconnected"
  }
}
```

---

## 错误处理

### 通用错误格式

**Server → Client**
```json
{
  "type": "error",
  "data": {
    "code": "ERROR_CODE",
    "message": "错误描述",
    "context": {
      "originalType": "voice:start",
      "details": {}
    }
  }
}
```

### 错误码定义

| 错误码 | 描述 | 处理建议 |
|-------|------|---------|
| `AUTH_FAILED` | 认证失败 | 重新登录 |
| `SESSION_EXPIRED` | 会话过期 | 刷新 token |
| `RATE_LIMIT` | 请求过于频繁 | 降低请求频率 |
| `INVALID_MESSAGE` | 消息格式错误 | 检查消息格式 |
| `SERVICE_UNAVAILABLE` | 服务不可用 | 稍后重试 |
| `NOT_IMPLEMENTED` | 功能未实现 | 无需处理 |

---

## 消息类型索引

### Client → Server

| 类型 | 描述 |
|-----|------|
| `auth` | 认证 |
| `disconnect` | 断开连接 |
| `room:join` | 加入房间 |
| `room:leave` | 离开房间 |
| `voice:start` | 开始录音 |
| `voice:audio` | 音频数据 |
| `voice:stop` | 停止录音 |
| `voice:interrupt` | 打断 |
| `speaker:completed` | 播放完成通知 |
| `chat:send` | 发送消息 |
| `chat:stop` | 停止生成 |
| `terminal:create` | 创建终端 |
| `terminal:input` | 终端输入 |
| `terminal:resize` | 调整终端大小 |
| `terminal:close` | 关闭终端 |
| `fs:watch` | 监控文件系统 |

### Server → Client

| 类型 | 描述 |
|-----|------|
| `auth:success` | 认证成功 |
| `auth:error` | 认证失败 |
| `room:joined` | 已加入房间 |
| `voice:started` | 录音已开始 |
| `voice:volume` | 音量更新 |
| `voice:asr:interim` | ASR 临时结果 |
| `voice:asr:final` | ASR 最终结果 |
| `speaker:play` | 播放指令 |
| `speaker:stop` | 停止播放 |
| `speaker:pause` | 暂停播放 |
| `speaker:resume` | 恢复播放 |
| `chat:thinking` | AI 思考过程 |
| `chat:delta` | 增量内容 |
| `chat:tool:call` | 工具调用 |
| `chat:tool:result` | 工具结果 |
| `chat:complete` | 生成完成 |
| `chat:error` | 生成错误 |
| `terminal:created` | 终端已创建 |
| `terminal:output` | 终端输出 |
| `fs:change` | 文件变更 |
| `state:update` | 状态更新 |
| `error` | 通用错误 |

---

## 向后兼容

旧版 Socket.io 命名空间将在 v2.0 中移除：
- `/volcano-stt` → 迁移到 `/viber` + `voice:*` 消息

过渡期（v1.x）支持双协议运行。
