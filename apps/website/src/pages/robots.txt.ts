// /robots.txt — the crawl policy, decided by the launch switch.
//
// Preview: disallow everything. Production: allow everything except the
// surfaces no environment indexes, and name the sitemap — the one thing a
// robots file does that a meta tag cannot.
import type { APIRoute } from "astro";

import {
  NEVER_INDEXED_PATHS,
  siteEnvironment,
} from "../deployment/site-environment.ts";
import { SITEMAP_PATH } from "../rendering/sitemap-model.ts";
import { absoluteUrl, siteOrigin } from "../rendering/site-identity.ts";

export function robotsText(
  environment: ReturnType<typeof siteEnvironment>,
  origin: string | undefined,
): string {
  if (environment !== "production") return "User-agent: *\nDisallow: /\n";
  const lines = ["User-agent: *", "Allow: /"];
  for (const path of NEVER_INDEXED_PATHS)
    if (path !== "/404") lines.push(`Disallow: ${path}`);
  const sitemap = absoluteUrl(SITEMAP_PATH, origin);
  if (sitemap !== undefined) lines.push("", `Sitemap: ${sitemap}`);
  return `${lines.join("\n")}\n`;
}

export const GET: APIRoute = () =>
  new Response(robotsText(siteEnvironment(), siteOrigin()), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
