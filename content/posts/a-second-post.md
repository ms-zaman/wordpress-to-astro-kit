---
slug: a-second-post
title: A second post, with the shapes a body carries
locale: en
cluster: posts/a-second-post
updatedAt: 2026-01-15
publishedAt: 2026-01-15
author: jane-doe
categories:
  - news
tags:
  - sample
source:
  system: sample
---

<p>A migrated post body is the HTML WordPress rendered — block markup, classic-editor markup, or a page builder's output — carried verbatim so the reconciler can compare this page to the live one word for word.</p>
<h2 class="wp-block-heading">What the body pipeline does</h2>
<p>Three things, all rendering concerns rather than content edits: the media origin seam rewrites the HOST of every upload reference and nothing else; every image without a <code>loading</code> attribute is deferred; and WordPress's emoji images become the characters they replaced.</p>
<ul class="wp-block-list">
<li>Headings keep their level. A second <code>h1</code> inside a body is demoted to <code>h2</code>, because the page owns its one.</li>
<li>Preset colour classes such as <code>has-vivid-cyan-blue-color</code> paint, because the tokens carry WordPress core's preset values.</li>
<li>Nothing is reworded. A typo in the source is a typo here, recorded as a disposition rather than silently fixed.</li>
</ul>
<blockquote class="wp-block-quote"><p>Defects are data, not fixes.</p></blockquote>
<figure class="wp-block-image alignleft size-medium"><img src="/media/sample-inline.svg" alt="A placeholder rectangle standing in for a migrated upload" width="240" height="160" /><figcaption class="wp-element-caption">A floated image, the shape two decades of WordPress posts carry.</figcaption></figure>
<p>A classic-editor float is the oldest shape in a migrated corpus, and it is also the one that breaks a narrow viewport: at 320px a floated image leaves a column two words wide. The rule that unfloats it below the mobile breakpoint is what every WordPress theme does, and it is here so the layout audit sees the shape rather than a page that never carries it.</p>
<div class="wp-block-columns">
<div class="wp-block-column"><p>Columns are a block, and a two-column block that stays two columns at 320px is exactly the overflow this kit's layout gate fails on.</p></div>
<div class="wp-block-column"><p>So they wrap to one below the same breakpoint, which is core's own behaviour, and the gate now runs against a body that actually contains them.</p></div>
</div>
<pre class="wp-block-code"><code>apps/website/src/rendering/portable-body.ts</code></pre>
<p>A code block wraps rather than scrolls, because core lets it: an unbreakable path in a migrated body is the same 320px overflow an inline code span caused on this kit's own contact page, found by the layout audit on its first run.</p>
<hr class="wp-block-separator has-alpha-channel-opacity" />
<pre class="wp-block-verse">A verse block is a pre
that core sets in the body font,
because it is poetry and not code.</pre>
<p>Every shape above is here so a gate can see it. A sample body that carries only the easy shapes proves the pipeline handles the easy shapes.</p>
