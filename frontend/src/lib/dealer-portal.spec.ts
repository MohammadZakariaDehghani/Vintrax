import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatCents, parseAmountToCents, summariseVehicleCosts } from '@vintrax/shared';

/** The dealer portal's client-side rules: what the browser may and may not do. */

const read = (path: string) => readFileSync(path, 'utf8');

describe('dealer help assistant (browser side)', () => {
  const source = read('src/components/dealer-help-assistant.tsx');

  it('talks only to the Vintrax API, never to an AI provider', () => {
    expect(source).toContain("'/dealer/help/chat'");
    expect(source).not.toMatch(/anthropic|openai|api\.anthropic|AI_API_KEY|x-api-key/i);
  });

  it('renders answers as text, never as HTML', () => {
    expect(source).not.toContain('dangerouslySetInnerHTML');
  });

  it('only links sources that stay on this site', () => {
    expect(source).toMatch(/href\?\.startsWith\('\/'\)/);
  });

  it('is mounted for every dealer portal page', () => {
    expect(read('src/app/dealer/layout.tsx')).toContain('<DealerHelpAssistant />');
  });
});

describe('dealer costs (browser side)', () => {
  it('sends whole cents, never a floating-point amount', () => {
    const form = read('src/app/dealer/costs/[vehicleId]/vehicle-costs.tsx');
    expect(form).toContain('parseAmountToCents(form.amount)');
    expect(form).not.toMatch(/vehicleId:\s*form|sellerId/);
    expect(parseAmountToCents('17,650.00')).toBe(1_765_000);
  });

  it('shows the same totals the API computes', () => {
    const totals = summariseVehicleCosts(
      [
        { category: 'PURCHASE', amountCents: 1_500_000 },
        { category: 'MECHANICAL_REPAIR', amountCents: 265_000 },
      ],
      21_995,
    );
    expect(formatCents(totals.totalCents)).toBe('$17,650.00');
    expect(formatCents(totals.grossMarginCents!)).toBe('$4,345.00');
  });
});

describe('dealer inventory (browser side)', () => {
  const page = read('src/app/dealer/inventory/page.tsx');

  it('never computes inventory statistics from the page of rows it holds', () => {
    expect(page).toContain("'/dealer/inventory/stats'");
    expect(page).not.toMatch(/items\.reduce/);
  });

  it('applies large selections in the batch size the API accepts', () => {
    expect(page).toContain('MAX_BULK_VEHICLE_IDS');
  });
});
