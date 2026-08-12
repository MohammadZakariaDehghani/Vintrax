import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  ConversationDetail,
  ConversationParticipant,
  ConversationSummary,
  MessageDto,
  Paginated,
  StartConversationInput,
} from '@atlas/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../../common/auth/auth-user';

const participantSelect = { id: true, displayName: true, role: true } satisfies Prisma.UserSelect;

const conversationSelect = {
  id: true,
  createdAt: true,
  updatedAt: true,
  lastMessageAt: true,
  buyer: { select: participantSelect },
  seller: { select: participantSelect },
  listing: {
    select: {
      id: true,
      title: true,
      priceCad: true,
      status: true,
      images: { select: { url: true }, orderBy: { position: 'asc' }, take: 1 },
    },
  },
  messages: {
    select: { id: true, conversationId: true, senderId: true, body: true, readAt: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 1,
  },
} satisfies Prisma.ConversationSelect;

type ConversationRow = Prisma.ConversationGetPayload<{ select: typeof conversationSelect }>;

@Injectable()
export class MessagingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Opens — or continues — the thread between a buyer and a listing's seller.
   * The seller is derived from the listing rather than supplied by the client,
   * so a caller cannot address a message to an arbitrary account.
   */
  async startConversation(
    input: StartConversationInput,
    user: AuthUser,
  ): Promise<ConversationDetail> {
    const listing = await this.prisma.listing.findUnique({
      where: { id: input.listingId },
      select: { id: true, sellerId: true, status: true },
    });
    if (!listing) throw new NotFoundException('Listing not found');
    if (listing.sellerId === user.id) {
      throw new BadRequestException('You cannot message yourself about your own listing');
    }
    if (listing.status !== 'ACTIVE') {
      throw new BadRequestException('This listing is not accepting enquiries');
    }

    const conversation = await this.prisma.conversation.upsert({
      where: { listingId_buyerId: { listingId: listing.id, buyerId: user.id } },
      update: {},
      create: { listingId: listing.id, buyerId: user.id, sellerId: listing.sellerId },
      select: { id: true },
    });

    await this.appendMessage(conversation.id, user.id, input.body);
    return this.getConversation(conversation.id, user);
  }

  async listConversations(
    user: AuthUser,
    page: number,
    pageSize: number,
  ): Promise<Paginated<ConversationSummary>> {
    // A user sees a thread whether they are its buyer or its seller.
    const where: Prisma.ConversationWhereInput = {
      OR: [{ buyerId: user.id }, { sellerId: user.id }],
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

    await this.prisma.message.updateMany({
      where: { conversationId: id, senderId: { not: user.id }, readAt: null },
      data: { readAt: new Date() },
    });

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
    const [message] = await this.prisma.$transaction([
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
      // Keeps the inbox sortable without aggregating over messages on every read.
      this.prisma.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: new Date() },
      }),
    ]);
    return message;
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

  private toSummary(row: ConversationRow, viewerId: string, unreadCount: number): ConversationSummary {
    const buyer: ConversationParticipant = row.buyer;
    const seller: ConversationParticipant = row.seller;
    const lastMessage = row.messages[0];

    return {
      id: row.id,
      listing: {
        id: row.listing.id,
        title: row.listing.title,
        priceCad: row.listing.priceCad,
        primaryImageUrl: row.listing.images[0]?.url ?? null,
        status: row.listing.status,
      },
      buyer,
      seller,
      counterparty: viewerId === buyer.id ? seller : buyer,
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
