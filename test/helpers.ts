import { vi } from "vitest";

export interface MockCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

type Reply =
  | { status?: number; json?: unknown; text?: string }
  | ((call: MockCall) => { status?: number; json?: unknown; text?: string });

/**
 * Stub the global fetch. Replies are used in order; the last one repeats.
 * Returns the recorded calls.
 */
export function mockFetch(...replies: Reply[]) {
  const calls: MockCall[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: MockCall = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
    };
    calls.push(call);
    const r = replies[Math.min(calls.length - 1, replies.length - 1)] ?? {};
    const reply = typeof r === "function" ? r(call) : r;
    const body = reply.text ?? JSON.stringify(reply.json ?? { success: true });
    return new Response(body, {
      status: reply.status ?? 200,
      headers: { "Content-Type": reply.text ? "text/html" : "application/json" },
    });
  });
  vi.stubGlobal("fetch", fn);
  return { calls, fn };
}

/** A fetch that never answers until aborted. */
export function hangingFetch() {
  const fn = vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("The operation was aborted");
          err.name = "AbortError";
          reject(err);
        });
      })
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}
