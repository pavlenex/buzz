import * as React from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import "@xterm/xterm/css/xterm.css";

type TerminalDataPayload = {
  sessionId: string;
  data: string;
};

type TerminalExitPayload = {
  sessionId: string;
  exitCode: number;
};

type TerminalOpenOutput = {
  sessionId: string;
  created: boolean;
  initialData: string | null;
};

type TerminalInstanceProps = {
  channelId: string;
  isVisible: boolean;
};

/**
 * A single xterm.js terminal instance backed by a native PTY session.
 * Scoped to a channel — reattaches on re-render if the session already exists.
 */
export function TerminalInstance({
  channelId,
  isVisible,
}: TerminalInstanceProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const termRef = React.useRef<Terminal | null>(null);
  const fitAddonRef = React.useRef<FitAddon | null>(null);
  const sessionIdRef = React.useRef<string | null>(null);
  const unlistenDataRef = React.useRef<UnlistenFn | null>(null);
  const unlistenExitRef = React.useRef<UnlistenFn | null>(null);

  React.useEffect(() => {
    if (!containerRef.current || !isVisible) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'SF Mono', 'Fira Code', 'JetBrains Mono', Menlo, monospace",
      lineHeight: 1.3,
      scrollback: 10000,
      allowProposedApi: true,
      theme: {
        background: "#1a1b26",
        foreground: "#c0caf5",
        cursor: "#c0caf5",
        selectionBackground: "#33467c",
        black: "#15161e",
        red: "#f7768e",
        green: "#9ece6a",
        yellow: "#e0af68",
        blue: "#7aa2f7",
        magenta: "#bb9af7",
        cyan: "#7dcfff",
        white: "#a9b1d6",
        brightBlack: "#414868",
        brightRed: "#f7768e",
        brightGreen: "#9ece6a",
        brightYellow: "#e0af68",
        brightBlue: "#7aa2f7",
        brightMagenta: "#bb9af7",
        brightCyan: "#7dcfff",
        brightWhite: "#c0caf5",
      },
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(containerRef.current);

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Fit after a frame so the container has dimensions.
    requestAnimationFrame(() => {
      fitAddon.fit();
    });

    // Open PTY session.
    const cols = term.cols;
    const rows = term.rows;

    invoke<TerminalOpenOutput>("terminal_open_session", {
      input: { channelId, cols, rows },
    }).then((output) => {
      sessionIdRef.current = output.sessionId;

      // Write buffered output from a reattached session.
      if (output.initialData) {
        term.write(output.initialData);
      }

      // Listen for PTY data.
      listen<TerminalDataPayload>("terminal:data", (event) => {
        if (event.payload.sessionId === sessionIdRef.current) {
          term.write(event.payload.data);
        }
      }).then((unlisten) => {
        unlistenDataRef.current = unlisten;
      });

      // Listen for PTY exit.
      listen<TerminalExitPayload>("terminal:exit", (event) => {
        if (event.payload.sessionId === sessionIdRef.current) {
          term.write(
            `\r\n\x1b[90m[Process exited with code ${event.payload.exitCode}]\x1b[0m\r\n`,
          );
          sessionIdRef.current = null;
        }
      }).then((unlisten) => {
        unlistenExitRef.current = unlisten;
      });

      // Send keystrokes to PTY.
      term.onData((data) => {
        if (sessionIdRef.current) {
          invoke("terminal_write", {
            input: { sessionId: sessionIdRef.current, data },
          });
        }
      });
    });

    // Resize observer.
    const resizeObserver = new ResizeObserver(() => {
      if (fitAddonRef.current && isVisible) {
        fitAddonRef.current.fit();
        if (sessionIdRef.current && termRef.current) {
          invoke("terminal_resize", {
            input: {
              sessionId: sessionIdRef.current,
              cols: termRef.current.cols,
              rows: termRef.current.rows,
            },
          });
        }
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      unlistenDataRef.current?.();
      unlistenExitRef.current?.();
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, [channelId, isVisible]);

  // Re-fit when visibility changes.
  React.useEffect(() => {
    if (isVisible && fitAddonRef.current) {
      requestAnimationFrame(() => {
        fitAddonRef.current?.fit();
        if (sessionIdRef.current && termRef.current) {
          invoke("terminal_resize", {
            input: {
              sessionId: sessionIdRef.current,
              cols: termRef.current.cols,
              rows: termRef.current.rows,
            },
          });
        }
      });
    }
  }, [isVisible]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      style={{ display: isVisible ? "block" : "none" }}
    />
  );
}
