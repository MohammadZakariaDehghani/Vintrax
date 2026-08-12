'use client';

import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { AuctionEvent } from '@atlas/shared';
import { tokenStore } from '@/lib/api-client';

const SOCKET_URL = process.env['NEXT_PUBLIC_WS_URL'] ?? '';

/**
 * Subscribes to live updates for one auction.
 *
 * The socket is read-only — bids go over HTTP so they get the same validation,
 * rate limiting and serializable transaction as every other write. This hook
 * only reflects what the server says has happened.
 *
 * A dropped connection is not fatal: `connected` is returned so the UI can say
 * so, and the caller should keep a slow poll as a backstop.
 */
export function useAuctionSocket(
  auctionId: string,
  onEvent: (event: AuctionEvent) => void,
): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  const handlerRef = useRef(onEvent);

  // Keep the latest handler without re-opening the socket on every render.
  useEffect(() => {
    handlerRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!auctionId) return;

    const socket: Socket = io(`${SOCKET_URL}/auctions`, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      // Authentication is optional — anonymous visitors may watch an auction.
      auth: { token: tokenStore.access ?? undefined },
      reconnectionAttempts: 10,
      reconnectionDelay: 1_000,
    });

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('auction:subscribe', { auctionId });
    });

    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));

    socket.on('auction:event', (event: AuctionEvent) => {
      handlerRef.current(event);
    });

    return () => {
      socket.emit('auction:unsubscribe', { auctionId });
      socket.disconnect();
    };
  }, [auctionId]);

  return { connected };
}
