/**
 * The one HTML frame every platform email shares (D-068).
 *
 * Email clients are not browsers: no scripts, no external stylesheets, little
 * CSS beyond inline styles, and tables for layout because Outlook still needs
 * them. Every value that reaches the markup goes through `escapeHtml`, so data
 * — a name, a vehicle title, a message — cannot become markup. Links are built
 * only from APP_URL and fixed paths, never from user input.
 */

/** Brand colours as fixed hex: email has no theme tokens (documentation/brand.md). */
const CARBON = '#100d0d';
const PRIMARY = '#bb1b1b';
const MUTED = '#5f5a5a';
const SURFACE = '#f6f5f5';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface EmailContent {
  /** Shown by most inboxes after the subject; plain text. */
  preheader: string;
  heading: string;
  /** Plain-text paragraphs. Escaped for HTML; written as-is for the text part. */
  paragraphs: string[];
  /** A single call to action. The URL must already be an APP_URL link. */
  action?: { label: string; url: string };
  /** Label/value rows (an applicant's phone, a bid amount). Plain text. */
  details?: Array<[string, string]>;
  /** Small print under the action: why this arrived, how long a link lasts. */
  footnote?: string;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/** Builds the HTML and the plain-text alternative from the same content. */
export function renderEmail(subject: string, content: EmailContent, appUrl: string): RenderedEmail {
  const paragraphs = content.paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:16px;line-height:24px;color:${CARBON};">${escapeHtml(p)}</p>`,
    )
    .join('');
  const details = content.details?.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px;width:100%;border-collapse:collapse;">${content.details
        .map(
          ([label, value]) =>
            `<tr><td style="padding:6px 12px 6px 0;font-size:14px;color:${MUTED};white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td><td style="padding:6px 0;font-size:14px;color:${CARBON};">${escapeHtml(value)}</td></tr>`,
        )
        .join('')}</table>`
    : '';
  const action = content.action
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr><td style="border-radius:8px;background:${PRIMARY};"><a href="${escapeHtml(content.action.url)}" style="display:inline-block;padding:12px 22px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(content.action.label)}</a></td></tr></table><p style="margin:0 0 16px;font-size:13px;line-height:20px;color:${MUTED};">If the button does not work, copy this link into your browser:<br><a href="${escapeHtml(content.action.url)}" style="color:${PRIMARY};word-break:break-all;">${escapeHtml(content.action.url)}</a></p>`
    : '';
  const footnote = content.footnote
    ? `<p style="margin:16px 0 0;font-size:13px;line-height:20px;color:${MUTED};">${escapeHtml(content.footnote)}</p>`
    : '';

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${SURFACE};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(content.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${SURFACE};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;">
<tr><td style="background:${CARBON};padding:18px 24px;"><a href="${escapeHtml(appUrl)}" style="font-size:20px;font-weight:700;letter-spacing:0.5px;color:#ffffff;text-decoration:none;">Vintrax</a></td></tr>
<tr><td style="padding:28px 24px 24px;">
<h1 style="margin:0 0 16px;font-size:22px;line-height:30px;color:${CARBON};">${escapeHtml(content.heading)}</h1>
${paragraphs}${details}${action}${footnote}
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #ece9e9;font-size:12px;line-height:18px;color:${MUTED};">Vintrax — Canada's automotive marketplace. <a href="${escapeHtml(appUrl)}" style="color:${MUTED};">${escapeHtml(appUrl.replace(/^https?:\/\//, ''))}</a></td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    content.heading,
    '',
    ...content.paragraphs.flatMap((p) => [p, '']),
    ...(content.details?.length ? [...content.details.map(([l, v]) => `${l}: ${v}`), ''] : []),
    ...(content.action ? [`${content.action.label}: ${content.action.url}`, ''] : []),
    ...(content.footnote ? [content.footnote, ''] : []),
    '— Vintrax',
    appUrl,
  ].join('\n');

  return { subject, text, html };
}
