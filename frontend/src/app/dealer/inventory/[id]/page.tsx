import { RequireAuth } from '@/components/require-auth';
import { EditListing } from '@/components/listing-form/edit-listing';
import { DealerNav } from '@/components/dealer-nav';
import { VehicleHistoryEditor } from '@/components/vehicle-history-editor';
import { VehicleBadgesEditor } from '@/components/vehicle-badges-editor';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui';

export const metadata = { title: 'Edit vehicle' };

export default async function EditVehiclePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <RequireAuth sellersOnly>
      <div className="container flex flex-col gap-6 py-8">
        <div className="-mb-6">
          <DealerNav />
        </div>
        <EditListing vehicleId={id} />

        {/* One card for everything that feeds the buyer-facing "Vehicle
            history" block: the five badges and the CARFAX link, and the
            dealer's own typed timeline entries. These are two separate
            actions underneath — saving the badges and saving the timeline
            each call their own endpoint, which is deliberate: neither should
            have to wait on, or be blocked by, the other — but a dealer
            working on this vehicle's history sees one box, not two. */}
        <Card>
          <CardHeader>
            <CardTitle>Vehicle history</CardTitle>
            <CardDescription>
              What buyers see in the vehicle history section of the listing: the badges you set
              below, and the accident timeline you type below that.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <VehicleBadgesEditor vehicleId={id} />
            <VehicleHistoryEditor vehicleId={id} />
          </CardContent>
        </Card>
      </div>
    </RequireAuth>
  );
}
