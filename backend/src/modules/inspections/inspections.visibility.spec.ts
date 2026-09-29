import { NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user';
import { InspectionsService } from './inspections.service';

/**
 * Condition reports are public only for public listings. A report on a car
 * still under review, rejected or withdrawn would reveal a listing the
 * vehicle page itself hides, so both public endpoints answer as though there
 * were none — except to the seller, inspectors and admins.
 */

type VehicleStatus = 'ACTIVE' | 'SOLD' | 'IN_AUCTION' | 'PENDING_REVIEW' | 'REJECTED' | 'DRAFT';

function setup(vehicleStatus: VehicleStatus, inspectionStatus = 'COMPLETED') {
  const inspection = {
    id: 'i1',
    vehicleId: 'v1',
    status: inspectionStatus,
    overallGrade: 'A',
    summary: 'Clean',
    odometerReadingKm: 42_000,
    hasFrameDamage: false,
    hasAccidentHistory: false,
    estimatedReconditioningCad: 0,
    scheduledFor: null,
    completedAt: new Date('2026-01-01'),
    createdAt: new Date('2026-01-01'),
    inspector: { firstName: 'Ira', lastName: 'Spector' },
    sections: [],
    images: [],
  };
  const prisma = {
    vehicle: { findUnique: async () => ({ sellerId: 'seller', status: vehicleStatus }) },
    vehicleInspection: {
      findUnique: async () => inspection,
      findFirst: async () => (inspection.status === 'COMPLETED' ? inspection : null),
    },
  };
  return new InspectionsService(prisma as never, {} as never);
}

const viewer = (id: string, role: AuthUser['role']) => ({ id, role }) as AuthUser;

describe('who sees a vehicle’s inspection report', () => {
  it.each(['ACTIVE', 'SOLD', 'IN_AUCTION'] as const)(
    'anyone, once complete, for a %s listing',
    async (status) => {
      const service = setup(status);
      await expect(service.findForVehicle('v1')).resolves.toMatchObject({ id: 'i1' });
      await expect(service.findById('i1')).resolves.toMatchObject({ id: 'i1' });
    },
  );

  it.each(['PENDING_REVIEW', 'REJECTED', 'DRAFT'] as const)(
    'nobody but the seller, inspectors and admins for a %s listing',
    async (status) => {
      const service = setup(status);
      await expect(service.findForVehicle('v1')).resolves.toBeNull();
      await expect(service.findForVehicle('v1', viewer('someone', 'BUYER'))).resolves.toBeNull();
      await expect(service.findById('i1')).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.findById('i1', viewer('other-dealer', 'DEALER'))).rejects.toBeInstanceOf(
        NotFoundException,
      );

      await expect(service.findForVehicle('v1', viewer('seller', 'DEALER'))).resolves.toMatchObject(
        { id: 'i1' },
      );
      await expect(service.findById('i1', viewer('admin', 'ADMIN'))).resolves.toMatchObject({
        id: 'i1',
      });
      await expect(service.findById('i1', viewer('ins', 'INSPECTOR'))).resolves.toMatchObject({
        id: 'i1',
      });
    },
  );

  it('keeps an unfinished report from the public even on a live listing', async () => {
    const service = setup('ACTIVE', 'IN_PROGRESS');
    await expect(service.findById('i1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.findById('i1', viewer('seller', 'DEALER'))).resolves.toMatchObject({
      status: 'IN_PROGRESS',
    });
  });
});
