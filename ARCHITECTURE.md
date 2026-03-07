# Kimi Code Web Assistant - 详细架构设计文档

## 1. 需求整合与关键决策

### 1.1 需求清单（完整版）

| 编号 | 需求 | 优先级 | 实现方案 |
|------|------|--------|----------|
| R1 | 首页显示最近打开的项目（目录） | P0 | 本地存储 + 后端持久化 |
| R2 | 每个项目维护独立的对话 Session | P0 | Session 绑定项目路径 |
| R3 | 文件编辑功能 | P0 | Monaco Editor |
| R4 | AI 修改文件的 Diff 展示 | P0 | diff-match-patch + Monaco Diff Editor |
| R5 | 版本控制系统信息展示 | P1 | 集成 Git 命令 |
| R6 | 向模型发送文字消息 | P0 | WebSocket 流式传输 |
| R7 | 语音按钮功能 | P0 | 浏览器 Audio API |
| R8 | "打电话"式双工语音体验 | P1 | STT + Kimi + TTS Pipeline |
| R9 | 完善的页面交互 | P0 | 多页面 SPA 设计 |
| R10 | 身份验证与安全性 | P0 | JWT + 路径沙箱 |

### 1.2 关键架构决策

#### 决策 1：语音方案选择
**背景**：Kimi CLI 不支持原生语音输入/输出，仅支持文本。

**方案对比**：
| 方案 | 架构 | 延迟 | 成本 | 复杂度 |
|------|------|------|------|--------|
| A | 浏览器 STT → Kimi → 浏览器 TTS | ~1-2s | 低 | 中 |
| B | 服务端 STT → Kimi → 服务端 TTS | ~1-2s | 中 | 高 |
| C | 第三方实时语音 API（替代 Kimi） | ~300ms | 高 | 低 |

**决策**：采用 **方案 A（客户端处理）**
- STT：浏览器 Web Speech API（免费）或 whisper-webgpu（本地）
- TTS：浏览器 SpeechSynthesis（免费）或 Edge TTS
- 理由：零额外成本，隐私性好，实现简单

#### 决策 2：Kimi 集成方式
**背景**：需要通过 Kimi Code CLI 的订阅计划使用，而非 Token 计费。

**方案对比**：
| 方案 | 实现 | 稳定性 | 灵活性 |
|------|------|--------|--------|
| A | 直接调用 `kimi` 子进程 | 高 | 中 |
| B | 使用官方 Node.js SDK | 中 | 高 |
| C | 直接调用 Moonshot API | 低（需 Token） | 高 |

**决策**：采用 **方案 A（子进程调用）**
- 使用 `kimi --print --output-format=stream-json` 模式
- 通过 stdin/stdout 进行通信
- 理由：确保使用订阅计划，稳定性最好

#### 决策 3：项目与 Session 管理
**决策**：
- 项目 = 文件系统目录
- Session 持久化到 SQLite，按项目路径关联
- 支持会话历史列表，可切换和恢复

---

## 2. 系统架构总览

### 2.1 架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              客户端 (Browser)                                 │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                           React SPA                                    │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │  │
│  │  │  Home Page  │  │ Project Page│  │  Settings   │  │   Login     │  │  │
│  │  │  (项目列表)  │  │  (编辑器)   │  │   (设置)    │  │  (登录)     │  │  │
│  │  └──────┬──────┘  └──────┬──────┘  └─────────────┘  └─────────────┘  │  │
│  │         │                │                                            │  │
│  │         └────────────────┘                                            │  │
│  │                      │                                                │  │
│  │  ┌───────────────────┴──────────────────────────────────────────┐    │  │
│  │  │                     全局组件                                   │    │  │
│  │  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐         │    │  │
│  │  │  │  Layout  │ │ FileTree │ │  Monaco  │ │ AI Chat  │         │    │  │
│  │  │  │ (布局)   │ │(文件树)  │ │(编辑器)  │ │(对话面板)│         │    │  │
│  │  │  └──────────┘ └──────────┘ └──────────┘ └────┬─────┘         │    │  │
│  │  │                                              │               │    │  │
│  │  │  ┌──────────┐ ┌──────────┐ ┌──────────┐     │               │    │  │
│  │  │  │ GitPanel │ │ DiffView │ │ VoiceBtn │←────┘               │    │  │
│  │  │  │(版本控制)│ │(差异对比)│ │(语音按钮)│                      │    │  │
│  │  │  └──────────┘ └──────────┘ └──────────┘                      │    │  │
│  │  └──────────────────────────────────────────────────────────────┘    │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                         服务层 (Services)                              │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │  │
│  │  │  Auth    │ │   FS     │ │  Editor  │ │   Chat   │ │  Voice   │   │  │
│  │  │ (认证)   │ │(文件系统)│ │ (编辑器) │ │ (对话)   │ │ (语音)   │   │  │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘   │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                      音频处理 (Audio Layer)                            │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │  │
│  │  │  Recorder    │  │  Web Speech  │  │  AudioWorklet│               │  │
│  │  │ (录音控制)   │  │   API        │  │ (原始PCM)    │               │  │
│  │  └──────────────┘  └──────────────┘  └──────────────┘               │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │ HTTPS / WSS
┌─────────────────────────────────┴───────────────────────────────────────────┐
│                             服务端 (Node.js)                                  │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                        Express Server                                 │  │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐     │  │
│  │  │  Auth API   │ │   FS API    │ │  Project API│ │  Git API    │     │  │
│  │  │  (REST)     │ │  (REST)     │ │  (REST)     │ │  (REST)     │     │  │
│  │  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘     │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                     Socket.io Server                                  │  │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐                     │  │
│  │  │ Chat Stream │ │ File Watch  │ │ Voice Proxy │                     │  │
│  │  │ (AI对话流)  │ │(文件变更)   │ │(音频中转)   │                     │  │
│  │  └─────────────┘ └─────────────┘ └─────────────┘                     │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                     业务逻辑层 (Services)                              │  │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐     │  │
│  │  │ FileService │ │GitService   │ │ChatService  │ │SessionMgr   │     │  │
│  │  │ (文件操作)  │ │(Git命令)    │ │(Kimi集成)   │ │(会话管理)   │     │  │
│  │  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘     │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                     数据持久化 (Storage)                               │  │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐       │  │
│  │  │   SQLite        │  │   File System   │  │   Kimi CLI      │       │  │
│  │  │ (会话/设置)     │  │ (代码文件)      │  │ (AI 推理)       │       │  │
│  │  │                 │  │                 │  │  (子进程)       │       │  │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘       │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 页面路由设计

```
/                           # HomePage - 项目列表首页
├── /login                  # LoginPage - 登录页
├── /settings               # SettingsPage - 设置页
│   ├── /settings/profile   # 用户配置
│   ├── /settings/keyboard  # 快捷键配置
│   └── /settings/voice     # 语音配置
└── /project/:projectId/*   # ProjectPage - 项目工作区
    ├── /project/:projectId/          # 默认打开 README 或上次文件
    ├── /project/:projectId/file/*    # 文件编辑路由
    └── /project/:projectId/diff/*    # Diff 对比路由
```

---

## 3. 详细页面设计

### 3.1 HomePage（首页）

**布局结构**：
```
┌──────────────────────────────────────────────────────────────┐
│  [Logo]  Kimi Code Web Assistant              [设置] [用户]  │  ← Header
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  🔍 搜索项目...                                        │  │  ← 搜索栏
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  最近打开的项目                                    [+ 新建]  │  ← 标题栏
│                                                              │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐            │
│  │ 📁 my-app   │ │ 📁 web-api  │ │ 📁 docs     │            │  ← 项目卡片
│  │             │ │             │ │             │            │
│  │ 路径: ~/code│ │ 路径: ~/code│ │ 路径: ~/code│            │
│  │             │ │             │ │             │            │
│  │ 最后打开:   │ │ 最后打开:   │ │ 最后打开:   │            │
│  │ 2小时前     │ │ 昨天        │ │ 3天前       │            │
│  │             │ │             │ │             │            │
│  │ [打开] [×]  │ │ [打开] [×]  │ │ [打开] [×]  │            │
│  └─────────────┘ └─────────────┘ └─────────────┘            │
│                                                              │
│  所有项目                                          [浏览...] │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ 📁 project-a        ~/code/project-a      [打开]       │  │
│  │ 📁 project-b        ~/code/project-b      [打开]       │  │  ← 项目列表
│  │ 📁 project-c        ~/code/project-c      [打开]       │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**交互细节**：
- 项目卡片悬停显示操作按钮（打开、删除、固定到首页）
- 右键项目卡片显示上下文菜单（在文件管理器中打开、复制路径、重命名）
- 支持拖拽目录到页面快速打开项目
- 搜索支持模糊匹配项目名称和路径
- 空状态显示引导（"拖拽目录到这里打开"或"点击浏览选择目录"）

### 3.2 ProjectPage（项目工作区）

**布局结构**：
```
┌──────────────────────────────────────────────────────────────────────────────┐
│  [🔙] my-app                          [🔍] [🎤] [⚙️] [👤]                     │  ← 顶部栏
├──────────┬──────────────────────────────────────────────────┬────────────────┤
│          │                                                  │                │
│ 📁 my-app│  文件编辑器                                        │   AI 助手面板   │
│ ├─ src   │                                                  │   ┌──────────┐ │
│ │  ├─ ...│  ┌──────────────────────────────────────────┐    │   │ 会话列表  │ │
│ │  └─ ...│  │  main.ts                            [×]  │    │   │ ├ sess-1 │ │
│ ├─ docs  │  ├──────────────────────────────────────────┤    │   │ └ sess-2 │ │
│ │  └─ ...│  │                                          │    │   ├──────────┤ │
│ ├─ test  │  │  import { useState } from 'react';      │    │   │          │ │
│ │  └─ ...│  │                                          │    │   │ 消息记录  │ │
│ ├─ ...   │  │  function App() {                       │    │   │          │ │
│ ├─ ...   │  │    const [count, setCount] = useState(0)│    │   │ 用户:... │ │
│ │        │  │    // AI 建议修改 ↓                     │    │   │ AI: ...  │ │
│ │        │  │    const doubled = count * 2;           │    │   │          │ │
│ │        │  │                                         │    │   ├──────────┤ │
│ │        │  │    return (                             │    │   │ [输入框] │ │
│ │        │  │      <div>...</div>                     │    │   │ [🎤发送] │ │
│ │        │  │    );                                   │    │   └──────────┘ │
│ │        │  │  }                                      │    │                │
│ │        │  │                                          │    │                │
│ └────────┤  └──────────────────────────────────────────┘    │                │
│          │                                                  │                │
│ [Git]    │  状态栏: UTF-8 | TypeScript | Ln 12, Col 34      │                │
│  ├─ 2修改 │  [main*] +2 ~1 -0                              │                │
│  └─ 1新增 │                                                  │                │
│          │                                                  │                │
└──────────┴──────────────────────────────────────────────────┴────────────────┘
   ↑        ↑                                               ↑
  240px   自适应 (剩余空间)                               380px
```

**区域说明**：

| 区域 | 宽度 | 功能 | 可折叠 |
|------|------|------|--------|
| 左侧边栏 | 240px | 文件树 + Git 面板 | ✅ |
| 编辑器区 | 自适应 | Monaco Editor | ❌ |
| 右侧面板 | 380px | AI 对话 | ✅ |

**编辑器功能区域**：
```
┌────────────────────────────────────────────────────────────┐
│  main.ts    utils.ts    styles.css    [+]         [←] [→] │  ← 标签栏
├────────────────────────────────────────────────────────────┤
│                                                            │
│  │1    import { useState } from 'react';                  │
│  │2                                                       │
│  │3    function App() {                                   │
│  │4      const [count, setCount] = useState(0);           │
│  │5      // TODO: Implement feature                       │
│  │6                                                       │
│  │7      return (                                         │
│  │8        <div className="app">                          │
│  │9          <h1>Hello</h1>                               │
│  │10       </div>                                         │
│  │11     );                                               │
│  │12   }                                                  │
│  │13                                                      │
│  │14   export default App;                                │
│                                                            │
├────────────────────────────────────────────────────────────┤
│  Ln 14, Col 20    UTF-8    LF    TypeScript React    [🔔]  │  ← 状态栏
└────────────────────────────────────────────────────────────┘
```

### 3.3 AI 对话面板详细设计

```
┌──────────────────────────────────────────┐
│  AI 助手                           [⚙️]  │  ← 面板标题
├──────────────────────────────────────────┤
│  ┌────────────────────────────────────┐  │
│  │ 🔽 Session: main-2024-03-05        │  │  ← 会话选择器
│  │   ├─ main-2024-03-05 (当前)        │  │
│  │   ├─ refactor-auth-2024-03-04      │  │
│  │   ├─ bugfix-login-2024-03-03       │  │
│  │   └─ [+ 新会话]                   │  │
│  └────────────────────────────────────┘  │
├──────────────────────────────────────────┤
│                                          │
│  ┌────────────────────────────────────┐  │
│  │ 👤 解释这段代码                     │  │  ← 用户消息
│  │                                    │  │
│  │ [代码块引用]                       │  │
│  │ ```typescript                      │  │
│  │ const doubled = count * 2;         │  │
│  │ ```                                │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │ 🤖 这段代码创建了一个计算属性...     │  │  ← AI 消息
│  │                                    │  │
│  │ 建议修改为：                        │  │
│  │ ```diff                            │  │
│  │ - const doubled = count * 2;       │  │  ← Diff 展示
│  │ + const doubled = useMemo(() =>    │  │
│  │ +   count * 2, [count]);           │  │
│  │ ```                                │  │
│  │                                    │  │
│  │ [查看完整 Diff] [应用到文件]         │  │  ← 操作按钮
│  └────────────────────────────────────┘  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │ 👤 还有其他优化建议吗？              │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │ 🤖 ▌正在输入...                    │  │  ← 流式输出
│  └────────────────────────────────────┘  │
│                                          │
├──────────────────────────────────────────┤
│  ┌────────────────────────────────────┐  │
│  │  添加当前文件到上下文  [+]          │  │  ← 上下文提示
│  └────────────────────────────────────┘  │
│  ┌────────────────────────────────┐      │
│  │ 输入消息...              [🎤] [➤]│    │  ← 输入区
│  └────────────────────────────────┘      │
│  ⌘+Enter 发送  @引用文件  #选择代码      │  ← 快捷键提示
└──────────────────────────────────────────┘
```

**语音模式界面**：
```
┌──────────────────────────────────────────┐
│  AI 语音对话                              │
├──────────────────────────────────────────┤
│                                          │
│                                          │
│              ┌──────────┐                │
│              │          │                │
│              │   🎙️    │                │  ← 语音波形动画
│              │  ╭────╮  │                │
│              │  │████│  │                │
│              │  ╰────╯  │                │
│              │          │                │
│              └──────────┘                │
│                                          │
│            "聆听中..."                    │  ← 状态文字
│                                          │
│  [用户]: 帮我优化这个函数的性能            │  ← 转录文本
│                                          │
│  [AI]: 好的，我建议使用二分查找来...        │  ← AI 回复
│                                          │
│              [挂断] [静音]               │  ← 控制按钮
│                                          │
└──────────────────────────────────────────────────────────────┘
```

### 3.4 Diff 视图页面

```
┌──────────────────────────────────────────────────────────────┐
│  [🔙] Diff: main.ts                                    [✓] [✗]│
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────────┬─────────────────────┐              │
│  │    原始文件          │      修改后          │              │
│  │    (只读)           │      (可编辑)        │              │
│  ├─────────────────────┼─────────────────────┤              │
│  │                     │                     │              │
│  │ function search(    │ function search(    │              │
│  │   arr, target       │   arr, target       │              │
│  │ ) {                 │ ) {                 │              │
│  │  │                  │  │                  │              │
│  │  │ for (let i = 0; │  │ // 使用二分查找   │ ← 新增行（绿色）│
│  │  │      i < arr.    │  │ arr.sort();       │              │
│  │  │      i++)        │  │                   │              │
│  │  │ {                │  │ let left = 0;     │              │
│  │  │   if (arr[i] ===│  │ let right = ...   │              │
│  │  │       target) {  │  │                   │              │
│  │  │     return i;    │  │ while (left <=    │              │
│  │  │   }              │  │        right) {   │              │
│  │  │ }                │  │   ...             │              │
│  │  │                  │  │ }                 │              │
│  │  │ return -1;       │  │                   │              │
│  │  │                  │  │ return -1;        │              │
│  │  }                  │  }                  │              │
│  │                     │                     │              │
│  └─────────────────────┴─────────────────────┘              │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ AI 修改说明:                                             ││
│  │ 将线性查找改为二分查找，时间复杂度从 O(n) 优化到 O(log n) ││
│  └─────────────────────────────────────────────────────────┘│
│                                                              │
│  [放弃修改]                          [接受修改] [部分接受...] │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 3.5 Git 面板详细设计

```
┌──────────────────────────────┐
│ 源代码管理                   │
├──────────────────────────────┤
│  ┌────────────────────────┐  │
│  │ 📦 main*               │  │  ← 当前分支
│  │    ↑1 ↓2               │  │  ← 与远程的差异
│  └────────────────────────┘  │
│  [🔄 拉取] [⬆️ 推送]         │
├──────────────────────────────┤
│ 更改 (3)            [+ 全部] │
│  ┌────────────────────────┐  │
│  │ 📝 M src/utils.ts      │  │  ← 已修改
│  │   │ -12 +5             │  │
│  │ ➕ A src/new.ts        │  │  ← 新增
│  │   │ +50                │  │
│  │ 🗑️ D src/old.ts        │  │  ← 删除
│  │   │ -30                │  │
│  └────────────────────────┘  │
│  [暂存所有更改]              │
├──────────────────────────────┤
│ 暂存的更改 (2)               │
│  ┌────────────────────────┐  │
│  │ 📝 M src/main.ts       │  │
│  │ 📝 M package.json      │  │
│  └────────────────────────┘  │
│  ┌────────────────────────┐  │
│  │ 输入提交消息...        │  │
│  │                        │  │
│  │ [💡 AI 生成提交信息]   │  │
│  └────────────────────────┘  │
│  [提交] [提交并推送]         │
├──────────────────────────────┤
│ 分支                         │
│  ├─ * main                   │
│  ├─ dev                      │
│  └─ feature/auth             │
│                              │
│ 最近提交                     │
│  ├─ abc123 修复登录 bug      │
│  ├─ def456 添加用户接口      │
│  └─ ghi789 初始化项目        │
└──────────────────────────────┘
```

---

## 4. 数据模型设计

### 4.1 数据库 Schema（SQLite）

```sql
-- 用户表
CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,  -- bcrypt
    avatar_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login_at DATETIME
);

-- 项目表（最近打开的项目）
CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    path TEXT UNIQUE NOT NULL,    -- 绝对路径
    name TEXT NOT NULL,           -- 目录名
    description TEXT,
    icon TEXT,                    -- emoji 或图标
    last_opened_at DATETIME,
    opened_count INTEGER DEFAULT 1,
    is_pinned BOOLEAN DEFAULT FALSE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE
);

-- 会话表（每个项目的对话会话）
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT,                    -- 会话名称（可自动生成）
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    message_count INTEGER DEFAULT 0,
    is_archived BOOLEAN DEFAULT FALSE
);

-- 消息表
CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    metadata TEXT,                -- JSON: { mentionedFiles, selectedCode, etc. }
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    token_count INTEGER           -- 用于统计
);

-- 文件变更记录（用于 Diff 展示）
CREATE TABLE file_changes (
    id TEXT PRIMARY KEY,
    session_id TEXT REFERENCES sessions(id),
    file_path TEXT NOT NULL,
    original_content TEXT,
    proposed_content TEXT,
    diff_content TEXT,            -- unified diff format
    status TEXT CHECK (status IN ('pending', 'applied', 'rejected')),
    applied_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 用户设置
CREATE TABLE user_settings (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    theme TEXT DEFAULT 'system',  -- light | dark | system
    font_size INTEGER DEFAULT 14,
    tab_size INTEGER DEFAULT 2,
    word_wrap BOOLEAN DEFAULT TRUE,
    -- 编辑器设置
    minimap_enabled BOOLEAN DEFAULT TRUE,
    auto_save BOOLEAN DEFAULT TRUE,
    auto_save_delay INTEGER DEFAULT 1000,
    -- 语音设置
    voice_enabled BOOLEAN DEFAULT TRUE,
    voice_input_device TEXT,
    voice_output_device TEXT,
    voice_language TEXT DEFAULT 'zh-CN',
    voice_speed REAL DEFAULT 1.0,
    -- AI 设置
    default_model TEXT DEFAULT 'kimi-latest',
    context_window INTEGER DEFAULT 10  -- 携带的上下文消息数
);

-- 快捷键配置
CREATE TABLE keybindings (
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    command TEXT NOT NULL,
    keybinding TEXT NOT NULL,
    PRIMARY KEY (user_id, command)
);
```

### 4.2 TypeScript 类型定义

```typescript
// types/index.ts

// 用户
interface User {
  id: string;
  username: string;
  avatarUrl?: string;
}

// 项目
interface Project {
  id: string;
  path: string;
  name: string;
  description?: string;
  icon?: string;
  lastOpenedAt: Date;
  openedCount: number;
  isPinned: boolean;
}

// 文件系统
interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  mtime: Date;
  children?: FileNode[];
  isLoaded?: boolean;  // 目录是否已加载子节点
}

// 会话
interface ChatSession {
  id: string;
  projectId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  messageCount: number;
  isArchived: boolean;
}

// 消息
interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: MessageMetadata;
  createdAt: Date;
}

interface MessageMetadata {
  mentionedFiles?: string[];      // @引用的文件
  selectedCode?: SelectedCode;    // 选中的代码
  toolCalls?: ToolCall[];         // 工具调用
}

interface SelectedCode {
  filePath: string;
  code: string;
  startLine: number;
  endLine: number;
}

// 文件变更/Diff
interface FileChange {
  id: string;
  sessionId: string;
  filePath: string;
  originalContent: string;
  proposedContent: string;
  diffContent: string;            // unified diff
  status: 'pending' | 'applied' | 'rejected';
  createdAt: Date;
  appliedAt?: Date;
}

// Git 信息
interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  files: GitFileStatus[];
}

interface GitFileStatus {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked';
  additions: number;
  deletions: number;
}

// 编辑器状态
interface EditorState {
  openFiles: OpenFile[];
  activeFilePath?: string;
  cursorPosition?: CursorPosition;
}

interface OpenFile {
  path: string;
  content: string;
  originalContent: string;  // 用于判断是否修改
  language: string;
  isDirty: boolean;
  isLoading: boolean;
}

// 语音状态
interface VoiceState {
  isListening: boolean;
  isSpeaking: boolean;
  isProcessing: boolean;
  transcript: string;
  error?: string;
}
```

---

## 5. 核心流程设计

### 5.1 项目打开流程

```
用户点击项目卡片
       │
       ▼
┌──────────────┐
│ 验证项目路径  │───路径不存在？──→ 从列表移除，提示用户
│ 是否可访问    │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ 更新项目记录  │───更新 lastOpenedAt, openedCount
│ (SQLite)     │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ 加载项目配置  │───读取 .kimi/config.json（如存在）
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ 加载文件树   │───递归加载目录结构（前两层）
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ 加载会话列表  │───从 SQLite 读取该项目的所有会话
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ 恢复上次会话  │───如果有未完成的会话，恢复它
│ 或创建新会话  │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ 初始化编辑器  │───打开 README 或上次编辑的文件
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ 初始化 Git   │───检查是否是 Git 仓库，获取状态
│ 状态         │
└──────┬───────┘
       │
       ▼
  进入 ProjectPage
```

### 5.2 AI 对话流程

```
用户发送消息
       │
       ▼
┌──────────────────┐
│ 构建上下文        │
│ - 当前文件内容    │
│ - 选中代码        │
│ - 历史消息        │
│ - @引用的文件     │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ 调用 Kimi CLI     │───spawn('kimi', ['--print', '--output-format=stream-json'])
│ 子进程           │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐     ┌──────────────────┐
│ 流式接收输出      │◄────│ 解析 JSONL 格式   │
│                  │     │ 提取内容增量      │
└────────┬─────────┘     └──────────────────┘
         │
         ▼
┌──────────────────┐
│ WebSocket 推送    │───实时推送到客户端
│                  │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ 客户端渲染        │───打字机效果显示
└────────┬─────────┘
         │
         ▼
┌──────────────────┐     ┌──────────────────┐
│ 检测到工具调用？  │─是──→│ 执行工具          │
│                  │     │ (ReadFile/Write等)│
└────────┬─────────┘     └────────┬─────────┘
         │否                      │
         │                        ▼
         │              ┌──────────────────┐
         │              │ 返回工具结果给 Kimi│
         │              │ 继续对话流        │
         │              └────────┬─────────┘
         │                       │
         └───────────────────────┘
         │
         ▼
┌──────────────────┐
│ 对话完成          │
│ 保存到 SQLite    │
└──────────────────┘
```

### 5.3 文件修改 Diff 流程

```
AI 返回包含代码修改的回复
       │
       ▼
┌──────────────────┐
│ 解析代码块        │───识别 ```diff 或 ```language 块
│ 提取修改建议      │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ 生成统一 Diff    │───使用 diff-match-patch 库
│ (unified format) │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ 展示 Diff 预览   │───在对话面板显示简化 Diff
│                  │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ 用户点击        │
│ [查看完整 Diff] │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ 打开 Diff 页面    │───使用 Monaco Diff Editor
│ 左右对比视图      │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐     ┌──────────────────┐
│ 用户选择操作      │────→│ [应用到文件]     │
│                  │     │ - 写入文件系统   │
└──────────────────┘     │ - 更新编辑器内容 │
                         │ - 标记为已应用   │
                         └──────────────────┘
                         ┌──────────────────┐
                         │ [部分应用]       │
                         │ - 用户编辑修改后 │
                         │   再应用         │
                         └──────────────────┘
                         ┌──────────────────┐
                         │ [放弃]           │
                         │ - 标记为已拒绝   │
                         └──────────────────┘
```

### 5.4 语音对话流程

```
用户点击语音按钮
       │
       ▼
┌──────────────────┐
│ 检查麦克风权限    │───未授权？──→ 请求权限
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ 初始化音频        │
│ - getUserMedia    │
│ - AudioContext    │
│ - 启用回声消除    │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ 启动 VAD         │───使用 @ricky0123/vad-web
│ 语音活动检测      │
└────────┬─────────┘
         │
         │◄──────────────────────────┐
         │                           │
         ▼                           │
┌──────────────────┐                 │
│ 检测到语音开始    │                 │
│ 显示"聆听中..."  │                 │
└────────┬─────────┘                 │
         │                           │
         ▼                           │
┌──────────────────┐                 │
│ 实时 STT 转录    │                 │
│ (Web Speech API) │                 │
└────────┬─────────┘                 │
         │                           │
         ▼                           │
┌──────────────────┐                 │
│ 检测到语音结束    │                 │
└────────┬─────────┘                 │
         │                           │
         ▼                           │
┌──────────────────┐                 │
│ 显示"思考中..."  │                 │
└────────┬─────────┘                 │
         │                           │
         ▼                           │
┌──────────────────┐                 │
│ 发送文本给 Kimi  │                 │
│ (复用对话流程)   │                 │
└────────┬─────────┘                 │
         │                           │
         ▼                           │
┌──────────────────┐                 │
│ 流式接收回复      │                 │
│ 实时 TTS 转换    │                 │
│ (SpeechSynthesis)│                 │
└────────┬─────────┘                 │
         │                           │
         ▼                           │
┌──────────────────┐                 │
│ 播放语音          │                 │
│ 显示"说话中..."  │                 │
└────────┬─────────┘                 │
         │                           │
         ▼                           │
┌──────────────────┐                 │
│ 播放完成？        │────否───────────┘
│                  │    （持续监听，
└────────┬─────────┘     可被用户打断）
         │是
         ▼
┌──────────────────┐
│ 回到聆听状态      │──→ 循环等待用户输入
│ 或超时自动关闭    │
└──────────────────┘
```

---

## 6. 安全设计

### 6.1 身份验证流程

```
┌─────────────────────────────────────────────────────────────────┐
│                        认证架构                                  │
│                                                                  │
│   ┌─────────┐         ┌─────────┐         ┌─────────┐         │
│   │  Client │         │  Server │         │ SQLite  │         │
│   └────┬────┘         └────┬────┘         └────┬────┘         │
│        │                   │                   │              │
│        │  POST /login      │                   │              │
│        │  {username, pass} │                   │              │
│        │──────────────────>│                   │              │
│        │                   │                   │              │
│        │                   │  验证密码         │              │
│        │                   │  (bcrypt)         │              │
│        │                   │──────────────────>│              │
│        │                   │<──────────────────│              │
│        │                   │                   │              │
│        │                   │  生成 JWT         │              │
│        │                   │  (有效期 7 天)     │              │
│        │  {token}          │                   │              │
│        │<──────────────────│                   │              │
│        │                   │                   │              │
│        │  后续请求          │                   │              │
│        │  Authorization:   │                   │              │
│        │  Bearer <token>   │                   │              │
│        │──────────────────>│                   │              │
│        │                   │  验证 JWT         │              │
│        │                   │  签名和过期时间    │              │
│        │                   │                   │              │
│        │                   │  拒绝？           │              │
│        │  401 Unauthorized │                   │              │
│        │<──────────────────│                   │              │
│        │                   │                   │              │
│        │  通过             │                   │              │
│        │  200 OK           │                   │              │
│        │<──────────────────│                   │              │
│        │                   │                   │              │
└────────┴───────────────────┴───────────────────┴───────────────┘
```

### 6.2 文件系统安全

**路径沙箱机制**：
```typescript
// server/utils/path.ts

import path from 'path';

class PathSecurity {
  private rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = path.resolve(rootDir);
  }

  // 验证并规范化路径
  sanitizePath(inputPath: string): string {
    // 1. 规范化路径
    const normalized = path.normalize(inputPath);
    
    // 2. 解析为绝对路径
    const absolute = path.isAbsolute(normalized) 
      ? normalized 
      : path.join(this.rootDir, normalized);
    
    // 3. 检查路径穿越攻击
    const relative = path.relative(this.rootDir, absolute);
    const isOutside = relative.startsWith('..') || path.isAbsolute(relative);
    
    if (isOutside) {
      throw new Error('Access denied: Path outside root directory');
    }
    
    // 4. 检查禁止访问的目录/文件
    const forbiddenPatterns = [
      /\.\./,           // 任何包含 .. 的路径
      /\/\.env/,        // 环境变量文件
      /\/\.ssh\//,      // SSH 密钥
      /\/\.git\//,      // Git 内部目录（只允许特定操作）
      /\.pem$/,         // 证书文件
      /\.key$/,         // 密钥文件
    ];
    
    for (const pattern of forbiddenPatterns) {
      if (pattern.test(absolute)) {
        throw new Error(`Access denied: Forbidden path pattern ${pattern}`);
      }
    }
    
    return absolute;
  }
}
```

### 6.3 AI 操作安全

**危险操作确认机制**：
```typescript
// 需要用户确认的操作类型
const DANGEROUS_OPERATIONS = [
  'Shell:rm -rf',      // 删除目录
  'Shell:sudo',        // 提权命令
  'WriteFile:/etc/',   // 写入系统目录
  'WriteFile:.env',    // 覆盖环境变量
];

// 工具调用审批中间件
async function approveToolCall(
  toolName: string, 
  args: any,
  userId: string
): Promise<boolean> {
  // 1. 检查是否在危险列表
  const isDangerous = DANGEROUS_OPERATIONS.some(op => {
    const [tool, pattern] = op.split(':');
    if (tool !== toolName) return false;
    return args.path?.includes(pattern) || args.command?.includes(pattern);
  });
  
  if (!isDangerous) return true;
  
  // 2. 发送到客户端请求确认
  const approved = await requestUserApproval(userId, {
    tool: toolName,
    args,
    risk: 'high',
    description: generateRiskDescription(toolName, args)
  });
  
  return approved;
}
```

### 6.4 网络安全

| 措施 | 实现 |
|------|------|
| HTTPS/WSS | 强制 TLS 1.3 |
| CORS | 白名单限制 |
| Rate Limiting | 100 req/min per IP |
| Input Validation | Zod Schema 验证 |
| XSS 防护 | Content Security Policy |
| CSRF 防护 | SameSite Cookie |

---

## 7. 性能优化策略

### 7.1 前端优化

```
1. 代码分割
   - 按路由懒加载
   - Monaco Editor 动态导入
   - diff-match-patch 按需加载

2. 虚拟滚动
   - 文件树（> 1000 文件）
   - 对话消息列表
   - Git 文件列表

3. 状态管理优化
   - 使用 Zustand 选择器
   - 文件内容缓存（LRU，最大 50MB）

4. 编辑器优化
   - Large File 检测（> 1MB 只读模式）
   - 语法高亮 worker 池
```

### 7.2 后端优化

```
1. 文件树缓存
   - Redis / Node 内存缓存
   - 文件系统 watch 更新

2. 数据库优化
   - 会话和消息索引
   - 分页查询（每次 50 条）

3. Kimi CLI 进程池
   - 预启动子进程
   - 连接复用

4. 流式传输
   - 使用 WebSocket 而非轮询
   - 压缩 JSON 数据
```

---

## 8. 部署架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        生产环境部署                              │
│                                                                  │
│  ┌─────────────────┐                                            │
│  │   Nginx/Træfik  │  SSL 终端，静态文件服务，反向代理            │
│  │                 │                                            │
│  │  /static/* ─────┼──────┐                                     │
│  │  /api/* ────────┼──────┼──┐                                  │
│  │  /socket.io/* ──┼──────┼──┼──┐                               │
│  └────────┬────────┘      │  │  │                               │
│           │               │  │  │                               │
│           ▼               ▼  ▼  ▼                               │
│  ┌──────────────────────────────────────────┐                  │
│  │           Docker Compose                  │                  │
│  │  ┌────────────────────────────────────┐  │                  │
│  │  │  app (Node.js)                     │  │                  │
│  │  │  - Express Server                  │  │                  │
│  │  │  - Socket.io Server                │  │                  │
│  │  │  - Kimi CLI 子进程管理              │  │                  │
│  │  │  - 端口: 3000                       │  │                  │
│  │  └────────────────────────────────────┘  │                  │
│  │                                          │                  │
│  │  ┌────────────────────────────────────┐  │                  │
│  │  │  sqlite (Volume)                   │  │                  │
│  │  │  - /data/kimi-assistant.db         │  │                  │
│  │  │  - 持久化存储                       │  │                  │
│  │  └────────────────────────────────────┘  │                  │
│  │                                          │                  │
│  │  ┌────────────────────────────────────┐  │                  │
│  │  │  code-volume (Bind Mount)          │  │                  │
│  │  │  - /path/to/your/code:/code:ro    │  │                  │
│  │  │  - 只读挂载源代码目录               │  │                  │
│  │  └────────────────────────────────────┘  │                  │
│  └──────────────────────────────────────────┘                  │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 9. 开发计划

### Phase 1: 基础架构（Week 1-2）
- [ ] 项目脚手架搭建（Vite + React + TS）
- [ ] Express + Socket.io 后端
- [ ] SQLite 数据库初始化
- [ ] 基础认证系统
- [ ] 路径安全模块

### Phase 2: 文件管理（Week 3）
- [ ] 文件树组件
- [ ] 文件 CRUD API
- [ ] Monaco Editor 集成
- [ ] 多标签页支持

### Phase 3: AI 对话（Week 4）
- [ ] Kimi CLI 集成
- [ ] 流式对话实现
- [ ] Session 管理
- [ ] 代码上下文传递

### Phase 4: 增强功能（Week 5）
- [ ] Diff 展示与应用
- [ ] Git 集成
- [ ] 首页项目列表
- [ ] 设置面板

### Phase 5: 语音功能（Week 6）
- [ ] Web Speech API 集成
- [ ] VAD 实现
- [ ] 语音对话 UI
- [ ] "打电话"体验优化

### Phase 6:  polish（Week 7-8）
- [ ] 性能优化
- [ ] 错误处理
- [ ] 文档完善
- [ ] Docker 部署

---

## 10. 总结

本架构设计涵盖了 Kimi Code Web Assistant 的完整技术方案：

**核心特点**：
1. **项目化管理** - 每个目录作为独立项目，维护独立会话
2. **完整的 IDE 体验** - Monaco Editor + Git + Diff
3. **语音集成** - 浏览器原生 API 实现低成本语音对话
4. **安全第一** - 路径沙箱、操作审批、JWT 认证

**技术亮点**：
- 通过子进程调用 Kimi CLI，确保使用订阅计划
- 客户端处理语音，零额外 API 成本
- 流式传输保证用户体验

**待确认问题**：
1. 是否支持多用户？（当前设计支持，但可简化为单用户）
2. 是否需要终端功能？（优先级较低，可后续添加）
3. 语音 TTS 使用浏览器原生还是云服务？

---

*文档版本: 1.0*  
*最后更新: 2026-03-05*
