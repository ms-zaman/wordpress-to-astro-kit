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
  webServer: {
    command: "node scripts/browser-tests/serve.ts",
    url: "http://127.0.0.1:4321/",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },

  use: {
    baseURL: "http://127.0.0.1:4321",
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
