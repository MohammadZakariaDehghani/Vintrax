import { RequireAuth } from '@/components/require-auth';
import { VehicleForm } from '@/components/vehicle-form';
import { VehicleHistoryEditor } from '@/components/vehicle-history-editor';
import { CarfaxReportReader } from '@/components/carfax-report-reader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui';

export const metadata = { title: 'Edit vehicle' };

export default async function EditVehiclePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <RequireAuth sellersOnly>
      <div className="container flex flex-col gap-6 py-8">
        <VehicleForm vehicleId={id} />

        {/* One card for everything that feeds the buyer-facing "Vehicle
            history" block: the report link and its two badges, and the
            seller's own typed timeline entries. These are two separate
            actions underneath — saving the link and saving the timeline each
            call their own endpoint, which is deliberate: neither should have
            to wait on, or be blocked by, the other — but a dealer working on
            this vehicle's history sees one box, not two. */}
        <Card>
          <CardHeader>
            <CardTitle>Vehicle history</CardTitle>
            <CardDescription>
              What buyers see in the vehicle history section of the listing: a CARFAX badge, and the
              accident timeline you type below.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <CarfaxReportReader vehicleId={id} />
            <VehicleHistoryEditor vehicleId={id} />
          </CardContent>
        </Card>
      </div>
    </RequireAuth>
  );
}
