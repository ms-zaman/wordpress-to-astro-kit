// Navigation view model — the seam between the menu data and the chrome
// components. Three things a `.astro` file should not do, because all three
// are decisions and all three are testable: resolve a localized label to one
// string; mark the current item (including an ancestor whose child is the
// page); degrade to an empty menu when the file is absent.

/** A menu item as the navigation schema stores one. */
export interface NavigationSource {
  readonly label: Readonly<Partial<Record<string, string>>>;
  readonly href: string;
  readonly children?: readonly NavigationSource[];
}

/** A menu entry as the collection yields one. */
export interface NavigationEntry {
  readonly data: {
    readonly slug: string;
    readonly items: readonly NavigationSource[];
  };
}

/** A menu item as a component renders one. */
export interface NavigationNode {
  readonly label: string;
  readonly href: string;
  readonly children: readonly NavigationNode[];
  /** This node's own href is the page being rendered. */
  readonly current: boolean;
  /** This node, or a descendant of it, is the page being rendered. */
  readonly containsCurrent: boolean;
}

const normalize = (path: string): string =>
  path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;

export function labelFor(
  item: NavigationSource,
  locale: string,
  defaultLocale: string,
): string {
  return item.label[locale] ?? item.label[defaultLocale] ?? "";
}

function toNode(
  item: NavigationSource,
  locale: string,
  defaultLocale: string,
  pathname: string,
): NavigationNode {
  const children = (item.children ?? []).map((child) =>
    toNode(child, locale, defaultLocale, pathname),
  );
  const current = normalize(item.href) === normalize(pathname);
  return {
    label: labelFor(item, locale, defaultLocale),
    href: item.href,
    children,
    current,
    containsCurrent: current || children.some((child) => child.containsCurrent),
  };
}

/**
 * Build one menu for rendering. A slug no entry claims returns an empty
 * array — the header renders its wordmark and nothing else, which is the
 * honest result of "this menu has not been migrated yet".
 */
export function buildMenu(
  entries: readonly NavigationEntry[],
  slug: string,
  options: {
    readonly locale: string;
    readonly defaultLocale: string;
    readonly pathname: string;
  },
): NavigationNode[] {
  const menu = entries.find((entry) => entry.data.slug === slug);
  if (!menu) return [];
  return menu.data.items.map((item) =>
    toNode(item, options.locale, options.defaultLocale, options.pathname),
  );
}

/** Every href a menu points at, depth-first, in render order. */
export function menuHrefs(nodes: readonly NavigationNode[]): string[] {
  return nodes.flatMap((node) => [node.href, ...menuHrefs(node.children)]);
}

/** Greatest nesting depth in a menu. A flat menu is depth 1; empty is 0. */
export function menuDepth(nodes: readonly NavigationNode[]): number {
  return nodes.length === 0
    ? 0
    : 1 + Math.max(...nodes.map((node) => menuDepth(node.children)));
}
