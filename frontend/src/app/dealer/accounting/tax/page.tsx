'use client';

import { useState } from 'react';
import {
  PROVINCES,
  PROVINCE_LABELS,
  TAX_CATEGORIES,
  TAX_CATEGORY_LABELS,
  TAX_FILING_STATUSES,
  TAX_RETURN_KINDS,
  TAX_RETURN_KIND_LABELS,
  TAX_TYPES,
  centsToDecimalString,
  formatRate,
  type Province,
  type TaxReturnKind,
} from '@vintrax/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  ErrorAlert,
  Field,
  Input,
  Select,
  Textarea,
} from '@/components/ui';
import { useAccounting } from '@/components/accounting/context';
import {
  Amount,
  Can,
  DataTable,
  ExportButtons,
  MoneyInput,
  PageHeader,
  RangeFilter,
  RangeLabel,
  Section,
  StatusBadge,
  fieldError,
  useAcctMutation,
  useAcctQuery,
} from '@/components/accounting/ui';
import {
  DEFAULT_RANGE,
  acct,
  isoDate,
  money,
  qs,
  rangeParams,
  todayIso,
  type Range,
  type RangeState,
} from '@/lib/accounting';
import { formatEnum } from '@/lib/utils';

interface ReturnSummary {
  kind: TaxReturnKind;
  collectedCents: number;
  paidCents: number;
  recoverableCents: number;
  netCents: number;
  taxableSalesCents: number;
  exemptSalesCents: number;
  adjustmentsCents: number;
  transactions: number;
}

interface Filing {
  id: string;
  kind: TaxReturnKind;
  frequency: string;
  startDate: string;
  endDate: string;
  status: string;
  adjustmentsCents: number;
  filedAt: string | null;
  confirmationNumber: string | null;
  notes: string | null;
  summary: ReturnSummary;
}

interface Rule {
  id: string;
  scope: 'PLATFORM' | 'DEALER';
  province: Province;
  taxType: string;
  name: string;
  rate: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  taxableCategories: string[];
  exemptCategories: string[];
  minPriceCents: number | null;
  maxPriceCents: number | null;
  tradeInReducesBase: boolean;
  recoverable: boolean;
  source: string | null;
  notes: string | null;
  isActive: boolean;
  version: number;
  usedCount: number;
}

export default function TaxCenterPage() {
  const { status, can } = useAccounting();
  const [range, setRange] = useState<RangeState>({ ...DEFAULT_RANGE, preset: 'THIS_QUARTER' });
  const [province, setProvince] = useState<Province>(
    (status.settings?.province as Province) ?? 'ON',
  );
  const [editingFiling, setEditingFiling] = useState<Filing | null>(null);
  const [creatingFiling, setCreatingFiling] = useState(false);
  const [rule, setRule] = useState<{ mode: 'new' } | { mode: 'supersede'; rule: Rule } | null>(
    null,
  );

  const summary = useAcctQuery<{ range: Range; disclaimer: string; returns: ReturnSummary[] }>(
    ['tax-summary', range],
    `/tax/summary${qs(rangeParams(range))}`,
  );
  const filings = useAcctQuery<Filing[]>(['tax-filings'], '/tax/filings');
  const rules = useAcctQuery<{ disclaimer: string; rules: Rule[] }>(
    ['tax-rules', province],
    `/tax/rules${qs({ province })}`,
  );
  const generate = useAcctMutation(() => {
    const year = todayIso().slice(0, 4);
    const month = String(status.settings?.fiscalYearStartMonth ?? 1).padStart(2, '0');
    const day = String(status.settings?.fiscalYearStartDay ?? 1).padStart(2, '0');
    const start = `${year}-${month}-${day}`;
    return acct.post('/tax/filings/generate', {
      fiscalYearStart: start > todayIso() ? `${Number(year) - 1}-${month}-${day}` : start,
    });
  });
  const toggleRule = useAcctMutation((target: Rule) =>
    acct.patch(`/tax/rules/${target.id}`, { isActive: !target.isActive }),
  );

  const returns = (summary.data?.returns ?? []).filter(
    (row) => row.kind === 'GST_HST' || row.transactions > 0 || row.collectedCents || row.paidCents,
  );

  return (
    <>
      <PageHeader
        title="Tax Center"
        description="GST/HST, PST and QST collected and paid, by filing period. A working view for your returns — check it with your accountant before you file."
      />
      <div className="mb-6 rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
        {summary.data?.disclaimer ?? rules.data?.disclaimer}
      </div>

      <Section
        title="Summary"
        actions={
          <>
            <RangeFilter value={range} onChange={setRange} />
            <ExportButtons report="tax" params={rangeParams(range)} />
          </>
        }
        description={summary.data ? <RangeLabel range={summary.data.range} /> : undefined}
      >
        <ErrorAlert error={summary.error} />
        <div className="grid gap-3 md:grid-cols-3">
          {returns.map((row) => (
            <Card key={row.kind}>
              <CardContent className="space-y-1 pt-5 text-sm">
                <p className="text-base font-semibold">{TAX_RETURN_KIND_LABELS[row.kind]}</p>
                <Line label="Taxable sales" cents={row.taxableSalesCents} />
                <Line label="Exempt / zero-rated sales" cents={row.exemptSalesCents} />
                <Line label="Tax collected" cents={row.collectedCents} />
                <Line label="Tax paid on purchases" cents={row.paidCents} />
                <Line label="Input tax credits" cents={-row.recoverableCents} />
                {row.adjustmentsCents ? (
                  <Line label="Adjustments" cents={row.adjustmentsCents} />
                ) : null}
                <div className="flex justify-between border-t border-border pt-1 font-semibold">
                  <span>{row.netCents >= 0 ? 'Net owing' : 'Refund due'}</span>
                  <Amount cents={Math.abs(row.netCents)} strong />
                </div>
                <p className="text-xs text-muted-foreground">{row.transactions} transactions</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </Section>

      <Section
        title="Filing periods"
        description="Open → In review → Filed → Closed. Record the CRA or Revenu Québec confirmation number when you file."
        actions={
          <Can permission="accounting.manage_tax">
            <Button
              variant="outline"
              loading={generate.isPending}
              onClick={() => generate.mutate(undefined)}
            >
              Create this year&apos;s periods
            </Button>
            <Button variant="outline" onClick={() => setCreatingFiling(true)}>
              Custom period
            </Button>
          </Can>
        }
      >
        <ErrorAlert error={generate.error} className="mb-2" />
        <DataTable
          dense
          loading={filings.isPending}
          error={filings.error}
          rows={filings.data}
          rowKey={(row) => row.id}
          empty={
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              No filing periods yet.
            </p>
          }
          columns={[
            { key: 'kind', label: 'Return', render: (row) => TAX_RETURN_KIND_LABELS[row.kind] },
            {
              key: 'period',
              label: 'Period',
              render: (row) => `${isoDate(row.startDate)} – ${isoDate(row.endDate)}`,
            },
            { key: 'frequency', label: 'Frequency', render: (row) => formatEnum(row.frequency) },
            {
              key: 'status',
              label: 'Status',
              render: (row) => <StatusBadge status={row.status} />,
            },
            {
              key: 'collected',
              label: 'Collected',
              align: 'right',
              render: (row) => <Amount cents={row.summary.collectedCents} />,
            },
            {
              key: 'itc',
              label: 'Credits',
              align: 'right',
              render: (row) => <Amount cents={row.summary.recoverableCents} />,
            },
            {
              key: 'net',
              label: 'Net',
              align: 'right',
              render: (row) => <Amount cents={row.summary.netCents} strong />,
            },
            {
              key: 'confirmation',
              label: 'Confirmation',
              render: (row) => row.confirmationNumber ?? '—',
            },
            {
              key: 'edit',
              label: '',
              align: 'right',
              render: (row) =>
                can('accounting.manage_tax') ? (
                  <Button size="sm" variant="ghost" onClick={() => setEditingFiling(row)}>
                    Update
                  </Button>
                ) : null,
            },
          ]}
        />
      </Section>

      <Section
        title="Tax rules"
        description="Rates come from configuration with effective dates, never from code. A change is a new version from a date; past transactions keep the rate they were charged."
        actions={
          <>
            <Select
              aria-label="Province"
              className="h-9 w-56"
              value={province}
              onChange={(event) => setProvince(event.target.value as Province)}
            >
              {PROVINCES.map((entry) => (
                <option key={entry} value={entry}>
                  {PROVINCE_LABELS[entry]}
                </option>
              ))}
            </Select>
            <Can permission="accounting.manage_tax">
              <Button variant="outline" onClick={() => setRule({ mode: 'new' })}>
                Add a dealer rule
              </Button>
            </Can>
          </>
        }
      >
        <ErrorAlert error={toggleRule.error} className="mb-2" />
        <DataTable
          dense
          loading={rules.isPending}
          error={rules.error}
          rows={rules.data?.rules}
          rowKey={(row) => row.id}
          columns={[
            {
              key: 'name',
              label: 'Rule',
              render: (row) => (
                <span>
                  {row.name}{' '}
                  {row.scope === 'DEALER' ? (
                    <Badge variant="primary">Yours</Badge>
                  ) : (
                    <Badge variant="outline">Default</Badge>
                  )}
                  {!row.isActive ? <Badge className="ml-1">Off</Badge> : null}
                </span>
              ),
            },
            { key: 'type', label: 'Tax', render: (row) => row.taxType },
            { key: 'rate', label: 'Rate', align: 'right', render: (row) => formatRate(row.rate) },
            {
              key: 'effective',
              label: 'Effective',
              render: (row) =>
                `${isoDate(row.effectiveFrom)}${row.effectiveTo ? ` – ${isoDate(row.effectiveTo)}` : ' onward'}`,
            },
            {
              key: 'applies',
              label: 'Applies to',
              render: (row) => (
                <span className="text-xs text-muted-foreground">
                  {row.taxableCategories.length
                    ? row.taxableCategories.map((category) => formatEnum(category)).join(', ')
                    : 'All categories'}
                  {row.exemptCategories.length
                    ? ` · not ${row.exemptCategories.map((category) => formatEnum(category)).join(', ')}`
                    : ''}
                  {row.minPriceCents !== null || row.maxPriceCents !== null
                    ? ` · vehicles ${row.minPriceCents !== null ? `from ${money(row.minPriceCents)}` : ''}${row.maxPriceCents !== null ? ` to ${money(row.maxPriceCents)}` : ''}`
                    : ''}
                  {row.tradeInReducesBase ? '' : ' · no trade-in credit'}
                </span>
              ),
            },
            {
              key: 'source',
              label: 'Source',
              render: (row) => (
                <span
                  className="line-clamp-2 max-w-xs text-xs text-muted-foreground"
                  title={row.source ?? ''}
                >
                  {row.source ?? '—'}
                </span>
              ),
            },
            {
              key: 'actions',
              label: '',
              align: 'right',
              render: (row) =>
                can('accounting.manage_tax') ? (
                  <span className="flex justify-end gap-1">
                    {row.scope === 'DEALER' && !row.effectiveTo ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setRule({ mode: 'supersede', rule: row })}
                      >
                        New rate
                      </Button>
                    ) : null}
                    {row.scope === 'DEALER' ? (
                      <Button size="sm" variant="ghost" onClick={() => toggleRule.mutate(row)}>
                        {row.isActive ? 'Turn off' : 'Turn on'}
                      </Button>
                    ) : null}
                  </span>
                ) : null,
            },
          ]}
        />
        <p className="mt-2 text-xs text-muted-foreground">
          A dealer rule replaces the default rule of the same tax type for this province from its
          effective date. Default rules are maintained by the platform.
        </p>
      </Section>

      <TaxCalculator province={province} />

      {editingFiling ? (
        <FilingDialog filing={editingFiling} onClose={() => setEditingFiling(null)} />
      ) : null}
      {creatingFiling ? <CustomFilingDialog onClose={() => setCreatingFiling(false)} /> : null}
      {rule ? (
        <RuleDialog
          province={province}
          supersede={rule.mode === 'supersede' ? rule.rule : null}
          onClose={() => setRule(null)}
        />
      ) : null}
    </>
  );
}

function Line({ label, cents }: { label: string; cents: number }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <Amount cents={cents} />
    </div>
  );
}

function FilingDialog({ filing, onClose }: { filing: Filing; onClose: () => void }) {
  const [form, setForm] = useState({
    status: filing.status,
    adjustments: centsToDecimalString(filing.adjustmentsCents),
    confirmationNumber: filing.confirmationNumber ?? '',
    notes: filing.notes ?? '',
  });
  const save = useAcctMutation(
    () =>
      acct.patch(`/tax/filings/${filing.id}`, {
        ...form,
        confirmationNumber: form.confirmationNumber || null,
        notes: form.notes || null,
      }),
    onClose,
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title={`${TAX_RETURN_KIND_LABELS[filing.kind]} · ${isoDate(filing.startDate)} – ${isoDate(filing.endDate)}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Status" htmlFor="tf-status">
          <Select
            id="tf-status"
            value={form.status}
            onChange={(event) => setForm({ ...form, status: event.target.value })}
          >
            {TAX_FILING_STATUSES.map((entry) => (
              <option key={entry} value={entry}>
                {formatEnum(entry)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Adjustments"
          htmlFor="tf-adj"
          hint="Added to the net amount (negative reduces it)."
        >
          <MoneyInput
            id="tf-adj"
            allowNegative
            value={form.adjustments}
            onChange={(value) => setForm({ ...form, adjustments: value })}
          />
        </Field>
        <Field label="Confirmation number" htmlFor="tf-conf" className="sm:col-span-2">
          <Input
            id="tf-conf"
            value={form.confirmationNumber}
            onChange={(event) => setForm({ ...form, confirmationNumber: event.target.value })}
          />
        </Field>
        <Field label="Notes" htmlFor="tf-notes" className="sm:col-span-2">
          <Textarea
            id="tf-notes"
            className="min-h-[70px]"
            value={form.notes}
            onChange={(event) => setForm({ ...form, notes: event.target.value })}
          />
        </Field>
      </div>
      <ErrorAlert error={save.error} className="mt-3" />
    </Dialog>
  );
}

function CustomFilingDialog({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({
    kind: 'GST_HST',
    startDate: `${todayIso().slice(0, 8)}01`,
    endDate: todayIso(),
  });
  const save = useAcctMutation(
    () => acct.post('/tax/filings', { ...form, frequency: 'CUSTOM' }),
    onClose,
  );
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title="Custom filing period"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>
            Create
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label="Return" htmlFor="cf-kind">
          <Select
            id="cf-kind"
            value={form.kind}
            onChange={(event) => setForm({ ...form, kind: event.target.value })}
          >
            {TAX_RETURN_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {TAX_RETURN_KIND_LABELS[kind]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="From" htmlFor="cf-from">
          <Input
            id="cf-from"
            type="date"
            value={form.startDate}
            onChange={(event) => setForm({ ...form, startDate: event.target.value })}
          />
        </Field>
        <Field label="To" htmlFor="cf-to" error={fieldError(save.error, 'endDate')}>
          <Input
            id="cf-to"
            type="date"
            value={form.endDate}
            onChange={(event) => setForm({ ...form, endDate: event.target.value })}
          />
        </Field>
      </div>
      <ErrorAlert error={save.error} className="mt-3" />
    </Dialog>
  );
}

function RuleDialog({
  province,
  supersede,
  onClose,
}: {
  province: Province;
  supersede: Rule | null;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    taxType: supersede?.taxType ?? 'PST',
    name: supersede?.name ?? '',
    rate: supersede?.rate ?? '',
    effectiveFrom: todayIso(),
    taxableCategories: supersede?.taxableCategories ?? [],
    tradeInReducesBase: supersede?.tradeInReducesBase ?? true,
    recoverable: supersede?.recoverable ?? true,
    source: '',
    notes: '',
  });
  const save = useAcctMutation(
    () =>
      supersede
        ? acct.post(`/tax/rules/${supersede.id}/supersede`, {
            rate: form.rate,
            effectiveFrom: form.effectiveFrom,
            source: form.source,
            notes: form.notes || null,
          })
        : acct.post('/tax/rules', { ...form, province, notes: form.notes || null }),
    onClose,
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title={
        supersede
          ? `New rate for ${supersede.name}`
          : `Add a dealer tax rule for ${PROVINCE_LABELS[province]}`
      }
      description="Cite where the rate comes from — the CRA, Revenu Québec or the province's ministry of finance."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={save.isPending}
            disabled={!form.rate || !form.source.trim() || (!supersede && !form.name.trim())}
            onClick={() => save.mutate(undefined)}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {!supersede ? (
          <>
            <Field label="Tax" htmlFor="tr-type">
              <Select
                id="tr-type"
                value={form.taxType}
                onChange={(event) => setForm({ ...form, taxType: event.target.value })}
              >
                {TAX_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Name" htmlFor="tr-name">
              <Input
                id="tr-name"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </Field>
          </>
        ) : null}
        <Field label="Rate %" htmlFor="tr-rate" error={fieldError(save.error, 'rate')}>
          <Input
            id="tr-rate"
            inputMode="decimal"
            value={form.rate}
            onChange={(event) => setForm({ ...form, rate: event.target.value })}
          />
        </Field>
        <Field label="Effective from" htmlFor="tr-from">
          <Input
            id="tr-from"
            type="date"
            value={form.effectiveFrom}
            onChange={(event) => setForm({ ...form, effectiveFrom: event.target.value })}
          />
        </Field>
        {!supersede ? (
          <>
            <fieldset className="sm:col-span-2">
              <legend className="mb-1 text-sm font-medium">
                Taxes these categories (none ticked: all)
              </legend>
              <div className="flex flex-wrap gap-3">
                {TAX_CATEGORIES.filter((category) => category !== 'EXEMPT').map((category) => (
                  <label key={category} className="flex items-center gap-1 text-sm">
                    <input
                      type="checkbox"
                      checked={form.taxableCategories.includes(category)}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          taxableCategories: event.target.checked
                            ? [...form.taxableCategories, category]
                            : form.taxableCategories.filter((entry) => entry !== category),
                        })
                      }
                    />
                    {TAX_CATEGORY_LABELS[category]}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.tradeInReducesBase}
                onChange={(event) => setForm({ ...form, tradeInReducesBase: event.target.checked })}
              />
              A trade-in reduces the taxable amount
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.recoverable}
                onChange={(event) => setForm({ ...form, recoverable: event.target.checked })}
              />
              Recoverable as an input tax credit
            </label>
          </>
        ) : null}
        <Field label="Source" htmlFor="tr-source" className="sm:col-span-2">
          <Input
            id="tr-source"
            placeholder="e.g. canada.ca — GST/HST rates"
            value={form.source}
            onChange={(event) => setForm({ ...form, source: event.target.value })}
          />
        </Field>
        <Field label="Notes" htmlFor="tr-notes" className="sm:col-span-2">
          <Textarea
            id="tr-notes"
            className="min-h-[60px]"
            value={form.notes}
            onChange={(event) => setForm({ ...form, notes: event.target.value })}
          />
        </Field>
      </div>
      <ErrorAlert error={save.error} className="mt-3" />
    </Dialog>
  );
}

interface Quote {
  components: Array<{
    ruleId: string;
    taxType: string;
    rate: string;
    taxableCents: number;
    tradeInDeductedCents: number;
    taxCents: number;
  }>;
  totalTaxCents: number;
  grossCents: number;
}

function TaxCalculator({ province }: { province: Province }) {
  const [form, setForm] = useState({
    date: todayIso(),
    category: 'VEHICLE',
    amount: '',
    tradeIn: '',
  });
  const [result, setResult] = useState<Quote | null>(null);
  const [error, setError] = useState<unknown>(null);
  const run = () => {
    setError(null);
    acct
      .post<Quote>('/tax/quote', {
        province,
        date: form.date,
        lines: [{ category: form.category, amount: form.amount || '0' }],
        tradeIn: form.tradeIn || '0',
      })
      .then(setResult)
      .catch(setError);
  };
  return (
    <Section
      title="Tax calculator"
      description={`What ${PROVINCE_LABELS[province]}'s rules charge on an amount, on a date.`}
    >
      <Card>
        <CardContent className="pt-5">
          <div className="grid gap-3 sm:grid-cols-5">
            <Field label="Date" htmlFor="tc-date">
              <Input
                id="tc-date"
                type="date"
                value={form.date}
                onChange={(event) => setForm({ ...form, date: event.target.value })}
              />
            </Field>
            <Field label="Category" htmlFor="tc-category">
              <Select
                id="tc-category"
                value={form.category}
                onChange={(event) => setForm({ ...form, category: event.target.value })}
              >
                {TAX_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {TAX_CATEGORY_LABELS[category]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Amount" htmlFor="tc-amount">
              <MoneyInput
                id="tc-amount"
                value={form.amount}
                onChange={(value) => setForm({ ...form, amount: value })}
              />
            </Field>
            <Field label="Trade-in" htmlFor="tc-trade">
              <MoneyInput
                id="tc-trade"
                value={form.tradeIn}
                onChange={(value) => setForm({ ...form, tradeIn: value })}
              />
            </Field>
            <Button className="self-end" onClick={run}>
              Calculate
            </Button>
          </div>
          <ErrorAlert error={error} className="mt-3" />
          {result ? (
            <ul className="mt-4 space-y-1 text-sm">
              {result.components.map((component) => (
                <li key={component.ruleId} className="flex justify-between gap-2">
                  <span>
                    {component.taxType} {formatRate(component.rate)} on{' '}
                    {money(component.taxableCents)}
                    {component.tradeInDeductedCents
                      ? ` (after ${money(component.tradeInDeductedCents)} trade-in)`
                      : ''}
                  </span>
                  <Amount cents={component.taxCents} />
                </li>
              ))}
              <li className="flex justify-between gap-2 border-t border-border pt-1 font-semibold">
                <span>Total tax</span>
                <Amount cents={result.totalTaxCents} strong />
              </li>
            </ul>
          ) : null}
        </CardContent>
      </Card>
    </Section>
  );
}
