---
slug: spring-opening
title: The spring opening
locale: en
cluster: posts/spring-opening
updatedAt: 2026-02-01
publishedAt: 2026-02-01
author: a-curator
categories:
  - announcements
  - openings
tags:
  - free-entry
source:
  system: wordpress
  sourceId: "501"
  capturedAt: 2026-02-01
---

<p>An image referenced three times, two of the spellings absolute:</p>
<img src="/wp-content/uploads/sites/4/2026/02/east%20wing.jpg" alt="East wing" />
<img src="https://old.museum.example/wp-content/uploads/sites/4/2026/02/east%20wing.jpg" alt="Again" />
<img src="//old.museum.example/wp-content/uploads/sites/4/2026/02/east%20wing.jpg" alt="And again, protocol-relative" />

<p>A responsive image with lazy attributes:</p>
<img
  data-src="/wp-content/uploads/sites/4/2026/02/gallery.jpg"
  data-srcset="/wp-content/uploads/sites/4/2026/02/gallery-480x320.jpg 480w, /wp-content/uploads/sites/4/2026/02/gallery.jpg 1200w"
  srcset="/wp-content/uploads/sites/4/2026/02/gallery-480x320.jpg 480w, /wp-content/uploads/sites/4/2026/02/gallery.jpg 1200w"
  src="/wp-content/uploads/sites/4/2026/02/gallery.jpg"
  loading="lazy" alt="The gallery" />

<p>A downloadable file, and a link to a page which is not an asset:</p>
<p><a href="/wp-content/uploads/sites/4/2026/02/season-guide.pdf">Season guide (PDF)</a></p>
<p><a href="/about/">About the museum</a></p>

<p>A file the source site never had, so nothing can capture it:</p>
<img src="/wp-content/uploads/sites/4/2026/02/absent.jpg" alt="Missing" />

<p>A background image, the only place a page builder puts one:</p>
<div style="background-image: url('/wp-content/uploads/sites/4/2026/02/banner.jpg')"></div>

<p>Somebody else's WordPress site — also uploads, and not ours:</p>
<img src="https://partner.example.org/wp-content/uploads/2025/09/their-logo.png" alt="A partner" />

<p>A query string that must survive, and a data URI that must not be touched:</p>
<img src="/wp-content/uploads/sites/4/2026/02/banner.jpg?ver=3" alt="Cache-busted" />
<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="Inline" />
