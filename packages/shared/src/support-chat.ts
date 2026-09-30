import { z } from 'zod';
import { MAX_PAGE_SIZE } from './schemas';

/**
 * The site chat: any visitor, signed in or not, can ask the Vintrax assistant
 * a question from the corner of any public page. The assistant answers from
 * the site's help and live listings; a person on the Vintrax team can read
 * every chat under Admin → Support and step in.
 *
 * A visitor's chat is theirs through a random token the API issues when the
 * chat starts and keeps only a hash of. There is no chat id guessing: without
 * the token, a chat is not found.
 */

export const SUPPORT_CHAT_STATUSES = ['OPEN', 'CLOSED'] as const;
export type SupportChatStatus = (typeof SUPPORT_CHAT_STATUSES)[number];

export const SUPPORT_MESSAGE_ROLES = ['VISITOR', 'ASSISTANT', 'AGENT'] as const;
export type SupportMessageRole = (typeof SUPPORT_MESSAGE_ROLES)[number];

/** The longest message either side may send. */
export const MAX_SUPPORT_MESSAGE_LENGTH = 1000;
/** Visitor messages one chat takes before it asks them to use the Contact page. */
export const MAX_VISITOR_MESSAGES_PER_CHAT = 40;

/** The header a visitor's chat token travels in, so it never lands in a URL or a log line. */
export const SUPPORT_CHAT_TOKEN_HEADER = 'x-chat-token';

const message = z
  .string()
  .trim()
  .min(1, 'Type a message.')
  .max(MAX_SUPPORT_MESSAGE_LENGTH, `Keep it under ${MAX_SUPPORT_MESSAGE_LENGTH} characters.`);

/** A page path on this site, for context. Never a full URL. */
const pagePath = z
  .string()
  .trim()
  .max(300)
  .regex(/^\/[^\s]*$/, 'A site path, e.g. /vehicles')
  .optional();

export const startSupportChatSchema = z.object({ message, pagePath }).strict();
export type StartSupportChatInput = z.infer<typeof startSupportChatSchema>;

export const sendSupportMessageSchema = z.object({ message, pagePath }).strict();
export type SendSupportMessageInput = z.infer<typeof sendSupportMessageSchema>;

/** A visitor asking for a person, optionally leaving a way to be reached. */
export const requestSupportHumanSchema = z
  .object({
    name: z
      .string()
      .trim()
      .max(120)
      .nullish()
      .transform((v) => v || null),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .max(254)
      .nullish()
      .transform((v) => v || null)
      .refine((v) => v === null || z.string().email().safeParse(v).success, {
        message: 'Enter a valid email address, or leave it empty.',
      }),
  })
  .strict();
export type RequestSupportHumanInput = z.infer<typeof requestSupportHumanSchema>;

export interface SupportChatMessage {
  id: string;
  role: SupportMessageRole;
  body: string;
  /** The team member's first name, for an agent's message. */
  authorName: string | null;
  createdAt: string;
}

/** A chat as its visitor sees it. */
export interface SupportChatView {
  id: string;
  status: SupportChatStatus;
  humanRequested: boolean;
  /** A team member has replied; the assistant stays quiet from then on. */
  agentJoined: boolean;
  messages: SupportChatMessage[];
}

/** What starting a chat returns: the chat, and the token that is the visitor's key to it. */
export interface StartedSupportChat extends SupportChatView {
  token: string;
}

// --- Admin -------------------------------------------------------------------

export const adminSupportChatQuerySchema = z.object({
  status: z.enum(SUPPORT_CHAT_STATUSES).optional(),
  /** Only chats where the visitor asked for a person. */
  humanRequested: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
});
export type AdminSupportChatQuery = z.infer<typeof adminSupportChatQuerySchema>;

export interface SupportChatSummary {
  id: string;
  status: SupportChatStatus;
  humanRequested: boolean;
  agentJoined: boolean;
  visitorName: string | null;
  visitorEmail: string | null;
  /** The signed-in account the chat was started from, if any. */
  account: { id: string; name: string; email: string } | null;
  pagePath: string | null;
  /** Visitor messages no team member has opened yet. */
  unread: number;
  messageCount: number;
  lastMessage: string | null;
  lastMessageAt: string;
  createdAt: string;
}

export interface SupportChatDetail extends SupportChatSummary {
  messages: SupportChatMessage[];
}

export interface SupportChatPage {
  items: SupportChatSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export const adminSupportReplySchema = z.object({ message }).strict();
export type AdminSupportReplyInput = z.infer<typeof adminSupportReplySchema>;

export const updateSupportChatSchema = z.object({ status: z.enum(SUPPORT_CHAT_STATUSES) }).strict();
export type UpdateSupportChatInput = z.infer<typeof updateSupportChatSchema>;
