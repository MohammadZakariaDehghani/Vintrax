import { contactMessageSchema } from '@vintrax/shared';
import { renderTemplate } from '../../common/mail/templates/catalog';
import { ContactService } from './contact.service';

/**
 * The Contact page's form sends email, so it is worth more to a spammer than
 * any other public endpoint. Four things are pinned: a message is kept even
 * when it cannot be emailed, it goes to the address set in the admin (the
 * private recipient first, then the public email), a reply reaches the
 * sender, and a bot that fills the hidden field is dropped without a trace.
 */

const message = contactMessageSchema.parse({
  name: 'Sam Driver',
  email: 'Sam@Example.com',
  phone: '514 555 0100',
  subject: 'Question about\r\nBcc: victim@example.com',
  message: 'Is the 2021 Civic still available?',
});

function setup(settings: { contactRecipient: string | null; contactEmail: string | null } | null) {
  const create = jest.fn().mockResolvedValue({ id: 'm1' });
  const send = jest.fn().mockResolvedValue('email-1');
  const contact = new ContactService(
    {
      contactMessage: { create },
      siteSettings: { findUnique: jest.fn().mockResolvedValue(settings) },
    } as never,
    { sendTemplate: send } as never,
  );
  return { contact, create, send };
}

describe('a Contact-page message', () => {
  it('is kept, then emailed to the private recipient with a reply-to of the sender', async () => {
    const { contact, create, send } = setup({
      contactRecipient: 'inbox@vintrax.ca',
      contactEmail: 'hello@vintrax.ca',
    });

    await contact.submit(message);

    expect(create).toHaveBeenCalledTimes(1);
    const [template, to, vars, options] = send.mock.calls[0];
    expect(template).toBe('contact.message');
    expect(to).toBe('inbox@vintrax.ca');
    expect(options).toMatchObject({ replyTo: 'sam@example.com' });
    expect(vars.message).toContain('Is the 2021 Civic still available?');
  });

  it('goes to the public contact email when no private recipient is set', async () => {
    const { contact, send } = setup({ contactRecipient: null, contactEmail: 'hello@vintrax.ca' });
    await contact.submit(message);
    expect(send.mock.calls[0][1]).toBe('hello@vintrax.ca');
  });

  it('is still kept when there is nowhere to email it', async () => {
    const { contact, create, send } = setup(null);
    await contact.submit(message);
    expect(create).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });

  /** A line break in the subject would otherwise start a header of the visitor's choosing. */
  it('cannot add a header through the subject', async () => {
    const { contact, send } = setup({ contactRecipient: 'inbox@vintrax.ca', contactEmail: null });
    await contact.submit(message);
    const vars = send.mock.calls[0][2];
    expect(vars.subject).not.toMatch(/[\r\n]/);
    expect(renderTemplate('contact.message', vars, 'https://vintrax.test').subject).not.toMatch(
      /[\r\n]/,
    );
  });

  it('is dropped quietly when the hidden honeypot field is filled', async () => {
    const { contact, create, send } = setup({
      contactRecipient: 'inbox@vintrax.ca',
      contactEmail: null,
    });
    await expect(
      contact.submit({ ...message, website: 'https://spam.example' }),
    ).resolves.toBeUndefined();
    expect(create).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('needs a name, a real email address, a subject and a few words', () => {
    expect(() => contactMessageSchema.parse({ ...message, name: '' })).toThrow();
    expect(() => contactMessageSchema.parse({ ...message, email: 'not-an-email' })).toThrow();
    expect(() => contactMessageSchema.parse({ ...message, subject: '' })).toThrow();
    expect(() => contactMessageSchema.parse({ ...message, message: 'hi' })).toThrow();
  });
});
