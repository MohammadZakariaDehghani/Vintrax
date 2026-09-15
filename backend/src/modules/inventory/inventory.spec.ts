import { CsvParseError, escapeCsvCell, parseCsv, toCsv } from './csv';
import {
  CREATE_REQUIRED_FIELDS,
  planInventoryImport,
  type ExistingVehicle,
} from './inventory-plan';
import { normaliseInteger, normaliseVin, resolveHeader } from '@vintrax/shared';

/**
 * The dealer CSV importer.
 *
 * These exercise the decisions, not the plumbing: what a row means, what it may
 * not do, and the three ways a bulk import silently corrupts an inventory —
 * duplicating vehicles, reaching another dealer's, and coercing bad data into
 * valid-looking data.
 */

const DEALER_DEFAULTS = { city: 'Toronto', province: 'ON' as const };

function existing(overrides: Partial<ExistingVehicle> = {}): ExistingVehicle {
  return {
    id: 'veh-1',
    vin: '1HGCM82633A123456',
    stockNumber: 'A1042',
    year: 2022,
    make: 'Mazda',
    model: 'CX-5',
    trim: 'GT',
    priceCad: 32480,
    reservePriceCad: null,
    mileageKm: 48900,
    condition: 'USED',
    bodyType: 'SUV',
    transmission: 'AUTOMATIC',
    fuelType: 'GASOLINE',
    drivetrain: 'AWD',
    engine: null,
    engineSizeL: null,
    cylinders: null,
    doors: null,
    seats: null,
    exteriorColour: 'Soul Red',
    interiorColour: null,
    city: 'Toronto',
    province: 'ON',
    postalCode: null,
    title: '2022 Mazda CX-5 GT',
    description: 'A well kept CX-5 with service history and winter tires included.',
    features: ['Sunroof'],
    status: 'ACTIVE',
    saleChannel: 'FIXED_PRICE',
    ...overrides,
  };
}

function plan(text: string, options: Partial<Parameters<typeof planInventoryImport>[0]> = {}) {
  return planInventoryImport({
    text,
    existing: [],
    defaults: DEALER_DEFAULTS,
    now: new Date('2026-09-15T00:00:00Z'),
    ...options,
  });
}

const FULL_HEADER =
  'vin,stock_number,year,make,model,trim,price_cad,mileage_km,condition,body_type,transmission,fuel_type,drivetrain';
const FULL_ROW =
  '2T3BFREV9FW123456,B-77,2019,Toyota,RAV4,LE,28995,62100,Used,SUV,Automatic,Gas,AWD';

describe('parseCsv', () => {
  it('reads quoted fields containing commas, quotes and newlines', () => {
    const rows = parseCsv('a,"b,c","say ""hi""","line1\nline2"');
    expect(rows).toEqual([['a', 'b,c', 'say "hi"', 'line1\nline2']]);
  });

  it('handles CRLF, a bare CR and a UTF-8 BOM', () => {
    expect(parseCsv('\uFEFFa,b\r\nc,d\re,f\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
      ['e', 'f'],
    ]);
  });

  it('does not invent a trailing row for a trailing newline', () => {
    expect(parseCsv('a,b\r\n')).toHaveLength(1);
  });

  it('keeps an empty quoted field distinct from a missing one', () => {
    expect(parseCsv('a,"",b')).toEqual([['a', '', 'b']]);
  });

  it('refuses a file that ends inside a quoted value', () => {
    expect(() => parseCsv('a,"unclosed')).toThrow(CsvParseError);
  });
});

describe('escapeCsvCell', () => {
  it('neutralises spreadsheet formulas', () => {
    // A description beginning "=" executes on open in Excel and Sheets. This is
    // the export path, so the value came from a listing somebody else typed.
    for (const dangerous of ['=1+1', '+1', '-1', '@SUM(A1)']) {
      expect(escapeCsvCell(dangerous)).toMatch(/^'|^"'/);
    }
  });

  it('leaves ordinary values alone and quotes only when it must', () => {
    expect(escapeCsvCell('Toyota')).toBe('Toyota');
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvCell(null)).toBe('');
  });

  it('round-trips through the parser', () => {
    const value = 'Sunroof, heated seats & "premium" audio';
    expect(parseCsv(toCsv([[value]]))[0]![0]).toBe(value);
  });
});

describe('header aliases', () => {
  it('maps the spellings a dealership system actually emits', () => {
    for (const header of ['VIN', 'Vin', 'vin_number', 'Vehicle VIN']) {
      expect(resolveHeader(header)).toEqual({ kind: 'mapped', column: 'vin' });
    }
    for (const header of ['Stock', 'Stock #', 'Stock Number', 'stock_number']) {
      expect(resolveHeader(header)).toEqual({ kind: 'mapped', column: 'stock_number' });
    }
    for (const header of ['Price', 'Asking Price', 'List Price']) {
      expect(resolveHeader(header)).toEqual({ kind: 'mapped', column: 'price_cad' });
    }
  });

  it('reports an ownership column as ignored rather than mapping it', () => {
    for (const header of ['dealer_id', 'dealership_id', 'seller_id', 'owner_id', 'id']) {
      expect(resolveHeader(header)).toEqual({ kind: 'ignored-ownership' });
    }
  });

  it('reports an unknown column rather than guessing at the nearest match', () => {
    // `price_msrp` is one edit away from a mapped column. A fuzzy matcher would
    // land it on price_cad and reprice the inventory to sticker.
    expect(resolveHeader('price_msrp')).toEqual({ kind: 'unrecognised' });
    expect(resolveHeader('lot_location_zone')).toEqual({ kind: 'unrecognised' });
  });
});

describe('value normalisation', () => {
  it('reads prices and mileage the way a dealership writes them', () => {
    expect(normaliseInteger('$29,999')).toBe(29999);
    expect(normaliseInteger('29999.00')).toBe(29999);
    expect(normaliseInteger('48,900 km')).toBe(48900);
    expect(normaliseInteger('  ')).toBeNull();
    expect(normaliseInteger('n/a')).toBeNull();
  });

  it('refuses rather than rounds a fractional whole-number field', () => {
    // Silently dropping fifty cents is how a dealer stops trusting the importer.
    expect(normaliseInteger('29999.50')).toBeUndefined();
    expect(normaliseInteger('call for price')).toBeUndefined();
  });

  it('upper-cases a VIN but never repairs one', () => {
    expect(normaliseVin('1hgcm82633a123456')).toBe('1HGCM82633A123456');
    // Case is formatting. Length is meaning, and this one stays wrong.
    expect(normaliseVin('abc123')).toBe('ABC123');
  });
});

describe('planInventoryImport', () => {
  it('creates a vehicle when nothing matches', () => {
    const result = plan(`${FULL_HEADER}\n${FULL_ROW}`);

    expect(result.summary).toMatchObject({ totalRows: 1, create: 1, errors: 0 });
    expect(result.rows[0]!.action).toBe('CREATE');
    expect(result.rows[0]!.draft?.vin).toBe('2T3BFREV9FW123456');
    // The dealership's own location fills in for the columns the file omitted.
    expect(result.rows[0]!.draft?.city).toBe('Toronto');
    expect(result.rows[0]!.draft?.province).toBe('ON');
  });

  it('updates on a VIN match and names only the fields that changed', () => {
    const result = plan(`vin,price_cad\n1HGCM82633A123456,31000`, { existing: [existing()] });

    expect(result.rows[0]!.action).toBe('UPDATE');
    expect(result.rows[0]!.changes).toEqual(['priceCad']);
    expect(result.rows[0]!.targetId).toBe('veh-1');
  });

  it('matches on stock number when the row has no VIN', () => {
    const result = plan(`stock_number,price_cad\nA1042,31000`, { existing: [existing()] });

    expect(result.rows[0]!.action).toBe('UPDATE');
    expect(result.rows[0]!.targetId).toBe('veh-1');
  });

  it('reports no change when the values already match', () => {
    const result = plan(`vin,price_cad,mileage_km\n1HGCM82633A123456,32480,48900`, {
      existing: [existing()],
    });

    expect(result.rows[0]!.action).toBe('UNCHANGED');
    expect(result.rows[0]!.changes).toEqual([]);
  });

  it('is idempotent: a second identical import creates nothing', () => {
    const file = `${FULL_HEADER}\n${FULL_ROW}`;
    const first = plan(file);
    expect(first.summary).toMatchObject({ create: 1, unchanged: 0 });

    // The vehicle the first run would have written, now in the inventory.
    const written = existing({
      id: 'veh-2',
      vin: '2T3BFREV9FW123456',
      stockNumber: 'B-77',
      year: 2019,
      make: 'Toyota',
      model: 'RAV4',
      trim: 'LE',
      priceCad: 28995,
      mileageKm: 62100,
      condition: 'USED',
      bodyType: 'SUV',
      transmission: 'AUTOMATIC',
      fuelType: 'GASOLINE',
      drivetrain: 'AWD',
    });

    const second = plan(file, { existing: [written] });
    expect(second.summary).toMatchObject({ create: 0, update: 0, unchanged: 1 });
  });

  describe('ownership', () => {
    it('never matches a vehicle belonging to another seller', () => {
      // `existing` is only ever this seller's inventory, so a VIN somebody else
      // lists cannot be matched — the row creates instead of hijacking.
      const result = plan(`${FULL_HEADER}\n${FULL_ROW}`, {
        existing: [],
        vinsElsewhere: new Set(['2T3BFREV9FW123456']),
      });

      expect(result.rows[0]!.action).toBe('CREATE');
      expect(result.rows[0]!.targetId).toBeUndefined();
      // Told, not silent.
      expect(result.rows[0]!.warnings.join(' ')).toContain('Another seller lists this VIN');
    });

    it('ignores an ownership column instead of honouring it', () => {
      const result = plan(`dealer_id,${FULL_HEADER}\nsomeone-elses-dealership,${FULL_ROW}`, {
        existing: [],
      });

      expect(result.ignoredColumns).toContain('dealer_id');
      expect(result.mappedColumns).not.toContain('dealer_id');
      expect(JSON.stringify(result.rows[0]!.draft)).not.toContain('someone-elses-dealership');
    });
  });

  describe('validation', () => {
    it('refuses a malformed VIN rather than padding it', () => {
      const result = plan(`vin,stock_number,price_cad\nABC123,X1,1000`, { existing: [] });

      expect(result.rows[0]!.action).toBe('ERROR');
      expect(result.rows[0]!.errors.join(' ')).toContain('not valid');
    });

    it('refuses a year outside the supported range', () => {
      const result = plan(`${FULL_HEADER}\n${FULL_ROW.replace('2019', '2099')}`);
      expect(result.rows[0]!.errors.join(' ')).toContain('year');
    });

    it('refuses an unrecognised enum value rather than creating one', () => {
      const result = plan(`${FULL_HEADER}\n${FULL_ROW.replace(',Gas,', ',Plasma,')}`);

      expect(result.rows[0]!.action).toBe('ERROR');
      expect(result.rows[0]!.errors.join(' ')).toContain('fuel_type');
    });

    it('accepts the enum spellings dealership systems use', () => {
      const result = plan(
        `${FULL_HEADER}\n2T3BFREV9FW123456,B-77,2019,Toyota,RAV4,LE,28995,62100,Pre-Owned,Crossover,Auto,Petrol,4x4`,
      );

      expect(result.rows[0]!.action).toBe('CREATE');
      expect(result.rows[0]!.draft).toMatchObject({
        condition: 'USED',
        bodyType: 'SUV',
        transmission: 'AUTOMATIC',
        fuelType: 'GASOLINE',
        drivetrain: 'FOUR_WHEEL_DRIVE',
      });
    });

    it('refuses a row with neither a VIN nor a stock number', () => {
      const result = plan(`vin,price_cad\n,31000`, { existing: [existing()] });

      expect(result.rows[0]!.action).toBe('ERROR');
      expect(result.rows[0]!.errors.join(' ')).toContain('vin or a stock_number');
    });

    it('refuses to create when a required column is missing', () => {
      const result = plan(`vin,price_cad\n2T3BFREV9FW123456,28995`, { existing: [] });

      expect(result.rows[0]!.action).toBe('ERROR');
      expect(result.rows[0]!.errors.join(' ')).toContain('required columns');
    });

    it('will not set ACTIVE, because publishing is a moderation decision', () => {
      // Left unchanged and reported rather than failed. An export carries the
      // real status, so failing it would break export → edit → re-import for
      // every dealer with a live listing.
      const result = plan(`vin,price_cad,listing_status\n1HGCM82633A123456,31000,ACTIVE`, {
        existing: [existing()],
      });

      expect(result.rows[0]!.action).toBe('UPDATE');
      expect(result.rows[0]!.changes).toEqual(['priceCad']);
      expect(result.rows[0]!.draft?.status).toBeUndefined();
      expect(result.rows[0]!.warnings.join(' ')).toContain('cannot be set from a CSV');
    });

    it('still fails a listing status that is not a status at all', () => {
      const result = plan(`vin,listing_status\n1HGCM82633A123456,ON_THE_LOT`, {
        existing: [existing()],
      });

      expect(result.rows[0]!.action).toBe('ERROR');
      expect(result.rows[0]!.errors.join(' ')).toContain('not a recognised value');
    });
  });

  it("says so when a row's VIN belongs to another seller and cannot be updated", () => {
    // The most confusing row a dealer can hit: they know the VIN exists, and
    // the reason it is not updatable is that it is not theirs.
    const result = plan(`vin,price_cad\n2T3BFREV9FW123456,31000`, {
      existing: [],
      vinsElsewhere: new Set(['2T3BFREV9FW123456']),
    });

    expect(result.rows[0]!.action).toBe('ERROR');
    expect(result.rows[0]!.warnings.join(' ')).toContain('Another seller lists this VIN');
  });

  describe('a real dealer management system export', () => {
    // The header row of an actual dealership feed, verbatim. Every one of these
    // columns failed to import before: Status held "Used" and was read as the
    // listing state, KMS and Passenger mapped to nothing, and CompanyID was
    // treated as data. The vehicles below are invented; the shape is not.
    const DMS_HEADER =
      'AdLastModifiedDate,CompanyID,3rdPartyADID,StockNumber,Vin,Status,Year,Make,Model,Trim,KMS,' +
      'Exterior Color,Interior Color,FuelType,Drive,Engine Size,Transmission,Doors,Passenger,' +
      'Cylinder,Body,Price,Options,Description,FinancingIsAvailable,MainPhoto';

    const dmsRow = (overrides: Partial<Record<string, string>> = {}) => {
      const cells: Record<string, string> = {
        AdLastModifiedDate: '2026-09-01',
        CompanyID: 'someone-elses-rooftop',
        '3rdPartyADID': '6416',
        StockNumber: '301421',
        Vin: '5XYZUDLB0FG301421',
        Status: 'Used',
        Year: '2015',
        Make: 'Hyundai',
        Model: 'Santa Fe Sport',
        Trim: 'GLS',
        KMS: '159760',
        'Exterior Color': 'Silver',
        'Interior Color': 'Black',
        FuelType: 'Gasoline',
        Drive: '4WD',
        'Engine Size': '2.4 L',
        Transmission: 'Automatic',
        Doors: '4',
        Passenger: '5',
        Cylinder: '4',
        Body: 'SUV',
        Price: '9980',
        Options: '',
        Description: 'A well equipped Santa Fe Sport with service records and winter tires.',
        FinancingIsAvailable: 'true',
        MainPhoto: 'https://example.test/a.jpg',
        ...overrides,
      };
      return DMS_HEADER.split(',')
        .map((header) => cells[header] ?? '')
        .join(',');
    };

    it('imports a row from the feed as delivered', () => {
      const result = plan(`${DMS_HEADER}\n${dmsRow()}`);

      expect(result.summary).toMatchObject({ totalRows: 1, create: 1, errors: 0 });
      expect(result.rows[0]!.draft).toMatchObject({
        stockNumber: '301421',
        vin: '5XYZUDLB0FG301421',
        // Status means the vehicle's condition in a dealership feed, not the
        // listing's state. Reading it as the latter failed every row.
        condition: 'USED',
        mileageKm: 159760,
        seats: 5,
        bodyType: 'SUV',
        drivetrain: 'FOUR_WHEEL_DRIVE',
        engineSizeL: 2.4,
      });
    });

    it("ignores the feed's CompanyID rather than honouring it", () => {
      const result = plan(`${DMS_HEADER}\n${dmsRow()}`);

      expect(result.ignoredColumns).toContain('CompanyID');
      expect(JSON.stringify(result.rows[0]!.draft)).not.toContain('someone-elses-rooftop');
    });

    it('records an explicit "Other" drivetrain rather than guessing one', () => {
      const result = plan(`${DMS_HEADER}\n${dmsRow({ Drive: 'Other' })}`);

      expect(result.rows[0]!.action).toBe('CREATE');
      expect(result.rows[0]!.draft?.drivetrain).toBe('OTHER');
    });

    it('records a blank transmission as OTHER, and says so', () => {
      const result = plan(`${DMS_HEADER}\n${dmsRow({ Transmission: '' })}`);

      expect(result.rows[0]!.action).toBe('CREATE');
      expect(result.rows[0]!.draft?.transmission).toBe('OTHER');
      expect(result.rows[0]!.warnings.join(' ')).toContain('blank');
    });

    it('keeps the vehicle when an optional number cannot be read', () => {
      // This feed writes "Electric" in its engine-size column. Losing the field
      // is the right trade; losing the listing is not.
      const result = plan(`${DMS_HEADER}\n${dmsRow({ 'Engine Size': 'Electric' })}`);

      expect(result.rows[0]!.action).toBe('CREATE');
      expect(result.rows[0]!.draft?.engineSizeL).toBeUndefined();
      expect(result.rows[0]!.warnings.join(' ')).toContain('is not a number');
    });

    describe('the location the feed does not carry', () => {
      // This feed has no City or Province column at all — a dealer management
      // system holds one address for the rooftop and does not repeat it per
      // vehicle. The listing still needs one, and where it comes from is the
      // whole of this block.
      const NOWHERE = { city: null, province: null };

      it('refuses the row in the preview rather than at the write', () => {
        // The bug this replaces: the planner did not require city, the writer
        // did, so a 47-row file previewed as 46 clean creates and then failed
        // the entire import with "this is a bug in the importer".
        const result = plan(`${DMS_HEADER}\n${dmsRow()}`, { defaults: NOWHERE });

        expect(result.summary).toMatchObject({ create: 0, errors: 1 });
        expect(result.rows[0]!.errors.join(' ')).toContain('city');
        expect(result.rows[0]!.errors.join(' ')).toContain('province');
      });

      it('says how to supply it', () => {
        const result = plan(`${DMS_HEADER}\n${dmsRow()}`, { defaults: NOWHERE });

        const message = result.rows[0]!.errors.join(' ');
        expect(message).toContain('Set a location for this import');
        expect(message).toContain('add city and province columns');
      });

      it('creates the row once a location is given', () => {
        const result = plan(`${DMS_HEADER}\n${dmsRow()}`, {
          defaults: { city: 'Mississauga', province: 'ON' },
        });

        expect(result.rows[0]!.action).toBe('CREATE');
        expect(result.rows[0]!.draft).toMatchObject({ city: 'Mississauga', province: 'ON' });
      });

      it('never overrides a city the file states', () => {
        const result = plan(`${DMS_HEADER},city,province\n${dmsRow()},Barrie,ON`, {
          defaults: { city: 'Mississauga', province: 'ON' },
        });

        expect(result.rows[0]!.draft?.city).toBe('Barrie');
      });

      it('resolves each half independently', () => {
        // A profile that knows the province but not the city still contributes
        // the province, so a file supplying only the city can be imported.
        const result = plan(`${DMS_HEADER},city\n${dmsRow()},Sudbury`, {
          defaults: { city: null, province: 'ON' },
        });

        expect(result.rows[0]!.action).toBe('CREATE');
        expect(result.rows[0]!.draft).toMatchObject({ city: 'Sudbury', province: 'ON' });
      });

      it('echoes back the location the plan was built with', () => {
        const result = plan(`${DMS_HEADER}\n${dmsRow()}`, {
          defaults: { city: 'Mississauga', province: 'ON' },
        });

        expect(result.defaultLocation).toEqual({ city: 'Mississauga', province: 'ON' });
      });
    });

    it('produces creates the writer will accept, field for field', () => {
      // The planner and the write boundary ask the same question from the same
      // list. This asserts the answer rather than the list: a CREATE row the
      // preview shows is a row that has every value the write needs.
      const result = plan(`${DMS_HEADER}\n${dmsRow()}`);
      const draft = result.rows[0]!.draft!;

      expect(result.rows[0]!.action).toBe('CREATE');
      for (const field of CREATE_REQUIRED_FIELDS) {
        expect(draft[field] ?? null).not.toBeNull();
      }
    });

    it('still fails a row whose body type the file never states', () => {
      // Body type drives the storefront's shape shortcuts, and the enumeration
      // is complete — so a blank here is missing data, not a new category.
      const result = plan(`${DMS_HEADER}\n${dmsRow({ Body: '' })}`);

      expect(result.rows[0]!.action).toBe('ERROR');
      expect(result.rows[0]!.errors.join(' ')).toContain('body_type');
    });
  });

  describe('duplicates within the file', () => {
    it('refuses both rows and names the other one', () => {
      const result = plan(`${FULL_HEADER}\n${FULL_ROW}\n${FULL_ROW.replace('28995', '30000')}`, {
        existing: [],
      });

      expect(result.summary).toMatchObject({ errors: 2, create: 0 });
      expect(result.rows[0]!.errors.join(' ')).toContain('row 3');
      expect(result.rows[1]!.errors.join(' ')).toContain('row 2');
    });
  });

  describe('file shape', () => {
    it('skips blank lines without failing the import', () => {
      const result = plan(`${FULL_HEADER}\n${FULL_ROW}\n\n`);
      expect(result.summary.totalRows).toBe(1);
    });

    it('keeps row numbers aligned with the spreadsheet', () => {
      // Row 2 is blank, so the real row is line 3 and must say so.
      const result = plan(`${FULL_HEADER}\n\n${FULL_ROW}`);
      expect(result.rows[0]!.row).toBe(3);
    });

    it('reports an unrecognised column without failing the file', () => {
      const result = plan(`lot_zone,${FULL_HEADER}\nNorth,${FULL_ROW}`);

      expect(result.unrecognisedColumns).toContain('lot_zone');
      expect(result.rows[0]!.action).toBe('CREATE');
    });

    it('skips the version line the export and template write first', () => {
      // The whole point of the export is that it can be edited and re-imported.
      // Before this was handled, the version line was read as the header row and
      // every column failed to map — the round trip was broken.
      const result = plan(`inventory_csv_version=1\n${FULL_HEADER}\n${FULL_ROW}`);

      expect(result.mappedColumns).toContain('vin');
      expect(result.rows[0]!.action).toBe('CREATE');
      // Row numbers still match the file: version is line 1, header line 2.
      expect(result.rows[0]!.row).toBe(3);
    });

    it('refuses a file with no recognised columns at all', () => {
      expect(() => plan('alpha,beta\n1,2')).toThrow(CsvParseError);
    });

    it('refuses the template documentation row if it is left in', () => {
      const result = plan(`${FULL_HEADER}\n# REQUIRED — Model year,,,,,,,,,,,,`);
      expect(result.rows[0]!.action).toBe('ERROR');
    });
  });

  it('generates a title and description for a row that omits them', () => {
    const result = plan(`${FULL_HEADER}\n${FULL_ROW}`);
    const draft = result.rows[0]!.draft!;

    expect(draft.title).toBe('2019 Toyota RAV4 LE');
    // Long enough for the listing schema, and every clause restates a value
    // from the row rather than inventing a selling point.
    expect(draft.description!.length).toBeGreaterThanOrEqual(20);
    expect(draft.description).toContain('2019 Toyota RAV4 LE');
    expect(draft.description).toContain('62,100 km');
  });
});
