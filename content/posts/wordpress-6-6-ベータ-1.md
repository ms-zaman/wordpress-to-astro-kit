---
slug: wordpress-6-6-ベータ-1
title: WordPress 6.6 ベータ 1
locale: en
cluster: posts/wordpress-6-6-ベータ-1
updatedAt: 2026-01-20
publishedAt: 2026-01-20
author: jane-doe
categories:
  - news
tags:
  - 翻訳
  - sample
excerpt: "A post whose slug is not ASCII, because WordPress's post_name is not."
source:
  system: sample
---

<p>This entry exists so that every build of this kit emits a route whose URL is not ASCII, and every gate walks it: the manifest, the link check, the sitemap, the browser tests. Nothing else here proved that path, and a route shape no fixture carries is a route shape no gate can fail on.</p>
<p>The slug is real. WordPress percent-encodes a non-ASCII <code>post_name</code> on the way into the database — <code>sanitize_title_with_dashes()</code> calls <code>utf8_uri_encode()</code> — so this post is stored and served by REST as <code>wordpress-6-6-%e3%83%99%e3%83%bc%e3%82%bf-1</code>, and <code>content:transform</code> decodes it. The two spellings are one URL.</p>
<p>It is deliberately MIXED-SCRIPT, which is the case a Latin-alphabet slug rule and a CJK-only one both get wrong: <code>wordpress</code> is <code>\p{Ll}</code>, <code>6</code> and <code>1</code> are <code>\p{N}</code>, <code>ベ</code> and <code>タ</code> are <code>\p{Lo}</code>, and <code>ー</code> — the prolonged sound mark, U+30FC — is <code>\p{Lm}</code>, which is the one an alphabet written from memory leaves out.</p>
<p>Its tag is non-ASCII too, so a taxonomy archive is published at a non-ASCII URL as well as an entry.</p>
