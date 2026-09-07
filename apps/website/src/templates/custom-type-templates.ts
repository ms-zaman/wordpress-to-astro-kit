// The override seam: a custom type that needs its own presentation.
//
// `CustomTypePage.astro` renders every custom type by default, and that is
// deliberate — publishing a type should be a configuration change, not a new
// component. But a generic renderer that grows a field per site is how a kit
// becomes one site's codebase, so the escape hatch is here and it is explicit.
//
// To use it: write a component taking `{ route, site }` the way
// `CustomTypePage.astro` does, and map your COLLECTION name to it. The
// collection, not the WordPress type key, because that is what the content
// tree and the identity both use.
//
//   import ProductPage from "./ProductPage.astro";
//   export const CUSTOM_TYPE_TEMPLATES = { products: ProductPage };
//
// A type whose fields the shared schema cannot hold needs a schema of its own
// as well — see `content-model/custom-type.ts`. A template alone cannot render
// a field the content contract refuses to load.
export const CUSTOM_TYPE_TEMPLATES: Readonly<
  Record<string, unknown | undefined>
> = {};

/** The same seam for a custom type's listing. */
export const CUSTOM_ARCHIVE_TEMPLATES: Readonly<
  Record<string, unknown | undefined>
> = {};
