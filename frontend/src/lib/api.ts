import type { DocFull, DocSummary, Identity, Session } from "./types";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.detail || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => json<{ status: string; components: Record<string, Record<string, unknown>> }>("/api/health"),
  identities: () => json<{ simulated: boolean; identities: Identity[] }>("/api/demo-identities"),
  login: (subject_id: string) => json<Session>("/api/auth/demo-login", { method: "POST", body: JSON.stringify({ subject_id }) }),
  documents: () => json<{ documents: DocSummary[] }>("/api/documents"),
  document: (id: string) => json<DocFull>(`/api/documents/${encodeURIComponent(id)}`),
  evaluation: () => json<Record<string, unknown> & { available: boolean }>("/api/evaluation"),
};

/** POST + Server-Sent Events over fetch (EventSource cannot send a body or auth header). */
export async function streamChat(
  body: { message: string; conversation_id: string; history: { role: string; content: string }[] },
  token: string,
  onEvent: (event: string, data: unknown) => void,
  signal?: AbortSignal,
) {
  const res = await fetch(`${API_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const detail = await res.json().catch(() => ({}));
    throw new ApiError(res.status, detail.detail || `Request failed (${res.status})`);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value.replace(/\r\n/g, "\n");
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      let event = "message";
      const data: string[] = [];
      for (const line of raw.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      if (!data.length) continue;
      try {
        onEvent(event, JSON.parse(data.join("\n")));
      } catch {
        /* ignore keep-alive / malformed frames */
      }
    }
  }
}

const KEY = "gaf.session";
const EVT = "gaf-session";
export const sessionStore = {
  /** Raw snapshot for useSyncExternalStore (a primitive, so referentially stable). */
  raw(): string | null {
    try {
      return sessionStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  subscribe(cb: () => void) {
    window.addEventListener(EVT, cb);
    window.addEventListener("storage", cb);
    return () => {
      window.removeEventListener(EVT, cb);
      window.removeEventListener("storage", cb);
    };
  },
  parse(raw: string | null): Session | null {
    if (!raw) return null;
    try {
      const s = JSON.parse(raw) as Session;
      return s.expires_at * 1000 > Date.now() ? s : null;
    } catch {
      return null;
    }
  },
  get(): Session | null {
    try {
      const raw = sessionStorage.getItem(KEY);
      if (!raw) return null;
      const s = JSON.parse(raw) as Session;
      return s.expires_at * 1000 > Date.now() ? s : null;
    } catch {
      return null;
    }
  },
  set(s: Session) {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(s));
    } catch {}
    window.dispatchEvent(new Event(EVT));
  },
  clear() {
    try {
      sessionStorage.removeItem(KEY);
    } catch {}
    window.dispatchEvent(new Event(EVT));
  },
};
