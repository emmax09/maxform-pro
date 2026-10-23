const allowedTags = new Set([
  "A",
  "B",
  "BLOCKQUOTE",
  "BR",
  "CODE",
  "EM",
  "H1",
  "H2",
  "H3",
  "H4",
  "HR",
  "I",
  "LI",
  "OL",
  "P",
  "PRE",
  "SPAN",
  "STRONG",
  "U",
  "UL",
]);

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const safeHref = (value: string) => {
  const trimmed = value.trim();
  return /^(https?:|mailto:|tel:|#)/i.test(trimmed) ? trimmed : "";
};

/** Sanitizes owner-authored rich content before it reaches the public form. */
export const sanitizeFormHtml = (source: string) => {
  if (typeof DOMParser === "undefined") return escapeHtml(source);
  const document = new DOMParser().parseFromString(source, "text/html");

  Array.from(document.body.querySelectorAll("script,style,iframe,object,embed,svg,math"))
    .forEach((element) => element.remove());

  Array.from(document.body.querySelectorAll("*")).forEach((element) => {
    if (!allowedTags.has(element.tagName)) {
      element.replaceWith(...Array.from(element.childNodes));
      return;
    }
    Array.from(element.attributes).forEach((attribute) => {
      const keepLinkAttribute =
        element.tagName === "A" &&
        ["href", "target", "rel"].includes(attribute.name.toLowerCase());
      if (!keepLinkAttribute) element.removeAttribute(attribute.name);
    });
    if (element.tagName === "A") {
      const href = safeHref(element.getAttribute("href") || "");
      if (href) element.setAttribute("href", href);
      else element.removeAttribute("href");
      if (element.getAttribute("target") === "_blank") {
        element.setAttribute("rel", "noopener noreferrer nofollow");
      } else {
        element.removeAttribute("target");
        element.removeAttribute("rel");
      }
    }
  });

  return document.body.innerHTML;
};
