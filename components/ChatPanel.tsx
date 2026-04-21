"use client";

import { useEffect, useRef, useState } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export default function ChatPanel({
  clientId,
  clientName,
}: {
  clientId: string;
  clientName: string;
}) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: `I've got ${clientName}'s account loaded — the analysis, the ads, the metrics. Ask me anything. "Is ad 3 worth keeping?" works. "Explain my CPA like I'm tired" also works.`,
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  async function send() {
    if (!input.trim() || busy) return;
    const userMsg: Message = { role: "user", content: input.trim() };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setBusy(true);

    // Optimistically append an empty assistant message we stream into.
    let current = "";
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          messages: nextMessages,
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

  return (
    <div className="card h-full flex flex-col">
      <div className="px-4 py-3 border-b border-[color:var(--line)] flex items-center justify-between">
        <div>
          <div className="font-display font-semibold">Chat with Adwise</div>
          <div className="text-xs text-[color:var(--muted)]">Knows this account</div>
        </div>
        <span className="pill pill-green">online</span>
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
            {m.content || (busy && i === messages.length - 1 ? "…" : "")}
          </div>
        ))}
      </div>
      <div className="border-t border-[color:var(--line)] p-3 flex gap-2">
        <textarea
          className="input resize-none flex-1"
          rows={2}
          placeholder="Ask away. Plain English is fine."
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
