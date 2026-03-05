# Kimi Code Web Assistant

基于 Kimi Code CLI 的智能代码助手 Web 服务，支持实时双工语音对话、项目文件管理、代码编辑和版本控制。

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
- 浏览器 Web Speech API 语音识别
- Edge TTS 语音合成（待集成）
- 实时语音波形可视化

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
cd kimi-code-web-assistant
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
sudo -u postgres psql -c "ALTER USER postgres WITH PASSWORD 'haruhikage';"
sudo -u postgres psql -c "CREATE DATABASE kimi_assistant;"

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
kimi-code-web-assistant/
├── src/
│   ├── server/          # 后端代码
│   │   ├── db/          # 数据库连接和迁移
│   │   ├── middleware/  # Express 中间件
│   │   ├── routes/      # API 路由
│   │   ├── services/    # 业务逻辑
│   │   ├── socket/      # Socket.io 处理器
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
DB_NAME=kimi_assistant
DB_USER=postgres
DB_PASSWORD=haruhikage

# Server
PORT=3000
ROOT_DIR=/path/to/your/code
AUTH_TOKEN=your-secret-token
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

由于 Kimi CLI 本身不支持原生语音输入/输出，我们采用以下方案：

1. **STT（语音转文字）**: 浏览器 Web Speech API
2. **AI 处理**: Kimi CLI 处理文本
3. **TTS（文字转语音）**: Edge TTS（待集成）

当语音识别结果不确定时，Kimi 会询问用户确认。

## 🔒 安全性

- 路径沙箱机制 - 禁止访问根目录外的文件
- 危险操作确认 - AI 执行 rm/sudo/写.env 等操作需用户确认
- JWT 认证（单用户模式可关闭）
- 敏感文件过滤

## 📝 License

MIT
