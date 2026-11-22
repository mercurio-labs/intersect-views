import type { HostClient } from "./session.ts";
/** Main-thread adapter; each language owns its Worker and isolated host state. */
export class WorkerHost implements HostClient {
  private next = 0;
  private closed = false;
  private presentationFingerprint?: string;
  private pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();
  private worker: Worker;
  constructor(worker: Worker) {
    this.worker = worker;
    worker.addEventListener("message", ({ data }) => {
      const p = this.pending.get(data.id);
      if (!p) return;
      this.pending.delete(data.id);
      if (data.error) p.reject(new Error(data.error));
      else p.resolve(data.result);
    });
    worker.addEventListener("error", (event:ErrorEvent) =>
      this.fail(new Error(`Language host worker failed${event.message ? `: ${event.message}` : ""}`)),
    );
  }
  async request<T = unknown>(method: string, params: unknown): Promise<T> {
    if (this.closed)
      return Promise.reject(new Error("Language host is closed"));
    if (this.next >= Number.MAX_SAFE_INTEGER)
      return Promise.reject(new Error("Host request identity exhausted"));
    const fingerprint = this.presentationFingerprint;
    const checked = fingerprint !== undefined && method.startsWith("views/") && method !== "views/preparePresentation";
    if (checked) params = { ...(params as Record<string, unknown>), presentationFingerprint: fingerprint };
    const result = await new Promise<unknown>((resolve, reject) => {
      const id = ++this.next;
      this.pending.set(id, { resolve, reject });
      try {
        this.worker.postMessage({ id, method, params });
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
    if (this.closed) throw Error("Language host is closed");
    if (checked) {
      const response = result as Record<string, any>;
      if ((method === "views/scene" ? response.presentation?.fingerprint : response.presentationFingerprint) !== fingerprint)
        throw Error("Stale presentation response");
      if (method !== "views/scene") delete response.presentationFingerprint;
    }
    if (method === "views/preparePresentation") {
      const fingerprint = (result as { presentation?: { fingerprint?: unknown } }).presentation?.fingerprint;
      if (typeof fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(fingerprint)) throw Error("Invalid prepared presentation fingerprint");
      this.presentationFingerprint = fingerprint;
    }
    return result as T;
  }
  private fail(error: Error) {
    this.closed = true;
    for (const p of this.pending.values()) p.reject(error);
    this.pending.clear();
  }
  destroy() {
    this.worker.terminate();
    this.fail(new Error("Language host is closed"));
  }
}
