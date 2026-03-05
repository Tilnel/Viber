import { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import { io } from 'socket.io-client';
import 'xterm/css/xterm.css';
import './TerminalPanel.css';

interface TerminalPanelProps {
  projectPath: string;
  onClose: () => void;
}

export default function TerminalPanel({ projectPath, onClose }: TerminalPanelProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<ReturnType<typeof io> | null>(null);
  const terminalIdRef = useRef<string>(`term-${Date.now()}`);
  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(true);

  useEffect(() => {
    if (!terminalRef.current) return;

    let term: Terminal | null = null;
    let fitAddon: FitAddon | null = null;
    let socket: ReturnType<typeof io> | null = null;

    const initTerminal = async () => {
      try {
        // Initialize terminal
        term = new Terminal({
          fontSize: 14,
          fontFamily: 'JetBrains Mono, Consolas, monospace',
          theme: {
            background: '#1e1e1e',
            foreground: '#cccccc',
            cursor: '#cccccc',
            selectionBackground: '#264f78',
            black: '#000000',
            red: '#cd3131',
            green: '#0dbc79',
            yellow: '#e5e510',
            blue: '#2472c8',
            magenta: '#bc3fbc',
            cyan: '#11a8cd',
            white: '#e5e5e5',
            brightBlack: '#666666',
            brightRed: '#f14c4c',
            brightGreen: '#23d18b',
            brightYellow: '#f5f543',
            brightBlue: '#3b8eea',
            brightMagenta: '#d670d6',
            brightCyan: '#29b8db',
            brightWhite: '#e5e5e5'
          },
          cursorBlink: true,
          scrollback: 10000
        });

        fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.loadAddon(new WebLinksAddon());

        // 先打开终端
        term.open(terminalRef.current!);
        
        xtermRef.current = term;
        fitAddonRef.current = fitAddon;

        // Connect to socket
        socket = io(window.location.origin);
        socketRef.current = socket;

        const terminalId = terminalIdRef.current;

        socket.on('connect', () => {
          console.log('Socket connected');
          // Create terminal session
          socket.emit('terminal:create', {
            id: terminalId,
            cwd: projectPath
          });
        });

        socket.on(`terminal:created:${terminalId}`, () => {
          setIsConnecting(false);
          
          // 延迟 fit 确保 DOM 已渲染
          setTimeout(() => {
            try {
              fitAddon?.fit();
              const { cols, rows } = term!;
              socket?.emit('terminal:resize', { id: terminalId, cols, rows });
            } catch (err) {
              console.error('Initial fit error:', err);
            }
          }, 100);
        });

        socket.on(`terminal:data:${terminalId}`, (data: string) => {
          term?.write(data);
        });

        socket.on(`terminal:close:${terminalId}`, () => {
          term?.writeln('\r\n\x1b[31m[终端已关闭]\x1b[0m\r\n');
        });

        socket.on(`terminal:error:${terminalId}`, (err: { message: string }) => {
          setError(err.message);
          setIsConnecting(false);
          term?.writeln(`\r\n\x1b[31m[错误: ${err.message}]\x1b[0m\r\n`);
        });

        // Handle user input
        term.onData((data) => {
          socket?.emit('terminal:input', { id: terminalId, input: data });
        });

        // Handle resize
        const handleResize = () => {
          try {
            fitAddon?.fit();
            const { cols, rows } = term!;
            socket?.emit('terminal:resize', { id: terminalId, cols, rows });
          } catch (err) {
            console.error('Resize error:', err);
          }
        };
        
        window.addEventListener('resize', handleResize);

        return () => {
          window.removeEventListener('resize', handleResize);
        };
      } catch (err: any) {
        setError(err.message || 'Failed to initialize terminal');
        setIsConnecting(false);
        console.error('Terminal initialization error:', err);
      }
    };

    const cleanupPromise = initTerminal();

    return () => {
      const terminalId = terminalIdRef.current;
      socket?.emit('terminal:kill', terminalId);
      socket?.disconnect();
      term?.dispose();
    };
  }, [projectPath]);

  return (
    <div className="terminal-panel">
      <div className="terminal-header">
        <span className="terminal-title">
          {isConnecting ? '终端 (连接中...)' : '终端'}
        </span>
        <button className="btn btn-icon" onClick={onClose} title="关闭">✕</button>
      </div>
      <div className="terminal-content" ref={terminalRef}>
        {error && (
          <div className="terminal-error">
            <p>❌ {error}</p>
          </div>
        )}
      </div>
    </div>
  );
}
