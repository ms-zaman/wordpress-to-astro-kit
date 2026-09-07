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

const PORT = 4321;
const ROOT = "apps/website/dist";

const server = await serveStatic(ROOT, PORT);
process.stdout.write(`Serving ${ROOT} on ${server.origin}\n`);

// Stay in the foreground until Playwright is done. `SIGTERM` is what it sends.
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    void server.close().then(() => process.exit(0));
  });
