// kit-init suite: plan against a COPY of the repository, apply, and assert
// that nothing carries the old prefix, that the identity landed where it
// lives, and that a second run reads the new prefix as the current one.
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyInit,
  currentPrefix,
  planInit,
  remainingOccurrences,
  renameText,
  validateName,
} from "../init.ts";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

let passed = 0;
const failures: string[] = [];
const check = (label: string, ok: boolean, detail = ""): void => {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
};

console.log("\nrenameText");
check(
  "renames a class prefix",
  renameText('class="wpk-button"', "wpk", "acme") === 'class="acme-button"',
);
check(
  "renames a data attribute",
  renameText("data-wpk-form", "wpk", "acme") === "data-acme-form",
);
check(
  "renames a build variable",
  renameText("WPK_SITE_ENV", "wpk", "acme") === "ACME_SITE_ENV",
);
check(
  "renames a package scope",
  renameText('"@wpk/ui": "workspace:*"', "wpk", "acme") ===
    '"@acme/ui": "workspace:*"',
);
check(
  "leaves a word that merely contains the prefix",
  renameText("awpk-x network-", "wpk", "acme") === "awpk-x network-",
);
check(
  "validateName rejects an uppercase prefix",
  validateName("Acme") !== undefined,
);
check(
  "validateName accepts a short lowercase prefix",
  validateName("acme") === undefined,
);

console.log("\nA copy of the repository, initialised");
const copy = mkdtempSync(path.join(tmpdir(), "kit-init-"));
try {
  cpSync(root, copy, {
    recursive: true,
    filter: (source) => {
      const name = path.basename(source);
      return ![
        "node_modules",
        ".git",
        "dist",
        ".astro",
        "test-results",
        "playwright-report",
      ].includes(name);
    },
  });
  const before = currentPrefix(copy);
  const plan = planInit(copy, {
    name: "acme",
    siteName: "Acme Corp",
    origin: "https://acme.example/",
    liveOrigin: "https://old.acme.example",
  });
  check(
    "the plan changes files",
    plan.changes.length > 20,
    `${plan.changes.length} change(s)`,
  );
  check(
    "the plan carries no warnings",
    plan.warnings.length === 0,
    plan.warnings.join("; "),
  );
  applyInit(plan);

  const remaining = remainingOccurrences(copy, before);
  check(
    `no file still carries "${before}"`,
    remaining.length === 0,
    remaining.slice(0, 10).join(", "),
  );
  check(
    "the root package.json records the new prefix",
    currentPrefix(copy) === "acme",
  );
  const site = JSON.parse(
    readFileSync(path.join(copy, "content/config/site.json"), "utf8"),
  ) as { name: string; origin: string };
  check(
    "site.json carries the name and origin",
    site.name === "Acme Corp" && site.origin === "https://acme.example",
  );
  const config = readFileSync(path.join(copy, "migration.config.ts"), "utf8");
  check(
    "migration.config.ts carries the live origin",
    /liveOrigin: "https:\/\/old\.acme\.example",/.test(config),
  );
  const header = readFileSync(
    path.join(copy, "apps/website/src/components/layout/SiteHeader.astro"),
    "utf8",
  );
  check(
    "a component carries the new class prefix",
    header.includes("acme-site-header") && !header.includes("wpk-"),
  );
  const env = readFileSync(
    path.join(copy, "apps/website/src/deployment/site-environment.ts"),
    "utf8",
  );
  check(
    "the launch switch carries the new variable",
    env.includes('"ACME_SITE_ENV"'),
  );
  const website = JSON.parse(
    readFileSync(path.join(copy, "apps/website/package.json"), "utf8"),
  ) as { name: string; dependencies: Record<string, string> };
  check(
    "the workspace packages are re-scoped",
    website.name === "@acme/website" && "@acme/ui" in website.dependencies,
  );
  check(
    "the lockfile is re-scoped too",
    existsSync(path.join(copy, "pnpm-lock.yaml")) &&
      !readFileSync(path.join(copy, "pnpm-lock.yaml"), "utf8").includes(
        "@wpk/",
      ),
  );

  const again = planInit(copy, { name: "beta" });
  check(
    "a second run reads the new prefix as current",
    again.currentPrefix === "acme" && again.changes.length > 20,
  );
} finally {
  rmSync(copy, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("\nkit-init suite FAILED:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("kit-init suite OK\n");
