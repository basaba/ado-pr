import { useEffect, useRef, useCallback, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

export interface UseCopilotTerminalOptions {
  /** Short initial prompt identifying the PR */
  prPrompt: string;
  /** ADO server URL (e.g. https://dev.azure.com) */
  adoServerUrl: string;
  /** ADO organization name */
  adoOrg: string;
  /** ADO project name */
  adoProject: string;
  /** Local repo path for copilot --add-dir */
  repoPath?: string;
  /** Source branch for isolated worktree */
  sourceBranch?: string;
}

export interface UseCopilotTerminalReturn {
  /** Ref to attach to the container div for xterm */
  terminalRef: React.RefObject<HTMLDivElement | null>;
  /** Whether the terminal is connected */
  connected: boolean;
  /** Error message if connection failed */
  error: string | null;
  /** Whether the copilot process has exited */
  exited: boolean;
  /** Reconnect the terminal session */
  reconnect: () => void;
}

export function useCopilotTerminal({
  prPrompt,
  adoServerUrl,
  adoOrg,
  adoProject,
  repoPath,
  sourceBranch,
}: UseCopilotTerminalOptions): UseCopilotTerminalReturn {
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exited, setExited] = useState(false);
  const [connectId, setConnectId] = useState(0);

  const reconnect = useCallback(() => {
    setExited(false);
    setError(null);
    setConnected(false);
    setConnectId((c) => c + 1);
  }, []);

  useEffect(() => {
    if (!terminalRef.current) return;

    const container = terminalRef.current;

    // Create terminal
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, monospace",
      theme: {
        background: '#1e1e2e',
        foreground: '#cdd6f4',
        cursor: '#f5e0dc',
        selectionBackground: '#585b7066',
        black: '#45475a',
        red: '#f38ba8',
        green: '#a6e3a1',
        yellow: '#f9e2af',
        blue: '#89b4fa',
        magenta: '#f5c2e7',
        cyan: '#94e2d5',
        white: '#bac2de',
        brightBlack: '#585b70',
        brightRed: '#f38ba8',
        brightGreen: '#a6e3a1',
        brightYellow: '#f9e2af',
        brightBlue: '#89b4fa',
        brightMagenta: '#f5c2e7',
        brightCyan: '#94e2d5',
        brightWhite: '#a6adc8',
      },
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);

    // Small delay for layout to settle before fitting
    requestAnimationFrame(() => {
      try { fitAddon.fit(); } catch { /* container not ready yet */ }
    });

    termRef.current = term;
    fitRef.current = fitAddon;

    // Connect WebSocket
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/copilot-pty`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setError(null);

      // Send init config
      ws.send(JSON.stringify({
        prPrompt,
        adoServerUrl,
        adoOrg,
        adoProject,
        repoPath,
        sourceBranch,
        cols: term.cols,
        rows: term.rows,
      }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as
          | { type: 'output'; data: string }
          | { type: 'exit'; exitCode: number; signal?: number }
          | { type: 'error'; message: string };

        if (msg.type === 'output') {
          term.write(msg.data);
        } else if (msg.type === 'exit') {
          term.write(`\r\n\x1b[33m[Copilot process exited with code ${msg.exitCode}]\x1b[0m\r\n`);
          setExited(true);
        } else if (msg.type === 'error') {
          term.write(`\r\n\x1b[31m[Error: ${msg.message}]\x1b[0m\r\n`);
          setError(msg.message);
        }
      } catch {
        // Raw data fallback
        term.write(event.data);
      }
    };

    ws.onclose = () => {
      setConnected(false);
    };

    ws.onerror = () => {
      setError('WebSocket connection failed');
      setConnected(false);
    };

    // Forward terminal input to WebSocket
    const inputDisposable = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    // Forward resize events
    const resizeDisposable = term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    });

    // Handle container resize with ResizeObserver
    const resizeObserver = new ResizeObserver(() => {
      try { fitAddon.fit(); } catch { /* ignore */ }
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      inputDisposable.dispose();
      resizeDisposable.dispose();
      ws.close();
      wsRef.current = null;
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      setConnected(false);
    };
  }, [prPrompt, adoServerUrl, adoOrg, adoProject, repoPath, sourceBranch, connectId]);

  return { terminalRef, connected, error, exited, reconnect };
}
