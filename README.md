# viber

**VoIce & Intelligence Backed EditoR**

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
- **火山引擎 ASR** - 实时语音识别
- **多引擎 TTS** - Edge TTS / Piper TTS / 火山 TTS
- 语音波形可视化
- 打断与恢复功能

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
│   ├── server/          # 后端代码
│   │   ├── db/          # 数据库连接和迁移
│   │   ├── middleware/  # Express 中间件
│   │   ├── routes/      # API 路由
│   │   ├── services/    # 业务逻辑
│   │   └── utils/       # 工具函数
│   ├── client/          # 前端代码
│   │   ├── src/
│   │   │   ├── components/  # React 组件
│   │   │   ├── pages/       # 页面组件
│   │   │   ├── stores/      # Zustand 状态管理
│   │   │   ├── services/    # API 服务
│   │   │   └── hooks/       # 自定义 Hooks
│   │   └── package.json
│   └── shared/          # 共享类型定义
├── dist/                # 构建输出
├── docker-compose.yml
├── Dockerfile
└── nginx.conf
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

viber 采用先进的语音交互方案：

1. **STT（语音转文字）**: 火山引擎流式语音识别
2. **AI 处理**: Kimi CLI 处理文本
3. **TTS（文字转语音）**: 多引擎支持（Edge TTS / Piper TTS / 火山 TTS）

语音识别结果实时显示在输入框，用户可编辑后发送。

## 🔒 安全性

- 路径沙箱机制 - 禁止访问根目录外的文件
- 危险操作确认 - AI 执行 rm/sudo/写.env 等操作需用户确认
- JWT 认证（单用户模式可关闭）
- 敏感文件过滤

## 📝 License

MIT
