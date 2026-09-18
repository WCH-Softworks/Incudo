/**
 * Making an element's description safe to render.
 *
 * `Element.description` (`packages/core/src/model.ts`) is stored verbatim as Aurora wrote it —
 * "loose HTML with app-specific bits", not normalized (docs/AURORA-FORMAT.md). It has never been
 * rendered anywhere in Incudo before the candidate picker, so there was no existing answer to
 * copy for showing it safely. A content source is a URL the user typed in, not a file Incudo
 * wrote, so this is untrusted input by the same reasoning that keeps every other bit of the
 * importer suspicious of what it reads: a `<script>` or an `onclick` in a description would run
 * inside the app's own window.
 *
 * This is a plain allowlist sanitizer built on `DOMParser` rather than a dependency, in keeping
 * with the project's dependency policy (docs/CODE-REUSE-POLICY.md rule 4) — `core`, `content`
 * and `aurora-import` hold to zero runtime dependencies already, and a browser-only concern like
 * this belongs beside the rendering it serves, not pulled into a shared package a React Native
 * shell could never use anyway (rule 3). Every tag not on the allowlist is unwrapped — its text
 * and its allowed descendants survive, only the tag itself goes — because Aurora's own
 * app-specific wrapper (`<div element="ID_…">`) carries no text of its own and disappearing is
 * exactly right for it, and because older content leans on plain formatting tags (`<font>`) that
 * would otherwise take real rulebook text with them. `<script>` and friends are the one
 * exception: removed whole, contents included, since PHB text is never found inside one.
 * Attributes are denied by default and allowed back one at a time per tag, which is what keeps
 * an `onclick` or a `style` out without a separate rule naming each dangerous one.
 *
 * What this deliberately does not do: resolve `<div element="ID_…">` into the name of the
 * element it references. That needs an `ElementIndex` lookup per reference and a rule for what
 * the result should look like, neither of which exists yet — left as a visible gap (an empty
 * div) rather than guessed at (ADR 0005).
 */

const ALLOWED_TAGS = new Set([
  'p',
  'br',
  'div',
  'span',
  'ul',
  'ol',
  'li',
  'strong',
  'b',
  'em',
  'i',
  'u',
  'small',
  'sub',
  'sup',
  'table',
  'thead',
  'tbody',
  'tr',
  'td',
  'th',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'hr',
  'a',
]);

/** Removed whole, contents included — never merely unwrapped. */
const DROP_ENTIRELY = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'link',
  'meta',
  'base',
  'form',
  'input',
  'button',
  'svg',
  'math',
]);

/** Attributes are denied unless a tag names them here. Everything else — `style`, `on*` handlers,
 *  `class` — is stripped from every tag, `a` and table cells included. */
const ALLOWED_ATTRIBUTES: Record<string, Set<string>> = {
  a: new Set(['href']),
  td: new Set(['colspan', 'rowspan']),
  th: new Set(['colspan', 'rowspan']),
};

/** Returns HTML safe to pass to `dangerouslySetInnerHTML`. */
export function sanitizeDescriptionHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  sanitizeChildren(doc.body);
  return doc.body.innerHTML;
}

function sanitizeChildren(parent: HTMLElement): void {
  for (const child of Array.from(parent.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) continue;
    if (child.nodeType !== Node.ELEMENT_NODE) {
      parent.removeChild(child);
      continue;
    }
    const element = child as HTMLElement;
    const tag = element.tagName.toLowerCase();

    if (DROP_ENTIRELY.has(tag)) {
      parent.removeChild(element);
      continue;
    }

    // Sanitize the children before deciding whether to unwrap the element itself, so an
    // unwrapped element's children are already clean when they are spliced into `parent`.
    sanitizeChildren(element);

    if (!ALLOWED_TAGS.has(tag)) {
      while (element.firstChild) parent.insertBefore(element.firstChild, element);
      parent.removeChild(element);
      continue;
    }

    const allowed = ALLOWED_ATTRIBUTES[tag];
    for (const attribute of Array.from(element.attributes)) {
      if (!allowed?.has(attribute.name)) element.removeAttribute(attribute.name);
    }

    if (tag === 'a') {
      const href = element.getAttribute('href') ?? '';
      if (!/^https?:\/\//i.test(href)) {
        element.removeAttribute('href');
      } else {
        element.setAttribute('rel', 'noopener noreferrer');
        element.setAttribute('target', '_blank');
      }
    }
  }
}
