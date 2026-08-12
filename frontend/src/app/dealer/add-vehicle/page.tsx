import { RequireAuth } from '@/components/require-auth';
import { VehicleForm } from '@/components/vehicle-form';

export const metadata = { title: 'Add a vehicle' };

export default function AddVehiclePage() {
  return (
    <RequireAuth sellersOnly>
      <div className="container py-8">
        <VehicleForm />
      </div>
    </RequireAuth>
  );
}
