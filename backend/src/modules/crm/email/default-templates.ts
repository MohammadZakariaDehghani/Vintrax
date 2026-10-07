import type { EmailPurpose, TemplateCategory } from '@vintrax/shared';

export interface DefaultTemplate {
  key: string;
  name: string;
  category: TemplateCategory;
  /**
   * TRANSACTIONAL answers or completes something the person asked for (their
   * inquiry, their appointment, their purchase). MARKETING promotes: it needs
   * consent and carries an unsubscribe link. When unsure, MARKETING — the
   * stricter rules are the safe side.
   */
  purpose: EmailPurpose;
  subject: string;
  bodyHtml: string;
}

const p = (...lines: string[]) => lines.map((line) => `<p>${line}</p>`).join('\n');
const sign = '<p>{{salesperson.name}}<br>{{dealer.name}} · {{dealer.phone}}</p>';
const vehicle = '{{vehicle.year}} {{vehicle.make}} {{vehicle.model}}';

/** The 20 starting templates every dealership gets; each can be edited or switched off. */
export const DEFAULT_DEALER_TEMPLATES: DefaultTemplate[] = [
  {
    key: 'NEW_LEAD_INTRO',
    name: 'New lead introduction',
    category: 'INTRODUCTION',
    purpose: 'TRANSACTIONAL',
    subject: 'Thanks for reaching out to {{dealer.name}}',
    bodyHtml:
      p(
        'Hi {{customer.first_name}},',
        'Thank you for your interest. I’m {{salesperson.name}}, and I’ll be looking after you at {{dealer.name}}.',
        'What’s the best time to reach you? You can reply to this email or call me at {{salesperson.phone}}.',
      ) + sign,
  },
  {
    key: 'VEHICLE_INQUIRY_RESPONSE',
    name: 'Vehicle inquiry response',
    category: 'INQUIRY',
    purpose: 'TRANSACTIONAL',
    subject: 'Your inquiry about the ' + vehicle,
    bodyHtml:
      p(
        'Hi {{customer.first_name}},',
        `Thanks for asking about the ${vehicle}. It’s listed at {{vehicle.price}}, and you can see every photo and detail here: <a href="{{vehicle.url}}">view the vehicle</a>.`,
        'Would you like to see it in person or book a test drive? Just reply with a day and time that suits you.',
      ) + sign,
  },
  {
    key: 'THANKS_FOR_INQUIRY',
    name: 'Thanks for your inquiry',
    category: 'INQUIRY',
    purpose: 'TRANSACTIONAL',
    subject: 'We received your inquiry',
    bodyHtml:
      p(
        'Hi {{customer.first_name}},',
        'We received your message and someone from {{dealer.name}} will be in touch shortly.',
      ) + sign,
  },
  {
    key: 'APPOINTMENT_CONFIRMATION',
    name: 'Appointment confirmation',
    category: 'APPOINTMENT',
    purpose: 'TRANSACTIONAL',
    subject: 'Your appointment on {{appointment.date}}',
    bodyHtml:
      p(
        'Hi {{customer.first_name}},',
        'You’re booked for {{appointment.date}} at {{appointment.time}} at {{dealer.name}}, {{dealer.address}}.',
        'If you need to change the time, reply to this email or call {{dealer.phone}}.',
      ) + sign,
  },
  {
    key: 'APPOINTMENT_REMINDER',
    name: 'Appointment reminder',
    category: 'APPOINTMENT',
    purpose: 'TRANSACTIONAL',
    subject: 'Reminder: see you {{appointment.date}} at {{appointment.time}}',
    bodyHtml:
      p(
        'Hi {{customer.first_name}},',
        'A quick reminder of your appointment at {{dealer.name}} on {{appointment.date}} at {{appointment.time}}.',
        'See you then!',
      ) + sign,
  },
  {
    key: 'TEST_DRIVE_FOLLOW_UP',
    name: 'Test drive follow-up',
    category: 'FOLLOW_UP',
    purpose: 'MARKETING',
    subject: 'How did the ' + vehicle + ' feel?',
    bodyHtml:
      p(
        'Hi {{customer.first_name}},',
        `Thanks for coming in to drive the ${vehicle}. Do you have any questions I can answer, or would you like me to put numbers together for you?`,
      ) + sign,
  },
  {
    key: 'PRICE_FOLLOW_UP',
    name: 'Price follow-up',
    category: 'FOLLOW_UP',
    purpose: 'MARKETING',
    subject: 'About the price of the ' + vehicle,
    bodyHtml:
      p(
        'Hi {{customer.first_name}},',
        `I wanted to follow up on pricing for the ${vehicle}. Let me know if you’d like a full breakdown including taxes and fees.`,
      ) + sign,
  },
  {
    key: 'FINANCING_FOLLOW_UP',
    name: 'Financing follow-up',
    category: 'FOLLOW_UP',
    purpose: 'MARKETING',
    subject: 'Your financing options',
    bodyHtml:
      p(
        'Hi {{customer.first_name}},',
        'Thanks for your financing request. I’m happy to walk you through the options and what a monthly payment could look like.',
      ) + sign,
  },
  {
    key: 'TRADE_IN_FOLLOW_UP',
    name: 'Trade-in follow-up',
    category: 'FOLLOW_UP',
    purpose: 'MARKETING',
    subject: 'Your trade-in',
    bodyHtml:
      p(
        'Hi {{customer.first_name}},',
        'Thanks for telling us about your trade-in. If you can bring it by, we can give you a firm appraisal in about 20 minutes.',
      ) + sign,
  },
  {
    key: 'NO_RESPONSE_FOLLOW_UP',
    name: 'No response follow-up',
    category: 'FOLLOW_UP',
    purpose: 'MARKETING',
    subject: 'Still looking?',
    bodyHtml:
      p(
        'Hi {{customer.first_name}},',
        'I haven’t heard back and wanted to make sure my last message reached you. Are you still shopping, or can I help with anything?',
      ) + sign,
  },
  {
    key: 'FOLLOW_UP_DAY_1',
    name: '1 day follow-up',
    category: 'FOLLOW_UP',
    purpose: 'MARKETING',
    subject: 'Following up from {{dealer.name}}',
    bodyHtml:
      p(
        'Hi {{customer.first_name}},',
        'Just following up on your inquiry. Is there anything I can answer, or a good time for a quick call?',
      ) + sign,
  },
  {
    key: 'FOLLOW_UP_DAY_3',
    name: '3 day follow-up',
    category: 'FOLLOW_UP',
    purpose: 'MARKETING',
    subject: 'Any questions I can answer?',
    bodyHtml:
      p(
        'Hi {{customer.first_name}},',
        'I wanted to check in. If the timing isn’t right, no problem — just let me know what you’re looking for and I’ll keep an eye out.',
      ) + sign,
  },
  {
    key: 'FOLLOW_UP_DAY_7',
    name: '7 day follow-up',
    category: 'FOLLOW_UP',
    purpose: 'MARKETING',
    subject: 'A week on — still shopping?',
    bodyHtml:
      p(
        'Hi {{customer.first_name}},',
        'It’s been a week since you got in touch. We get new arrivals often; tell me what matters most to you and I’ll send matches.',
      ) + sign,
  },
  {
    key: 'FOLLOW_UP_DAY_14',
    name: '14 day follow-up',
    category: 'FOLLOW_UP',
    purpose: 'MARKETING',
    subject: 'Checking in from {{dealer.name}}',
    bodyHtml:
      p(
        'Hi {{customer.first_name}},',
        'One more check-in from me. If you’ve found something already, congratulations — and if not, I’m here to help.',
      ) + sign,
  },
  {
    key: 'NURTURE_DAY_30',
    name: '30 day nurture',
    category: 'NURTURE',
    purpose: 'MARKETING',
    subject: 'New arrivals at {{dealer.name}}',
    bodyHtml:
      p(
        'Hi {{customer.first_name}},',
        'We’ve had new vehicles arrive since we last spoke. Reply with what you’re looking for and I’ll send you a short list.',
      ) + sign,
  },
  {
    key: 'SOLD_THANK_YOU',
    name: 'Sold customer thank you',
    category: 'POST_SALE',
    purpose: 'TRANSACTIONAL',
    subject: 'Thank you for choosing {{dealer.name}}',
    bodyHtml:
      p(
        'Hi {{customer.first_name}},',
        `Congratulations on your ${vehicle}, and thank you for choosing {{dealer.name}}. If anything comes up, I’m one email away.`,
      ) + sign,
  },
  {
    key: 'DELIVERY_FOLLOW_UP',
    name: 'Delivery follow-up',
    category: 'POST_SALE',
    purpose: 'TRANSACTIONAL',
    subject: 'How is the ' + vehicle + '?',
    bodyHtml:
      p(
        'Hi {{customer.first_name}},',
        'How are you enjoying your new vehicle? If you have any questions about features or paperwork, just reply.',
      ) + sign,
  },
  {
    key: 'REVIEW_REQUEST',
    name: 'Review request',
    category: 'POST_SALE',
    purpose: 'MARKETING',
    subject: 'Would you share your experience?',
    bodyHtml:
      p(
        'Hi {{customer.first_name}},',
        'If you were happy with your experience at {{dealer.name}}, a short review would mean a lot to our team. Thank you!',
      ) + sign,
  },
  {
    key: 'SERVICE_REMINDER',
    name: 'Service reminder',
    category: 'SERVICE',
    purpose: 'MARKETING',
    subject: 'Time for a check-up?',
    bodyHtml:
      p(
        'Hi {{customer.first_name}},',
        `It’s been a while since you picked up your ${vehicle}. It may be time for routine maintenance — reply and we’ll help you book it.`,
      ) + sign,
  },
  {
    key: 'RE_ENGAGEMENT',
    name: 'Re-engagement',
    category: 'MARKETING',
    purpose: 'MARKETING',
    subject: 'Still thinking about a vehicle?',
    bodyHtml:
      p(
        'Hi {{customer.first_name}},',
        'It’s been a while! If you’re still thinking about your next vehicle, we’d love to help. Reply and tell me what you’re after.',
      ) + sign,
  },
];

/** Templates the admin support team sends; all answer the requester’s own ticket. */
export const DEFAULT_SUPPORT_TEMPLATES: DefaultTemplate[] = [
  {
    key: 'TICKET_RECEIVED',
    name: 'Ticket received',
    category: 'SUPPORT',
    purpose: 'TRANSACTIONAL',
    subject: 'We received your request (#{{ticket.number}})',
    bodyHtml: p(
      'Hi {{user.first_name}},',
      'Thanks for contacting Vintrax support. We’ve opened ticket #{{ticket.number}}: “{{ticket.subject}}”.',
      'You can follow it and reply here: <a href="{{ticket.url}}">view your ticket</a>.',
      'The Vintrax support team',
    ),
  },
  {
    key: 'TICKET_WAITING_REMINDER',
    name: 'Waiting for your reply',
    category: 'SUPPORT',
    purpose: 'TRANSACTIONAL',
    subject: 'We’re waiting for your reply (#{{ticket.number}})',
    bodyHtml: p(
      'Hi {{user.first_name}},',
      'We need a little more information to continue with ticket #{{ticket.number}}: “{{ticket.subject}}”.',
      '<a href="{{ticket.url}}">Reply to your ticket</a> when you can.',
      'The Vintrax support team',
    ),
  },
  {
    key: 'TICKET_RESOLVED',
    name: 'Ticket resolved',
    category: 'SUPPORT',
    purpose: 'TRANSACTIONAL',
    subject: 'Your request is resolved (#{{ticket.number}})',
    bodyHtml: p(
      'Hi {{user.first_name}},',
      'We’ve marked ticket #{{ticket.number}} “{{ticket.subject}}” as resolved.',
      'If anything is still not right, <a href="{{ticket.url}}">reply to the ticket</a> and it will reopen.',
      'The Vintrax support team',
    ),
  },
  {
    key: 'TICKET_SURVEY',
    name: 'Satisfaction survey',
    category: 'SUPPORT',
    purpose: 'TRANSACTIONAL',
    subject: 'How did we do? (#{{ticket.number}})',
    bodyHtml: p(
      'Hi {{user.first_name}},',
      'How was your experience with Vintrax support on “{{ticket.subject}}”? Reply to this email with a score from 1 to 5 and anything we could do better.',
      'The Vintrax support team',
    ),
  },
];
