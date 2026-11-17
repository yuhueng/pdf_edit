import type { FieldValues, FormField } from './pages.ts';

/** Fields a person can fill in (buttons, signatures and read-only fields are not asked for). */
export const fillable = (all: FormField[]): FormField[] =>
  all.filter((f) => f.type !== 'button' && f.type !== 'signature' && !f.readOnly);

export function currentValue(f: FormField, values: FieldValues): string | boolean {
  const v = values[f.key];
  if (v !== undefined) return v;
  return f.type === 'checkbox' || f.type === 'radio' ? f.checked : f.value;
}

/** A radio group counts as filled when any of its buttons is on; everything else by its own value. */
export function isFilled(f: FormField, all: FormField[], values: FieldValues): boolean {
  if (f.type === 'radio') return all.some((o) => o.type === 'radio' && o.name === f.name && currentValue(o, values) === true);
  const v = currentValue(f, values);
  return typeof v === 'boolean' ? v : v.trim() !== '';
}

/** One entry per field to fill (radio groups collapse to one), with whether it has a value. */
export function checkFields(all: FormField[], values: FieldValues): { total: number; filled: number; empty: FormField[] } {
  const seen = new Set<string>();
  const list = fillable(all).filter((f) => {
    if (f.type !== 'radio') return true;
    if (seen.has(f.name)) return false;
    seen.add(f.name);
    return true;
  });
  const empty = list.filter((f) => !isFilled(f, all, values));
  return { total: list.length, filled: list.length - empty.length, empty };
}
