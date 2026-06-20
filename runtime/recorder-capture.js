// Injected into the recorded page at document-start via Playwright addInitScript({ path }).
// PLAIN JS ON PURPOSE: this file ships verbatim (tsx/esbuild never compiles it), so it carries
// no __name() helper references that would break addInitScript when serialized into the page.
// Captures the user's actions (field change -> input/select, click -> click/submit) and posts
// each one back to the Node recorder via the exposed window.__record binding.
(() => {
  // Idempotent: this runs via addInitScript (fresh navigations) AND via a post-goto evaluate
  // (needed over Browserbase CDP, where the pre-existing page's navigation skips init scripts).
  // The guard ensures listeners attach exactly once either way.
  if (window.__mimicCaptureAttached) return;
  window.__mimicCaptureAttached = true;
  const post = (a) => window.__record(a);

  const selectorFor = (el) => {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const name = el.getAttribute("name");
    if (name) return `${el.tagName.toLowerCase()}[name="${name}"]`;
    const parent = el.parentElement;
    if (!parent) return el.tagName.toLowerCase();
    const tag = el.tagName.toLowerCase();
    const sameTag = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
    const idx = sameTag.indexOf(el) + 1;
    return `${selectorFor(parent)} > ${tag}:nth-of-type(${idx})`;
  };

  const contextFor = (el) => {
    const tag = el.tagName.toLowerCase();
    const role =
      el.getAttribute("role") ||
      (tag === "button" ? "button" : tag === "input" || tag === "textarea" ? "textbox" : null);
    const label =
      el.labels?.[0]?.innerText?.trim() ||
      el.getAttribute("aria-label") ||
      el.getAttribute("placeholder") ||
      null;
    const text = (el.innerText || "").trim().slice(0, 80) || null;
    const attrs = {};
    for (const a of ["id", "name", "type", "role"]) {
      const v = el.getAttribute(a);
      if (v) attrs[a] = v;
    }
    const scope = el.closest("form") || el.parentElement || el;
    return {
      selector: selectorFor(el),
      role,
      label,
      text,
      attributes: attrs,
      domSnapshot: scope.outerHTML.slice(0, 2000),
    };
  };

  document.addEventListener(
    "change",
    (e) => {
      const el = e.target;
      const isField =
        el instanceof HTMLInputElement ||
        el instanceof HTMLSelectElement ||
        el instanceof HTMLTextAreaElement;
      if (!isField) return;
      post({
        type: el instanceof HTMLSelectElement ? "select" : "input",
        timestamp: Date.now(),
        value: el.value ?? null,
        target: contextFor(el),
      });
    },
    true,
  );

  document.addEventListener(
    "click",
    (e) => {
      const el = e.target?.closest("button, a, [role=button], input[type=submit]");
      if (!el) return;
      const isSubmit = el.type === "submit" || el.getAttribute("type") === "submit";
      post({
        type: isSubmit ? "submit" : "click",
        timestamp: Date.now(),
        value: null,
        target: contextFor(el),
      });
    },
    true,
  );
})();
