'use client';

/**
 * Live auction updates over the shared socket protocol. Importing the local
 * API client module first configures the socket origin.
 */
import '@/lib/api-client';

export { useAuctionSocket } from '@vintrax/client';
