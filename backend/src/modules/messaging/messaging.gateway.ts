import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { type OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { MessagingEvent } from '@vintrax/shared';
import type { Server, Socket } from 'socket.io';
import { parseCorsOrigins, type Env } from '../../config/env';
import type { AccessTokenPayload } from '../../common/auth/auth-user';

/** One room per account: every tab and device that person has open. */
export const userRoom = (userId: string) => `user:${userId}`;

/**
 * Live delivery for chats: a new message, and "seen", reach both sides as
 * they happen, the way Marketplace's messenger feels — instead of waiting
 * for the next poll.
 *
 * Unlike the auction socket, which anyone may watch, this one carries private
 * conversations, so a connection without a valid access token is dropped. A
 * socket only ever joins its own user's room, and the server — never the
 * client — decides which rooms an event goes to, so nobody can listen in on
 * somebody else's chats. The REST API stays the source of truth; the socket
 * only says "something changed", and the page polls as a fallback.
 */
@WebSocketGateway({
  namespace: '/messages',
  cors: { origin: true, credentials: true },
})
export class MessagingGateway implements OnGatewayConnection {
  private readonly logger = new Logger(MessagingGateway.name);

  @WebSocketServer()
  private server?: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    // Origin is checked here as well as in the CORS option, because that
    // option does not apply to non-browser clients.
    const allowed = parseCorsOrigins(this.config.get('CORS_ORIGINS', { infer: true }));
    const origin = client.handshake.headers.origin;
    if (origin && allowed.length > 0 && !allowed.includes(origin)) {
      client.disconnect(true);
      return;
    }

    const token = (client.handshake.auth as { token?: string } | undefined)?.token;
    if (!token) {
      client.disconnect(true);
      return;
    }
    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
        algorithms: ['HS256'],
      });
      client.data['userId'] = payload.sub;
      await client.join(userRoom(payload.sub));
    } catch {
      this.logger.debug(`Refused a messages socket with an invalid token`);
      client.disconnect(true);
    }
  }

  /** Sends an event to every open connection of each of these accounts. */
  emitTo(userIds: string[], event: MessagingEvent): void {
    if (!this.server) return;
    const rooms = [...new Set(userIds)].map(userRoom);
    this.server.to(rooms).emit('messaging:event', event);
  }
}
