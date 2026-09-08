---
slug: migrated-media
title: A body carrying migrated media
locale: en
cluster: posts/migrated-media
updatedAt: 2026-01-20
publishedAt: 2026-01-20
author: jane-doe
categories:
  - news
tags:
  - sample
excerpt: The shapes a WordPress body carries media in, so the migration engine runs on every build.
source:
  system: sample
---

<p>The references below are written the way WordPress writes them — in the
uploads namespace, on the source host. The media engine rewrites each one to
the path this site serves it at, and <code>pnpm media verify</code> fails if the
file is not there.</p>

<figure class="wp-block-image size-large">
  <img
    src="/wp-content/uploads/2026/01/gallery.svg"
    srcset="/wp-content/uploads/2026/01/gallery-480x320.svg 480w, /wp-content/uploads/2026/01/gallery.svg 1200w"
    sizes="(max-width: 700px) 100vw, 700px"
    width="1200" height="800" loading="lazy"
    alt="A grey placeholder standing in for a migrated upload" />
  <figcaption class="wp-element-caption">A responsive image: two renditions, one asset.</figcaption>
</figure>

<p>The same file again, written absolutely on the source host — one asset, not
two: <img src="https://old.example.com/wp-content/uploads/2026/01/gallery-480x320.svg" width="480" height="320" alt="The same placeholder, referenced a second way" /></p>

<p>A file to download: <a href="/wp-content/uploads/2026/01/season-guide.pdf">the season guide (PDF)</a>.</p>

<p>And an image on somebody else's WordPress site, which stays exactly where it
is: <img src="https://partner.example.org/wp-content/uploads/2025/09/their-logo.png" width="120" height="40" alt="A partner's logo, deliberately not migrated" /></p>
