// The search island — the controller `/search` inlines after `search-core.js`.
//
// Plain JavaScript, no exports, no imports: the page concatenates this file
// after the core and wraps both in one function, so `search`, `terms` and
// `emptyReason` are in scope. It runs the query a reader typed against the
// static index at `/search-index.json`, fetched once on first use, and writes
// the results into the page with DOM calls — never `innerHTML` from data.
//
// Progressive: the form is a real `GET` to `/search?q=`, so without this
// script the page reloads with the query in the URL, and with it the query
// runs in place and the URL is kept in step.
/* global search, emptyReason */
(function () {
  const root = document.querySelector("[data-wpk-search]");
  if (!root) return;
  const form = root.querySelector("form");
  const input = form && form.querySelector("input[name='q']");
  const status = root.querySelector("[data-wpk-search-status]");
  const list = root.querySelector("[data-wpk-search-results]");
  const more = root.querySelector("[data-wpk-search-more]");
  const chips = Array.from(root.querySelectorAll("[data-wpk-search-kind]"));
  if (!form || !input || !status || !list || !more) return;

  const labels = JSON.parse(
    root.getAttribute("data-wpk-search-labels") || "{}",
  );
  const indexUrl =
    root.getAttribute("data-wpk-search-index") || "/search-index.json";
  const PAGE = 20;
  const locale = document.documentElement.lang || "en";
  const dateFormat = new Intl.DateTimeFormat(locale, {
    dateStyle: "long",
    timeZone: "UTC",
  });

  let index = null;
  let loading = null;
  let kind = "all";
  let query = "";
  let results = [];
  let shown = PAGE;

  function loadIndex() {
    if (!loading)
      loading = fetch(indexUrl, { headers: { accept: "application/json" } })
        .then((response) => {
          if (!response.ok) throw new Error("HTTP " + response.status);
          return response.json();
        })
        .then((json) => {
          index = json;
          return json;
        })
        .catch((error) => {
          loading = null;
          throw error;
        });
    return loading;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function setChips() {
    for (const chip of chips) {
      const active = chip.getAttribute("data-wpk-search-kind") === kind;
      chip.setAttribute("aria-pressed", active ? "true" : "false");
    }
  }

  function countFor(candidate) {
    if (!index || !query) return 0;
    return search(index, query, { kind: candidate }).length;
  }

  function render() {
    list.replaceChildren();
    root.removeAttribute("aria-busy");
    setChips();
    for (const chip of chips) {
      const count = chip.querySelector("[data-wpk-search-count]");
      if (count)
        count.textContent =
          query && index
            ? String(countFor(chip.getAttribute("data-wpk-search-kind")))
            : "";
    }
    const reason = index ? emptyReason(index, query, results) : "no-query";
    if (reason === "no-query") {
      status.textContent = "Type a word or two above to search the site.";
      more.hidden = true;
      return;
    }
    if (reason === "empty-index") {
      status.textContent =
        "Nothing is published yet, so there is nothing to search.";
      more.hidden = true;
      return;
    }
    if (reason === "no-match") {
      status.textContent =
        "No results for “" + query + "”. Try a shorter word.";
      more.hidden = true;
      return;
    }
    status.textContent =
      results.length +
      (results.length === 1 ? " result" : " results") +
      " for “" +
      query +
      "”";
    for (const result of results.slice(0, shown)) {
      const doc = result.document;
      const item = el("li", "wpk-search-result");
      const link = el("a", "wpk-search-result__link");
      link.href = doc.href;
      const label = labels[doc.kind] || doc.kind;
      link.appendChild(el("span", "wpk-search-result__kind", label));
      link.appendChild(el("span", "wpk-search-result__title", doc.title));
      if (doc.summary)
        link.appendChild(el("span", "wpk-search-result__summary", doc.summary));
      const meta = el("span", "wpk-search-result__meta");
      const time = el(
        "time",
        "",
        dateFormat.format(new Date(doc.date + "T00:00:00Z")),
      );
      time.setAttribute("datetime", doc.date);
      meta.appendChild(time);
      link.appendChild(meta);
      item.appendChild(link);
      list.appendChild(item);
    }
    more.hidden = results.length <= shown;
    if (!more.hidden)
      more.textContent =
        "Show more (" + (results.length - shown) + " remaining)";
  }

  function syncUrl(push) {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (kind !== "all") params.set("kind", kind);
    const next = params.toString()
      ? "?" + params.toString()
      : location.pathname;
    const current = location.search || location.pathname;
    if (next === current) return;
    if (push) history.pushState(null, "", next);
    else history.replaceState(null, "", next);
  }

  function run(push) {
    query = input.value.trim();
    shown = PAGE;
    syncUrl(push);
    if (!query) {
      results = [];
      render();
      return;
    }
    root.setAttribute("aria-busy", "true");
    status.textContent = "Searching…";
    loadIndex()
      .then(() => {
        results = search(index, query, { kind: kind });
        render();
      })
      .catch(() => {
        root.removeAttribute("aria-busy");
        status.textContent =
          "The search index could not be loaded. Reload the page to try again.";
      });
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    run(true);
  });
  for (const chip of chips)
    chip.addEventListener("click", () => {
      kind = chip.getAttribute("data-wpk-search-kind") || "all";
      shown = PAGE;
      syncUrl(true);
      if (index && query) results = search(index, query, { kind: kind });
      render();
    });
  more.addEventListener("click", () => {
    shown += PAGE;
    render();
  });
  window.addEventListener("popstate", () => {
    const params = new URLSearchParams(location.search);
    input.value = params.get("q") || "";
    kind = params.get("kind") || "all";
    run(false);
  });

  const initial = new URLSearchParams(location.search);
  input.value = initial.get("q") || "";
  kind = initial.get("kind") || "all";
  if (!chips.some((chip) => chip.getAttribute("data-wpk-search-kind") === kind))
    kind = "all";
  root.setAttribute("data-wpk-search-ready", "");
  run(false);
})();
