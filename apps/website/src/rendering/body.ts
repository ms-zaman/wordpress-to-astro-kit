// A migrated body, prepared for the page.
//
// Bodies are WordPress HTML — block markup, classic-editor markup or a page
// builder's rendered output — not Markdown, and they are rendered as HTML so
// the page says what the source says. Six preparations, all rendering
// concerns rather than content edits:
//
//   1. the MEDIA ENGINE (`src/media/`) — every reference the migration owns is
//      rewritten to the path this site serves it at;
//   2. the media origin seam (`media.ts`) — for whatever the engine did not
//      take, the one place the host serving the uploads library is decided;
//   3. INTERNAL LINKS (`links.ts`) — an absolute link to the source site
//      becomes root-relative, so the migrated site does not send its readers
//      back to the server it is replacing;
//   4. every `<img>` with no `loading` attribute is deferred;
//   5. WordPress's emoji IMAGES become the characters they replaced;
//   6. an `<h1>` inside a body becomes an `<h2>`: the page owns its one h1,
//      and demoting a second changes no word the reader sees.
//
// ## Why the engine runs FIRST, and why both still exist
//
// They are two strategies for the same problem, and a migration legitimately
// uses both at once:
//
//   COPY     `media.migrateFrom` names the source host. The file is captured
//            into `public/`, the reference becomes `/media/…`, and the site
//            works with the WordPress install switched off.
//   ORIGIN   `WPK_MEDIA_ORIGIN` names a host that still serves the library.
//            Nothing is copied and the reference keeps its uploads path.
//
// Running the engine first means a reference the migration owns becomes local,
// and one it does not — a file nobody captured yet, mid-migration — still gets
// an origin. With `migrateFrom` empty, which is the default, the engine takes
// nothing and this behaves exactly as it did before it existed.
import { migration } from "../../../../migration.config.ts";
import { rewriteReferences } from "../media/references.ts";
import { internaliseLinks } from "./links.ts";
import {
  deferBodyImages,
  inlineEmojiImages,
  mediaOrigin,
  rewriteMediaHtml,
} from "./media.ts";

export function prepareBody(
  html: string,
  origin: string | undefined = mediaOrigin(),
): string {
  // Media first — it owns the uploads namespace and rewrites what it copies.
  // Then the links, over whatever absolute source-origin references are left,
  // which are the internal PAGE links a WordPress editor stores absolutely.
  const migrated = internaliseLinks(
    rewriteReferences(html.trim(), migration.media).html,
  );
  return inlineEmojiImages(
    deferBodyImages(rewriteMediaHtml(migrated, origin)),
  ).replace(
    /<(\/?)h1(\s[^>]*)?>/gi,
    (_whole, close: string, attributes: string | undefined) =>
      `<${close}h2${attributes ?? ""}>`,
  );
}
