import { randomUUID } from 'node:crypto';
import {
  type CanActivate,
  type ExecutionContext,
  type INestApplication,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { AuthUser } from '../../common/auth/auth-user';
import type { HelpModel, HelpModelRequest } from '../../common/ai/language-model';
import { languageModelFactory } from '../../common/ai/model-factory';
import { OpenAiCompatibleModel } from '../../common/ai/openai-compatible-model';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { validateEnv } from '../../config/env';
import { SupportChatController } from './support-chat.controller';
import { SITE_CHAT_FALLBACK, SupportChatService, priceCap } from './support-chat.service';

/**
 * The site chat end to end: the real controller, validation, guards and
 * service, over an in-memory stand-in for the Prisma calls it makes.
 */

type Role = 'VISITOR' | 'ASSISTANT' | 'AGENT';
interface MessageRow {
  id: string;
  chatId: string;
  role: Role;
  body: string;
  authorId: string | null;
  createdAt: Date;
}
interface ChatRow {
  id: string;
  tokenHash: string;
  userId: string | null;
  visitorName: string | null;
  visitorEmail: string | null;
  pagePath: string | null;
  status: 'OPEN' | 'CLOSED';
  humanRequested: boolean;
  agentJoined: boolean;
  unreadByTeam: number;
  lastMessageAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

let clock = Date.now();
const tick = () => new Date((clock += 1000));

class FakeDatabase {
  chats = new Map<string, ChatRow>();
  messages: MessageRow[] = [];
  vehicles = [
    {
      title: '2016 Ford Focus SE',
      slug: '2016-ford-focus-se',
      priceCad: 6980,
      mileageKm: 154452,
      city: 'Vancouver',
      province: 'BC',
      make: 'Ford',
      model: 'Focus',
      status: 'ACTIVE',
    },
    {
      title: '2022 Toyota RAV4 XLE',
      slug: '2022-toyota-rav4-xle',
      priceCad: 38900,
      mileageKm: 41200,
      city: 'North Vancouver',
      province: 'BC',
      make: 'Toyota',
      model: 'RAV4',
      status: 'ACTIVE',
    },
  ];
  admins = [{ id: 'admin-1' }, { id: 'admin-2' }];

  private addMessage(chatId: string, create: { role: Role; body: string; authorId?: string }) {
    this.messages.push({
      id: randomUUID(),
      chatId,
      role: create.role,
      body: create.body,
      authorId: create.authorId ?? null,
      createdAt: tick(),
    });
  }

  private full(chat: ChatRow) {
    const messages = this.messages
      .filter((m) => m.chatId === chat.id)
      .map((m) => ({ ...m, author: m.authorId ? { firstName: 'Dana' } : null }));
    return { ...chat, messages, user: null, _count: { messages: messages.length } };
  }

  supportChat = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const now = tick();
      const chat: ChatRow = {
        id: randomUUID(),
        tokenHash: data['tokenHash'] as string,
        userId: (data['userId'] as string | null) ?? null,
        visitorName: (data['visitorName'] as string | null) ?? null,
        visitorEmail: (data['visitorEmail'] as string | null) ?? null,
        pagePath: (data['pagePath'] as string | null) ?? null,
        status: 'OPEN',
        humanRequested: false,
        agentJoined: false,
        unreadByTeam: (data['unreadByTeam'] as number) ?? 0,
        lastMessageAt: now,
        createdAt: now,
        updatedAt: now,
      };
      this.chats.set(chat.id, chat);
      const nested = data['messages'] as { create: { role: Role; body: string } };
      this.addMessage(chat.id, nested.create);
      return { id: chat.id };
    },
    findFirst: async ({ where }: { where: { id: string; tokenHash: string } }) => {
      const chat = this.chats.get(where.id);
      return chat && chat.tokenHash === where.tokenHash ? chat : null;
    },
    findUnique: async ({ where }: { where: { id: string } }) => {
      const chat = this.chats.get(where.id);
      return chat ? this.full(chat) : null;
    },
    findMany: async () =>
      [...this.chats.values()]
        .sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime())
        .map((chat) => {
          const full = this.full(chat);
          return { ...full, messages: full.messages.slice(-1) };
        }),
    count: async ({ where }: { where?: Record<string, unknown> } = {}) =>
      [...this.chats.values()].filter((chat) => {
        const unread = where?.['unreadByTeam'] as { gt: number } | undefined;
        if (unread && !(chat.unreadByTeam > unread.gt)) return false;
        if (where?.['status'] && chat.status !== where['status']) return false;
        return true;
      }).length,
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const chat = this.chats.get(where.id)!;
      for (const [key, value] of Object.entries(data)) {
        if (key === 'messages') {
          this.addMessage(chat.id, (value as { create: { role: Role; body: string } }).create);
        } else if (value && typeof value === 'object' && 'increment' in value) {
          const numbers = chat as never as Record<string, number>;
          numbers[key] = (numbers[key] ?? 0) + (value as { increment: number }).increment;
        } else {
          (chat as never as Record<string, unknown>)[key] = value;
        }
      }
      return chat;
    },
  };

  supportChatMessage = {
    count: async ({ where }: { where: { chatId: string; role: Role } }) =>
      this.messages.filter((m) => m.chatId === where.chatId && m.role === where.role).length,
    findMany: async ({ where, take }: { where: { chatId: string }; take: number }) =>
      this.messages
        .filter((m) => m.chatId === where.chatId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, take),
  };

  vehicle = {
    findMany: async ({ where }: { where: Record<string, unknown> }) => {
      const or =
        (where['OR'] as Array<Record<string, { equals?: string; contains?: string }>>) ?? [];
      const cap = (where['priceCad'] as { lte: number } | undefined)?.lte;
      return this.vehicles.filter((v) => {
        if (cap !== undefined && v.priceCad > cap) return false;
        if (or.length === 0) return true;
        return or.some((clause) => {
          const [field, filter] = Object.entries(clause)[0]!;
          const value = String((v as Record<string, unknown>)[field]).toLowerCase();
          return filter.equals !== undefined
            ? value === filter.equals.toLowerCase()
            : value.includes(String(filter.contains).toLowerCase());
        });
      });
    },
  };

  user = { findMany: async () => this.admins };
}

const ADMIN: AuthUser = {
  id: 'admin-1',
  email: 'admin@example.test',
  firstName: 'Dana',
  lastName: 'Admin',
  role: 'ADMIN',
  status: 'ACTIVE',
  emailVerified: true,
  dealerId: null,
};
const BUYER: AuthUser = { ...ADMIN, id: 'buyer-1', role: 'BUYER', firstName: 'Sam' };

@Injectable()
class TestIdentityGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, string>; user?: AuthUser }>();
    const who = req.headers['x-test-user'];
    if (who === 'admin') req.user = ADMIN;
    if (who === 'buyer') req.user = BUYER;
    return true;
  }
}

async function appWith(model: HelpModel | null) {
  const db = new FakeDatabase();
  const notifications = { notify: jest.fn(async () => undefined) };
  const service = new SupportChatService(db as never, notifications as never, model);
  const moduleRef = await Test.createTestingModule({
    controllers: [SupportChatController],
    providers: [
      { provide: SupportChatService, useValue: service },
      { provide: APP_GUARD, useClass: TestIdentityGuard },
      { provide: APP_GUARD, useClass: PermissionsGuard },
    ],
  }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return { app, db, notifications };
}

describe('site chat, without a language model', () => {
  let app: INestApplication;
  let db: FakeDatabase;
  let notifications: { notify: jest.Mock };
  let chatId: string;
  let token: string;

  beforeAll(async () => {
    ({ app, db, notifications } = await appWith(null));
  });
  afterAll(async () => {
    await app.close();
  });

  it('starts a chat for any visitor, answers from live listings, and tells the team', async () => {
    const response = await request(app.getHttpServer())
      .post('/support-chat')
      .send({ message: 'Do you have a Ford Focus under $10k?', pagePath: '/' })
      .expect(201);
    ({ id: chatId, token } = response.body);

    expect(token).toEqual(expect.any(String));
    expect(response.body.messages.map((m: { role: string }) => m.role)).toEqual([
      'VISITOR',
      'ASSISTANT',
    ]);
    const answer = response.body.messages[1].body as string;
    expect(answer).toContain('/vehicles/2016-ford-focus-se');
    expect(answer).not.toContain('RAV4'); // over the price cap, and not a Focus
    expect(notifications.notify).toHaveBeenCalledTimes(2); // both admins
    expect(notifications.notify.mock.calls[0]![0]).toMatchObject({
      link: `/admin/support/${chatId}`,
    });
    // Only a hash of the token is kept.
    expect(JSON.stringify([...db.chats.values()])).not.toContain(token);
  });

  it('answers site questions from the articles, and says so when it cannot', async () => {
    const finance = await request(app.getHttpServer())
      .post(`/support-chat/${chatId}/messages`)
      .set('x-chat-token', token)
      .send({ message: 'Can I get a loan? Does it affect my credit score?' })
      .expect(201);
    expect(finance.body.messages.at(-1).body).toMatch(/not a lender/);

    const unknown = await request(app.getHttpServer())
      .post(`/support-chat/${chatId}/messages`)
      .set('x-chat-token', token)
      .send({ message: 'What is the weather tomorrow?' })
      .expect(201);
    expect(unknown.body.messages.at(-1).body).toBe(SITE_CHAT_FALLBACK);
  });

  it('keeps a chat to the visitor who holds its token', async () => {
    await request(app.getHttpServer()).get(`/support-chat/${chatId}`).expect(404);
    await request(app.getHttpServer())
      .get(`/support-chat/${chatId}`)
      .set('x-chat-token', 'guessed')
      .expect(404);
    await request(app.getHttpServer())
      .get(`/support-chat/${chatId}`)
      .set('x-chat-token', token)
      .expect(200);
  });

  it('hands over to a person when asked, and the team sees and answers', async () => {
    notifications.notify.mockClear();
    const handoff = await request(app.getHttpServer())
      .post(`/support-chat/${chatId}/human`)
      .set('x-chat-token', token)
      .send({ name: 'Sam', email: 'Sam@Example.test' })
      .expect(201);
    expect(handoff.body.humanRequested).toBe(true);
    expect(notifications.notify).toHaveBeenCalledTimes(2);

    // The team: buyers cannot read chats, admins can.
    await request(app.getHttpServer())
      .get('/admin/support-chats')
      .set('x-test-user', 'buyer')
      .expect(403);
    const list = await request(app.getHttpServer())
      .get('/admin/support-chats')
      .set('x-test-user', 'admin')
      .expect(200);
    expect(list.body.items[0]).toMatchObject({
      id: chatId,
      humanRequested: true,
      visitorEmail: 'sam@example.test',
    });
    expect(
      (
        await request(app.getHttpServer())
          .get('/admin/support-chats/unread')
          .set('x-test-user', 'admin')
          .expect(200)
      ).body.unread,
    ).toBe(1);

    const detail = await request(app.getHttpServer())
      .get(`/admin/support-chats/${chatId}`)
      .set('x-test-user', 'admin')
      .expect(200);
    expect(detail.body.messages.length).toBeGreaterThanOrEqual(6);
    expect(detail.body.unread).toBe(0); // opening it marks it read

    await request(app.getHttpServer())
      .post(`/admin/support-chats/${chatId}/messages`)
      .set('x-test-user', 'admin')
      .send({ message: 'Hi Sam, Dana here — the Focus is still available.' })
      .expect(201);

    // The visitor sees the reply; from now on the assistant stays quiet.
    const after = await request(app.getHttpServer())
      .post(`/support-chat/${chatId}/messages`)
      .set('x-chat-token', token)
      .send({ message: 'Great, can I see it Saturday?' })
      .expect(201);
    const roles = after.body.messages.map((m: { role: string }) => m.role);
    expect(roles.slice(-2)).toEqual(['AGENT', 'VISITOR']);
    expect(after.body.messages.at(-2)).toMatchObject({ authorName: 'Dana' });
  });

  it('refuses empty, oversized and unknown fields', async () => {
    await request(app.getHttpServer()).post('/support-chat').send({ message: '   ' }).expect(400);
    await request(app.getHttpServer())
      .post('/support-chat')
      .send({ message: 'x'.repeat(1001) })
      .expect(400);
    await request(app.getHttpServer())
      .post('/support-chat')
      .send({ message: 'hi', role: 'AGENT' })
      .expect(400);
  });
});

describe('site chat, with a language model', () => {
  it('gives the model the site articles and the matching listings, and uses its answer', async () => {
    const seen: HelpModelRequest[] = [];
    const model: HelpModel = {
      name: 'test',
      complete: async (req) => {
        seen.push(req);
        return 'The 2016 Ford Focus SE is $6,980: /vehicles/2016-ford-focus-se';
      },
    };
    const { app } = await appWith(model);
    const response = await request(app.getHttpServer())
      .post('/support-chat')
      .send({ message: 'any ford focus?' })
      .expect(201);
    expect(response.body.messages.at(-1).body).toContain('/vehicles/2016-ford-focus-se');
    expect(seen[0]!.system).toContain('Vintrax is not a lender');
    expect(seen[0]!.messages.at(-1)!.content).toContain('2016 Ford Focus SE | $6,980');
    await app.close();
  });

  it('falls back to the articles when the model fails', async () => {
    const model: HelpModel = {
      name: 'down',
      complete: async () => {
        throw new Error('HTTP 429');
      },
    };
    const { app } = await appWith(model);
    const response = await request(app.getHttpServer())
      .post('/support-chat')
      .send({ message: 'How do I sell my car?' })
      .expect(201);
    expect(response.body.messages.at(-1).body).toMatch(/register\?role=SELLER/);
    await app.close();
  });
});

describe('the free, OpenAI-compatible providers', () => {
  const env = (extra: Record<string, string>) =>
    new ConfigService(
      validateEnv({
        DATABASE_URL: 'postgresql://unused',
        JWT_ACCESS_SECRET: 'test-access-secret-0123456789',
        JWT_REFRESH_SECRET: 'test-refresh-secret-0123456789',
        ...extra,
      }),
    ) as never;

  it('knows Gemini and Groq by name, with a default model each', () => {
    expect(languageModelFactory(env({ AI_PROVIDER: 'gemini', AI_API_KEY: 'k' }))?.name).toBe(
      'gemini:gemini-2.5-flash',
    );
    expect(
      languageModelFactory(
        env({ AI_PROVIDER: 'groq', AI_API_KEY: 'k', AI_MODEL: 'llama-3.1-8b-instant' }),
      )?.name,
    ).toBe('groq:llama-3.1-8b-instant');
    expect(languageModelFactory(env({}))).toBeNull();
  });

  it('needs a base URL and model for any other OpenAI-compatible endpoint', () => {
    expect(() => env({ AI_PROVIDER: 'openai-compatible', AI_API_KEY: 'k' })).toThrow(/AI_BASE_URL/);
  });

  it('speaks Chat Completions with the key as a bearer token', async () => {
    const fetchImpl = jest.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify({ choices: [{ message: { content: ' Hello! ' } }] }), {
          status: 200,
        }),
    );
    const model = new OpenAiCompatibleModel(
      'secret-key',
      'https://api.example.test/v1/',
      'free-model',
      5000,
      'test',
      fetchImpl as unknown as typeof fetch,
    );
    await expect(
      model.complete({ system: 'rules', messages: [{ role: 'user', content: 'hi' }] }),
    ).resolves.toBe('Hello!');

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.example.test/v1/chat/completions');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer secret-key');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('free-model');
    expect(body.messages[0]).toEqual({ role: 'system', content: 'rules' });
  });

  it('reports a provider error without the response body', async () => {
    const model = new OpenAiCompatibleModel(
      'k',
      'https://x.test',
      'm',
      5000,
      'test',
      (async () =>
        new Response('{"error":"quota for key k exceeded"}', {
          status: 429,
        })) as unknown as typeof fetch,
    );
    await expect(model.complete({ system: 's', messages: [] })).rejects.toThrow('HTTP 429');
  });
});

describe('reading a price cap', () => {
  it.each([
    ['cars under $20,000', 20000],
    ['something below 15k', 15000],
    ['less than 9500 please', 9500],
    ['a 2018 civic', null],
  ])('%s', (text, expected) => {
    expect(priceCap(text)).toBe(expected);
  });
});
