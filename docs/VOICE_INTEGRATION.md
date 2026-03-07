# 火山引擎语音集成文档

本文档介绍 Kimi Code Web Assistant 中的火山引擎（字节跳动）语音识别（STT）和语音合成（TTS）集成。

## 功能特性

- 🎙️ **语音识别 (STT)**：实时流式识别，支持中文普通话
- 🔊 **语音合成 (TTS)**：多种音色可选，包括方言（四川话、东北话）
- ⚡ **双引擎支持**：火山引擎（云端）+ Piper/浏览器（本地）
- 🎛️ **灵活配置**：用户可自由切换引擎和音色

## 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                        前端 (React)                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ volcanoSTT  │  │ volcanoTTS  │  │ voiceConversation   │  │
│  │ (Socket.io) │  │  (HTTP)     │  │    (整合层)          │  │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │
└─────────┼────────────────┼────────────────────┼─────────────┘
          │                │                    │
          │ WebSocket      │ HTTP POST          │
          ▼                ▼                    ▼
┌─────────────────────────────────────────────────────────────┐
│                      后端 (Node.js)                          │
│  ┌──────────────────────────────────────────────────────┐   │
│  │           /api/volcano/stt  (Socket.io)               │   │
│  │           /api/volcano/tts  (HTTP POST)               │   │
│  └────────────────────┬─────────────────────────────────┘   │
└───────────────────────┼─────────────────────────────────────┘
                        │
                        │ WebSocket / HTTPS
                        ▼
              ┌──────────────────────┐
              │   火山引擎开放平台    │
              │  openspeech.bytedance │
              │      .com            │
              └──────────────────────┘
```

## 配置说明

### 1. 获取火山引擎密钥

1. 访问 [火山引擎官网](https://www.volcengine.com/)
2. 注册并登录账号
3. 进入控制台，开通以下服务：
   - **语音识别**（流式识别）
   - **语音合成**（大模型语音合成）
4. 创建应用，获取：
   - `App ID`
   - `Access Token`

### 2. 配置环境变量

```bash
# .env 文件
VOLCANO_APP_ID=your-app-id
VOLCANO_ACCESS_TOKEN=your-access-token
VOLCANO_CLUSTER=volcengine_streaming_common  # 可选
```

### 3. 重启服务器

```bash
npm run dev
```

## 使用指南

### 选择引擎

1. 点击聊天界面右下角的 🎙️ 按钮打开语音设置
2. 选择 TTS 引擎：
   - **火山引擎**：云端高质量，多种音色
   - **Piper**：本地运行，无需联网
3. 选择 STT 引擎：
   - **火山引擎**：云端识别，准确率高
   - **浏览器**：本地识别，免费使用

### 音色列表

| 音色 ID | 名称 | 描述 |
|---------|------|------|
| zh_female_qingxin | 清新女声 | 通用场景，自然亲切 |
| zh_male_qingshu | 青叔男声 | 通用场景，成熟稳重 |
| zh_male_sunwukong | 孙悟空 | 角色扮演，西游记 |
| zh_male_yuzhou | 东北老铁 | 方言，亲切幽默 |
| zh_female_sichuan | 四川妹子 | 方言，热情泼辣 |
| ... | 更多 | 共 11 种音色可选 |

### 语音对话

1. 点击语音对话按钮（🎙️）开始
2. 说话时音量条会跳动
3. 说完后停顿 0.6-0.8 秒自动发送
4. AI 回复会通过语音播放
5. 可随时点击按钮打断 AI 说话

## API 端点

### STT 状态检查
```
GET /api/volcano/stt/status
Response: { available: boolean, error?: string }
```

### TTS 音色列表
```
GET /api/volcano/tts/voices
Response: { voices: Voice[], available: boolean }
```

### TTS 语音合成
```
POST /api/volcano/tts/synthesize
Body: { text: string, voice?: string, speed?: number }
Response: audio/mpeg
```

### TTS 流式合成（长文本）
```
POST /api/volcano/tts/synthesize/stream
Body: { text: string, voice?: string, speed?: number }
Response: chunked audio/mpeg
```

### STT WebSocket (Socket.io)
```
Namespace: /volcano-stt
Events:
  - client -> server: audio { audio: base64 }
  - client -> server: stop
  - server -> client: connected
  - server -> client: text { text: string, isFinal: boolean }
  - server -> client: error { message: string }
```

## 降级策略

如果火山引擎未配置或不可用：

1. **STT**：自动降级到浏览器 Web Speech API
2. **TTS**：自动降级到本地 Piper TTS
3. **用户提示**：语音设置面板显示警告信息

## 技术细节

### 音频格式

- **STT 输入**：16kHz, 16-bit PCM, 单声道
- **TTS 输出**：MP3, 24kHz

### VAD 参数

- 静音阈值：0.015（较敏感）
- 静音超时：600-800ms（较快响应）
- 最小语音时长：150ms

### 安全考虑

- API 密钥仅存储在服务器端
- 前端通过代理访问火山引擎
- 用户 ID 使用随机 UUID，不包含真实身份信息

## 故障排查

### STT 无法连接

1. 检查环境变量是否正确配置
2. 查看服务器日志中的连接错误
3. 确认火山引擎服务已开通

### TTS 播放失败

1. 检查网络连接
2. 查看浏览器控制台错误
3. 尝试切换音色或引擎

### 语音识别不准确

1. 检查麦克风权限
2. 调整 VAD 阈值设置
3. 确保说话清晰，避免背景噪音

## 成本说明

火山引擎语音服务为付费服务，大致价格：

- **STT**：约 ¥0.5 / 小时
- **TTS**：约 ¥10 / 1万字符

具体价格请参考火山引擎官方文档。

## 相关文件

```
src/
├── server/
│   ├── routes/
│   │   ├── volcanoSTT.js    # STT 代理
│   │   └── volcanoTTS.js    # TTS 代理
│   └── index.js             # Socket.io 设置
├── client/
│   ├── services/
│   │   ├── volcanoSTT.ts    # STT 客户端
│   │   ├── volcanoTTS.ts    # TTS 客户端
│   │   ├── voiceConfig.ts   # 配置管理
│   │   └── voiceConversation.ts  # 对话整合
│   └── components/
│       └── VoiceSettings.tsx  # 设置面板
```

## 未来优化

- [ ] 支持更多方言（粤语、闽南语等）
- [ ] 添加语音克隆功能
- [ ] 支持实时翻译
- [ ] 添加语音情感控制
