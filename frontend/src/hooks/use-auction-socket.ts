'use client';

/**
 * The live-auction subscription lives in `@atlas/client`; the socket protocol
 * is shared with the mobile application. Importing the local API client module
 * first configures the socket origin for this application.
 */
import '@/lib/api-client';

export { useAuctionSocket } from '@atlas/client';
