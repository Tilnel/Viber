# viber

**Voice & Intelligence Backed EditoR**

基于语音交互的智能代码编辑器，支持实时双工语音对话、项目文件管理、代码编辑和版本控制。viber 让你用自然语言与 AI 协作编程，实现真正的 "vibe coding" 体验。

## ✨ 核心功能

### 1. 项目管理
- 首页显示最近打开的项目
- 每个目录作为一个独立项目
- 每个项目维护自己的对话 Session

### 2. 代码编辑器
- 基于 Monaco Editor（VS Code 同款）
- 语法高亮、代码折叠、多光标编辑
- 多标签页、自动保存

### 3. AI 助手
- 集成 Kimi CLI（使用订阅计划）
- 流式对话响应
- 代码上下文感知（当前文件、选中代码）
- AI 修改文件的 Diff 展示

### 4. 语音对话
- **实时双工语音** - "打电话"式体验
- **火山引擎 ASR/TTS** - 低延迟、高准确率
- **流式响应** - LLM 边生成边播报
- **智能打断** - 说话即打断，无需按钮
- **文本清洗** - Markdown/代码自动转换为口语

### 5. 版本控制
- Git 状态显示
- 文件暂存/取消暂存
- 提交更改
- 最近提交历史

### 6. Web Terminal
- 内置终端，可在浏览器执行 shell 命令
- 基于 xterm.js 和 node-pty

## 🛠️ 技术栈

### 后端
- **Node.js** + **Express**
- **Socket.io** - 实时通信
- **PostgreSQL** - 数据持久化
- **simple-git** - Git 操作
- **node-pty** - 终端仿真

### 前端
- **React 18** + **TypeScript**
- **Zustand** - 状态管理
- **Monaco Editor** - 代码编辑
- **react-resizable-panels** - 可调整面板
- **xterm.js** - 终端组件

## 🚀 快速开始

### 环境要求
- Node.js >= 18
- PostgreSQL >= 14
- Git
- Kimi CLI（已安装并登录）

### 安装

1. 克隆仓库
```bash
cd viber
```

2. 运行启动脚本
```bash
./start.sh
```

或者手动启动：

```bash
# 安装依赖
npm install
cd src/client && npm install && cd ../..

# 配置 PostgreSQL
sudo -u postgres psql -c "ALTER USER postgres WITH PASSWORD 'your_password';"
sudo -u postgres psql -c "CREATE DATABASE viber;"

# 运行数据库迁移
npm run db:migrate

# 启动开发服务器
npm run dev
```

3. 访问应用
打开浏览器访问 http://localhost:5173

### Docker 部署

```bash
# 构建并启动
docker-compose up -d

# 查看日志
docker-compose logs -f app
```

## 📁 项目结构

```
viber/
├── src/
│   ├── server/                 # 后端代码
│   │   ├── db/                 # PostgreSQL 数据库
│   │   ├── socket/             # WebSocket 服务 (/viber)
│   │   │   ├── viber.js        # ViberSocketManager
│   │   │   └── handlers/       # 消息处理器
│   │   ├── services/           # 业务逻辑
│   │   │   ├── voice/          # VoiceOrchestrator (ASR→LLM→TTS)
│   │   │   ├── chat/           # ChatService (kimi-cli)
│   │   │   ├── asr/            # ASR 服务 (火山引擎)
│   │   │   └── tts/            # TTS 服务 (火山引擎)
│   │   └── routes/             # REST API
│   │
│   ├── client/                 # 前端代码 (React + Vite)
│   │   └── src/
│   │       ├── components/     # React 组件
│   │       ├── services/       # 业务服务
│   │       │   ├── voice/      # 语音服务
│   │       │   │   ├── NewVoiceService.ts    # 主语音服务
│   │       │   │   ├── SpeakerController.ts  # 音频播放
│   │       │   │   └── SimpleRecorder.ts     # 录音器
│   │       │   └── viberSocket.ts            # 统一 WebSocket
│   │       └── stores/         # Zustand 状态管理
│   │
│   └── shared/                 # 共享类型
│
├── docs/                       # 文档
│   ├── websocket-protocol.md   # WebSocket 协议规范
│   └── VOICE_INTEGRATION.md    # 语音集成指南
│
└── docker-compose.yml          # Docker 部署配置
```

## 🔧 配置

编辑 `.env` 文件：

```env
# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=viber
DB_USER=postgres
DB_PASSWORD=your_password

# Server
PORT=3000
ROOT_DIR=/path/to/your/code
AUTH_TOKEN=your-secret-token

# 火山引擎 ASR/TTS (可选)
VOLCANO_APP_ID=your_app_id
VOLCANO_ACCESS_TOKEN=your_token
VOLCANO_CLUSTER=volcengine_streaming_common
```

## ⌨️ 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+P` | 快速打开文件 |
| `Ctrl+Shift+F` | 全局搜索 |
| `Ctrl+L` | 聚焦 AI 对话 |
| `Ctrl+M` | 语音输入开关 |
| `Ctrl+S` | 保存文件 |
| `Ctrl+W` | 关闭当前文件 |
| `Ctrl+Enter` | 发送消息 |

## 🎤 语音功能说明

viber 采用服务端语音处理架构，实现真正的实时双工对话：

```
用户语音 → 火山引擎 ASR → Kimi CLI → 文本清洗 → 火山引擎 TTS → 播放
                ↓              ↓              ↓
           实时字幕      Thinking播报    流式响应
```

### 特性
- **即说即播**: 无需等待完整响应，LLM 边生成边语音播报
- **智能打断**: 说话自动打断 AI，无需点击按钮
- **文本清洗**: 自动将 Markdown、代码块转换为适合朗读的口语
- **多音色支持**: 可在设置中选择不同的发音人

### 使用
点击输入框右侧的麦克风按钮开始语音对话。

## 🔒 安全性

- 路径沙箱机制 - 禁止访问根目录外的文件
- 危险操作确认 - AI 执行 rm/sudo/写.env 等操作需用户确认
- JWT 认证（单用户模式可关闭）
- 敏感文件过滤

## 📝 License

MIT
