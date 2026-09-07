// A minimal Chrome DevTools Protocol client — the browser seam.
//
// Zero dependencies. Node 24 ships a global `WebSocket`, and CDP is a JSON
// request/response protocol over one, so a browser driver is a few dozen lines
// rather than a dependency. Three gates are built on it — `layout-audit`,
// `contrast-audit` and `render-digest` — and none of them needs anything more
// than navigate, resize, read and screenshot.
//
// It drives a browser that is ALREADY ON THE MACHINE and downloads none. That
// is the trade: one fewer install step and no browser binary in a lockfile,
// against a CI runner that must ship Chrome (`ubuntu-latest` does, and the
// workflow checks for it out loud). `CHROME_PATH` names one anywhere else.
//
// It never writes to a page, submits a form, or follows a link that changes
// state. `scripts/browser-tests` is where interaction lives, and that layer
// uses Playwright because operating a control is a different job from
// measuring a page at rest.

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** Where Chrome lives, in the order we are willing to accept it. */
const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

/** The first Chrome-family binary present, or `undefined`. */
export function findChrome(): string | undefined {
  const configured = process.env.CHROME_PATH;
  if (configured !== undefined && configured !== "" && existsSync(configured))
    return configured;
  return CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
}

export type Browser = {
  /** A fresh page, with its own CDP session. */
  readonly page: () => Promise<Page>;
  readonly close: () => Promise<void>;
};

export type Page = {
  readonly send: (
    method: string,
    params?: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  readonly close: () => Promise<void>;
};

type Pending = {
  readonly resolve: (value: Record<string, unknown>) => void;
  readonly reject: (reason: Error) => void;
};

/**
 * How long to wait for Chrome to print its endpoint.
 *
 * A start-up wait, not a poll of a condition that might never become true —
 * the `exit` handler already covers a Chrome that refuses. Sixty seconds
 * because a cold Chrome on a contended CI runner is much slower than a cold
 * Chrome on a laptop, and the original project's first failure here was
 * exactly that: alive, and thirty seconds was not enough.
 */
const TIMEOUT_MS = 60_000;

/**
 * Launch headless Chrome and connect to it.
 *
 * `--force-device-scale-factor=1` and `--hide-scrollbars` are not cosmetic:
 * they are what makes two observations comparable. A scrollbar present on one
 * run and not the other shifts every horizontal measurement by its width, and
 * a device scale factor inherited from the host makes screenshot dimensions
 * machine-specific.
 */
export async function launch(): Promise<Browser> {
  const binary = findChrome();
  if (binary === undefined)
    throw new Error(
      "No Chrome-family browser found. Install Google Chrome or Chromium, or " +
        "set CHROME_PATH to one. This tool deliberately downloads no browser " +
        "— see the header of scripts/lib/cdp.ts.",
    );

  const profile = mkdtempSync(path.join(tmpdir(), "kit-cdp-"));
  const child: ChildProcess = spawn(
    binary,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-sync",
      "--mute-audio",
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );

  const endpoint = await readEndpoint(child);
  const socket = await connect(endpoint);

  let nextId = 1;
  const pending = new Map<number, Pending>();

  socket.addEventListener("message", (event: MessageEvent) => {
    let message: {
      id?: number;
      error?: { message?: string };
      result?: Record<string, unknown>;
    };
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (typeof message.id !== "number") return; // an event, not a reply
    const waiter = pending.get(message.id);
    if (waiter === undefined) return;
    pending.delete(message.id);
    if (message.error)
      waiter.reject(new Error(message.error.message ?? "CDP error"));
    else waiter.resolve(message.result ?? {});
  });

  const send = (
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<Record<string, unknown>> => {
    const id = nextId++;
    const payload: Record<string, unknown> = { id, method, params };
    if (sessionId !== undefined) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify(payload));
    });
  };

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    try {
      await send("Browser.close");
    } catch {
      // A browser that has already gone is the state we wanted.
    }
    try {
      socket.close();
    } catch {
      /* already closed */
    }
    child.kill("SIGTERM");
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      /* a leftover temp profile is not worth failing a run over */
    }
  };

  return {
    async page(): Promise<Page> {
      const created = await send("Target.createTarget", { url: "about:blank" });
      const targetId = String(created.targetId);
      const attached = await send("Target.attachToTarget", {
        targetId,
        flatten: true,
      });
      const sessionId = String(attached.sessionId);
      return {
        send: (method, params = {}) => send(method, params, sessionId),
        close: async () => {
          try {
            await send("Target.closeTarget", { targetId });
          } catch {
            /* the target may already be gone */
          }
        },
      };
    },
    close,
  };
}

/**
 * Chrome prints its websocket endpoint on stderr; wait for that line.
 *
 * Two failures, and they mean different things. Chrome EXITING is a refusal —
 * a missing sandbox, a bad flag — and it happens in under a second. A TIMEOUT
 * means the process is alive and has not printed the line, which on a loaded
 * runner is a cold start rather than a refusal.
 *
 * Whatever it did say goes into the error. An instrument that cannot say why
 * it failed costs the next reader the whole diagnosis again.
 */
function readEndpoint(child: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const said = (): string =>
      buffer.trim() === ""
        ? "it printed nothing at all"
        : `it printed: ${buffer.trim().split("\n").slice(-5).join(" / ").slice(0, 500)}`;
    const timer = setTimeout(() => {
      reject(
        new Error(
          `Chrome did not report a DevTools endpoint in ${TIMEOUT_MS / 1000}s ` +
            `and is still running — ${said()}`,
        ),
      );
    }, TIMEOUT_MS);
    child.stderr?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const match = /ws:\/\/[^\s]+/.exec(buffer);
      if (match !== null) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(
        new Error(`Chrome exited before connecting (code ${code}) — ${said()}`),
      );
    });
  });
}

function connect(endpoint: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(endpoint);
    socket.addEventListener("open", () => resolve(socket), { once: true });
    socket.addEventListener(
      "error",
      () => reject(new Error(`Could not connect to ${endpoint}`)),
      { once: true },
    );
  });
}

/** Resolve after `ms`. Used for settle waits, never for polling a condition. */
export const settle = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
