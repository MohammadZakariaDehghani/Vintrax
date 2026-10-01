'use client';

import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { MessagingEvent } from '@vintrax/shared';
import { tokenStore } from './api-client';
import { vintraxClientConfig } from './config';

/** How long to wait before trying again after the server refused the token. */
const RETRY_AFTER_REFUSAL_MS = 5_000;
const MAX_REFUSALS = 5;

/**
 * Live chat events for the signed-in account: a new message in any of its
 * conversations, and the other side reading a thread.
 *
 * Like the auction socket it is read-only — messages are sent over HTTP — and
 * the events only say "something changed"; the caller refetches from the API.
 * The server drops a connection whose access token is missing or expired.
 * Socket.io does not reconnect after the server hangs up, so this tries again
 * a few times with whatever token is current by then (the API client refreshes
 * it on the next request). The caller should keep a slow poll as a backstop.
 */
export function useMessagingSocket(
  enabled: boolean,
  onEvent: (event: MessagingEvent) => void,
): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  const handlerRef = useRef(onEvent);

  useEffect(() => {
    handlerRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!enabled) return;

    let refusals = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const socket: Socket = io(`${vintraxClientConfig().socketUrl}/messages`, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      // A function, so every (re)connection sends the token current at the time.
      auth: (send) => send({ token: tokenStore.access ?? undefined }),
      reconnectionAttempts: 10,
      reconnectionDelay: 1_000,
    });

    socket.on('connect', () => {
      refusals = 0;
      setConnected(true);
    });
    socket.on('connect_error', () => setConnected(false));
    socket.on('disconnect', (reason) => {
      setConnected(false);
      if (reason === 'io server disconnect' && refusals < MAX_REFUSALS) {
        refusals += 1;
        retry = setTimeout(() => socket.connect(), RETRY_AFTER_REFUSAL_MS * refusals);
      }
    });

    socket.on('messaging:event', (event: MessagingEvent) => handlerRef.current(event));

    return () => {
      clearTimeout(retry);
      socket.disconnect();
    };
  }, [enabled]);

  return { connected };
}
