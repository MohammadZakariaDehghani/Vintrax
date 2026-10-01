import { RequireAuth } from '@/components/require-auth';
import { VehicleCosts } from './vehicle-costs';

export const metadata = { title: 'Vehicle costs' };

export default async function VehicleCostsPage({
  params,
}: {
  params: Promise<{ vehicleId: string }>;
}) {
  const { vehicleId } = await params;
  return (
    <RequireAuth sellersOnly dealersOnly>
      <VehicleCosts vehicleId={vehicleId} />
    </RequireAuth>
  );
}
