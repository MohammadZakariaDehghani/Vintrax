import { ForbiddenException } from '@nestjs/common';
import { conversationQuerySchema } from '@vintrax/shared';
import { MessagingService } from './messaging.service';

/**
 * The Marketplace-style inbox: which chats each box holds, archive for one
 * side only, live events to both sides, and one notification per burst.
 */

const BUYER = { id: 'b1', email: 'b@example.test' } as never;
const SELLER = { id: 's1', email: 's@example.test' } as never;
const STRANGER = { id: 'x1', email: 'x@example.test' } as never;

const person = (id: string, firstName: string) => ({
  id,
  firstName,
  lastName: 'Test',
  role: 'BUYER' as const,
});

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    createdAt: new Date(),
    updatedAt: new Date(),
    lastMessageAt: new Date(),
    buyerArchivedAt: null,
    sellerArchivedAt: null,
    buyer: person('b1', 'Bea'),
    seller: person('s1', 'Sam'),
    vehicle: {
      id: 'v1',
      slug: '2020-honda-civic',
      title: '2020 Honda Civic',
      priceCad: 18_000,
      status: 'ACTIVE',
      images: [],
    },
    messages: [],
    ...overrides,
  };
}

function setup({ earlierUnread = 0 } = {}) {
  const gateway = { emitTo: jest.fn() };
  const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
  const prisma = {
    conversation: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue({ id: 'c1', buyerId: 'b1', sellerId: 's1' }),
      update: jest.fn(
        (args: { data?: Record<string, unknown>; select?: Record<string, unknown> }) =>
          Promise.resolve(
            args.select && 'vehicle' in args.select && 'buyerId' in args.select
              ? {
                  buyerId: 'b1',
                  sellerId: 's1',
                  vehicle: { title: '2020 Honda Civic' },
                  buyer: { firstName: 'Bea', lastName: 'Test' },
                  seller: { firstName: 'Sam', lastName: 'Test' },
                }
              : row(),
          ),
      ),
    },
    message: {
      create: jest.fn(({ data }: { data: { body: string; senderId: string } }) =>
        Promise.resolve({
          id: 'm1',
          conversationId: 'c1',
          senderId: data.senderId,
          body: data.body,
          readAt: null,
          createdAt: new Date(),
        }),
      ),
      count: jest.fn().mockResolvedValue(earlierUnread),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn((ops: Array<Promise<unknown>>) => Promise.all(ops)),
  };
  const service = new MessagingService(prisma as never, gateway as never, notifications as never);
  return { service, prisma, gateway, notifications };
}

const flush = () => new Promise((done) => setImmediate(done));

describe('the inbox boxes', () => {
  const whereFor = async (box: string, q?: string) => {
    const { service, prisma } = setup();
    await service.listConversations(SELLER, conversationQuerySchema.parse({ box, q }));
    return prisma.conversation.findMany.mock.calls[0][0].where;
  };

  it('shows every chat not archived by the caller, buying and selling', async () => {
    expect(await whereFor('ALL')).toEqual({
      AND: [
        {
          OR: [
            { buyerId: 's1', buyerArchivedAt: null },
            { sellerId: 's1', sellerArchivedAt: null },
          ],
        },
        {},
      ],
    });
  });

  it('splits buying from selling', async () => {
    expect((await whereFor('SELLING')).AND[0]).toEqual({ sellerId: 's1', sellerArchivedAt: null });
    expect((await whereFor('BUYING')).AND[0]).toEqual({ buyerId: 's1', buyerArchivedAt: null });
  });

  it('keeps archived chats in their own box', async () => {
    expect((await whereFor('ARCHIVED')).AND[0]).toEqual({
      OR: [
        { buyerId: 's1', buyerArchivedAt: { not: null } },
        { sellerId: 's1', sellerArchivedAt: { not: null } },
      ],
    });
  });

  it('searches the car and the other person, never the caller’s own name', async () => {
    const search = (await whereFor('ALL', 'civic')).AND[1];
    expect(search.OR).toEqual([
      { vehicle: { title: { contains: 'civic', mode: 'insensitive' } } },
      { buyerId: 's1', seller: expect.any(Object) },
      { sellerId: 's1', buyer: expect.any(Object) },
    ]);
  });
});

describe('sending a message', () => {
  it('reaches both sides live, and brings the chat back from either side’s archive', async () => {
    const { service, prisma, gateway } = setup();
    await service.sendMessage('c1', 'Is it still available?', BUYER);
    const update = prisma.conversation.update.mock.calls[0]![0];
    expect(update.data).toMatchObject({ buyerArchivedAt: null, sellerArchivedAt: null });
    expect(gateway.emitTo).toHaveBeenCalledWith(
      ['b1', 's1'],
      expect.objectContaining({ type: 'message:new', conversationId: 'c1' }),
    );
  });

  it('notifies the seller by app and email about the first unread message', async () => {
    const { service, notifications } = setup({ earlierUnread: 0 });
    await service.sendMessage('c1', 'Is it still available?', BUYER);
    await flush();
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 's1',
        type: 'MESSAGE_RECEIVED',
        title: 'New message about your 2020 Honda Civic',
        body: 'Bea: Is it still available?',
        link: '/dashboard/messages/c1',
        email: true,
      }),
    );
  });

  it('does not notify again while earlier messages are still unread', async () => {
    const { service, notifications } = setup({ earlierUnread: 2 });
    await service.sendMessage('c1', 'Hello?', BUYER);
    await flush();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('refuses someone who is not in the chat', async () => {
    const { service } = setup();
    await expect(service.sendMessage('c1', 'hi', STRANGER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('archiving', () => {
  it('archives for the caller only', async () => {
    const { service, prisma } = setup();
    await service.setArchived('c1', true, SELLER);
    const { data } = prisma.conversation.update.mock.calls[0]![0];
    expect(data).toEqual({ sellerArchivedAt: expect.any(Date) });
  });

  it('refuses someone who is not in the chat', async () => {
    const { service } = setup();
    await expect(service.setArchived('c1', true, STRANGER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
