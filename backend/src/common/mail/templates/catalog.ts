import { z } from 'zod';
import { renderEmail, type RenderedEmail } from './layout';

/**
 * Every platform email Vintrax sends, by key (D-068).
 *
 * A template declares its category (which decides whether it can be switched
 * off), whether it carries a secret (a sign-in-equivalent link that must never
 * be written to the database), and a strict schema for its variables — a
 * missing or mistyped value fails at the call site, not as a half-rendered
 * email. Links are built here from APP_URL and fixed paths; no caller passes a
 * URL in, so no input can turn a button into a link somewhere else.
 *
 * CRM email (campaigns, automations, one-off messages) is authored by dealers
 * and rendered by the CRM; it is not in this catalogue.
 */

export type EmailCategoryKey = 'SECURITY' | 'ACCOUNT' | 'NOTIFICATION' | 'ADMIN';

interface TemplateDefinition<S extends z.ZodTypeAny> {
  category: EmailCategoryKey;
  /** Carries a single-use link: the variables are never stored, so no re-send from the log. */
  secret: boolean;
  schema: S;
  render: (vars: z.infer<S>, appUrl: string) => RenderedEmail;
}

function define<S extends z.ZodTypeAny>(definition: TemplateDefinition<S>): TemplateDefinition<S> {
  return definition;
}

const name = z.string().trim().min(1).max(100);
const line = z.string().trim().min(1).max(300);

/** A relative app path, e.g. /dealer/crm/leads/abc. Never a full URL. */
const appPath = z
  .string()
  .max(500)
  .regex(/^\/(?!\/)[^\s]*$/, 'must be a path within the app');

const cad = (value: number) =>
  `$${value.toLocaleString('en-CA', { maximumFractionDigits: 0 })}`;

export const EMAIL_TEMPLATES = {
  'auth.verify-email': define({
    category: 'SECURITY',
    secret: true,
    schema: z.object({ firstName: name, token: z.string().min(16).max(256) }),
    render: (v, app) =>
      renderEmail(
        'Verify your Vintrax account',
        {
          preheader: 'Confirm your email address to finish setting up your account.',
          heading: `Hi ${v.firstName}, confirm your email`,
          paragraphs: ['Confirm your email address to finish setting up your Vintrax account.'],
          action: {
            label: 'Verify my email',
            url: `${app}/verify-email?token=${encodeURIComponent(v.token)}`,
          },
          footnote:
            'This link expires in 24 hours and works once. If you did not create a Vintrax account, you can ignore this message.',
        },
        app,
      ),
  }),

  'auth.password-reset': define({
    category: 'SECURITY',
    secret: true,
    schema: z.object({ firstName: name, token: z.string().min(16).max(256) }),
    render: (v, app) =>
      renderEmail(
        'Reset your Vintrax password',
        {
          preheader: 'Use this link to choose a new password.',
          heading: `Hi ${v.firstName}, reset your password`,
          paragraphs: ['Someone asked to reset the password on your Vintrax account. If it was you, choose a new one:'],
          action: {
            label: 'Choose a new password',
            url: `${app}/reset-password?token=${encodeURIComponent(v.token)}`,
          },
          footnote:
            'This link expires in 1 hour and works once. If you did not ask for a reset, ignore this message — your password has not changed.',
        },
        app,
      ),
  }),

  'auth.password-changed': define({
    category: 'SECURITY',
    secret: false,
    schema: z.object({ firstName: name, via: z.enum(['settings', 'reset']) }),
    render: (v, app) =>
      renderEmail(
        'Your Vintrax password was changed',
        {
          preheader: 'The password on your account was just changed.',
          heading: 'Your password was changed',
          paragraphs: [
            `Hi ${v.firstName}, the password on your Vintrax account was just changed${
              v.via === 'reset' ? ' using a password-reset link' : ' from your account settings'
            }. Every other signed-in session has been signed out.`,
            'If this was you, there is nothing to do. If it was not, reset your password straight away and contact us.',
          ],
          action: { label: 'Reset my password', url: `${app}/forgot-password` },
        },
        app,
      ),
  }),

  'auth.email-changed': define({
    category: 'SECURITY',
    secret: false,
    schema: z.object({ firstName: name, newEmail: z.string().email().max(254) }),
    render: (v, app) =>
      renderEmail(
        'Your Vintrax email address was changed',
        {
          preheader: 'The sign-in email on your account was changed.',
          heading: 'Your email address was changed',
          paragraphs: [
            `Hi ${v.firstName}, the email address on your Vintrax account was just changed to ${v.newEmail}. This old address will no longer receive account email.`,
            'If you did not make this change, reset your password and contact us straight away.',
          ],
          action: { label: 'Reset my password', url: `${app}/forgot-password` },
        },
        app,
      ),
  }),

  'account.created': define({
    category: 'ACCOUNT',
    secret: false,
    schema: z.object({ firstName: name, email: z.string().email().max(254) }),
    render: (v, app) =>
      renderEmail(
        'Your Vintrax account is ready',
        {
          preheader: 'An administrator created a Vintrax account for you.',
          heading: `Welcome to Vintrax, ${v.firstName}`,
          paragraphs: [
            `A Vintrax administrator created an account for you, signing in as ${v.email}.`,
            'For your security, choose your own password before you sign in for the first time.',
          ],
          action: { label: 'Set my password', url: `${app}/forgot-password` },
          footnote: 'No password is ever sent by email. If you were not expecting this account, you can ignore this message.',
        },
        app,
      ),
  }),

  'account.status-changed': define({
    category: 'ACCOUNT',
    secret: false,
    schema: z.object({ firstName: name, status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']) }),
    render: (v, app) =>
      renderEmail(
        v.status === 'ACTIVE' ? 'Your Vintrax account is active' : 'Your Vintrax account was suspended',
        {
          preheader:
            v.status === 'ACTIVE'
              ? 'You can sign in to Vintrax again.'
              : 'Your account can no longer be used to sign in.',
          heading: v.status === 'ACTIVE' ? 'Your account is active' : 'Your account is not active',
          paragraphs:
            v.status === 'ACTIVE'
              ? [`Hi ${v.firstName}, your Vintrax account has been reactivated. You can sign in again.`]
              : [
                  `Hi ${v.firstName}, an administrator has ${
                    v.status === 'SUSPENDED' ? 'suspended' : 'deactivated'
                  } your Vintrax account and signed it out everywhere.`,
                  'If you think this is a mistake, reply to this email to reach our support team.',
                ],
          action: v.status === 'ACTIVE' ? { label: 'Sign in', url: `${app}/login` } : undefined,
        },
        app,
      ),
  }),

  'notification.generic': define({
    category: 'NOTIFICATION',
    secret: false,
    schema: z.object({
      firstName: name,
      title: line,
      body: z.string().trim().min(1).max(5000),
      link: appPath.nullish(),
    }),
    render: (v, app) =>
      renderEmail(
        v.title,
        {
          preheader: v.body.slice(0, 120),
          heading: v.title,
          paragraphs: [`Hi ${v.firstName},`, ...v.body.split(/\n{2,}/)],
          action: v.link ? { label: 'Open in Vintrax', url: `${app}${v.link}` } : undefined,
          footnote: 'You receive this because email notifications are on for your account. Change this under Account → Notifications.',
        },
        app,
      ),
  }),

  'finance.application': define({
    category: 'NOTIFICATION',
    secret: false,
    schema: z.object({
      applicantName: name,
      applicantEmail: z.string().email().max(254),
      applicantPhone: z.string().trim().min(1).max(40),
      preferredContact: z.enum(['PHONE', 'EMAIL', 'TEXT']),
      vehicleTitle: line,
      vehiclePriceCad: z.number().nonnegative(),
      applicationPath: appPath,
    }),
    render: (v, app) =>
      renderEmail(
        `New finance application: ${v.vehicleTitle}`,
        {
          preheader: `${v.applicantName} applied for financing.`,
          heading: 'New finance application',
          paragraphs: [
            `${v.applicantName} has applied for financing on your ${v.vehicleTitle} (${cad(v.vehiclePriceCad)}).`,
            'The full application — including income and employment — stays in your dealer portal, behind your sign-in.',
          ],
          details: [
            ['Email', v.applicantEmail],
            ['Phone', v.applicantPhone],
            [
              'Prefers',
              { PHONE: 'A phone call', EMAIL: 'Email', TEXT: 'A text message' }[v.preferredContact],
            ],
          ],
          action: { label: 'Open the application', url: `${app}${v.applicationPath}` },
          footnote:
            'You receive this because your listing takes finance applications on Vintrax. Change where they are sent under Dealer portal → Finance.',
        },
        app,
      ),
  }),

  'auction.outbid': define({
    category: 'NOTIFICATION',
    secret: false,
    schema: z.object({
      firstName: name,
      vehicleTitle: line,
      auctionId: z.string().uuid(),
      currentBidCad: z.number().nonnegative(),
    }),
    render: (v, app) =>
      renderEmail(
        `You have been outbid on ${v.vehicleTitle}`,
        {
          preheader: `The current bid is ${cad(v.currentBidCad)}.`,
          heading: 'You have been outbid',
          paragraphs: [
            `Hi ${v.firstName}, someone placed a higher bid on ${v.vehicleTitle}. The current bid is ${cad(v.currentBidCad)}.`,
          ],
          action: { label: 'View the auction', url: `${app}/auctions/${v.auctionId}` },
        },
        app,
      ),
  }),

  'contact.message': define({
    category: 'NOTIFICATION',
    secret: false,
    schema: z.object({
      name,
      email: z.string().email().max(254),
      phone: z.string().trim().max(40).nullish(),
      subject: line,
      message: z.string().trim().min(1).max(10_000),
    }),
    render: (v, app) =>
      renderEmail(
        `[Vintrax contact] ${v.subject.replace(/\s+/g, ' ')}`,
        {
          preheader: `${v.name} wrote through the Contact page.`,
          heading: v.subject,
          paragraphs: v.message.split(/\n{2,}/),
          details: [
            ['From', `${v.name} <${v.email}>`],
            ...(v.phone ? ([['Phone', v.phone]] as Array<[string, string]>) : []),
          ],
          footnote: 'Sent from the Contact page. Reply to this email to answer them directly.',
        },
        app,
      ),
  }),

  'admin.alert': define({
    category: 'ADMIN',
    secret: false,
    schema: z.object({
      severity: z.enum(['info', 'warning', 'critical']),
      title: line,
      summary: z.string().trim().min(1).max(2000),
      link: appPath.nullish(),
      occurredAt: z.string().datetime(),
    }),
    render: (v, app) =>
      renderEmail(
        `[Vintrax ${v.severity}] ${v.title}`,
        {
          preheader: v.summary.slice(0, 120),
          heading: v.title,
          paragraphs: v.summary.split(/\n{2,}/),
          details: [
            ['Severity', v.severity],
            ['When', `${new Date(v.occurredAt).toISOString().replace('T', ' ').slice(0, 16)} UTC`],
          ],
          action: v.link ? { label: 'Open in Vintrax admin', url: `${app}${v.link}` } : undefined,
          footnote: 'An operational alert for the addresses in MAIL_ADMIN_TO. Repeats of the same alert are held back for an hour.',
        },
        app,
      ),
  }),
} as const;

export type EmailTemplateKey = keyof typeof EMAIL_TEMPLATES;
export type EmailTemplateVars<K extends EmailTemplateKey> = z.infer<
  (typeof EMAIL_TEMPLATES)[K]['schema']
>;

/** A notification's link when it is a path inside the app; anything else is dropped. */
export function appPathOrNull(link: string | null | undefined): string | null {
  return link && appPath.safeParse(link).success ? link : null;
}

export function isTemplateKey(value: string): value is EmailTemplateKey {
  return Object.prototype.hasOwnProperty.call(EMAIL_TEMPLATES, value);
}

/** Validates the variables and renders. Throws a ZodError on bad input. */
export function renderTemplate<K extends EmailTemplateKey>(
  key: K,
  vars: EmailTemplateVars<K>,
  appUrl: string,
): RenderedEmail {
  const template = EMAIL_TEMPLATES[key] as unknown as TemplateDefinition<z.ZodTypeAny>;
  return template.render(template.schema.parse(vars), appUrl);
}
