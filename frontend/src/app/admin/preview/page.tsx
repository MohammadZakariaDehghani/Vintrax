'use client';

import { useEffect, useState } from 'react';
import { RequireAuth } from '@/components/require-auth';
import { HomeHero } from '@/components/home-hero';
import { HomeFeatures } from '@/components/home-features';
import { HomeMasthead } from '@/components/home-masthead';
import { PromoTileRow } from '@/components/promo-tiles';
import {
  PREVIEW_MESSAGE,
  PREVIEW_READY,
  type PreviewPayload,
} from '@/components/media/admin/live-preview';

/**
 * The inside of the admin's live preview frames: draws whatever the editor in
 * the parent window posts, with the home page's own components.
 *
 * It only listens to its own parent on its own origin, renders only what it
 * is sent — it fetches nothing — and is behind the admin check like the rest
 * of /admin. The page around it (footer, chat, cookie prompt) is hidden.
 */
function Preview() {
  const [message, setMessage] = useState<{ payload: PreviewPayload; replay: number } | null>(null);

  useEffect(() => {
    document.documentElement.classList.add('media-preview');
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      const data = event.data as { type?: string; payload?: PreviewPayload; replay?: number };
      if (data?.type === PREVIEW_MESSAGE && data.payload) {
        setMessage({ payload: data.payload, replay: data.replay ?? 0 });
      }
    };
    window.addEventListener('message', onMessage);
    window.parent.postMessage({ type: PREVIEW_READY }, window.location.origin);
    return () => {
      window.removeEventListener('message', onMessage);
      document.documentElement.classList.remove('media-preview');
    };
  }, []);

  if (!message) return null;
  const { payload, replay } = message;

  // A new key replays the entrance: the content is drawn afresh.
  return (
    <div key={replay} className="pb-24">
      {payload.kind === 'hero' ? (
        <HomeHero hero={payload.hero} headingLevel="h2" className="pb-28" />
      ) : payload.kind === 'feature' ? (
        <div className="pt-8">
          <HomeFeatures features={[payload.feature]} />
        </div>
      ) : payload.kind === 'boxes' ? (
        <section className="container pt-8">
          <PromoTileRow tiles={payload.tiles} />
        </section>
      ) : (
        <HomeMasthead article={payload.article} className="pb-10" />
      )}
    </div>
  );
}

export default function AdminPreviewPage() {
  return (
    <RequireAuth adminOnly>
      <Preview />
    </RequireAuth>
  );
}
