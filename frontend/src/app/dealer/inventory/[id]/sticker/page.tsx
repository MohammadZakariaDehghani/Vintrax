import { RequireAuth } from '@/components/require-auth';
import { WindowSticker } from './window-sticker';

export const metadata = { title: 'Window sticker' };

export default async function WindowStickerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <RequireAuth sellersOnly dealersOnly>
      <div className="container py-8">
        <WindowSticker vehicleId={id} />
      </div>
    </RequireAuth>
  );
}
