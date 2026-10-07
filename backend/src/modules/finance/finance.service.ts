import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  FINANCE_APPLICATION_STATUSES,
  OPEN_FINANCE_STATUSES,
  annualIncomeCad,
  type FinanceApplicationDetail,
  type FinanceApplicationInput,
  type FinanceApplicationPage,
  type FinanceApplicationQuery,
  type FinanceApplicationStatus,
  type FinanceApplicationSummary,
  type FinanceSettings,
  type FinanceSettingsInput,
  type UpdateFinanceApplicationInput,
  type VehicleFinanceOptions,
} from '@vintrax/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MailService } from '../../common/mail/mail.service';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { NotificationsService } from '../notifications/notifications.service';
import { CrmEvents } from '../crm/events/crm-events.service';

/** Only a car on sale can be financed through its listing. */
const FINANCEABLE_STATUSES = ['ACTIVE'] as const;

const VEHICLE_SELECT = {
  id: true,
  slug: true,
  title: true,
  year: true,
  make: true,
  model: true,
  trim: true,
  priceCad: true,
  stockNumber: true,
  vin: true,
  images: { select: { url: true }, orderBy: { position: 'asc' }, take: 1 },
} satisfies Prisma.VehicleSelect;

const APPLICATION_SELECT = {
  id: true,
  status: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  dateOfBirth: true,
  postalCode: true,
  creditRange: true,
  grossIncomeCad: true,
  incomeFrequency: true,
  employmentStatus: true,
  employerName: true,
  jobTitle: true,
  employmentMonths: true,
  housingStatus: true,
  monthlyHousingCad: true,
  addressMonths: true,
  hasTradeIn: true,
  tradeInYear: true,
  tradeInMake: true,
  tradeInModel: true,
  tradeInMileageKm: true,
  tradeInOwedCad: true,
  downPaymentCad: true,
  termMonths: true,
  preferredContact: true,
  preferredVisitDate: true,
  comments: true,
  dealerNotes: true,
  createdAt: true,
  updatedAt: true,
  vehicle: { select: VEHICLE_SELECT },
} satisfies Prisma.FinanceApplicationSelect;

type ApplicationRow = Prisma.FinanceApplicationGetPayload<{ select: typeof APPLICATION_SELECT }>;

/**
 * Finance applications.
 *
 * A buyer applies for one vehicle; the application belongs to that vehicle's
 * seller, recorded on the row when it is sent. Every seller-side read and
 * write is scoped by `sellerId: user.id`, and anything outside that scope is
 * "not found" — the same answer as an id that does not exist.
 *
 * The rows hold a date of birth and an income, so they are shown to nobody
 * but the seller: there is no administrator view, the notification email
 * carries only who applied and how to reach them, and the audit log records
 * that something changed, never the personal details.
 */
@Injectable()
export class FinanceService {
  private readonly logger = new Logger(FinanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    @Optional() private readonly crmEvents?: CrmEvents,
  ) {}

  // --- The buyer's side ---------------------------------------------------------

  /** Whether the finance form should be offered for a vehicle, and whether this buyer already applied. */
  async optionsFor(vehicleId: string, user: AuthUser): Promise<VehicleFinanceOptions> {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, status: { in: [...FINANCEABLE_STATUSES] } },
      select: { sellerId: true },
    });
    if (!vehicle || vehicle.sellerId === user.id) {
      return { acceptsApplications: false, openApplicationId: null };
    }
    const [settings, open] = await Promise.all([
      this.prisma.sellerFinanceSettings.findUnique({
        where: { sellerId: vehicle.sellerId },
        select: { acceptApplications: true },
      }),
      this.openApplication(user.id, vehicleId),
    ]);
    return {
      acceptsApplications: settings?.acceptApplications ?? true,
      openApplicationId: open?.id ?? null,
    };
  }

  async apply(
    vehicleId: string,
    input: FinanceApplicationInput,
    user: AuthUser,
  ): Promise<{ id: string }> {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, status: { in: [...FINANCEABLE_STATUSES] } },
      select: { id: true, title: true, priceCad: true, sellerId: true, slug: true },
    });
    if (!vehicle) throw new NotFoundException('This vehicle is not available');
    if (vehicle.sellerId === user.id) {
      throw new BadRequestException('You cannot apply for financing on your own listing');
    }

    const settings = await this.prisma.sellerFinanceSettings.findUnique({
      where: { sellerId: vehicle.sellerId },
      select: { acceptApplications: true, notificationEmail: true },
    });
    if (settings && !settings.acceptApplications) {
      throw new ForbiddenException('This seller is not taking finance applications online');
    }

    // One open application per buyer and vehicle: a second press of Send, or
    // a script, does not flood the seller with copies.
    if (await this.openApplication(user.id, vehicleId)) {
      throw new ConflictException(
        'You have already sent a finance application for this vehicle. The seller will be in touch.',
      );
    }

    const { consent: _consent, ...fields } = input;
    const created = await this.prisma.financeApplication.create({
      data: { ...fields, vehicleId, sellerId: vehicle.sellerId, applicantId: user.id },
      select: { id: true },
    });

    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: 'finance.application_sent',
      entityType: 'FinanceApplication',
      entityId: created.id,
      metadata: { vehicleId },
    });

    // Tell the seller. Neither message carries the date of birth or income:
    // those stay in the portal, behind the seller's sign-in.
    const name = `${input.firstName} ${input.lastName}`;
    const link = `/dealer/finance/${created.id}`;
    await this.notifications
      .notify({
        userId: vehicle.sellerId,
        type: 'SYSTEM',
        title: `New finance application: ${vehicle.title}`,
        body: `${name} applied for financing on your ${vehicle.title}.`,
        link,
      })
      .catch((error: unknown) => this.logger.warn(`In-app notice failed: ${String(error)}`));

    const to = settings?.notificationEmail ?? (await this.accountEmail(vehicle.sellerId));
    if (to) {
      await this.mail.sendFinanceApplicationNotice(to, {
        applicantName: name,
        applicantEmail: input.email,
        applicantPhone: input.phone,
        preferredContact: input.preferredContact,
        vehicleTitle: vehicle.title,
        vehiclePriceCad: vehicle.priceCad,
        applicationPath: link,
      });
    }

    // A dealership's CRM records that this lead asked for financing.
    this.crmEvents?.financeApplicationSubmitted(created.id);
    return created;
  }

  // --- The seller's side --------------------------------------------------------

  async list(user: AuthUser, query: FinanceApplicationQuery): Promise<FinanceApplicationPage> {
    const q = query.q?.trim();
    const search: Prisma.FinanceApplicationWhereInput = q
      ? {
          OR: [
            { firstName: { contains: q, mode: 'insensitive' } },
            { lastName: { contains: q, mode: 'insensitive' } },
            { email: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q } },
            { vehicle: { title: { contains: q, mode: 'insensitive' } } },
            { vehicle: { stockNumber: { contains: q, mode: 'insensitive' } } },
            { vehicle: { vin: { contains: q.toUpperCase() } } },
          ],
        }
      : {};
    const where: Prisma.FinanceApplicationWhereInput = {
      sellerId: user.id,
      ...(query.status ? { status: query.status } : {}),
      ...search,
    };

    const [total, rows, grouped] = await Promise.all([
      this.prisma.financeApplication.count({ where }),
      this.prisma.financeApplication.findMany({
        where,
        select: APPLICATION_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.financeApplication.groupBy({
        by: ['status'],
        where: { sellerId: user.id, ...search },
        _count: { _all: true },
      }),
    ]);

    const counts = Object.fromEntries(FINANCE_APPLICATION_STATUSES.map((s) => [s, 0])) as Record<
      FinanceApplicationStatus,
      number
    >;
    for (const group of grouped) counts[group.status] = group._count._all;

    return {
      items: rows.map((row) => this.toSummary(row)),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      counts,
    };
  }

  async detail(id: string, user: AuthUser): Promise<FinanceApplicationDetail> {
    return this.toDetail(await this.findOwn(id, user));
  }

  async update(
    id: string,
    input: UpdateFinanceApplicationInput,
    user: AuthUser,
  ): Promise<FinanceApplicationDetail> {
    const current = await this.findOwn(id, user);
    const row = await this.prisma.financeApplication.update({
      where: { id: current.id },
      data: {
        ...(input.status ? { status: input.status } : {}),
        ...(input.dealerNotes !== undefined ? { dealerNotes: input.dealerNotes } : {}),
      },
      select: APPLICATION_SELECT,
    });
    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: 'finance.application_updated',
      entityType: 'FinanceApplication',
      entityId: id,
      metadata: {
        ...(input.status && input.status !== current.status
          ? { status: { from: current.status, to: input.status } }
          : {}),
        ...(input.dealerNotes !== undefined ? { notesChanged: true } : {}),
      },
    });
    return this.toDetail(row);
  }

  /** Deletes an application outright — the applicant's details with it. */
  async remove(id: string, user: AuthUser): Promise<void> {
    const current = await this.findOwn(id, user);
    await this.prisma.financeApplication.delete({ where: { id: current.id } });
    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: 'finance.application_deleted',
      entityType: 'FinanceApplication',
      entityId: id,
    });
  }

  async settings(user: AuthUser): Promise<FinanceSettings> {
    const row = await this.prisma.sellerFinanceSettings.findUnique({
      where: { sellerId: user.id },
      select: { acceptApplications: true, notificationEmail: true },
    });
    return {
      acceptApplications: row?.acceptApplications ?? true,
      notificationEmail: row?.notificationEmail ?? null,
      effectiveEmail: row?.notificationEmail ?? user.email,
    };
  }

  async updateSettings(input: FinanceSettingsInput, user: AuthUser): Promise<FinanceSettings> {
    await this.prisma.sellerFinanceSettings.upsert({
      where: { sellerId: user.id },
      create: { sellerId: user.id, ...input },
      update: input,
    });
    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: 'finance.settings_updated',
      entityType: 'SellerFinanceSettings',
      entityId: user.id,
      metadata: { acceptApplications: input.acceptApplications },
    });
    return this.settings(user);
  }

  // --- Helpers ----------------------------------------------------------------

  private openApplication(applicantId: string, vehicleId: string) {
    return this.prisma.financeApplication.findFirst({
      where: { applicantId, vehicleId, status: { in: [...OPEN_FINANCE_STATUSES] } },
      select: { id: true },
    });
  }

  private async accountEmail(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    return user?.email ?? null;
  }

  private async findOwn(id: string, user: AuthUser): Promise<ApplicationRow> {
    const row = await this.prisma.financeApplication.findFirst({
      where: { id, sellerId: user.id },
      select: APPLICATION_SELECT,
    });
    if (!row) throw new NotFoundException('Finance application not found');
    return row;
  }

  private toSummary(row: ApplicationRow): FinanceApplicationSummary {
    return {
      id: row.id,
      status: row.status,
      firstName: row.firstName,
      lastName: row.lastName,
      email: row.email,
      phone: row.phone,
      creditRange: row.creditRange,
      annualIncomeCad: annualIncomeCad(row.grossIncomeCad, row.incomeFrequency),
      downPaymentCad: row.downPaymentCad,
      hasTradeIn: row.hasTradeIn,
      vehicle: {
        id: row.vehicle.id,
        slug: row.vehicle.slug,
        title: row.vehicle.title,
        year: row.vehicle.year,
        make: row.vehicle.make,
        model: row.vehicle.model,
        trim: row.vehicle.trim,
        priceCad: row.vehicle.priceCad,
        stockNumber: row.vehicle.stockNumber,
        vin: row.vehicle.vin,
        primaryImageUrl: row.vehicle.images[0]?.url ?? null,
      },
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toDetail(row: ApplicationRow): FinanceApplicationDetail {
    return {
      ...this.toSummary(row),
      dateOfBirth: row.dateOfBirth,
      postalCode: row.postalCode,
      grossIncomeCad: row.grossIncomeCad,
      incomeFrequency: row.incomeFrequency,
      employmentStatus: row.employmentStatus,
      employerName: row.employerName,
      jobTitle: row.jobTitle,
      employmentMonths: row.employmentMonths,
      housingStatus: row.housingStatus,
      monthlyHousingCad: row.monthlyHousingCad,
      addressMonths: row.addressMonths,
      tradeInYear: row.tradeInYear,
      tradeInMake: row.tradeInMake,
      tradeInModel: row.tradeInModel,
      tradeInMileageKm: row.tradeInMileageKm,
      tradeInOwedCad: row.tradeInOwedCad,
      termMonths: row.termMonths,
      preferredContact: row.preferredContact,
      preferredVisitDate: row.preferredVisitDate,
      comments: row.comments,
      dealerNotes: row.dealerNotes,
    };
  }
}
