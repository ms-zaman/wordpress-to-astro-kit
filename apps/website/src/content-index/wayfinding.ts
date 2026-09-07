// Breadcrumbs: where the reader is, derived from where the entry sits rather
// than authored — an authored breadcrumb can disagree with the URL it
// describes.

export interface Crumb {
  readonly label: string;
  /** Absent on the current page: the page you are on is not a link to itself. */
  readonly href?: string;
  readonly current: boolean;
}

/** The site root, the first crumb of every trail. */
export const HOME: Crumb = { label: "Home", href: "/", current: false };

/** `Home / <label>` for a standalone page reached from the root. */
export function pageCrumbs(label: string): Crumb[] {
  return [HOME, { label, current: true }];
}

/** `Home / <parent> / … / <title>` for an entry under a trail of parents. */
export function trailCrumbs(
  parents: readonly { readonly label: string; readonly href: string }[],
  label: string,
): Crumb[] {
  return [
    HOME,
    ...parents.map((parent) => ({
      label: parent.label,
      href: parent.href,
      current: false,
    })),
    { label, current: true },
  ];
}
