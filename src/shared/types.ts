// 文件系统
export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  mtime?: string;
  children?: FileNode[];
  isLoaded?: boolean;
}

// 项目
export interface Project {
  id: number;
  path: string;
  absolutePath?: string;  // 绝对路径，打开项目时返回
  name: string;
  description?: string;
  icon?: string;
  lastOpenedAt: string;
  openedCount: number;
  isPinned: boolean;
  exists?: boolean;
}

// 会话
export interface ChatSession {
  id: number;
  projectId: number;
  name: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  isArchived: boolean;
}

// 消息
export interface ChatMessage {
  id: number;
  sessionId: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: MessageMetadata;
  createdAt: string;
}

export interface MessageMetadata {
  mentionedFiles?: string[];
  selectedCode?: SelectedCode;
  currentFile?: string;
  isSTTResult?: boolean;  // 标记是否为语音识别结果
  sttConfidence?: number; // 语音识别置信度
}

// 工具调用
export interface ToolCall {
  id: string;
  type: string;
  function: {
    name: string;
    arguments: string | Record<string, any>;
  };
  status?: 'pending' | 'running' | 'completed' | 'error';
  result?: any;
}

export interface SelectedCode {
  filePath: string;
  code: string;
  startLine: number;
  endLine: number;
}

// 文件变更
export interface FileChange {
  id: number;
  sessionId: number;
  filePath: string;
  originalContent: string;
  proposedContent: string;
  diffContent: string;
  status: 'pending' | 'applied' | 'rejected';
  createdAt: string;
  appliedAt?: string;
}

// Git
export interface GitStatus {
  isGitRepo: boolean;
  branch?: string;
  tracking?: string;
  ahead?: number;
  behind?: number;
  files: GitFileStatus[];
  recentCommits?: GitCommit[];
  branches?: string[];
}

export interface GitFileStatus {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked';
  staged: boolean;
}

export interface GitCommit {
  hash: string;
  message: string;
  author: string;
  date: string;
}

// 编辑器
export interface OpenFile {
  path: string;
  content: string;
  originalContent: string;
  language: string;
  isDirty: boolean;
  isLoading: boolean;
  isBinary?: boolean;
}

// 设置
export interface Settings {
  theme: 'light' | 'dark' | 'system';
  fontSize: number;
  tabSize: number;
  wordWrap: boolean;
  minimapEnabled: boolean;
  autoSave: boolean;
  autoSaveDelay: number;
  voiceEnabled: boolean;
  voiceInputDevice?: string;
  voiceOutputDevice?: string;
  voiceLanguage: string;
  voiceSpeed: number;
  // TTS 音色设置
  ttsEngine: 'volcano' | 'piper' | 'browser';
  ttsVoice: string;
  // VAD 设置
  vadThreshold: number;
  vadSilenceTimeout: number;
  defaultModel: string;
  contextWindow: number;
  rootDirectory: string;
}

// 语音状态
export type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking' | 'error';

export interface VoiceStatus {
  state: VoiceState;
  transcript: string;
  error?: string;
}

// API 响应
export interface ApiResponse<T> {
  data?: T;
  error?: string;
  message?: string;
}
