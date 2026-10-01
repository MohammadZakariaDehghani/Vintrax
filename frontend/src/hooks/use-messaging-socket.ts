'use client';

/**
 * The live chat subscription lives in `@vintrax/client`, shared with the
 * mobile application. Importing the local API client module first configures
 * the socket origin for this application.
 */
import '@/lib/api-client';

export { useMessagingSocket } from '@vintrax/client';
