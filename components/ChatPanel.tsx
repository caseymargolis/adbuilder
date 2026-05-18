"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AGENTS, type AgentDef, type AgentId } from "@/lib/agents";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export default function ChatPanel({
  clientId,
  clientName,
  roster,
  defaultAgent = "atlas",
}: {
  clientId: string;
  clientName: string;
  roster: AgentDef[];
  defaultAgent?: AgentId;
}) {
  const [agentId, setAgentId] = useState<AgentId>(defaultAgent);
  const [audience, setAudience] = useState<"pm" | "client">("pm");
  // Per-agent thread so switching agents doesn't lose context
  const [threads, setThreads] = useState<Record<AgentId, Message[]>>(
    () =>
      Object.fromEntries(
        Object.values(AGENTS).map((a) => [
          a.id,
          [
            {
              role: "assistant" as const,
              content: greetingFor(a, clientName),
            },
          ],
        ]),
      ) as Record<AgentId, Message[]>,
  );
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const messages = threads[agentId];
  const agent = AGENTS[agentId];

  // Hydrate from backend, then localStorage fallback
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/chat/history?clientId=${clientId}`, { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as {
            threads?: Record<AgentId, Message[]>;
          };
          if (data.threads) {
            const withGreetings = Object.fromEntries(
              Object.values(AGENTS).map((a) => {
                const existing = data.threads?.[a.id] ?? [];
                return [
                  a.id,
                  existing.length > 0
                    ? existing
                    : ([{ role: "assistant", content: greetingFor(a, clientName) }] as Message[]),
                ];
              }),
            ) as Record<AgentId, Message[]>;
            setThreads(withGreetings);
            return;
          }
        }
      } catch {
        /* fall through to localStorage */
      }
      try {
        const raw = localStorage.getItem(`chat:${clientId}`);
        if (!raw) return;
        const saved = JSON.parse(raw) as Record<AgentId, Message[]> | null;
        if (saved && typeof saved === "object") {
          const withGreetings = Object.fromEntries(
            Object.values(AGENTS).map((a) => {
              const existing = saved[a.id] ?? [];
              return [
                a.id,
                existing.length > 0
                  ? existing
                  : ([{ role: "assistant", content: greetingFor(a, clientName) }] as Message[]),
              ];
            }),
          ) as Record<AgentId, Message[]>;
          setThreads(withGreetings);
        }
      } catch {
        /* ignore */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  // Persist to localStorage and backend on change (debounced)
  useEffect(() => {
    try {
      localStorage.setItem(`chat:${clientId}`, JSON.stringify(threads));
    } catch {
      // ignore save errors
    }
    const t = setTimeout(() => {
      fetch("/api/chat/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, threads }),
      }).catch(() => {});
    }, 600);
    return () => clearTimeout(t);
  }, [threads, clientId]);

  // Persist per-agent audience selection in localStorage
  useEffect(() => {
    try {
      const key = `chatMeta:${clientId}`;
      const meta = JSON.parse(localStorage.getItem(key) || "{}") as Record<AgentId, { audience: "pm" | "client" }>;
      const next = { ...meta, [agentId]: { audience } };
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, [agentId, audience, clientId]);

  // Hydrate audience per-agent on agent switch
  useEffect(() => {
    try {
      const key = `chatMeta:${clientId}`;
      const meta = JSON.parse(localStorage.getItem(key) || "{}") as Record<AgentId, { audience: "pm" | "client" }>;
      const a = meta[agentId]?.audience;
      if (a && a !== audience) setAudience(a);
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  const setMessages = (
    next: Message[] | ((prev: Message[]) => Message[]),
  ) => {
    setThreads((all) => ({
      ...all,
      [agentId]: typeof next === "function" ? next(all[agentId]) : next,
    }));
  };

  async function send() {
    if (!input.trim() || busy) return;
    const userMsg: Message = { role: "user", content: input.trim() };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setBusy(true);

    let current = "";
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          messages: nextMessages,
          agentId,
          audience,
        }),
      });
      if (!res.ok || !res.body) {
        throw new Error(`Chat failed (${res.status}).`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        current += decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = { role: "assistant", content: current };
          return next;
        });
      }
    } catch (e) {
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = {
          role: "assistant",
          content: `Hit a snag: ${(e as Error).message}`,
        };
        return next;
      });
    } finally {
      setBusy(false);
    }
  }

  const suggestions = useMemo(() => {
    switch (agentId) {
      case "molly":
        return [
          "Is ad 3 worth keeping?",
          "Which Meta angle is winning?",
          "When should we kill the worst-performing one?",
        ];
      case "geo":
        return [
          "Which RSA is performing best?",
          "What search terms are converting?",
          "Should we add negative keywords?",
        ];
      case "river":
        return [
          "What should we post next week?",
          "Which platform is highest-engagement?",
          "Draft a contrarian post for LinkedIn.",
        ];
      case "lex":
        return [
          "Summarize this week for the client.",
          "What's the morning brief look like?",
          "Where's our spend going hardest?",
        ];
      case "atlas":
      default:
        return [
          "What's the play this week?",
          "Should we shift budget toward Google?",
          "Are we executing the game plan?",
        ];
    }
  }, [agentId]);

  return (
    <div className="card h-full flex flex-col">
      <div className="px-4 py-3 border-b border-[color:var(--line)] space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {roster.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                if (busy) return; // prevent switching during stream
                setAgentId(a.id);
              }}
              className={`pill text-[11px] ${
                a.id === agentId ? "" : "opacity-60"
              }`}
              style={
                a.id === agentId
                  ? {
                      background: a.accent,
                      color: "#fff",
                    }
                  : undefined
              }
              title={a.bio}
              disabled={busy}
            >
              {a.name}
            </button>
          ))}
        </div>
        <div className="flex justify-between items-center">
          <div>
            <div className="font-display font-semibold">
              Chatting with {agent.name}
            </div>
            <div className="text-xs text-[color:var(--muted)]">{agent.role}</div>
          </div>
          <select
            className="text-xs border border-[color:var(--line)] rounded px-2 py-1 bg-white/70"
            value={audience}
            onChange={(e) =>
              setAudience(e.target.value as "pm" | "client")
            }
          >
            <option value="pm">PM mode</option>
            <option value="client">Client mode</option>
          </select>
        </div>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((m, i) => (
          <div
            key={i}
            className={`text-sm ${
              m.role === "user"
                ? "bg-[color:var(--ink)] text-[color:var(--bg)] ml-6 rounded-2xl rounded-br-sm px-3 py-2"
                : "bg-[color:var(--bg)] border border-[color:var(--line)] mr-6 rounded-2xl rounded-bl-sm px-3 py-2"
            } whitespace-pre-wrap leading-relaxed`}
          >
            {m.content ? (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  a: ({ node, ...props }) => (
                    // eslint-disable-next-line react/jsx-no-target-blank
                    <a {...props} target="_blank" rel="noopener noreferrer" />
                  ),
                  code: ({ inline, className, children, ...props }) => (
                    <code className={`${className ?? ""} bg-black/10 px-1 rounded`} {...props}>
                      {children}
                    </code>
                  ),
                }}
              >
                {m.content}
              </ReactMarkdown>
            ) : busy && i === messages.length - 1 ? (
              "…"
            ) : null}
          </div>
        ))}
      </div>
      <div className="px-4 pb-2 flex flex-wrap gap-1.5">
        {suggestions.map((s) => (
          <button
            key={s}
            className="text-[11px] px-2 py-1 rounded-full bg-[color:var(--bg)] border border-[color:var(--line)] text-[color:var(--muted)] hover:text-[color:var(--ink)]"
            onClick={() =>
              setInput((prev) => (prev ? prev.replace(/\s*$/, " ") + s : s))
            }
            type="button"
          >
            {s}
          </button>
        ))}
      </div>
      <div className="border-t border-[color:var(--line)] p-3 flex gap-2">
        <textarea
          className="input resize-none flex-1"
          rows={2}
          placeholder={`Ask ${agent.name}…`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          disabled={busy}
        />
        <button
          className="btn btn-primary self-end"
          onClick={send}
          disabled={busy || !input.trim()}
        >
          {busy ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}

function greetingFor(agent: AgentDef, clientName: string): string {
  switch (agent.id) {
    case "molly":
      return `Molly here. I run ${clientName}'s Meta side — every CPA, every frequency reading. Ask me about ad performance, what to kill, what to scale, and I'll tell you straight.`;
    case "geo":
      return `Geo. I'm on the Google Ads beat. Ask me about RSA performance, search terms, or whether to expand to Performance Max.`;
    case "river":
      return `River. I run organic for ${clientName}. The post calendar, the angles, the hashtag discipline. Ask me what to ship next.`;
    case "lex":
      return `Lex. I write the reports. Ask me to summarize the week for ${clientName} (client mode) or the morning brief (PM mode).`;
    case "atlas":
    default:
      return `Atlas, head of strategy on ${clientName}. I see across Meta, Google, and organic. Ask me about the game plan, budget mix, or anything that crosses channels.`;
  }
}
