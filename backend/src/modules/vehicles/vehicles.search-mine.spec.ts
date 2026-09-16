import { VehiclesService } from './vehicles.service';

/**
 * Keyword search over a seller's own inventory.
 *
 * One property matters more than the rest and is the reason this file exists:
 * a search term must never widen the result past the caller's own vehicles.
 * `sellerId` is applied from the authenticated user and the term is applied as
 * an additional constraint, so the worst a hostile term can do is match
 * nothing. The tests below read the `where` clause the service builds, because
 * that is where such a mistake would live.
 */

const USER = { id: 'seller-1', email: 'dealer@example.test', role: 'DEALER' } as never;

/** Captures the filter `listMine` builds, without a database. */
function serviceCapturing() {
  const seen: Array<Record<string, unknown>> = [];

  const service = Object.create(VehiclesService.prototype) as VehiclesService;
  Object.assign(service, {
    prisma: {
      vehicle: {
        count: async ({ where }: { where: Record<string, unknown> }) => {
          seen.push(where);
          return 0;
        },
        findMany: async () => [],
      },
    },
    favouritedIds: async () => new Set<string>(),
  });
  (service as unknown as { favouritedIds: () => Promise<Set<string>> }).favouritedIds = async () =>
    new Set<string>();

  return { service, where: () => seen[0]! };
}

type TermGroup = { OR: Array<Record<string, unknown>> };

async function whereFor(q?: string) {
  const { service, where } = serviceCapturing();
  await service.listMine(USER, 1, 20, undefined, q);
  return where();
}

describe('listMine', () => {
  it('scopes to the caller whether or not a term is given', async () => {
    expect(await whereFor()).toMatchObject({ sellerId: 'seller-1' });
    expect(await whereFor('rav4')).toMatchObject({ sellerId: 'seller-1' });
  });

  it('adds the term as a constraint, never as an alternative to ownership', async () => {
    // The mistake this guards: putting the search into a top-level OR, which
    // would match every seller's vehicles that contain the term.
    const where = await whereFor('rav4');

    expect(where).not.toHaveProperty('OR');
    expect(where['AND']).toBeDefined();
  });

  it('ANDs several terms, so typing more narrows', async () => {
    const where = await whereFor('2015 hyundai');
    const groups = where['AND'] as TermGroup[];

    expect(groups).toHaveLength(2);
    // Each group is the alternatives for one word.
    expect(groups[0]?.OR.length).toBeGreaterThan(1);
  });

  it('matches a four-digit term against the year as well as the text', async () => {
    const groups = (await whereFor('2015'))['AND'] as TermGroup[];

    expect(groups[0]?.OR).toContainEqual({ year: 2015 });
  });

  it('does not treat an ordinary word as a year', async () => {
    const groups = (await whereFor('hyundai'))['AND'] as TermGroup[];

    expect(groups[0]?.OR.some((clause) => 'year' in clause)).toBe(false);
  });

  it('searches the fields a dealer actually types', async () => {
    const groups = (await whereFor('abc123'))['AND'] as TermGroup[];
    const fields = groups[0]!.OR.flatMap((clause) => Object.keys(clause));

    expect(fields).toEqual(
      expect.arrayContaining(['title', 'make', 'model', 'trim', 'vin', 'stockNumber', 'city']),
    );
  });

  it('ignores an empty or whitespace-only term rather than matching nothing', async () => {
    for (const q of [undefined, '', '   ']) {
      expect(await whereFor(q)).not.toHaveProperty('AND');
    }
  });

  it('caps how many terms one search applies', async () => {
    // Otherwise a pasted paragraph becomes a query with a hundred OR groups.
    const groups = (await whereFor('a b c d e f g h i j'))['AND'] as TermGroup[];

    expect(groups).toHaveLength(6);
  });

  it('keeps the status filter alongside the search', async () => {
    const { service, where } = serviceCapturing();
    await service.listMine(USER, 1, 20, 'DRAFT', 'rav4');

    expect(where()).toMatchObject({ sellerId: 'seller-1', status: 'DRAFT' });
    expect(where()['AND']).toBeDefined();
  });
});
