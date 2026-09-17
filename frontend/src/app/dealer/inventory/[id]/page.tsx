import { RequireAuth } from '@/components/require-auth';
import { VehicleForm } from '@/components/vehicle-form';
import { VehicleHistoryEditor } from '@/components/vehicle-history-editor';
import { CarfaxReportReader } from '@/components/carfax-report-reader';

export const metadata = { title: 'Edit vehicle' };

export default async function EditVehiclePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <RequireAuth sellersOnly>
      <div className="container flex flex-col gap-6 py-8">
        <VehicleForm vehicleId={id} />
        {/* Above the timeline editor because it is the one that reaches a
            buyer: the listing's history block draws the CARFAX reading, and
            the editor below is the seller's own notes. It needs the link saved
            by the form above, which is why it is not part of it. */}
        <CarfaxReportReader vehicleId={id} />

        {/* Separate from the form on purpose: the timeline is replaced as a
            whole set by its own endpoint, so saving it is its own act and does
            not ride on whether the listing above passed validation. */}
        <VehicleHistoryEditor vehicleId={id} />
      </div>
    </RequireAuth>
  );
}
