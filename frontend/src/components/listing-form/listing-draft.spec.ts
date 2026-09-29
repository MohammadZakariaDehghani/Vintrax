import { describe, expect, it } from 'vitest';
import type { VehicleDetail, VinDecodeResult } from '@vintrax/shared';
import {
  BLANK_DRAFT,
  LISTING_SECTIONS,
  autoTitle,
  draftFromDecode,
  draftFromVehicle,
  draftQuality,
  sectionState,
  toPayload,
  validateDraft,
  type ListingDraft,
} from './listing-draft';

const COMPLETE: ListingDraft = {
  ...BLANK_DRAFT,
  vin: 'JHLRD1871YC810608',
  make: 'Honda',
  model: 'CR-V',
  year: '2000',
  trim: 'SE',
  bodyType: 'SUV',
  province: 'ON',
  city: 'Toronto',
  mileageKm: '420,647',
  fuelType: 'GASOLINE',
  drivetrain: 'FOUR_WHEEL_DRIVE',
  transmission: 'AUTOMATIC',
  description: 'Clean, well kept and ready to drive home today.',
  priceCad: '4,980',
};

const section = (id: string) => LISTING_SECTIONS.find((entry) => entry.id === id)!;

describe('validating the listing form', () => {
  it('passes a listing with every required field', () => {
    expect(validateDraft(COMPLETE)).toEqual({});
  });

  it('names every missing required field on a blank form', () => {
    const errors = validateDraft(BLANK_DRAFT);
    expect(Object.keys(errors).sort()).toEqual(
      [
        'stockNumber',
        'make',
        'model',
        'year',
        'bodyType',
        'province',
        'city',
        'mileageKm',
        'fuelType',
        'drivetrain',
        'transmission',
        'description',
        'priceCad',
      ].sort(),
    );
  });

  it('needs a VIN or a stock number, and accepts either', () => {
    expect(validateDraft({ ...COMPLETE, vin: '' }).stockNumber).toBe(
      'Enter a VIN or a stock number.',
    );
    expect(
      validateDraft({ ...COMPLETE, vin: '', stockNumber: 'A1042' }).stockNumber,
    ).toBeUndefined();
  });

  it('explains a VIN that cannot be one', () => {
    expect(validateDraft({ ...COMPLETE, vin: 'JHLRD1871' }).vin).toContain('9/17');
  });

  it('counts down to the shortest description', () => {
    expect(validateDraft({ ...COMPLETE, description: 'Runs well.' }).description).toBe(
      'Write at least 20 characters — 10 more to go.',
    );
  });

  it('checks optional numbers only when they are filled in', () => {
    expect(validateDraft({ ...COMPLETE, doors: '' }).doors).toBeUndefined();
    expect(validateDraft({ ...COMPLETE, doors: '12' }).doors).toBeDefined();
    expect(validateDraft({ ...COMPLETE, videoUrl: 'https://vimeo.com/1' }).videoUrl).toBeDefined();
  });
});

describe('the timeline marks', () => {
  const quality = draftQuality(COMPLETE);

  it('are a tick for a complete required section and an exclamation mark for a missing one', () => {
    expect(sectionState(section('condition'), COMPLETE, validateDraft(COMPLETE), quality)).toBe(
      'done',
    );
    const missing = { ...COMPLETE, mileageKm: '' };
    expect(sectionState(section('condition'), missing, validateDraft(missing), quality)).toBe(
      'error',
    );
  });

  it('leave an untouched optional section numbered, and tick it once something is filled in', () => {
    expect(sectionState(section('features'), COMPLETE, {}, quality)).toBe('todo');
    const coloured = { ...COMPLETE, exteriorColour: 'Silver' };
    expect(sectionState(section('features'), coloured, {}, quality)).toBe('done');
    const equipped = { ...COMPLETE, equipment: ['Air conditioning'] };
    expect(sectionState(section('equipment'), equipped, {}, quality)).toBe('done');
  });
});

describe('what is saved', () => {
  it('writes a headline when the dealer leaves it blank', () => {
    expect(autoTitle(COMPLETE)).toBe('2000 Honda CR-V SE');
    expect(toPayload(COMPLETE, {}).title).toBe('2000 Honda CR-V SE');
  });

  it('sends numbers as numbers, blanks as null, and ticked plus typed features together', () => {
    const payload = toPayload(
      {
        ...COMPLETE,
        equipment: ['Air conditioning', 'Heated seats'],
        otherFeatures: 'Block heater, Heated seats',
        isDamaged: 'no',
        ownerCount: '2',
      },
      { status: 'PENDING_REVIEW' },
    );
    expect(payload).toMatchObject({
      mileageKm: 420_647,
      priceCad: 4_980,
      stockNumber: null,
      horsepower: null,
      isDamaged: false,
      extendedWarranty: null,
      ownerCount: 2,
      status: 'PENDING_REVIEW',
      features: ['Air conditioning', 'Heated seats', 'Block heater'],
    });
    expect(payload).not.toHaveProperty('titleStatus');
  });

  it('leaves the status out of an edit', () => {
    expect(toPayload(COMPLETE, {})).not.toHaveProperty('status');
  });
});

describe('filling the form in', () => {
  it('from a decoded VIN', () => {
    const decoded: VinDecodeResult = {
      vin: 'JHLRD1871YC810608',
      checkDigitValid: true,
      make: 'Honda',
      model: 'CR-V',
      year: 2000,
      trim: 'SE',
      style: 'CR-V 4WD SE Auto (Gasoline, 2.0L)',
      bodyType: 'SUV',
      drivetrain: 'FOUR_WHEEL_DRIVE',
      transmission: 'AUTOMATIC',
      fuelType: 'GASOLINE',
      engine: '2.0L 4-cylinder',
      engineSizeL: 2,
      cylinders: 4,
      doors: 4,
      seats: null,
      horsepower: null,
    };
    const draft = draftFromDecode(BLANK_DRAFT, decoded);
    expect(draft).toMatchObject({
      vin: 'JHLRD1871YC810608',
      year: '2000',
      doors: '4',
      seats: '',
      style: 'CR-V 4WD SE Auto (Gasoline, 2.0L)',
    });
  });

  it('from a saved vehicle, splitting catalogue equipment from typed features', () => {
    const vehicle = {
      ...({} as VehicleDetail),
      make: 'Honda',
      model: 'CR-V',
      year: 2000,
      trim: null,
      title: '2000 Honda CR-V',
      mileageKm: 420_647,
      priceCad: 4_980,
      features: ['Air conditioning', 'Block heater'],
      images: [],
      isDamaged: true,
      extendedWarranty: false,
      ownerCount: null,
      referencePrices: null,
    } as VehicleDetail;
    const draft = draftFromVehicle(vehicle);
    expect(draft.equipment).toEqual(['Air conditioning']);
    expect(draft.otherFeatures).toBe('Block heater');
    expect(draft.isDamaged).toBe('yes');
    expect(draft.extendedWarranty).toBe('no');
    expect(draft.ownerCount).toBe('');
  });
});
