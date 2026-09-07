// The only module in this kit that touches the source site.
//
// **It reads. It never writes.** GET only, same origin only, one request at a
// time, a configured delay between every one, and no retry. Nothing here can
// change the site being migrated, and that is not a convention — there is no
// code path that sends any other method.
//
// ## Why the pacing is not a preference
//
// A managed WordPress host's firewall watches request rate. In the migration
// this kit came from, a burst of REST requests got `wp-json` blocked for the
// better part of two hours **while ordinary pages kept answering 200**. An
// inventory captured in that window is not empty and does not error: it is
// FALSE, and it looks exactly like a smaller site.
//
// Two consequences are built in here:
//
//   1. **Every loop waits.** `crawl.delayMs` between page requests,
//      `crawl.mediaDelayMs` between the tighter REST loops the capture tools
//      use. Both come from `migration.config.ts`.
//   2. **A failure is not retried to get past a refusal.** Retrying into a
//      rate limit deepens it and turns a recoverable pause into a longer
//      block. A non-200 is RECORDED with its status and the run continues; if
//      a whole family comes back 403, that is a finding for a person, not
//      something to hammer at.
//
// ## The one place a retry IS correct, and why
//
// The rule above is about DISCOVERY, where a failure becomes a recorded status
// and the integrity guard refuses to report over a truncated capture.
//
// A CAPTURE that writes content is different, and getting this wrong is
// measurable. In one run, 278 back-to-back media requests had 80 refused, and
// the `catch` around each one turned that into 80 posts quietly losing their
// featured image. A transient network condition had rewritten somebody's
// content, and nothing said so.
//
// So `getRetrying` exists for exactly that case: a bounded retry with backoff,
// used where NOT retrying would silently change what gets written. It is not a
// fix for a genuine 404 — a missing attachment still ends up absent, which is
// correct — it is what keeps a rate limiter from being recorded as an
// editorial fact.
//
// ## Why it identifies itself
//
// `crawl.userAgent` goes on every request, and the kit ships it saying to set
// it. An operator reading their access log deserves to know who this is and
// how to reach whoever ran it. A crawler that pretends to be a browser is one
// nobody can ask to stop.
import { migration } from "../../migration.config.ts";

export interface FetchSettings {
  readonly userAgent: string;
  readonly delayMs: number;
  readonly timeoutMs: number;
}

export const DEFAULT_TIMEOUT_MS = 20_000;

/** The settings from `migration.config.ts`, with a timeout the config omits. */
export function settingsFromConfig(
  overrides: Partial<FetchSettings> = {},
): FetchSettings {
  return {
    userAgent: migration.crawl.userAgent,
    delayMs: migration.crawl.delayMs,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    ...overrides,
  };
}

/**
 * The origin of the site being migrated.
 *
 * Throws when it is not configured. Every tool that reaches the network calls
 * this first, so "which site am I about to crawl" is answered before a single
 * request goes out — rather than a tool quietly crawling `undefined` or, worse,
 * defaulting to something.
 */
export function requireLiveOrigin(): string {
  const origin = migration.liveOrigin;
  if (origin === undefined || origin.trim() === "")
    throw new Error(
      "migration.config.ts has no `liveOrigin`, so there is no site to read.\n" +
        "Set it — `pnpm kit:init --live-origin https://example.com` writes it — " +
        "before running any capture or crawl.",
    );
  return origin.replace(/\/+$/, "");
}

/** True when the user agent is still the placeholder the kit ships. */
export const isPlaceholderUserAgent = (userAgent: string): boolean =>
  userAgent.includes("set crawl.userAgent");

/** One response, recorded rather than thrown. */
export interface Fetched {
  readonly url: string;
  /** The HTTP status, or `0` when the request never completed. */
  readonly status: number;
  /** The `location` header on a 3xx, verbatim and unfollowed. */
  readonly location?: string;
  readonly contentType?: string;
  /** The body, for the text types this audit reads. */
  readonly body?: string;
  /** Why the request produced no status: a timeout, DNS, a reset connection. */
  readonly error?: string;
  /**
   * Every response header, lowercased.
   *
   * Kept whole rather than picked, because WordPress answers a collection with
   * `x-wp-total` and `x-wp-totalpages` and a reader that did not carry them
   * would have to guess when a listing ended — which is how a capture silently
   * stops at page one.
   */
  readonly headers: Readonly<Record<string, string>>;
}

const TEXTUAL = /^(text\/|application\/(json|xml|xhtml))/i;

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A paced, read-only GET client over one origin.
 *
 * Sequential by construction: `get` awaits the previous call's delay before
 * issuing the next request, so no caller can accidentally parallelise it by
 * mapping over an array with `Promise.all`.
 */
export class PoliteReader {
  readonly #settings: FetchSettings;
  #nextAllowedAt = 0;
  #requests = 0;

  constructor(settings: FetchSettings = settingsFromConfig()) {
    this.#settings = settings;
  }

  /** How many requests this reader has made. Reported at the end of a run. */
  get requests(): number {
    return this.#requests;
  }

  async #wait(): Promise<void> {
    const now = Date.now();
    if (now < this.#nextAllowedAt) await sleep(this.#nextAllowedAt - now);
    this.#nextAllowedAt = Date.now() + this.#settings.delayMs;
  }

  /**
   * GET one URL. Redirects are NOT followed: a 3xx is an alias, which is a
   * finding, and following it silently would record the destination as though
   * the source had served it.
   */
  async get(url: string): Promise<Fetched> {
    await this.#wait();
    this.#requests += 1;

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.#settings.timeoutMs,
    );
    try {
      const response = await fetch(url, {
        method: "GET",
        redirect: "manual",
        headers: {
          "user-agent": this.#settings.userAgent,
          accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        signal: controller.signal,
      });
      const headers: Record<string, string> = {};
      response.headers.forEach((headerValue, name) => {
        headers[name.toLowerCase()] = headerValue;
      });
      const contentType = response.headers.get("content-type") ?? undefined;
      const location = response.headers.get("location") ?? undefined;
      const body =
        contentType !== undefined && TEXTUAL.test(contentType)
          ? await response.text()
          : undefined;
      return {
        url,
        status: response.status,
        headers,
        ...(location === undefined ? {} : { location }),
        ...(contentType === undefined ? {} : { contentType }),
        ...(body === undefined ? {} : { body }),
      };
    } catch (cause) {
      // Recorded, never retried. See the header.
      return {
        url,
        status: 0,
        headers: {},
        error:
          (cause as Error).name === "AbortError"
            ? `no response in ${this.#settings.timeoutMs / 1000}s`
            : (cause as Error).message,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * GET with a bounded retry, for a request whose FAILURE would silently
   * change what gets written.
   *
   * Use it for the loops a capture runs hundreds of times — resolving media,
   * resolving a term — and nowhere else. See the header for the measurement
   * that separates this from the no-retry rule: 80 refused media requests
   * became 80 posts quietly losing their featured image.
   *
   * A 404 is returned as a 404 on the first attempt and never retried: a
   * missing attachment is a fact about the site, and hammering it would turn a
   * correct answer into four requests.
   */
  async getRetrying(url: string, attempts = 4): Promise<Fetched> {
    let last: Fetched | undefined;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const response = await this.get(url);
      if (response.status >= 200 && response.status < 500) return response;
      last = response;
      // Backoff, on top of the pacing every request already waits for. A
      // refusal means the server is asking for less, so asking again sooner
      // is the one thing that cannot help.
      if (attempt < attempts) await sleep(attempt * 750);
    }
    return last!;
  }
}
