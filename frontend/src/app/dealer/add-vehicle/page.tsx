import { RequireAuth } from '@/components/require-auth';
import { DealerNav } from '@/components/dealer-nav';
import { AddVehicleFlow } from '@/components/listing-form/add-vehicle-flow';

export const metadata = { title: 'Add a vehicle' };

export default function AddVehiclePage() {
  return (
    <RequireAuth sellersOnly>
      <div className="container py-8">
        <DealerNav />
        <AddVehicleFlow />
      </div>
    </RequireAuth>
  );
}
