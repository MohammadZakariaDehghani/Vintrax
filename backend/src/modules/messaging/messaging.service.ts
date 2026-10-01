import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  ConversationDetail,
  ConversationParticipant,
  ConversationQuery,
  ConversationSummary,
  MessageDto,
  Paginated,
  StartConversationInput,
} from '@vintrax/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { NotificationsService } from '../notifications/notifications.service';
import { MessagingGateway } from './messaging.gateway';

/** How much of a message a notification quotes. */
const PREVIEW_LENGTH = 140;

const participantSelect = {
  id: true,
  firstName: true,
  lastName: true,
  role: true,
} satisfies Prisma.UserSelect;

type ParticipantRow = Prisma.UserGetPayload<{ select: typeof participantSelect }>;

/** Users are stored as first and last name; the wire contract carries one. */
const toParticipant = (row: ParticipantRow): ConversationParticipant => ({
  id: row.id,
  displayName: `${row.firstName} ${row.lastName}`.trim(),
  role: row.role,
});

const conversationSelect = {
  id: true,
  createdAt: true,
  updatedAt: true,
  lastMessageAt: true,
  buyerArchivedAt: true,
  sellerArchivedAt: true,
  buyer: { select: participantSelect },
  seller: { select: participantSelect },
  vehicle: {
    select: {
      id: true,
      slug: true,
      title: true,
      priceCad: true,
      status: true,
      images: { select: { url: true }, orderBy: { position: 'asc' }, take: 1 },
    },
  },
  messages: {
    select: {
      id: true,
      conversationId: true,
      senderId: true,
      body: true,
      readAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 1,
  },
} satisfies Prisma.ConversationSelect;

type ConversationRow = Prisma.ConversationGetPayload<{ select: typeof conversationSelect }>;

/** Which of the caller's chats a box holds. */
function boxFilter(userId: string, box: ConversationQuery['box']): Prisma.ConversationWhereInput {
  const asBuyer = { buyerId: userId };
  const asSeller = { sellerId: userId };
  switch (box) {
    case 'BUYING':
      return { ...asBuyer, buyerArchivedAt: null };
    case 'SELLING':
      return { ...asSeller, sellerArchivedAt: null };
    case 'ARCHIVED':
      return {
        OR: [
          { ...asBuyer, buyerArchivedAt: { not: null } },
          { ...asSeller, sellerArchivedAt: { not: null } },
        ],
      };
    default:
      return {
        OR: [
          { ...asBuyer, buyerArchivedAt: null },
          { ...asSeller, sellerArchivedAt: null },
        ],
      };
  }
}

/** A search over the car's title and the *other* person's name — not the caller's own. */
function searchFilter(userId: string, q: string | undefined): Prisma.ConversationWhereInput {
  if (!q) return {};
  const contains = { contains: q, mode: 'insensitive' as const };
  const named = { OR: [{ firstName: contains }, { lastName: contains }, { username: contains }] };
  return {
    OR: [
      { vehicle: { title: contains } },
      { buyerId: userId, seller: named },
      { sellerId: userId, buyer: named },
    ],
  };
}

/**
 * Chats between a buyer and a car's seller — private sellers and dealers alike
 * — in the shape of Marketplace's messenger: an inbox split into buying and
 * selling, archive per side, "seen" receipts, live delivery over the
 * `/messages` socket, and a notification when someone writes.
 */
@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: MessagingGateway,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Opens — or continues — the thread between a buyer and a vehicle's seller.
   * The seller is derived from the vehicle rather than supplied by the client,
   * so a caller cannot address a message to an arbitrary account.
   */
  async startConversation(
    input: StartConversationInput,
    user: AuthUser,
  ): Promise<ConversationDetail> {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id: input.vehicleId },
      select: { id: true, sellerId: true, status: true },
    });
    if (!vehicle) throw new NotFoundException('Vehicle not found');
    if (vehicle.sellerId === user.id) {
      throw new BadRequestException('You cannot message yourself about your own vehicle');
    }
    if (vehicle.status !== 'ACTIVE') {
      throw new BadRequestException('This vehicle is not accepting enquiries');
    }

    const conversation = await this.prisma.conversation.upsert({
      where: { vehicleId_buyerId: { vehicleId: vehicle.id, buyerId: user.id } },
      update: {},
      create: { vehicleId: vehicle.id, buyerId: user.id, sellerId: vehicle.sellerId },
      select: { id: true },
    });

    await this.appendMessage(conversation.id, user.id, input.body);
    return this.getConversation(conversation.id, user);
  }

  async listConversations(
    user: AuthUser,
    query: Pick<ConversationQuery, 'page' | 'pageSize'> & Partial<ConversationQuery>,
  ): Promise<Paginated<ConversationSummary>> {
    const { page, pageSize } = query;
    // A user sees a thread whether they are its buyer or its seller; the box
    // narrows that, and archived chats live in their own box.
    const where: Prisma.ConversationWhereInput = {
      AND: [boxFilter(user.id, query.box ?? 'ALL'), searchFilter(user.id, query.q)],
    };

    const [total, rows] = await Promise.all([
      this.prisma.conversation.count({ where }),
      this.prisma.conversation.findMany({
        where,
        select: conversationSelect,
        orderBy: { lastMessageAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const unreadCounts = await this.unreadCounts(
      user.id,
      rows.map((row) => row.id),
    );

    return {
      items: rows.map((row) => this.toSummary(row, user.id, unreadCounts.get(row.id) ?? 0)),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  /** Returns a full thread and marks the counterparty's messages as read. */
  async getConversation(id: string, user: AuthUser): Promise<ConversationDetail> {
    const row = await this.prisma.conversation.findUnique({
      where: { id },
      select: conversationSelect,
    });
    if (!row) throw new NotFoundException('Conversation not found');
    this.assertParticipant(row, user);

    const readAt = new Date();
    const { count } = await this.prisma.message.updateMany({
      where: { conversationId: id, senderId: { not: user.id }, readAt: null },
      data: { readAt },
    });
    // The other side's "Sent" turns to "Seen" while they watch.
    if (count > 0) {
      const counterpartyId = row.buyer.id === user.id ? row.seller.id : row.buyer.id;
      this.gateway.emitTo([counterpartyId], {
        type: 'conversation:read',
        conversationId: id,
        readerId: user.id,
        readAt: readAt.toISOString(),
      });
    }

    const messages = await this.prisma.message.findMany({
      where: { conversationId: id },
      select: {
        id: true,
        conversationId: true,
        senderId: true,
        body: true,
        readAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    return {
      ...this.toSummary(row, user.id, 0),
      messages: messages.map((message) => this.toMessage(message)),
    };
  }

  async sendMessage(conversationId: string, body: string, user: AuthUser): Promise<MessageDto> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true, buyerId: true, sellerId: true },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    if (conversation.buyerId !== user.id && conversation.sellerId !== user.id) {
      throw new ForbiddenException('You are not a participant in this conversation');
    }

    const message = await this.appendMessage(conversationId, user.id, body);
    return this.toMessage(message);
  }

  /** Archives a chat — or brings it back — for the caller only; the other side is unaffected. */
  async setArchived(id: string, archived: boolean, user: AuthUser): Promise<ConversationSummary> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id },
      select: { buyerId: true, sellerId: true },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    if (conversation.buyerId !== user.id && conversation.sellerId !== user.id) {
      throw new ForbiddenException('You are not a participant in this conversation');
    }
    const stamp = archived ? new Date() : null;
    const row = await this.prisma.conversation.update({
      where: { id },
      data:
        conversation.buyerId === user.id ? { buyerArchivedAt: stamp } : { sellerArchivedAt: stamp },
      select: conversationSelect,
    });
    const unread = await this.unreadCounts(user.id, [id]);
    return this.toSummary(row, user.id, unread.get(id) ?? 0);
  }

  /** Total unread messages across all of the user's threads, for the navbar badge. */
  async unreadTotal(user: AuthUser): Promise<{ unread: number }> {
    const unread = await this.prisma.message.count({
      where: {
        readAt: null,
        senderId: { not: user.id },
        conversation: { OR: [{ buyerId: user.id }, { sellerId: user.id }] },
      },
    });
    return { unread };
  }

  private async appendMessage(conversationId: string, senderId: string, body: string) {
    const [message, conversation] = await this.prisma.$transaction([
      this.prisma.message.create({
        data: { conversationId, senderId, body },
        select: {
          id: true,
          conversationId: true,
          senderId: true,
          body: true,
          readAt: true,
          createdAt: true,
        },
      }),
      // Keeps the inbox sortable without aggregating over messages on every
      // read, and brings an archived chat back to both inboxes, as a new
      // Marketplace message does.
      this.prisma.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: new Date(), buyerArchivedAt: null, sellerArchivedAt: null },
        select: {
          buyerId: true,
          sellerId: true,
          vehicle: { select: { title: true } },
          buyer: { select: { firstName: true, lastName: true } },
          seller: { select: { firstName: true, lastName: true } },
        },
      }),
    ]);

    const dto = this.toMessage(message);
    this.gateway.emitTo([conversation.buyerId, conversation.sellerId], {
      type: 'message:new',
      conversationId,
      message: dto,
    });
    // A failed notification must never fail the message itself.
    void this.notifyRecipient(conversationId, message.id, senderId, body, conversation).catch(
      (error: unknown) => this.logger.warn(`Message notification failed: ${String(error)}`),
    );
    return message;
  }

  /**
   * Tells the recipient about a new message — in the app, and by email if they
   * keep email notifications on — but only for the first unread one in a
   * thread: a buyer sending five lines in a row is one notification, not five.
   */
  private async notifyRecipient(
    conversationId: string,
    messageId: string,
    senderId: string,
    body: string,
    conversation: {
      buyerId: string;
      sellerId: string;
      vehicle: { title: string };
      buyer: { firstName: string; lastName: string };
      seller: { firstName: string; lastName: string };
    },
  ): Promise<void> {
    const recipientId =
      senderId === conversation.buyerId ? conversation.sellerId : conversation.buyerId;
    const earlierUnread = await this.prisma.message.count({
      where: { conversationId, senderId, readAt: null, id: { not: messageId } },
    });
    if (earlierUnread > 0) return;

    const sender = senderId === conversation.buyerId ? conversation.buyer : conversation.seller;
    const preview = body.length > PREVIEW_LENGTH ? `${body.slice(0, PREVIEW_LENGTH - 1)}…` : body;
    await this.notifications.notify({
      userId: recipientId,
      type: 'MESSAGE_RECEIVED',
      // A buyer writes about the seller's car; a seller replies about the car the buyer asked about.
      title:
        senderId === conversation.buyerId
          ? `New message about your ${conversation.vehicle.title}`
          : `New reply about the ${conversation.vehicle.title}`,
      body: `${sender.firstName}: ${preview}`,
      link: `/dashboard/messages/${conversationId}`,
      email: true,
    });
  }

  private async unreadCounts(
    userId: string,
    conversationIds: string[],
  ): Promise<Map<string, number>> {
    if (!conversationIds.length) return new Map();
    const grouped = await this.prisma.message.groupBy({
      by: ['conversationId'],
      where: {
        conversationId: { in: conversationIds },
        senderId: { not: userId },
        readAt: null,
      },
      _count: { _all: true },
    });
    return new Map(grouped.map((row) => [row.conversationId, row._count._all]));
  }

  private assertParticipant(row: ConversationRow, user: AuthUser): void {
    if (row.buyer.id !== user.id && row.seller.id !== user.id) {
      throw new ForbiddenException('You are not a participant in this conversation');
    }
  }

  private toSummary(
    row: ConversationRow,
    viewerId: string,
    unreadCount: number,
  ): ConversationSummary {
    const buyer = toParticipant(row.buyer);
    const seller = toParticipant(row.seller);
    const lastMessage = row.messages[0];
    const viewerRole = viewerId === buyer.id ? 'BUYER' : 'SELLER';

    return {
      id: row.id,
      vehicle: {
        id: row.vehicle.id,
        slug: row.vehicle.slug,
        title: row.vehicle.title,
        priceCad: row.vehicle.priceCad,
        primaryImageUrl: row.vehicle.images[0]?.url ?? null,
        status: row.vehicle.status,
      },
      buyer,
      seller,
      counterparty: viewerId === buyer.id ? seller : buyer,
      viewerRole,
      archived: Boolean(viewerRole === 'BUYER' ? row.buyerArchivedAt : row.sellerArchivedAt),
      lastMessage: lastMessage ? this.toMessage(lastMessage) : null,
      unreadCount,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toMessage(message: {
    id: string;
    conversationId: string;
    senderId: string;
    body: string;
    readAt: Date | null;
    createdAt: Date;
  }): MessageDto {
    return {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      body: message.body,
      readAt: message.readAt?.toISOString() ?? null,
      createdAt: message.createdAt.toISOString(),
    };
  }
}
