// Playwright — the interaction layer.
//
// ## What this is FOR, and what it is not
//
// Every other gate in this kit reads a page that is already finished: the
// build audit reads `dist/`, the accessibility, layout and contrast audits
// load a page and measure it at rest, `render-digest` records what it looks
// like. **None of them ever clicks anything.**
//
// So a menu that will not open, a menu that will not close again, and a link
// that goes nowhere have no automated coverage at all — and in the project
// this kit came from, every defect any of those ever had was found by a person
// clicking, never by a gate.
//
// That is the gap this fills. It is deliberately NOT a replacement for the
// existing tools: `scripts/lib/cdp.ts` and the three audits built on it stay
// exactly as they are. Replacing a working, zero-dependency measurement layer
// would spend a large refactor to arrive back where it started, and the thing
// that was missing was never the driver.
//
// **It also does not claim to catch what a person catches.** A test finds a
// behaviour that broke; it does not find a page that was badly designed from
// its first render, and no assertion here would notice a sentence that
// describes the build rather than the site. Said plainly because a green gate
// people believe covers more than it does is worse than no gate. PLAYBOOK.md
// §7 step 5 is the walk, and nothing here replaces it.
//
// ## The one dependency
//
// `@playwright/test` is the only runtime tool this kit takes on beyond Astro,
// TypeScript and the linters. Chromium only: cross-browser is a real thing
// this could buy, and it costs three browser downloads on every CI run for a
// site that has no browser-specific code and ships no framework runtime. It is
// one line here when somebody wants it.
import { defineConfig, devices } from "@playwright/test";

/**
 * Where the suite's own server answers.
 *
 * `serve.ts` reads the same variable, so the two copies of the port cannot
 * drift. Overridable because 4321 is somebody else's dev server on any machine
 * running more than one project.
 */
const PORT = process.env.WPK_TEST_PORT ?? "4321";
const ORIGIN = `http://127.0.0.1:${PORT}`;

/** The two widths every other tool in this kit measures at. */
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 375, height: 812 };

export default defineConfig({
  testDir: "./scripts/browser-tests",

  // No `.only` reaches CI, and no retry hides a flake. A retry would have
  // hidden the one flaky gate in this lineage — a digest whose image settle
  // was too short once posts carried remote media — and the cost of that was
  // that every real diff afterwards read as noise.
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: process.env.CI ? 2 : undefined,

  // The build is static, so the server just serves `dist/`. It is NOT rebuilt
  // here: CI builds once and every gate reads that same output, which is what
  // makes them describe one artifact rather than five.
  //
  // `reuseExistingServer` is FALSE everywhere, including locally, and that is
  // a correctness rule rather than a preference. Playwright's default is to
  // adopt whatever already answers on the port — which means an unrelated dev
  // server left running on 4321 becomes the thing under test. Measured: a
  // sibling project's `astro dev` held the port and this suite ran sixteen
  // assertions against somebody else's site, reporting them as this kit's
  // failures. The dangerous half is the other one: a page that happens to
  // satisfy the selectors would have reported GREEN for a build the run never
  // loaded, and safe and honest are different properties.
  //
  // With this false, a busy port is a loud startup error naming the port,
  // which is a thirty-second fix instead of an hour of reading tracebacks.
  webServer: {
    command: "node scripts/browser-tests/serve.ts",
    url: `${ORIGIN}/`,
    reuseExistingServer: false,
    timeout: 120_000,
  },

  use: {
    baseURL: ORIGIN,
    // A trace on the first failure, because what this layer tests is a
    // SEQUENCE — "the menu opened, then it would not close" is unreadable from
    // an assertion message and obvious from a trace.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: DESKTOP },
    },
    {
      name: "phone",
      use: { ...devices["Desktop Chrome"], viewport: PHONE, isMobile: false },
      // `isMobile: false` deliberately: this project exists to test the 375px
      // LAYOUT, and Playwright's mobile emulation also turns on touch and a
      // device scale factor, which would make these results incomparable with
      // `layout-audit` and `render-digest` — both of which measure 375 with a
      // scale factor of 1 and no touch.
    },
  ],

  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
});
