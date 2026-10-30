/**
 * The release check's debug-port half: a page of the installed window, reached through WebView2's remote debugging port
 * with Node's own WebSocket. Nothing here knows Incudo; `drive.ts` says what to run in the page.
 */

export interface Target {
  id: string;
  type: string;
  url: string;
  webSocketDebuggerUrl: string;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The debug port's targets, or `[]` while it is not answering yet. */
export async function targets(port: number): Promise<Target[]> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    return (await response.json()) as Target[];
  } catch {
    return [];
  }
}

/** Waits for a target the predicate accepts, up to `timeout` milliseconds. */
export async function waitForTarget(port: number, accept: (target: Target) => boolean, timeout = 30_000): Promise<Target> {
  const until = Date.now() + timeout;
  for (;;) {
    const found = (await targets(port)).find(accept);
    if (found) return found;
    if (Date.now() > until) throw new Error(`no debug target appeared on port ${port} in ${timeout / 1000} s`);
    await sleep(250);
  }
}

/** One page, evaluated in over a WebSocket. */
export class Page {
  private readonly socket: WebSocket;
  private next = 0;
  private readonly pending = new Map<number, (message: { result?: unknown; error?: { message: string } }) => void>();

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message: string } };
      if (message.id === undefined) return;
      const resolve = this.pending.get(message.id);
      this.pending.delete(message.id);
      resolve?.(message);
    });
  }

  static async open(target: Target): Promise<Page> {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve());
      socket.addEventListener('error', () => reject(new Error(`could not connect to ${target.url}`)));
    });
    return new Page(socket);
  }

  /** Sends one protocol command and waits for its answer, up to `timeout` milliseconds. */
  send(method: string, params: Record<string, unknown> = {}, timeout = 60_000): Promise<unknown> {
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} had no answer in ${timeout / 1000} s`));
      }, timeout);
      this.pending.set(id, (message) => {
        clearTimeout(timer);
        if (message.error) reject(new Error(`${method}: ${message.error.message}`));
        else resolve(message.result);
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  /**
   * Runs `body` as the body of an async function in the page and returns what it returns, as JSON. A thrown error in
   * the page is thrown here with its message.
   */
  async run<T>(body: string, timeout = 60_000): Promise<T> {
    const answer = (await this.send(
      'Runtime.evaluate',
      { expression: `(async () => { ${body}\n})()`, awaitPromise: true, returnByValue: true },
      timeout,
    )) as { result: { value?: unknown }; exceptionDetails?: { exception?: { description?: string }; text?: string } };
    if (answer.exceptionDetails) {
      throw new Error(`in the page: ${answer.exceptionDetails.exception?.description ?? answer.exceptionDetails.text}`);
    }
    return answer.result.value as T;
  }

  close(): void {
    this.socket.close();
  }
}
