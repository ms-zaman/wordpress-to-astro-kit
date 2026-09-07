// Navigation menus — the structured data behind header and footer chrome.
//
// Structure is content and migrates; rendering does not. A menu file carrying
// markup or CSS classes is a boundary violation, which `strictObject`
// enforces everywhere below.
import { z } from "astro/zod";

import { localizedName, provenance, slug } from "./shared.ts";

/**
 * A single menu item. `label` is a `localizedName` because a menu is
 * language-neutral data — one structure, labels per locale. Recursive rather
 * than depth-limited: WordPress menus nest arbitrarily.
 */
export interface NavigationItem {
  label: Partial<Record<string, string>>;
  href: string;
  children?: NavigationItem[];
}

export const navigationItem: z.ZodType<NavigationItem> = z.lazy(() =>
  z.strictObject({
    label: localizedName,
    /** Carried VERBATIM — an internal path or an external URL. */
    href: z.string().min(1),
    /** Child items in display order. Absent and empty are both valid. */
    children: z.array(navigationItem).optional(),
  }),
);

/**
 * One menu. `items` is ordered: array position IS menu order, and there is no
 * `order` field, because two sources of order is how they drift apart.
 */
export const navigationSchema = z.strictObject({
  slug,
  /** The captured menu name. Optional; `slug` is the identity. */
  name: localizedName.optional(),
  items: z.array(navigationItem),
  source: provenance.optional(),
});
