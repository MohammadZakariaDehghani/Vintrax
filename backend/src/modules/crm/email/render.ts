import { BadRequestException } from '@nestjs/common';
import { templateVariablesIn, type TemplateVariable } from '@vintrax/shared';
import { escapeHtml } from './sanitizer';

/** Values for the variables one email uses. Missing ones fall back (below). */
export type TemplateValues = Partial<Record<TemplateVariable, string | null | undefined>>;

/** What a missing value reads as; anything not listed becomes empty. */
const FALLBACKS: Partial<Record<TemplateVariable, string>> = {
  'customer.first_name': 'there',
  'user.first_name': 'there',
  'salesperson.name': 'The team',
  'vehicle.make': 'vehicle',
};

/**
 * The variables a template uses that are not in the allowed set. A template
 * with any is refused when saved, so a typo cannot reach a customer as
 * literal `{{ custmer.name }}`.
 */
export function unknownVariables(text: string, allowed: readonly string[]): string[] {
  const allowedSet = new Set(allowed);
  return [...new Set(templateVariablesIn(text))].filter((name) => !allowedSet.has(name));
}

export function assertKnownVariables(allowed: readonly string[], ...texts: string[]): void {
  const unknown = [...new Set(texts.flatMap((text) => unknownVariables(text, allowed)))];
  if (unknown.length) {
    throw new BadRequestException({
      message: `Unknown variable${unknown.length > 1 ? 's' : ''}: ${unknown.map((name) => `{{${name}}}`).join(', ')}`,
      details: { bodyHtml: unknown.map((name) => `{{${name}}} is not a variable you can use`) },
    });
  }
}

function valueOf(values: TemplateValues, name: string): string {
  const value = values[name as TemplateVariable];
  if (value !== undefined && value !== null && value !== '') return value;
  return FALLBACKS[name as TemplateVariable] ?? '';
}

/** Fills `{{ variable }}`s. In HTML every value is escaped, so data cannot become markup. */
export function renderTemplate(text: string, values: TemplateValues, mode: 'html' | 'text'): string {
  return text.replace(/\{\{\s*([^{}]*?)\s*\}\}/g, (_match, name: string) => {
    const value = valueOf(values, name);
    return mode === 'html' ? escapeHtml(value) : value;
  });
}

/** Subjects are plain text and one line. */
export function renderSubject(subject: string, values: TemplateValues): string {
  return renderTemplate(subject, values, 'text').replace(/\s+/g, ' ').trim().slice(0, 250);
}
