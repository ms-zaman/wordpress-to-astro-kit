---
slug: contact
title: Contact
locale: en
cluster: pages/contact
updatedAt: 2026-01-01
form: contact
source:
  system: sample
---

<p>A page with a form. The form's fields live in <code>apps/website/src/forms/definitions.ts</code>; where a submission goes is decided in <code>forms/routing.ts</code> and wired by one build variable per form. Until that variable names an endpoint, the form says plainly that it does not send — a form that looked like it worked would lose the message silently.</p>
