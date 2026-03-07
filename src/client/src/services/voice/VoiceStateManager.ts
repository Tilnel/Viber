/**
 * 语音状态管理器 - 统一管理语音对话的状态，避免重复和竞争条件
 * 
 * 设计原则：
 * 1. 单一数据源：所有语音相关状态都在这里管理
 * 2. 严格的阶段控制：listening -> processing -> speaking -> idle
 * 3. 防重复机制：在状态转换时进行严格的检查
 */

export type VoicePhase = 'idle' | 'listening' | 'processing' | 'speaking';

interface VoiceState {
  phase: VoicePhase;
  sessionId: string | null;
  lastUserMessage: string;
  lastUserMessageTime: number;
  lastAIResponse: string;
  isAIResponding: boolean;
  transcript: string;
  interimTranscript: string;
}

interface VoiceCallbacks {
  onPhaseChange?: (phase: VoicePhase, prevPhase: VoicePhase) => void;
  onTranscript?: (text: string, isFinal: boolean) => void;
  onUserSpeech?: (text: string) => void;
  onAIResponse?: (text: string) => void;
  onError?: (error: string) => void;
}

export class VoiceStateManager {
  private state: VoiceState;
  private callbacks: VoiceCallbacks;
  private readonly DEBOUNCE_DELAY = 3000;
  
  constructor(callbacks: VoiceCallbacks = {}) {
    this.callbacks = callbacks;
    this.state = {
      phase: 'idle',
      sessionId: null,
      lastUserMessage: '',
      lastUserMessageTime: 0,
      lastAIResponse: '',
      isAIResponding: false,
      transcript: '',
      interimTranscript: ''
    };
  }

  getPhase(): VoicePhase {
    return this.state.phase;
  }

  getTranscript(): string {
    return this.state.transcript;
  }

  getInterimTranscript(): string {
    return this.state.interimTranscript;
  }

  canTransitionTo(newPhase: VoicePhase): boolean {
    const { phase } = this.state;
    
    const validTransitions: Record<VoicePhase, VoicePhase[]> = {
      'idle': ['listening'],
      'listening': ['processing', 'idle'],
      'processing': ['speaking', 'idle'],
      'speaking': ['listening', 'idle']
    };
    
    return validTransitions[phase]?.includes(newPhase) || false;
  }

  private transitionTo(newPhase: VoicePhase): boolean {
    if (!this.canTransitionTo(newPhase)) {
      console.warn(`[VoiceStateManager] Invalid transition: ${this.state.phase} -> ${newPhase}`);
      return false;
    }

    const prevPhase = this.state.phase;
    this.state.phase = newPhase;
    
    console.log(`[VoiceStateManager] Phase: ${prevPhase} -> ${newPhase}`);
    this.callbacks.onPhaseChange?.(newPhase, prevPhase);
    
    return true;
  }

  startListening(sessionId?: string): boolean {
    if (this.state.phase !== 'idle' && this.state.phase !== 'speaking') {
      console.warn('[VoiceStateManager] Cannot start listening from phase:', this.state.phase);
      return false;
    }

    this.state.transcript = '';
    this.state.interimTranscript = '';
    
    if (sessionId) {
      this.state.sessionId = sessionId;
    }

    return this.transitionTo('listening');
  }

  updateTranscript(text: string, isFinal: boolean): void {
    if (this.state.phase !== 'listening') {
      return;
    }

    if (isFinal) {
      this.state.transcript = text;
      this.state.interimTranscript = '';
    } else {
      this.state.interimTranscript = text.replace(this.state.transcript, '');
    }

    this.callbacks.onTranscript?.(text, isFinal);
  }

  finalizeUserSpeech(): string | null {
    if (this.state.phase !== 'listening') {
      console.warn('[VoiceStateManager] Cannot finalize speech from phase:', this.state.phase);
      return null;
    }

    const text = this.state.transcript.trim();
    if (!text) {
      console.log('[VoiceStateManager] Empty transcript, returning to idle');
      this.transitionTo('idle');
      return null;
    }

    const now = Date.now();
    const isDuplicate = this.checkDuplicate(text, now);
    
    if (isDuplicate) {
      console.log('[VoiceStateManager] Duplicate speech detected:', text);
      this.transitionTo('idle');
      return null;
    }

    this.state.lastUserMessage = text;
    this.state.lastUserMessageTime = now;
    
    if (!this.transitionTo('processing')) {
      return null;
    }

    this.callbacks.onUserSpeech?.(text);
    
    return text;
  }

  private checkDuplicate(text: string, now: number): boolean {
    const { lastUserMessage, lastUserMessageTime } = this.state;
    
    if (now - lastUserMessageTime < this.DEBOUNCE_DELAY) {
      const normalizedNew = this.normalizeText(text);
      const normalizedLast = this.normalizeText(lastUserMessage);
      
      if (normalizedNew === normalizedLast ||
          normalizedNew.includes(normalizedLast) ||
          normalizedLast.includes(normalizedNew)) {
        return true;
      }
    }
    
    return false;
  }

  private normalizeText(text: string): string {
    return text
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[，。？！,.?!]/g, '')
      .replace(/[０１２３４５６７８９]/g, d => String.fromCharCode(d.charCodeAt(0) - 0xFEE0))
      .trim();
  }

  startAIResponse(): boolean {
    if (this.state.phase !== 'processing') {
      console.warn('[VoiceStateManager] Cannot start AI response from phase:', this.state.phase);
      return false;
    }

    this.state.isAIResponding = true;
    this.state.lastAIResponse = '';
    
    return this.transitionTo('speaking');
  }

  updateAIResponse(text: string): void {
    if (this.state.phase !== 'speaking') {
      return;
    }

    this.state.lastAIResponse += text;
    this.callbacks.onAIResponse?.(text);
  }

  finalizeAIResponse(): string {
    const response = this.state.lastAIResponse;
    this.state.isAIResponding = false;
    return response;
  }

  interrupt(): boolean {
    if (this.state.phase !== 'speaking') {
      return false;
    }

    console.log('[VoiceStateManager] AI interrupted');
    
    this.transitionTo('listening');
    
    this.state.transcript = '';
    this.state.interimTranscript = '';
    this.state.lastAIResponse = '';
    this.state.isAIResponding = false;
    
    return true;
  }

  stop(): void {
    console.log('[VoiceStateManager] Stopping, current phase:', this.state.phase);

    this.state.phase = 'idle';
    this.state.transcript = '';
    this.state.interimTranscript = '';
    this.state.isAIResponding = false;
    this.state.lastAIResponse = '';
  }

  setError(error: string): void {
    console.error('[VoiceStateManager] Error:', error);
    this.callbacks.onError?.(error);
    this.stop();
  }
}

let globalVoiceStateManager: VoiceStateManager | null = null;

export function getVoiceStateManager(callbacks?: VoiceCallbacks): VoiceStateManager {
  if (!globalVoiceStateManager) {
    globalVoiceStateManager = new VoiceStateManager(callbacks);
  }
  return globalVoiceStateManager;
}

export function resetVoiceStateManager(): void {
  globalVoiceStateManager?.stop();
  globalVoiceStateManager = null;
}
