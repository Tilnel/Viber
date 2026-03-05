# Kimi Code Web Assistant - 产品需求文档

## 1. 项目概述

### 1.1 产品名称
**Kimi Code Web Assistant** - 基于 Kimi Code 订阅计划的智能代码助手 Web 服务

### 1.2 产品定位
一款面向开发者的浏览器端 AI 代码助手，集成实时双工语音对话、项目文件管理、智能代码编辑功能，通过 Kimi Code CLI 的订阅计划提供无限量的 AI 对话能力。

### 1.3 目标用户
- 个人开发者
- 小型技术团队
- 需要随时随地访问代码助手的程序员

### 1.4 核心价值
1. **零 Token 成本** - 利用 Kimi Code CLI 的订阅计划，无需为每次对话付费
2. **实时语音交互** - 真正的双工语音对话，边说边听，自然流畅
3. **浏览器即 IDE** - 无需安装，打开浏览器即可管理项目、编写代码

---

## 2. 功能需求

### 2.1 文件系统管理模块

#### 2.1.1 目录浏览
| 功能点 | 描述 | 优先级 |
|--------|------|--------|
| 根目录设置 | 管理员可配置允许访问的根目录（如 `/path/to/your/code`） | P0 |
| 目录树展示 | 侧边栏展示层级目录结构，支持展开/折叠 | P0 |
| 面包屑导航 | 顶部显示当前路径，可点击跳转 | P0 |
| 文件过滤 | 支持按类型筛选（如只显示代码文件） | P1 |
| 快速搜索 | 当前目录下文件名模糊搜索 | P1 |
| 书签收藏 | 收藏常用目录，快速访问 | P2 |

#### 2.1.2 项目操作
| 功能点 | 描述 | 优先级 |
|--------|------|--------|
| 打开项目 | 选择目录作为工作区，加载到编辑器 | P0 |
| 最近项目 | 记录最近打开的 10 个项目 | P0 |
| 项目配置 | 读取项目级配置（如 `.kimi/config.json`） | P1 |
| 多工作区 | 支持同时打开多个项目 | P2 |

#### 2.1.3 文件操作
| 功能点 | 描述 | 优先级 |
|--------|------|--------|
| 新建文件/文件夹 | 右键菜单创建 | P0 |
| 重命名 | 原地编辑或弹窗确认 | P0 |
| 删除 | 确认后删除（移至回收站或直接删除） | P0 |
| 复制/粘贴 | 跨目录文件操作 | P1 |
| 文件上传 | 拖拽或选择文件上传到服务器 | P1 |
| 文件下载 | 单个或批量下载 | P1 |

### 2.2 代码编辑器模块

#### 2.2.1 基础编辑功能
| 功能点 | 描述 | 优先级 |
|--------|------|--------|
| 语法高亮 | 支持主流编程语言（50+ 语言） | P0 |
| 代码折叠 | 按代码块折叠展开 | P0 |
| 多光标编辑 | Alt+Click 多位置同时编辑 | P0 |
| 自动缩进 | 智能缩进调整 | P0 |
| 括号匹配 | 高亮配对的括号 | P0 |
| 行号显示 | 可开关的行号 | P0 |
| 换行符处理 | 自动识别 CRLF/LF | P0 |
| 编码识别 | 自动检测文件编码（UTF-8/GBK等） | P1 |

#### 2.2.2 高级编辑功能
| 功能点 | 描述 | 优先级 |
|--------|------|--------|
| 代码补全 | 基于上下文的智能补全（可接入 AI） | P1 |
| 代码诊断 | 实时语法错误提示 | P1 |
| 代码格式化 | 支持 Prettier、Black 等 | P1 |
| 代码大纲 | 侧边栏显示函数/类结构 | P1 |
| 跳转到定义 | 代码跳转（LSP 支持） | P2 |
| 查找引用 | 查找符号引用位置 | P2 |
| 多文件搜索 | 项目级文本搜索替换 | P1 |
| Diff 视图 | 文件修改对比 | P1 |

#### 2.2.3 编辑器布局
| 功能点 | 描述 | 优先级 |
|--------|------|--------|
| 多标签页 | 同时打开多个文件 | P0 |
| 分屏编辑 | 左右/上下分屏对比编辑 | P1 |
| 自动保存 | 延迟自动保存或失焦保存 | P0 |
| 状态栏 | 显示行列、编码、语言模式 | P0 |

### 2.3 AI 助手模块

#### 2.3.1 对话界面
| 功能点 | 描述 | 优先级 |
|--------|------|--------|
| 对话列表 | 左侧显示历史对话列表 | P0 |
| 新对话 | 创建新的对话会话 | P0 |
| 对话命名 | 自动或手动命名对话 | P1 |
| 消息渲染 | Markdown 渲染、代码块高亮 | P0 |
| 流式输出 | AI 回复实时打字机效果 | P0 |
| 代码操作 | 代码块一键复制、插入到文件 | P0 |
| 上下文携带 | 自动携带最近 N 轮对话 | P0 |

#### 2.3.2 代码上下文集成
| 功能点 | 描述 | 优先级 |
|--------|------|--------|
| 选中代码提问 | 右键"询问 Kimi"发送选中代码 | P0 |
| 当前文件上下文 | 自动携带当前打开文件内容 | P0 |
| 多文件上下文 | @ 符号引用其他文件 | P1 |
| 项目结构上下文 | AI 可感知项目整体结构 | P1 |
| 终端输出上下文 | 携带终端输出进行提问 | P2 |

#### 2.3.3 Kimi Code 集成
| 功能点 | 描述 | 优先级 |
|--------|------|--------|
| CLI 调用 | 通过子进程调用 `kimi` 命令 | P0 |
| 订阅计划支持 | 使用用户的订阅计划（非 Token 计费） | P0 |
| 会话保持 | 维护与 CLI 的长连接 | P0 |
| 工具调用 | 支持 kimi 的 tool use 能力 | P1 |
| 文件编辑建议 | AI 建议的代码变更预览和应用 | P1 |

### 2.4 实时双工语音对话模块

#### 2.4.1 语音采集
| 功能点 | 描述 | 优先级 |
|--------|------|--------|
| 麦克风权限 | 浏览器麦克风权限申请 | P0 |
| 语音活动检测 | VAD 自动检测语音起止 | P0 |
| 降噪处理 | 浏览器端音频降噪 | P1 |
| 多麦克风选择 | 可选择输入设备 | P2 |

#### 2.4.2 语音合成与播放
| 功能点 | 描述 | 优先级 |
|--------|------|--------|
| 实时 TTS | AI 回复实时转语音流 | P0 |
| 语音打断 | 用户说话时自动打断 AI 语音 | P0 |
| 播放控制 | 暂停、继续、停止播放 | P0 |
| 音量调节 | 独立的播放音量控制 | P1 |
| 多输出设备 | 可选择输出设备 | P2 |

#### 2.4.3 双工通信
| 功能点 | 描述 | 优先级 |
|--------|------|--------|
| 全双工模式 | 真正的同时听和说 | P0 |
| 对话状态显示 | 显示"聆听中/思考中/说话中" | P0 |
| 自动轮替 | 智能判断说话权切换 | P0 |
| 打断检测 | 用户插话立即响应 | P0 |

#### 2.4.4 语音相关设置
| 功能点 | 描述 | 优先级 |
|--------|------|--------|
| 语音开关 | 全局启用/禁用语音 | P0 |
| 语音音色选择 | 多种音色可选 | P1 |
| 语速调节 | 调整 AI 语音速度 | P1 |
| 唤醒词 | 语音唤醒功能（如"Hey Kimi"） | P2 |

### 2.5 终端模块（可选增强）

| 功能点 | 描述 | 优先级 |
|--------|------|--------|
| Web Terminal | 浏览器内执行 shell 命令 | P2 |
| 命令建议 | AI 建议的终端命令 | P2 |
| 输出捕获 | 捕获终端输出用于对话 | P2 |

---

## 3. 技术架构

### 3.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                        客户端 (Browser)                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  文件浏览器   │  │  代码编辑器   │  │   AI 对话面板     │  │
│  │  (React)     │  │  (Monaco)    │  │    (React)       │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
│  ┌──────────────┐  ┌──────────────┐                         │
│  │   语音组件    │  │  WebSocket   │                         │
│  │  (WebRTC)    │  │   Client     │                         │
│  └──────────────┘  └──────────────┘                         │
└─────────────────────┬───────────────────────────────────────┘
                      │ HTTPS / WSS
┌─────────────────────┴───────────────────────────────────────┐
│                      服务端 (Node.js)                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │   HTTP API   │  │ WebSocket    │  │   语音网关        │  │
│  │   (Express)  │  │   Server     │  │                  │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  文件服务    │  │  Kimi CLI    │  │   语音处理        │  │
│  │  (fs)        │  │  (spawn)     │  │  (Whisper/TTS)   │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 技术选型

| 层级 | 技术 | 说明 |
|------|------|------|
| 前端框架 | React 18 + TypeScript | 组件化开发，类型安全 |
| 状态管理 | Zustand | 轻量级状态管理 |
| UI 组件 | Ant Design / Chakra UI | 成熟的组件库 |
| 代码编辑器 | Monaco Editor | VS Code 同款编辑器 |
| 文件树 | react-complex-tree | 高性能文件树 |
| WebSocket | Socket.io | 实时双向通信 |
| 语音采集 | Web Audio API + MediaRecorder | 浏览器原生 API |
| 语音处理 | WebRTC / Socket.io-stream | 实时音频流传输 |
| 后端框架 | Node.js + Express | 轻量高效 |
| 进程通信 | Node child_process | 调用 kimi CLI |
| 文件系统 | fs-extra | 增强的文件操作 |
| 身份验证 | JWT | 无状态认证 |

### 3.3 语音架构方案

方案 A：客户端直接处理（推荐）
```
浏览器 ──WebRTC──→ 语音服务 ──WebSocket──→ Kimi
        (采集+播放)     (STT/TTS)      (AI)
```

方案 B：服务端中转
```
浏览器 ──WebSocket──→ 服务端 ──API──→ 语音服务商
                    (中转)      (STT/TTS)
```

**推荐方案 A**，原因：
- 端到端延迟更低
- 服务端压力更小
- 可以利用浏览器的 WebRTC 能力

---

## 4. 接口设计

### 4.1 REST API

#### 文件管理
```typescript
// 获取目录内容
GET /api/fs/list?path=/project/src
Response: {
  path: string;
  items: Array<{
    name: string;
    type: 'file' | 'directory';
    size?: number;
    mtime: string;
  }>;
}

// 读取文件
GET /api/fs/read?path=/project/src/main.ts
Response: {
  content: string;
  encoding: string;
  mtime: string;
}

// 保存文件
POST /api/fs/write
Body: {
  path: string;
  content: string;
  encoding?: string;
}

// 文件操作（新建、删除、重命名、移动）
POST /api/fs/operation
Body: {
  operation: 'create' | 'delete' | 'rename' | 'move';
  source: string;
  target?: string;
  type?: 'file' | 'directory';
}
```

#### 项目管理
```typescript
// 打开项目
POST /api/project/open
Body: { path: string }

// 获取项目信息
GET /api/project/info
Response: {
  name: string;
  path: string;
  fileCount: number;
  config?: ProjectConfig;
}

// 搜索文件内容
GET /api/project/search?q=keyword&path=/project
```

### 4.2 WebSocket 事件

#### AI 对话
```typescript
// 客户端发送消息
client.emit('chat:message', {
  sessionId: string;
  content: string;
  context?: {
    currentFile?: string;
    selectedCode?: string;
    mentionedFiles?: string[];
  };
});

// 服务端流式响应
server.emit('chat:delta', {
  sessionId: string;
  delta: string;
  finishReason?: 'stop' | 'length' | 'error';
});

// 工具调用（可选）
server.emit('chat:tool_call', {
  sessionId: string;
  tool: string;
  arguments: object;
});
```

#### 语音通道
```typescript
// 开始语音会话
client.emit('voice:start', {
  mode: 'duplex'; // 双工模式
});

// 发送音频流（ArrayBuffer）
client.emit('voice:audio', audioData);

// 接收 AI 音频流
server.emit('voice:audio', audioData);

// 状态更新
server.emit('voice:state', {
  state: 'listening' | 'thinking' | 'speaking';
});

// 打断信号
client.emit('voice:interrupt');
```

---

## 5. 非功能需求

### 5.1 性能要求
| 指标 | 目标值 |
|------|--------|
| 首屏加载时间 | < 2s |
| 文件树加载（1000文件） | < 500ms |
| 大文件打开（10MB） | < 1s |
| AI 首字响应时间 | < 1s |
| 语音延迟（端到端） | < 500ms |
| 编辑延迟 | < 16ms（60fps） |

### 5.2 兼容性
- **浏览器**: Chrome 90+, Firefox 90+, Safari 15+, Edge 90+
- **操作系统**: Windows 10+, macOS 11+, Linux
- **移动端**: iOS Safari, Android Chrome（基础功能）

### 5.3 安全要求
- 所有通信使用 HTTPS/WSS
- 文件访问权限控制（禁止越界访问）
- 用户身份验证（JWT）
- 命令注入防护（对 AI 生成的命令进行校验）
- 敏感文件过滤（如 .env, .ssh）

### 5.4 可扩展性
- 支持多实例部署
- 水平扩展 WebSocket 连接（Redis 适配器）
- 插件系统架构（预留扩展点）

---

## 6. 部署方案

### 6.1 环境要求
```yaml
# 服务端
Node.js: >= 18.0
内存: >= 2GB
磁盘: >= 10GB

# 客户端
现代浏览器
麦克风权限
网络: >= 1Mbps
```

### 6.2 配置说明
```yaml
# config.yaml
server:
  port: 3000
  host: 0.0.0.0
  
security:
  jwt_secret: ${JWT_SECRET}
  allowed_origins: ['http://localhost:3000']
  
fs:
  root_dir: /path/to/your/code
  max_upload_size: 100MB
  forbidden_patterns: ['*.pem', '.ssh/*', '.env*']
  
kimi:
  cli_path: /usr/local/bin/kimi
  default_model: 'kimi-latest'
  subscription_mode: true  # 使用订阅计划
  
voice:
  enabled: true
  stt_provider: 'whisper'  # 或第三方服务
  tts_provider: 'edge-tts' # 或第三方服务
  sample_rate: 16000
```

### 6.3 启动方式
```bash
# 开发模式
npm run dev

# 生产模式
npm run build
npm start

# Docker 部署
docker-compose up -d
```

---

## 7. 界面原型

### 7.1 布局结构
```
┌──────────────────────────────────────────────────────────────┐
│  [Logo]  文件  编辑  视图  帮助          [语音开关] [用户头像] │ ← 顶部栏
├──────┬──────────────────────────────────────┬────────────────┤
│      │                                      │                │
│ 文件  │          代码编辑器                  │   AI 助手面板   │
│ 浏览  │          (Monaco)                   │   ┌──────────┐ │
│ 器    │                                      │   │ 对话历史  │ │
│      │  ┌──────────────┬──────────────┐    │   ├──────────┤ │
│ 📁src │  │              │              │    │   │          │ │
│ 📄main│  │   文件A.ts   │   文件B.ts   │    │   │ 消息记录  │ │
│ 📄util│  │              │              │    │   │          │ │
│      │  └──────────────┴──────────────┘    │   ├──────────┤ │
│      │                                      │   │ 输入框    │ │
│      │  状态栏: UTF-8 | TypeScript | Ln 12  │   │ [语音🎤] │ │
│      │                                      │   └──────────┘ │
└──────┴──────────────────────────────────────┴────────────────┘
        ↑ 可拖拽调整宽度                        ↑ 可隐藏/展开
```

### 7.2 关键交互
- **三栏布局**: 文件树(200px) | 编辑器(自适应) | AI 面板(350px)
- **拖拽调整**: 侧边栏宽度可拖拽调整
- **快捷键**: 
  - `Ctrl+P` 快速打开文件
  - `Ctrl+Shift+F` 全局搜索
  - `Ctrl+L` 聚焦 AI 对话
  - `Ctrl+M` 切换语音

---

## 8. 里程碑规划

### Phase 1: MVP（4 周）
- [x] 基础文件系统管理
- [x] Monaco 编辑器集成
- [x] AI 对话基础功能（文本）
- [x] Kimi CLI 集成

### Phase 2: 语音功能（3 周）
- [x] 实时语音采集与播放
- [x] 双工语音对话
- [x] 语音状态管理

### Phase 3: 增强功能（3 周）
- [x] 高级编辑器功能（搜索替换、多光标）
- [x] 代码上下文集成
- [x] 文件上传下载
- [x] 设置面板

### Phase 4: 优化（2 周）
- [x] 性能优化
- [x] 移动端适配
- [x] 安全加固
- [x] 文档完善

---

## 9. 风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| Kimi CLI 接口变更 | 高 | 封装适配层，监控变更 |
| 语音延迟过高 | 中 | 优化网络，本地缓存 |
| 大文件性能问题 | 中 | 虚拟滚动，分片加载 |
| 安全问题 | 高 | 路径校验，权限控制 |
| 浏览器兼容性 | 低 | 特性检测，降级方案 |

---

## 10. 附录

### 10.1 术语表
- **双工语音**: 双向同时进行的语音通信，类似电话
- **VAD**: Voice Activity Detection，语音活动检测
- **STT**: Speech to Text，语音转文字
- **TTS**: Text to Speech，文字转语音
- **Monaco Editor**: VS Code 使用的代码编辑器组件

### 10.2 参考资源
- [Kimi CLI 文档](https://github.com/moonshot-ai/kimi-cli)
- [Monaco Editor API](https://microsoft.github.io/monaco-editor/)
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [WebRTC 指南](https://webrtc.org/getting-started/)

---

*文档版本: 1.0*  
*最后更新: 2026-03-05*  
*作者: AI Assistant*
