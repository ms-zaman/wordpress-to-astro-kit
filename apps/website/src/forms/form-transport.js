// The form-transport island.
//
// Inlined by every WIRED form (one whose route resolved to `http-post`). The
// form already posts natively — `method="post" action="<endpoint>"` — so this
// only upgrades the experience: the submission goes by `fetch`, the reader
// stays on the page, and the outcome is stated in a live region. A failed
// request says so and leaves the fields intact; it never claims success.
//
// Idempotent: a page with two wired forms inlines this twice, and the second
// copy finds nothing left to bind.
(function () {
  const forms = document.querySelectorAll(
    "form[data-wpk-form]:not([data-wpk-form-bound])",
  );
  for (const form of forms) {
    form.setAttribute("data-wpk-form-bound", "");
    const status = form.querySelector("[data-wpk-form-status]");
    const submit = form.querySelector("button[type='submit']");
    const success = form.getAttribute("data-wpk-form-success") || "Sent.";
    const failure =
      form.getAttribute("data-wpk-form-failure") ||
      "Something went wrong and your message was not sent. Please try again.";
    form.addEventListener("submit", (event) => {
      if (typeof fetch !== "function" || !status) return;
      event.preventDefault();
      const trap = form.querySelector("input[name='website']");
      if (trap && trap.value) return;
      if (!form.reportValidity()) return;
      form.setAttribute("aria-busy", "true");
      if (submit) submit.disabled = true;
      status.textContent = "Sending…";
      status.removeAttribute("data-wpk-form-outcome");
      fetch(form.action, {
        method: "POST",
        body: new FormData(form),
        headers: { accept: "application/json, text/plain, */*" },
        credentials: "omit",
      })
        .then((response) => {
          if (!response.ok) throw new Error("HTTP " + response.status);
          status.textContent = success;
          status.setAttribute("data-wpk-form-outcome", "success");
          form.reset();
        })
        .catch(() => {
          status.textContent = failure;
          status.setAttribute("data-wpk-form-outcome", "failure");
        })
        .finally(() => {
          form.removeAttribute("aria-busy");
          if (submit) submit.disabled = false;
        });
    });
  }
})();
