// The SEO audit, composed.
//
// One function over a build output. It runs the seven checks and reports
// counts alongside the findings, because a run that prints only "OK" tells an
// operator nothing about whether it read nineteen pages or none.
//
// It also reports the ORIGIN STATE, prominently, because half of what this
// audit asserts depends on it: with no production host decided, "no canonical
// anywhere" is the correct answer and this audit is checking that nothing
// invented one. A reader who does not know that would read a clean run as
// "our canonicals are fine".
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { SiteEnvironment } from "../../apps/website/src/deployment/site-environment.ts";
import { siteOrigin } from "../../apps/website/src/rendering/site-identity.ts";
import {
  isReviewOnly,
  readPages,
  type Page,
} from "../accessibility-audit/pages.ts";
import { pageFamilies } from "../lib/manifest.ts";
import { sortFindings, type Finding } from "./finding.ts";
import {
  canonicalsOf,
  checkCanonical,
  checkDescription,
  checkHead,
  checkRobots,
  checkSocial,
  checkStructuredData,
  checkTitle,
  structuredDataOf,
} from "./rules.ts";

export interface AuditCounts {
  readonly pages: number;
  readonly productionPages: number;
  readonly reviewPages: number;
  readonly titles: number;
  readonly descriptions: number;
  readonly canonicals: number;
  readonly structuredDataBlocks: number;
}

export interface AuditResult {
  readonly root: string;
  /** The production origin, or `undefined` while none is decided. */
  readonly origin: string | undefined;
  readonly environment: SiteEnvironment;
  readonly findings: readonly Finding[];
  readonly counts: AuditCounts;
  /** True when nothing at `error` severity was found. */
  readonly ok: boolean;
}

export interface AuditOptions {
  /**
   * Which build this is — decides the robots contract. Defaults to what
   * `dist/deployment.json` recorded, and to `preview` when there is none.
   */
  readonly environment?: SiteEnvironment;
  /**
   * The production origin to audit against. Defaults to the project's one
   * origin seam.
   *
   * A parameter for the reason `checkCanonical`'s own header gives: whichever
   * of its two halves is not the current state would never execute, and would
   * rot unnoticed until the day it mattered. The suite runs both.
   */
  readonly origin?: string;
}

function countOf(pages: readonly Page[]): AuditCounts {
  let titles = 0;
  let descriptions = 0;
  let canonicals = 0;
  let structuredDataBlocks = 0;
  for (const page of pages) {
    if (/<title>/.test(page.html)) titles += 1;
    if (/<meta\b[^>]*name="description"/.test(page.html)) descriptions += 1;
    canonicals += canonicalsOf(page.html).length;
    structuredDataBlocks += structuredDataOf(page.html).length;
  }
  return {
    pages: pages.length,
    productionPages: pages.filter((page) => !isReviewOnly(page.file)).length,
    reviewPages: pages.filter((page) => isReviewOnly(page.file)).length,
    titles,
    descriptions,
    canonicals,
    structuredDataBlocks,
  };
}

/** The environment `dist/deployment.json` recorded, or `preview` without one. */
export function readEnvironment(root: string): SiteEnvironment {
  const file = path.join(root, "deployment.json");
  if (!existsSync(file)) return "preview";
  try {
    const manifest = JSON.parse(readFileSync(file, "utf8")) as {
      build?: { environment?: string };
    };
    return manifest.build?.environment === "production"
      ? "production"
      : "preview";
  } catch {
    return "preview";
  }
}

/** Audit a build output. Throws only when there is nothing to audit. */
export function auditSeo(
  root: string,
  options: AuditOptions = {},
): AuditResult {
  const pages = readPages(root);
  // `in`, not `??`. See `checkCanonical`: a default parameter cannot express
  // "explicitly no origin", so the caller states which it means.
  const origin = "origin" in options ? options.origin : siteOrigin();
  const environment = options.environment ?? readEnvironment(root);

  const findings = sortFindings([
    ...checkTitle(pages, pageFamilies(root)),
    ...checkDescription(pages),
    ...checkSocial(pages),
    ...checkCanonical(pages, origin),
    ...checkRobots(pages, environment),
    ...checkStructuredData(pages),
    ...checkHead(pages),
  ]);

  return {
    root,
    origin,
    environment,
    findings,
    counts: countOf(pages),
    ok: !findings.some((finding) => finding.severity === "error"),
  };
}
