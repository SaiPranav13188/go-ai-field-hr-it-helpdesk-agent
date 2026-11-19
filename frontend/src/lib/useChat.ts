"use client";

import { useCallback, useRef, useState } from "react";
import { ApiError, streamChat } from "./api";
import type { ChatMessage, FinalPayload, RetrievalEvent, StageEvent, ToolEvent, Trace } from "./types";

const uid = () => Math.random().toString(36).slice(2, 10);

export function useChat(token: string | null, onAuthError: () => void) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const convId = useRef(uid() + uid());
  const abortRef = useRef<AbortController | null>(null);

  const patchTrace = (id: string, fn: (t: Trace) => Trace) =>
    setMessages((ms) => ms.map((m) => (m.id === id && m.role === "assistant" ? { ...m, trace: fn(m.trace) } : m)));

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || busy || !token) return;
      const userMsg: ChatMessage = { id: uid(), role: "user", content, at: Date.now() };
      const aid = uid();
      const asst: ChatMessage = { id: aid, role: "assistant", at: Date.now(), pending: true, trace: { stages: [], tools: [] } };
      const history = messages
        .slice(-8)
        .map((m) => (m.role === "user" ? { role: "user", content: m.content } : m.final ? { role: "assistant", content: m.final.answer.slice(0, 800) } : null))
        .filter(Boolean) as { role: string; content: string }[];
      setMessages((ms) => [...ms, userMsg, asst]);
      setSelectedId(aid);
      setBusy(true);
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        await streamChat(
          { message: content, conversation_id: convId.current, history },
          token,
          (event, data) => {
            if (event === "stage") patchTrace(aid, (t) => ({ ...t, stages: [...t.stages, data as StageEvent] }));
            else if (event === "retrieval") {
              const r = data as RetrievalEvent;
              patchTrace(aid, (t) => (r.stage === "first_stage" ? { ...t, firstStage: r } : { ...t, rerank: r }));
            } else if (event === "tool") patchTrace(aid, (t) => ({ ...t, tools: [...t.tools, data as ToolEvent] }));
            else if (event === "final")
              setMessages((ms) => ms.map((m) => (m.id === aid && m.role === "assistant" ? { ...m, pending: false, final: data as FinalPayload } : m)));
            else if (event === "error")
              setMessages((ms) => ms.map((m) => (m.id === aid && m.role === "assistant" ? { ...m, pending: false, error: (data as { message: string }).message } : m)));
          },
          ctrl.signal,
        );
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        if (e instanceof ApiError && e.status === 401) onAuthError();
        const msg = e instanceof ApiError ? e.message : "Couldn’t reach the helpdesk API. Check that the backend is running.";
        setMessages((ms) => ms.map((m) => (m.id === aid && m.role === "assistant" ? { ...m, pending: false, error: msg } : m)));
      } finally {
        setMessages((ms) => ms.map((m) => (m.id === aid && m.role === "assistant" && m.pending && !m.final ? { ...m, pending: false, error: m.error ?? "The response ended unexpectedly." } : m)));
        setBusy(false);
        abortRef.current = null;
      }
    },
    [busy, token, messages, onAuthError],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);
  const reset = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setSelectedId(null);
    convId.current = uid() + uid();
  }, []);

  return { messages, busy, send, stop, reset, selectedId, setSelectedId };
}
