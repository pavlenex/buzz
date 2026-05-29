import * as React from "react";

import { runSproutCli } from "@/shared/api/tauri";
import type { Channel } from "@/shared/api/types";

type ConsoleLine = {
  id: number;
  kind: "input" | "output" | "error" | "hint";
  text: string;
};

type QuakeConsoleProps = {
  channels: Channel[];
  onOpenChange: (open: boolean) => void;
  onOpenChannel: (channelId: string) => void;
  open: boolean;
};

const INTRO_LINES: ConsoleLine[] = [
  {
    id: 1,
    kind: "hint",
    text: "sprout console",
  },
  {
    id: 2,
    kind: "hint",
    text: "Type `help` to see available commands.",
  },
  {
    id: 3,
    kind: "hint",
    text: "This is a Sprout-native command surface, not a full shell.",
  },
];

function normalizeCommand(command: string) {
  return command.trim().replace(/\s+/g, " ");
}

function findChannel(channels: Channel[], rawName: string) {
  const normalizedName = rawName.replace(/^#/, "").trim().toLowerCase();
  return (
    channels.find((channel) => channel.name.toLowerCase() === normalizedName) ??
    channels.find((channel) =>
      channel.name.toLowerCase().includes(normalizedName),
    ) ??
    null
  );
}

function parseCommandArgs(command: string) {
  const matches = command.match(/"([^"]*)"|'([^']*)'|\S+/g) ?? [];
  return matches.map((match) => {
    if (
      (match.startsWith('"') && match.endsWith('"')) ||
      (match.startsWith("'") && match.endsWith("'"))
    ) {
      return match.slice(1, -1);
    }

    return match;
  });
}

function formatCliOutput(text: string) {
  return text
    .trimEnd()
    .split("\n")
    .filter((line) => line.length > 0);
}

function isSproutCliCommand(command: string) {
  const args = parseCommandArgs(command);
  const first = args[0]?.toLowerCase();
  return (
    first === "sprout" ||
    first === "--format" ||
    [
      "canvas",
      "channels",
      "dms",
      "feed",
      "messages",
      "reactions",
      "repos",
      "social",
      "users",
      "workflows",
    ].includes(first)
  );
}

function toSproutCliArgs(command: string) {
  const args = parseCommandArgs(command);
  return args[0] === "sprout" ? args.slice(1) : args;
}

export function QuakeConsole({
  channels,
  onOpenChange,
  onOpenChannel,
  open,
}: QuakeConsoleProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const nextLineIdRef = React.useRef(INTRO_LINES.length + 1);
  const [draft, setDraft] = React.useState("");
  const [isRunning, setIsRunning] = React.useState(false);
  const [lines, setLines] = React.useState<ConsoleLine[]>(INTRO_LINES);

  React.useEffect(() => {
    if (!open) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  React.useEffect(() => {
    if (!open) {
      return;
    }

    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  });

  const appendLines = React.useCallback(
    (nextLines: Omit<ConsoleLine, "id">[]) => {
      setLines((current) => [
        ...current,
        ...nextLines.map((line) => ({
          ...line,
          id: nextLineIdRef.current++,
        })),
      ]);
    },
    [],
  );

  const runCommand = React.useCallback(
    async (rawCommand: string) => {
      const command = normalizeCommand(rawCommand);
      if (command.length === 0) {
        return;
      }

      if (command === "clear") {
        setLines(INTRO_LINES);
        return;
      }

      const output: Omit<ConsoleLine, "id">[] = [
        { kind: "input", text: `$ ${command}` },
      ];
      const lowerCommand = command.toLowerCase();

      if (lowerCommand === "help") {
        output.push(
          {
            kind: "output",
            text: "help                         Show commands",
          },
          {
            kind: "output",
            text: "clear                        Reset console",
          },
          {
            kind: "output",
            text: "sprout channels list         Run the real Sprout CLI",
          },
          {
            kind: "output",
            text: 'sprout messages search --query "release"',
          },
          {
            kind: "output",
            text: "open #channel                App-native channel navigation",
          },
        );
      } else if (lowerCommand.startsWith("open ")) {
        const channel = findChannel(channels, command.slice(5));
        if (!channel) {
          output.push({
            kind: "error",
            text: `No channel matched "${command.slice(5)}".`,
          });
        } else {
          output.push({ kind: "output", text: `Opening #${channel.name}...` });
          onOpenChannel(channel.id);
          onOpenChange(false);
        }
      } else if (isSproutCliCommand(command)) {
        appendLines(output);
        setIsRunning(true);
        try {
          const result = await runSproutCli(toSproutCliArgs(command));
          const stdoutLines = formatCliOutput(result.stdout);
          const stderrLines = formatCliOutput(result.stderr);

          appendLines([
            ...stdoutLines.map((text) => ({ kind: "output" as const, text })),
            ...stderrLines.map((text) => ({
              kind:
                result.exitCode === 0 ? ("hint" as const) : ("error" as const),
              text,
            })),
            ...(result.exitCode === 0
              ? []
              : [
                  {
                    kind: "error" as const,
                    text: `sprout exited with code ${result.exitCode}`,
                  },
                ]),
          ]);
        } catch (error) {
          appendLines([
            {
              kind: "error",
              text: error instanceof Error ? error.message : String(error),
            },
          ]);
        } finally {
          setIsRunning(false);
        }
        return;
      } else {
        output.push({
          kind: "error",
          text: `Unknown command: ${command}. Type \`help\` for options.`,
        });
      }

      appendLines(output);
    },
    [appendLines, channels, onOpenChange, onOpenChannel],
  );

  if (!open) {
    return null;
  }

  return (
    <div
      aria-label="Sprout console"
      aria-modal="true"
      className="fixed inset-0 z-[220] bg-black/20 backdrop-blur-3xl supports-[backdrop-filter]:bg-black/10"
      data-testid="quake-console"
      role="dialog"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(0,0,0,0.16)_48%,rgba(0,0,0,0.44)_100%),linear-gradient(180deg,rgba(0,0,0,0.06),rgba(0,0,0,0.24))]" />
      <div
        className="relative flex h-full w-full flex-col overflow-hidden bg-black/18 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.16)] backdrop-blur-3xl supports-[backdrop-filter]:bg-black/12"
        onMouseDown={() => inputRef.current?.focus()}
        role="document"
      >
        <div
          className="min-h-0 flex-1 overflow-y-auto px-8 pb-8 pt-14 font-mono text-[13px] leading-[1.45] text-zinc-100"
          ref={scrollRef}
        >
          {lines.map((line) => (
            <div
              className={
                line.kind === "input"
                  ? "text-zinc-50"
                  : line.kind === "error"
                    ? "text-red-300"
                    : line.kind === "hint"
                      ? "text-zinc-300"
                      : "text-zinc-100"
              }
              key={line.id}
            >
              {line.text}
            </div>
          ))}

          <form
            className="mt-1 flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void runCommand(draft);
              setDraft("");
            }}
          >
            <label className="sr-only" htmlFor="quake-console-command">
              Console command
            </label>
            <span className="shrink-0 text-zinc-50">$</span>
            <input
              id="quake-console-command"
              aria-label="Console command"
              className="min-w-0 flex-1 bg-transparent text-zinc-50 caret-zinc-50 outline-none placeholder:text-zinc-600"
              disabled={isRunning}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  onOpenChange(false);
                }
              }}
              placeholder=""
              ref={inputRef}
              value={draft}
            />
            {isRunning ? (
              <span className="shrink-0 text-zinc-500">running...</span>
            ) : null}
          </form>
        </div>
      </div>
    </div>
  );
}
