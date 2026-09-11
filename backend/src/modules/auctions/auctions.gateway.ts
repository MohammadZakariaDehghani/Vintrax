import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { AuctionEvent } from '@vintrax/shared';
import type { Server, Socket } from 'socket.io';
import { parseCorsOrigins, type Env } from '../../config/env';
import type { AccessTokenPayload } from '../../common/auth/auth-user';

/** Socket.IO room per auction, so a broadcast reaches only its watchers. */
const roomFor = (auctionId: string) => `auction:${auctionId}`;

/**
 * Live auction updates.
 *
 * Read-only by design: clients subscribe to rooms and receive events, but bids
 * are placed over HTTP. Routing writes through the REST endpoint means bidding
 * gets the same validation, rate limiting, auditing and serializable transaction
 * as every other write, with one code path rather than two.
 *
 * Authentication is optional. Anonymous visitors can watch an auction; a token
 * only marks which events belong to the viewer.
 */
@WebSocketGateway({
  namespace: '/auctions',
  cors: { origin: true, credentials: true },
})
export class AuctionsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(AuctionsGateway.name);

  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    // Origin is checked here as well as in the Socket.IO CORS option, because
    // that option does not apply to non-browser clients.
    const allowed = parseCorsOrigins(this.config.get('CORS_ORIGINS', { infer: true }));
    const origin = client.handshake.headers.origin;
    if (origin && allowed.length > 0 && !allowed.includes(origin)) {
      this.logger.warn(`Rejected socket from disallowed origin ${origin}`);
      client.disconnect(true);
      return;
    }

    const token =
      (client.handshake.auth as { token?: string } | undefined)?.token ??
      (typeof client.handshake.query['token'] === 'string'
        ? client.handshake.query['token']
        : undefined);

    if (token) {
      try {
        const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
          secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
        });
        client.data['userId'] = payload.sub;
      } catch {
        // An invalid token downgrades the socket to anonymous rather than
        // dropping it — watching an auction does not require an account.
        client.data['userId'] = null;
      }
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`Socket ${client.id} disconnected`);
  }

  @SubscribeMessage('auction:subscribe')
  handleSubscribe(
    @MessageBody() payload: { auctionId?: string },
    @ConnectedSocket() client: Socket,
  ): { subscribed: boolean; auctionId?: string } {
    const auctionId = payload?.auctionId;
    if (!auctionId || !/^[0-9a-f-]{36}$/i.test(auctionId)) {
      return { subscribed: false };
    }
    void client.join(roomFor(auctionId));
    return { subscribed: true, auctionId };
  }

  @SubscribeMessage('auction:unsubscribe')
  handleUnsubscribe(
    @MessageBody() payload: { auctionId?: string },
    @ConnectedSocket() client: Socket,
  ): { subscribed: boolean } {
    if (payload?.auctionId) void client.leave(roomFor(payload.auctionId));
    return { subscribed: false };
  }

  /**
   * Pushes an auction event to everyone watching that auction.
   *
   * Never throws: a failed broadcast must not roll back a bid that has already
   * been committed. Clients reconcile on their next poll or reconnect.
   */
  broadcast(auctionId: string, event: AuctionEvent): void {
    try {
      this.server?.to(roomFor(auctionId)).emit('auction:event', event);
    } catch (error) {
      this.logger.warn(`Failed to broadcast for auction ${auctionId}: ${String(error)}`);
    }
  }
}
