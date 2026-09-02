'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker that makes the app installable and gives it an
 * offline shell.
 *
 * Registration is deliberately late — after load — so it never competes with
 * the first render for bandwidth on a phone.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    // A service worker on http://<lan-ip> is refused by the browser; only
    // localhost and HTTPS are trusted origins. Development over a LAN address
    // therefore runs without one, which is fine: it only costs offline shell.
    if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') return;

    const register = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        // An unregistered worker costs the offline shell and nothing else, so
        // this is not worth surfacing to the user.
      });
    };

    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);

  return null;
}
