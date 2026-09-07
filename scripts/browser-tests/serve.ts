// The static server Playwright's `webServer` starts.
//
// Two reasons this file exists rather than pointing Playwright at
// `astro preview`:
//
//   1. **It serves `dist/` and nothing else.** A dev server injects its own
//      client runtime, which would make "this site loads no script" a
//      statement about the dev server rather than about the site. The build
//      audit and these tests then check different artifacts, and the one that
//      ships is the one nobody checked.
//   2. **A `webServer` command must stay in the foreground.** Playwright waits
//      for the URL to answer and kills the process afterwards; a command that
//      daemonises exits immediately and the run starts against nothing.
//
// The port is FIXED here and ephemeral everywhere else, because Playwright has
// to be told a URL before the server exists. That is the one place in this kit
// where a port is a constant, and `playwright.config.ts` holds the other copy.
import process from "node:process";

import { serveStatic } from "../lib/serve.ts";

// 4321 by default, overridable because a fixed port is somebody else's dev
// server on any machine that runs more than one project. `playwright.config.ts`
// reads the same variable, so the two copies cannot drift.
const PORT = Number(process.env.WPK_TEST_PORT ?? 4321);
const ROOT = "apps/website/dist";

// A busy port has to be fatal and legible. Playwright is configured never to
// adopt an existing server (see `playwright.config.ts`), so the only way this
// port is taken is that something else holds it — usually another project's
// dev server. Saying which port, and that the fix is to stop that process,
// turns an hour of unexplained red into a thirty-second fix.
let server;
try {
  server = await serveStatic(ROOT, PORT);
} catch (cause) {
  const error = cause as NodeJS.ErrnoException;
  if (error.code === "EADDRINUSE") {
    process.stderr.write(
      `\nPort ${PORT} is already in use, so the browser tests have nothing of\n` +
        `their own to run against. Something else is holding it — often another\n` +
        `project's dev server. Stop it, or find it with:\n\n` +
        `  lsof -ti:${PORT}\n\n` +
        `Or run this suite on another port:\n\n` +
        `  WPK_TEST_PORT=4322 pnpm test:browser\n\n` +
        `This is deliberately fatal. Testing whatever happens to answer on the\n` +
        `port would report a verdict about somebody else's site.\n\n`,
    );
    process.exit(1);
  }
  throw error;
}
process.stdout.write(`Serving ${ROOT} on ${server.origin}\n`);

// Stay in the foreground until Playwright is done. `SIGTERM` is what it sends.
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    void server.close().then(() => process.exit(0));
  });
