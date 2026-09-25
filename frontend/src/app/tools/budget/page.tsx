import type { Metadata } from 'next';
import { BudgetTool } from './budget-tool';

export const metadata: Metadata = {
  title: 'Estimate your budget',
  description:
    'Work out how much car you can afford from your monthly payment, down payment, trade-in, credit and province, then shop cars in your budget.',
};

export default function BudgetPage() {
  return (
    <div className="container max-w-5xl py-10">
      <h1 className="text-3xl font-bold tracking-tight">Estimate your budget</h1>
      <p className="mt-2 max-w-2xl text-muted-foreground">
        Start from the monthly payment you’re comfortable with. We’ll work out the most you can
        spend on the car itself once financing, your trade-in and sales tax are counted.
      </p>
      <BudgetTool />
    </div>
  );
}
