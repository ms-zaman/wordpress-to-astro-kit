// A migrated body, prepared for the page.
//
// Bodies are WordPress HTML — block markup, classic-editor markup or a page
// builder's rendered output — not Markdown, and they are rendered as HTML so
// the page says what the source says. Four preparations, all rendering
// concerns rather than content edits:
//
//   1. the media origin seam (`media.ts`) — the one place the host serving the
//      uploads library is decided;
//   2. every `<img>` with no `loading` attribute is deferred;
//   3. WordPress's emoji IMAGES become the characters they replaced;
//   4. an `<h1>` inside a body becomes an `<h2>`: the page owns its one h1,
//      and demoting a second changes no word the reader sees.
import {
  deferBodyImages,
  inlineEmojiImages,
  rewriteMediaHtml,
} from "./media.ts";

export function prepareBody(html: string): string {
  return inlineEmojiImages(
    deferBodyImages(rewriteMediaHtml(html.trim())),
  ).replace(
    /<(\/?)h1(\s[^>]*)?>/gi,
    (_whole, close: string, attributes: string | undefined) =>
      `<${close}h2${attributes ?? ""}>`,
  );
}
