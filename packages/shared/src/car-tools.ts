import type { Province } from './domain';

// --- Estimate your budget ----------------------------------------------------

/**
 * Sales tax a buyer pays on a vehicle bought from a dealer, by province, as a
 * fraction: GST, plus the provincial sales tax or the harmonized tax. These are
 * the general rates. British Columbia charges more PST on dearer cars, some
 * provinces tax private sales differently, and rates change, so the budget
 * tool calls its figure an estimate.
 */
export const VEHICLE_SALES_TAX_RATES: Record<Province, number> = {
  AB: 0.05,
  BC: 0.12,
  MB: 0.12,
  NB: 0.15,
  NL: 0.15,
  NS: 0.14,
  NT: 0.05,
  NU: 0.05,
  ON: 0.13,
  PE: 0.15,
  QC: 0.14975,
  SK: 0.11,
  YT: 0.05,
};

/** Credit bands a buyer picks from, each with a typical used-car rate in Canada. */
export const CREDIT_BANDS = ['EXCELLENT', 'GOOD', 'FAIR', 'POOR'] as const;
export type CreditBand = (typeof CREDIT_BANDS)[number];

export const CREDIT_BAND_INFO: Record<CreditBand, { label: string; scores: string; rate: number }> =
  {
    EXCELLENT: { label: 'Excellent', scores: '760+', rate: 6.49 },
    GOOD: { label: 'Good', scores: '700–759', rate: 7.99 },
    FAIR: { label: 'Fair', scores: '640–699', rate: 11.49 },
    POOR: { label: 'Rebuilding', scores: 'Under 640', rate: 17.99 },
  };

/** Loan lengths offered, in months. */
export const LOAN_TERMS = [24, 36, 48, 60, 72, 84, 96] as const;

export interface BudgetInput {
  /** What the buyer can pay each month, in dollars. */
  monthlyPayment: number;
  downPayment: number;
  /** What the buyer's current car is worth as a trade-in. */
  tradeInValue: number;
  /** What is still owed on that car, paid off from the trade. */
  amountOwed: number;
  /** Annual percentage rate, e.g. 7.99 for 7.99 %. */
  annualRatePct: number;
  termMonths: number;
  /** A fraction, e.g. 0.13; see `VEHICLE_SALES_TAX_RATES`. */
  salesTaxRate: number;
  /** Dealer and licensing fees, taxed with the car. */
  fees: number;
}

export interface BudgetEstimate {
  /** The most the car itself can cost, rounded down to the nearest $100. */
  maxVehiclePrice: number;
  /** What the monthly payment finances. */
  loanAmount: number;
  /** Interest over the whole loan. */
  totalInterest: number;
  salesTax: number;
  /** The trade-in's value less what is owed on it; negative when more is owed than it is worth. */
  tradeInEquity: number;
  /** Everything that pays for the car: the loan, the down payment and the trade-in equity. */
  totalFinancing: number;
}

const nonNegative = (value: number) => (Number.isFinite(value) && value > 0 ? value : 0);

/**
 * How much a loan with this monthly payment can borrow: the present value of
 * the payments at the monthly rate. At 0 % it is the payments added up.
 */
export function loanPrincipal(monthlyPayment: number, annualRatePct: number, termMonths: number) {
  const payment = nonNegative(monthlyPayment);
  const months = Math.max(0, Math.round(nonNegative(termMonths)));
  const rate = nonNegative(annualRatePct) / 100 / 12;
  if (months === 0 || payment === 0) return 0;
  if (rate === 0) return payment * months;
  return (payment * (1 - Math.pow(1 + rate, -months))) / rate;
}

/** The monthly payment that repays `principal` over the term; the inverse of `loanPrincipal`. */
export function monthlyPaymentFor(principal: number, annualRatePct: number, termMonths: number) {
  const amount = nonNegative(principal);
  const months = Math.max(0, Math.round(nonNegative(termMonths)));
  const rate = nonNegative(annualRatePct) / 100 / 12;
  if (months === 0 || amount === 0) return 0;
  if (rate === 0) return amount / months;
  return (amount * rate) / (1 - Math.pow(1 + rate, -months));
}

/**
 * The most a buyer can spend on a car, from what they can pay monthly and
 * put down, the way CarGurus' "Estimate your budget" works it out.
 *
 * The money available is the loan the monthly payment supports, plus the
 * down payment, plus the trade-in's equity (its value less what is owed on
 * it). That pays for the car, the fees and the sales tax. As in most
 * provinces, the trade-in is deducted before tax, so tax is charged on the
 * price and fees less the trade-in's value:
 *
 *   price + fees + tax × max(0, price + fees − tradeIn) = available
 */
export function estimateBudget(input: BudgetInput): BudgetEstimate {
  const tax = nonNegative(input.salesTaxRate);
  const fees = nonNegative(input.fees);
  const tradeIn = nonNegative(input.tradeInValue);
  const loanAmount = loanPrincipal(input.monthlyPayment, input.annualRatePct, input.termMonths);
  const tradeInEquity = tradeIn - nonNegative(input.amountOwed);
  const totalFinancing = loanAmount + nonNegative(input.downPayment) + tradeInEquity;

  // Assume the taxable amount is positive, then fall back if it is not: a
  // trade-in worth more than the car leaves nothing to tax.
  let price = (totalFinancing - fees + tax * (tradeIn - fees)) / (1 + tax);
  if (price + fees - tradeIn <= 0) price = totalFinancing - fees;
  price = Math.max(0, price);

  const salesTax = tax * Math.max(0, price + fees - tradeIn);
  const months = Math.max(0, Math.round(nonNegative(input.termMonths)));
  const totalInterest = Math.max(0, nonNegative(input.monthlyPayment) * months - loanAmount);

  return {
    maxVehiclePrice: Math.floor(price / 100) * 100,
    loanAmount: Math.round(loanAmount),
    totalInterest: Math.round(totalInterest),
    salesTax: Math.round(salesTax),
    tradeInEquity: Math.round(tradeInEquity),
    totalFinancing: Math.round(totalFinancing),
  };
}
