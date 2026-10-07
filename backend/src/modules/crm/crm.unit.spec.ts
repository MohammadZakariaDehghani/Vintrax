import { automationSchema, DEALER_TEMPLATE_VARIABLES } from '@vintrax/shared';
import { evaluate, evaluateAll, type Facts } from './automation/conditions';
import { localParts, nextSendTime, resolveRange, zonedTime, type SendWindow } from './core/time';
import {
  assertKnownVariables,
  renderSubject,
  renderTemplate,
  unknownVariables,
} from './email/render';
import { htmlToText, sanitizeHtml } from './email/sanitizer';
import { signLink, trackLinks, unsubscribeUrl, verifyLink } from './email/tracking';

/** The CRM's pure building blocks: no database, no Nest. */

describe('sanitizeHtml', () => {
  it('keeps the allowed formatting', () => {
    expect(sanitizeHtml('<p>Hi <strong>there</strong><br>Thanks</p>')).toBe(
      '<p>Hi <strong>there</strong><br>Thanks</p>',
    );
  });

  it('drops script, style and iframe together with their content', () => {
    const out = sanitizeHtml(
      '<p>a</p><script>alert(1)</script><style>p{}</style><iframe src="https://x"></iframe><p>b</p>',
    );
    expect(out).toBe('<p>a</p><p>b</p>');
  });

  it('removes event handlers and inline styles', () => {
    const out = sanitizeHtml(
      '<p onclick="steal()" style="color:red">x</p><img src="https://cdn.example/a.png" onerror="x()">',
    );
    expect(out).not.toMatch(/onclick|onerror|style=/);
    expect(out).toContain('<img src="https://cdn.example/a.png">');
  });

  it('refuses javascript: and data: links, including obfuscated schemes', () => {
    for (const href of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'java\tscript:alert(1)',
      '&#106;avascript:alert(1)',
      'data:text/html,x',
    ]) {
      const out = sanitizeHtml(`<a href="${href}">x</a>`);
      expect(out).toBe('<a>x</a>');
    }
  });

  it('keeps http(s), mailto, tel and variable links, and opens them safely', () => {
    expect(sanitizeHtml('<a href="https://vintrax.ca">x</a>')).toBe(
      '<a href="https://vintrax.ca" target="_blank" rel="noopener noreferrer">x</a>',
    );
    expect(sanitizeHtml('<a href="{{vehicle.url}}">x</a>')).toContain('href="{{vehicle.url}}"');
    expect(sanitizeHtml('<a href="mailto:a@b.c">x</a>')).toContain('href="mailto:a@b.c"');
  });

  it('only loads images over https', () => {
    expect(sanitizeHtml('<img src="http://tracker.example/x.gif">')).toBe('<img>');
  });

  it('escapes stray angle brackets and closes unbalanced tags', () => {
    expect(sanitizeHtml('<p>1 < 2 <b>bold')).toBe('<p>1 &lt; 2 <b>bold</b></p>');
    expect(sanitizeHtml('<unknown>text</unknown>')).toBe('text');
  });

  it('cannot be tricked by attribute-quoted markup', () => {
    const out = sanitizeHtml(
      '<a title="x&quot; onmouseover=&quot;alert(1)" href="https://a.b">x</a>',
    );
    expect(out).not.toMatch(/ onmouseover=/);
  });

  it('turns HTML into readable text with link targets', () => {
    expect(
      htmlToText('<p>Hello</p><p>See <a href="https://a.b/c">the car</a></p><ul><li>One</li></ul>'),
    ).toBe('Hello\n\nSee the car (https://a.b/c)\n\n- One');
  });
});

describe('template rendering', () => {
  it('fills variables and escapes values in HTML', () => {
    const html = renderTemplate(
      '<p>Hi {{customer.first_name}}</p>',
      { 'customer.first_name': '<b>Ann</b>' },
      'html',
    );
    expect(html).toBe('<p>Hi &lt;b&gt;Ann&lt;/b&gt;</p>');
    expect(
      renderTemplate('Hi {{ customer.first_name }}', { 'customer.first_name': 'Ann' }, 'text'),
    ).toBe('Hi Ann');
  });

  it('falls back when a value is missing', () => {
    expect(renderTemplate('Hi {{customer.first_name}}', {}, 'text')).toBe('Hi there');
    expect(renderTemplate('[{{vehicle.trim}}]', {}, 'text')).toBe('[]');
  });

  it('keeps subjects to one line', () => {
    expect(
      renderSubject('Your {{vehicle.make}}\nis ready', { 'vehicle.make': 'Honda  Civic' }),
    ).toBe('Your Honda Civic is ready');
  });

  it('rejects variables that do not exist', () => {
    expect(
      unknownVariables('{{customer.first_name}} {{custmer.name}}', DEALER_TEMPLATE_VARIABLES),
    ).toEqual(['custmer.name']);
    expect(() => assertKnownVariables(DEALER_TEMPLATE_VARIABLES, 'Hi {{nope.nope}}')).toThrow(
      /Unknown variable/,
    );
    expect(() =>
      assertKnownVariables(DEALER_TEMPLATE_VARIABLES, 'Hi {{customer.first_name}}'),
    ).not.toThrow();
  });
});

describe('tracking links', () => {
  const secret = 'test-secret-test-secret';

  it('signs a link to one email and URL', () => {
    const signature = signLink(secret, 'tok', 'https://a.b/x');
    expect(verifyLink(secret, 'tok', 'https://a.b/x', signature)).toBe(true);
    expect(verifyLink(secret, 'tok', 'https://evil.example/', signature)).toBe(false);
    expect(verifyLink(secret, 'other', 'https://a.b/x', signature)).toBe(false);
    expect(verifyLink(secret, 'tok', 'https://a.b/x', 'short')).toBe(false);
  });

  it('routes http(s) links through the click tracker and leaves the rest', () => {
    const html = trackLinks(
      '<a href="https://a.b/x?y=1&amp;z=2">x</a> <a href="mailto:a@b.c">m</a>',
      'https://api.example',
      secret,
      'tok',
    );
    expect(html).toContain(
      'https://api.example/api/crm/t/c/tok?u=https%3A%2F%2Fa.b%2Fx%3Fy%3D1%26z%3D2&amp;s=',
    );
    expect(html).toContain('href="mailto:a@b.c"');
  });

  it('builds the unsubscribe page link', () => {
    expect(unsubscribeUrl('https://vintrax.ca', 'a+b')).toBe(
      'https://vintrax.ca/unsubscribe?t=a%2Bb',
    );
  });
});

describe('time zones and the send window', () => {
  const window: SendWindow = {
    timezone: 'America/Toronto',
    sendWindowStartHour: 9,
    sendWindowEndHour: 19,
    sendDays: [1, 2, 3, 4, 5, 6],
  };

  it('converts local wall-clock time to an instant', () => {
    // 9 a.m. in Toronto in October is 13:00 UTC (EDT), in January 14:00 UTC (EST).
    expect(zonedTime(2026, 10, 7, 9, 'America/Toronto').toISOString()).toBe(
      '2026-10-07T13:00:00.000Z',
    );
    expect(zonedTime(2026, 1, 7, 9, 'America/Toronto').toISOString()).toBe(
      '2026-01-07T14:00:00.000Z',
    );
    expect(localParts(new Date('2026-10-07T03:30:00Z'), 'America/Vancouver').day).toBe(6);
  });

  it('sends now inside the window', () => {
    const now = new Date('2026-10-07T15:00:00Z'); // Wednesday 11 a.m. Toronto
    expect(nextSendTime(now, window)).toEqual(now);
  });

  it('waits for the morning when it is too early or too late', () => {
    expect(nextSendTime(new Date('2026-10-07T07:00:00Z'), window).toISOString()).toBe(
      '2026-10-07T13:00:00.000Z',
    );
    // Wednesday 9 p.m. → Thursday 9 a.m.
    expect(nextSendTime(new Date('2026-10-08T01:00:00Z'), window).toISOString()).toBe(
      '2026-10-08T13:00:00.000Z',
    );
  });

  it('skips days that are not sending days', () => {
    // Saturday 8 p.m. → Monday 9 a.m. (Sunday is not a sending day).
    expect(nextSendTime(new Date('2026-10-11T00:00:00Z'), window).toISOString()).toBe(
      '2026-10-12T13:00:00.000Z',
    );
  });

  it('resolves report ranges in the dealer zone', () => {
    const now = new Date('2026-10-07T15:00:00Z');
    const month = resolveRange('THIS_MONTH', 'America/Toronto', {}, now);
    expect(month.from.toISOString()).toBe('2026-10-01T04:00:00.000Z');
    expect(month.to.toISOString()).toBe('2026-11-01T04:00:00.000Z');
    const week = resolveRange('THIS_WEEK', 'America/Toronto', {}, now);
    expect(week.from.toISOString()).toBe('2026-10-05T04:00:00.000Z'); // Monday
    const custom = resolveRange(
      'CUSTOM',
      'America/Toronto',
      { from: '2026-01-01', to: '2026-01-31' },
      now,
    );
    expect(custom.to.toISOString()).toBe('2026-02-01T05:00:00.000Z');
  });
});

describe('automation conditions', () => {
  const facts: Facts = {
    'lead.score': 55,
    'lead.temperature': 'HOT',
    'lead.tags': ['Finance', 'SUV'],
    'lead.has_replied': false,
    'vehicle.make': 'Honda',
    'lead.source': null,
  };

  it('compares numbers, text and lists', () => {
    expect(evaluate({ field: 'lead.score', op: 'gte', value: 50 }, facts)).toBe(true);
    expect(evaluate({ field: 'lead.score', op: 'lt', value: 50 }, facts)).toBe(false);
    expect(evaluate({ field: 'lead.temperature', op: 'eq', value: 'hot' }, facts)).toBe(true);
    expect(evaluate({ field: 'lead.tags', op: 'contains', value: 'finance' }, facts)).toBe(true);
    expect(evaluate({ field: 'lead.tags', op: 'neq', value: 'SUV' }, facts)).toBe(false);
    expect(evaluate({ field: 'vehicle.make', op: 'in', value: 'Toyota,Honda' }, facts)).toBe(true);
    expect(evaluate({ field: 'lead.has_replied', op: 'is_false' }, facts)).toBe(true);
  });

  it('never matches a missing fact', () => {
    expect(evaluate({ field: 'lead.source', op: 'eq', value: 'WEBSITE' }, facts)).toBe(false);
    expect(evaluate({ field: 'lead.days_since_contact', op: 'gt', value: 3 }, facts)).toBe(false);
  });

  it('requires every condition', () => {
    expect(
      evaluateAll(
        [
          { field: 'lead.score', op: 'gte', value: 50 },
          { field: 'vehicle.make', op: 'eq', value: 'Honda' },
        ],
        facts,
      ),
    ).toBe(true);
    expect(
      evaluateAll(
        [
          { field: 'lead.score', op: 'gte', value: 50 },
          { field: 'vehicle.make', op: 'eq', value: 'Ford' },
        ],
        facts,
      ),
    ).toBe(false);
    expect(evaluateAll(undefined, facts)).toBe(true);
  });
});

describe('automation graph validation', () => {
  const base = { name: 'Test', trigger: 'LEAD_CREATED' };

  it('accepts a valid sequence with a branch', () => {
    const result = automationSchema.safeParse({
      ...base,
      steps: [
        { id: 'email', type: 'SEND_EMAIL', next: 'wait', config: { templateKey: 'LEAD_INTRO' } },
        { id: 'wait', type: 'WAIT', next: 'check', config: { minutes: 1440 } },
        {
          id: 'check',
          type: 'CONDITION',
          yes: 'stop',
          no: 'task',
          config: { conditions: [{ field: 'lead.has_replied', op: 'is_true' }] },
        },
        { id: 'task', type: 'CREATE_TASK', config: { title: 'Call them' } },
        { id: 'stop', type: 'STOP' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('refuses loops, missing steps, duplicate ids and incomplete steps', () => {
    const messages = (steps: unknown[]) => {
      const result = automationSchema.safeParse({ ...base, steps });
      return result.success ? [] : result.error.issues.map((issue) => issue.message);
    };
    expect(
      messages([
        { id: 'a', type: 'WAIT', next: 'b', config: { minutes: 5 } },
        { id: 'b', type: 'WAIT', next: 'a', config: { minutes: 5 } },
      ]).join(),
    ).toMatch(/loop/i);
    expect(messages([{ id: 'a', type: 'STOP', next: 'missing' }])).toContain(
      'Step "a" points at a step that does not exist',
    );
    expect(
      messages([
        { id: 'a', type: 'STOP' },
        { id: 'a', type: 'STOP' },
      ]),
    ).toContain('Step id "a" is used twice');
    expect(messages([{ id: 'a', type: 'WAIT' }])).toContain('A wait needs a length');
    expect(messages([{ id: 'a', type: 'SEND_EMAIL' }])).toContain('Choose a template');
  });
});
