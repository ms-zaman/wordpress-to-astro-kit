// A static file server for the built site.
//
// Every browser gate must observe the same bytes `pnpm build` produced. A dev
// server would inject its own client runtime, which would make the "this site
// ships no client JavaScript" measurement a statement about the dev server
// rather than about the site. So the target is `dist/` served flat, over HTTP,
// on the loopback interface only.

import { createReadStream, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import path from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

export type StaticServer = {
  readonly origin: string;
  readonly close: () => Promise<void>;
};

/**
 * Serve `root` on a loopback port.
 *
 * `port: 0` — the default — binds an ephemeral one, which is what the audits
 * want: several may run in one CI job and a fixed port would collide. The
 * browser-test server passes a fixed one, because Playwright's `webServer`
 * has to be told a URL in advance.
 */
export function serveStatic(root: string, port = 0): Promise<StaticServer> {
  const base = path.resolve(root);

  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    // Decode first, resolve second: the join must happen on the real path so
    // the containment check below cannot be walked past with an escape.
    let target: string;
    try {
      target = path.resolve(base, "." + decodeURIComponent(url.pathname));
    } catch {
      response.writeHead(400).end("Bad request");
      return;
    }
    if (target !== base && !target.startsWith(base + path.sep)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    try {
      if (statSync(target).isDirectory())
        target = path.join(target, "index.html");
    } catch {
      response.writeHead(404).end("Not found");
      return;
    }
    let info;
    try {
      info = statSync(target);
    } catch {
      response.writeHead(404).end("Not found");
      return;
    }
    response.writeHead(200, {
      "content-type":
        TYPES[path.extname(target).toLowerCase()] ?? "application/octet-stream",
      "content-length": info.size,
      "cache-control": "no-store",
    });
    createReadStream(target).pipe(response);
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("The static server did not report a port."));
        return;
      }
      resolve({
        origin: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}
