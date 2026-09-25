import { describe, expect, it } from 'vitest';
import {
  CREDIT_BANDS,
  CREDIT_BAND_INFO,
  PROVINCES,
  VEHICLE_SALES_TAX_RATES,
  estimateBudget,
  loanPrincipal,
  monthlyPaymentFor,
} from '@vintrax/shared';

const base = {
  monthlyPayment: 500,
  downPayment: 0,
  tradeInValue: 0,
  amountOwed: 0,
  annualRatePct: 0,
  termMonths: 60,
  salesTaxRate: 0,
  fees: 0,
};

describe('loanPrincipal', () => {
  it('adds the payments up at 0 %', () => {
    expect(loanPrincipal(500, 0, 60)).toBe(30_000);
  });

  it('borrows less than the payments add up to when there is interest', () => {
    const principal = loanPrincipal(500, 7.99, 72);
    expect(principal).toBeGreaterThan(28_000);
    expect(principal).toBeLessThan(29_000);
  });

  it('is undone by monthlyPaymentFor', () => {
    const principal = loanPrincipal(640, 9.49, 84);
    expect(monthlyPaymentFor(principal, 9.49, 84)).toBeCloseTo(640, 6);
  });

  it('is zero for a zero or nonsense payment', () => {
    expect(loanPrincipal(0, 7, 60)).toBe(0);
    expect(loanPrincipal(-50, 7, 60)).toBe(0);
    expect(loanPrincipal(Number.NaN, 7, 60)).toBe(0);
  });
});

describe('estimateBudget', () => {
  it('is the loan plus the down payment with no tax or fees', () => {
    expect(estimateBudget({ ...base, downPayment: 2_000 }).maxVehiclePrice).toBe(32_000);
  });

  it('leaves room for the sales tax and the fees', () => {
    const result = estimateBudget({ ...base, salesTaxRate: 0.13, fees: 500 });
    // price + fees + 13 % of both = 30,000
    expect(result.maxVehiclePrice).toBe(Math.floor((30_000 / 1.13 - 500) / 100) * 100);
    expect(result.maxVehiclePrice + 500 + result.salesTax).toBeLessThanOrEqual(30_000 + 1);
  });

  it('adds the trade-in, less what is owed on it, and taxes only the difference', () => {
    const result = estimateBudget({
      ...base,
      tradeInValue: 10_000,
      amountOwed: 4_000,
      salesTaxRate: 0.13,
    });
    expect(result.tradeInEquity).toBe(6_000);
    // price + 13 % × (price − 10,000) = 36,000  →  price = 37,300 / 1.13
    expect(result.maxVehiclePrice).toBe(Math.floor(37_300 / 1.13 / 100) * 100);
  });

  it('charges no tax when the trade-in is worth more than the car', () => {
    const result = estimateBudget({
      ...base,
      monthlyPayment: 0,
      tradeInValue: 20_000,
      salesTaxRate: 0.15,
    });
    expect(result.maxVehiclePrice).toBe(20_000);
    expect(result.salesTax).toBe(0);
  });

  it('never goes below zero when more is owed than there is to spend', () => {
    const result = estimateBudget({ ...base, monthlyPayment: 0, amountOwed: 5_000 });
    expect(result.maxVehiclePrice).toBe(0);
    expect(result.tradeInEquity).toBe(-5_000);
  });

  it('counts the interest the payments carry', () => {
    const result = estimateBudget({ ...base, annualRatePct: 7.99, termMonths: 72 });
    expect(result.totalInterest).toBe(Math.round(500 * 72 - result.loanAmount));
  });

  it('buys less car with worse credit', () => {
    const [best, ...rest] = CREDIT_BANDS.map(
      (band) =>
        estimateBudget({ ...base, annualRatePct: CREDIT_BAND_INFO[band].rate }).maxVehiclePrice,
    );
    for (const next of rest) expect(next).toBeLessThan(best!);
  });
});

describe('sales tax rates', () => {
  it('has a rate for every province, between GST alone and the highest HST', () => {
    for (const province of PROVINCES) {
      expect(VEHICLE_SALES_TAX_RATES[province]).toBeGreaterThanOrEqual(0.05);
      expect(VEHICLE_SALES_TAX_RATES[province]).toBeLessThanOrEqual(0.15);
    }
  });
});
