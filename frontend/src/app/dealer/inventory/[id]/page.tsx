import { RequireAuth } from '@/components/require-auth';
import { VehicleForm } from '@/components/vehicle-form';

export const metadata = { title: 'Edit vehicle' };

export default async function EditVehiclePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <RequireAuth sellersOnly>
      <div className="container py-8">
        <VehicleForm vehicleId={id} />
      </div>
    </RequireAuth>
  );
}
