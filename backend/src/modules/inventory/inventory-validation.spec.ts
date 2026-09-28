import { importReportCsv } from '@vintrax/shared';
import { planInventoryImport, type ExistingVehicle } from './inventory-plan';

/**
 * What the CSV preview refuses, and why — the dealer portal's upload modal
 * promises that nothing invalid is imported silently. Each case is a row a
 * real dealership export produces.
 */

const HEADER =
  'vin,stock_number,year,make,model,price_cad,mileage_km,condition,body_type,transmission,fuel_type,drivetrain,listing_status';

function row(fields: Partial<Record<string, string>> = {}): string {
  const values: Record<string, string> = {
    vin: '2T3BFREV9FW123456',
    stock_number: 'B-77',
    year: '2019',
    make: 'Toyota',
    model: 'RAV4',
    price_cad: '28995',
    mileage_km: '62100',
    condition: 'Used',
    body_type: 'SUV',
    transmission: 'Automatic',
    fuel_type: 'Gas',
    drivetrain: 'AWD',
    listing_status: '',
    ...fields,
  };
  return HEADER.split(',')
    .map((key) => values[key] ?? '')
    .join(',');
}

function plan(lines: string[], existing: ExistingVehicle[] = []) {
  return planInventoryImport({
    text: [HEADER, ...lines].join('\n'),
    existing,
    defaults: { city: 'Toronto', province: 'ON' },
    now: new Date('2026-09-15T00:00:00Z'),
  });
}

const errorsOf = (result: ReturnType<typeof plan>, index = 0) =>
  result.rows[index]!.errors.join(' ');

describe('CSV validation', () => {
  it('accepts a complete row', () => {
    const result = plan([row()]);
    expect(result.rows[0]!.action).toBe('CREATE');
    expect(result.summary).toMatchObject({ create: 1, errors: 0 });
  });

  describe('missing VIN', () => {
    it('skips a new vehicle with neither a VIN nor a stock number', () => {
      const result = plan([row({ vin: '', stock_number: '' })]);
      expect(result.rows[0]!.action).toBe('ERROR');
      expect(errorsOf(result)).toContain('needs a vin or a stock_number');
    });

    it('imports a vehicle with a stock number but no VIN, and warns', () => {
      const result = plan([row({ vin: '' })]);
      expect(result.rows[0]!.action).toBe('CREATE');
      expect(result.rows[0]!.warnings.join(' ')).toContain('Missing VIN');
    });
  });

  it('refuses a malformed VIN rather than repairing it', () => {
    const result = plan([row({ vin: 'NOT-A-VIN' })]);
    expect(result.rows[0]!.action).toBe('ERROR');
    expect(errorsOf(result)).toContain('VIN');
  });

  it('refuses an impossible model year', () => {
    expect(errorsOf(plan([row({ year: '1850' })]))).toContain('year');
    expect(errorsOf(plan([row({ year: 'twenty' })]))).toContain('year');
  });

  it('refuses a price that is not a whole positive number of dollars', () => {
    expect(plan([row({ price_cad: 'call' })]).rows[0]!.action).toBe('ERROR');
    expect(plan([row({ price_cad: '0' })]).rows[0]!.action).toBe('ERROR');
    expect(plan([row({ price_cad: '-5' })]).rows[0]!.action).toBe('ERROR');
  });

  it('refuses a mileage outside what an odometer can read', () => {
    expect(plan([row({ mileage_km: '-1' })]).rows[0]!.action).toBe('ERROR');
    expect(plan([row({ mileage_km: '9000000' })]).rows[0]!.action).toBe('ERROR');
  });

  it('refuses both rows of a duplicated VIN', () => {
    const result = plan([row(), row({ stock_number: 'B-78', price_cad: '30000' })]);
    expect(result.summary).toMatchObject({ errors: 2, create: 0 });
    expect(errorsOf(result)).toContain('Duplicate');
  });

  it('names the required columns a new vehicle is missing', () => {
    const result = plan([row({ make: '', body_type: '' })]);
    expect(result.rows[0]!.action).toBe('ERROR');
    expect(errorsOf(result)).toMatch(/make/);
    expect(errorsOf(result)).toMatch(/body_type/);
  });

  it('refuses a listing status that is not a status', () => {
    const result = plan([row({ listing_status: 'MAYBE' })]);
    expect(result.rows[0]!.action).toBe('ERROR');
    expect(errorsOf(result)).toContain('listing_status');
  });

  it('never publishes from a file: ACTIVE is left unchanged with a warning', () => {
    const result = plan([row({ listing_status: 'ACTIVE' })]);
    expect(result.rows[0]!.action).toBe('CREATE');
    expect(result.rows[0]!.warnings.join(' ')).toContain('cannot be set from a CSV');
  });

  it('writes a downloadable error report with formula-looking values neutralised', () => {
    const result = plan([row({ vin: '', stock_number: '', make: '=HYPERLINK("x")' })]);
    const report = importReportCsv(result.rows);
    const lines = report.split('\r\n');

    expect(lines[0]).toBe('row,result,vin,stock_number,vehicle,errors,warnings');
    expect(lines[1]).toContain('SKIPPED');
    // A cell starting with "=" is prefixed so a spreadsheet shows it as text.
    expect(report).not.toMatch(/(^|,)=HYPERLINK/m);
  });
});
