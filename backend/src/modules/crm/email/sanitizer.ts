/**
 * An allowlist HTML sanitiser for email templates.
 *
 * Template HTML is written by dealership staff and sent to customers, and it
 * is shown back inside the CRM's preview, so anything executable is removed:
 * only the tags and attributes below survive, every attribute value is
 * re-escaped, and a link must be http(s), mailto, tel or a template variable.
 * Elements whose content is code (script, style, iframe, …) are dropped with
 * their content.
 */

const ALLOWED_TAGS = new Set([
  'a',
  'b',
  'blockquote',
  'br',
  'div',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'hr',
  'i',
  'img',
  'li',
  'ol',
  'p',
  'span',
  'strong',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'u',
  'ul',
]);

const VOID_TAGS = new Set(['br', 'hr', 'img']);

/** Dropped together with everything inside them. */
const DROP_WITH_CONTENT = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'template',
  'svg',
  'math',
  'noscript',
  'textarea',
  'select',
  'head',
  'title',
  'frameset',
  'frame',
  'applet',
]);

const ALLOWED_ATTRIBUTES: Record<string, Set<string>> = {
  a: new Set(['href', 'title']),
  img: new Set(['src', 'alt', 'width', 'height']),
  td: new Set(['align', 'colspan', 'rowspan']),
  th: new Set(['align', 'colspan', 'rowspan']),
  p: new Set(['align']),
  div: new Set(['align']),
  table: new Set(['width', 'cellpadding', 'cellspacing', 'border']),
};

const VARIABLE_ONLY = /^\{\{\s*[a-z_]+\.[a-z_]+\s*\}\}$/;

function safeUrl(value: string, kind: 'href' | 'src'): string | null {
  const trimmed = value.trim();
  if (VARIABLE_ONLY.test(trimmed)) return trimmed;
  // Browsers ignore control characters and whitespace inside a scheme.
  // eslint-disable-next-line no-control-regex
  const compact = trimmed.replace(/[\u0000- ]/g, '').toLowerCase();
  if (kind === 'src') return /^https:\/\//.test(compact) ? trimmed : null;
  if (/^(https?:|mailto:|tel:)/.test(compact)) return trimmed;
  return null;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Decodes the few entities an attribute value commonly carries, before re-escaping. */
function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

const ATTRIBUTE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function cleanAttributes(tag: string, raw: string): string {
  const allowed = ALLOWED_ATTRIBUTES[tag];
  if (!allowed) return '';
  const kept: string[] = [];
  for (const match of raw.matchAll(ATTRIBUTE)) {
    const name = match[1]!.toLowerCase();
    if (!allowed.has(name)) continue;
    let value = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
    if (name === 'href' || name === 'src') {
      const url = safeUrl(value, name);
      if (url === null) continue;
      value = url;
    } else if (!/^[\w\s%#.-]{0,40}$/.test(value)) {
      continue;
    }
    kept.push(`${name}="${escapeHtml(value)}"`);
  }
  if (tag === 'a' && kept.some((attribute) => attribute.startsWith('href='))) {
    kept.push('target="_blank"', 'rel="noopener noreferrer"');
  }
  return kept.length ? ' ' + kept.join(' ') : '';
}

const TOKEN =
  /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<![^>]*>?|<\?[^>]*>?|<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;

export function sanitizeHtml(input: string): string {
  let output = '';
  let last = 0;
  /** Inside a dropped element: its name and nesting depth. */
  let dropping: { tag: string; depth: number } | null = null;
  const open: string[] = [];

  const text = (chunk: string) => {
    if (dropping || !chunk) return;
    // Any `<` left in text is not a tag we recognised: show it, never parse it.
    output += chunk.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };

  for (const match of input.matchAll(TOKEN)) {
    text(input.slice(last, match.index));
    last = match.index! + match[0].length;
    const name = match[1]?.toLowerCase();
    if (!name) continue; // comments, doctype, processing instructions
    const closing = match[0].startsWith('</');

    if (dropping) {
      if (name === dropping.tag) dropping.depth += closing ? -1 : 1;
      if (dropping.depth === 0) dropping = null;
      continue;
    }
    if (DROP_WITH_CONTENT.has(name)) {
      if (!closing && !/\/\s*>$/.test(match[0])) dropping = { tag: name, depth: 1 };
      continue;
    }
    if (!ALLOWED_TAGS.has(name)) continue;

    if (closing) {
      if (VOID_TAGS.has(name)) continue;
      const index = open.lastIndexOf(name);
      if (index === -1) continue;
      // Close anything left open inside it, so the markup stays balanced.
      while (open.length > index) output += `</${open.pop()}>`;
      continue;
    }
    output += `<${name}${cleanAttributes(name, match[2] ?? '')}>`;
    if (!VOID_TAGS.has(name)) open.push(name);
  }
  text(input.slice(last));
  while (open.length) output += `</${open.pop()}>`;
  return output.trim();
}

/** A readable plain-text version of (sanitised) template HTML. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-4]|blockquote|tr|table|ul|ol)>/gi, '\n\n')
      .replace(/<li[^>]*>/gi, '\n- ')
      .replace(
        /<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
        (_m, href: string, label: string) => {
          const text = label.replace(/<[^>]+>/g, '').trim();
          const url = decodeEntities(href);
          return text && text !== url ? `${text} (${url})` : url;
        },
      )
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
