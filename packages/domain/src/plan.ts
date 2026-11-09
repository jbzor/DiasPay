import { DomainError } from './types';
import type { RecurrenceFreq, TrancheDraft } from './types';

/** Vérifie que la somme des tranches égale le montant total. */
export function validatePlan(totalMinor: number, tranches: readonly TrancheDraft[]): void {
  if (tranches.length === 0) throw new DomainError('PLAN_EMPTY', 'Au moins une tranche est requise');
  for (const t of tranches) {
    if (!Number.isInteger(t.amountMinor) || t.amountMinor <= 0) {
      throw new DomainError('PLAN_BAD_AMOUNT', 'Chaque tranche doit avoir un montant entier positif');
    }
  }
  const sum = tranches.reduce((s, t) => s + t.amountMinor, 0);
  if (sum !== totalMinor) {
    throw new DomainError('PLAN_SUM_MISMATCH',
      `La somme des tranches (${sum}) doit égaler le montant total (${totalMinor})`);
  }
}

function parseDate(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) throw new DomainError('BAD_DATE', `Date invalide : ${iso}`);
  return { y, m, d };
}

function fmt(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Ajoute des mois à la date d'origine, en plafonnant au dernier jour du mois (comme PostgreSQL). */
export function addMonths(iso: string, months: number): string {
  const { y, m, d } = parseDate(iso);
  const idx = (y * 12 + (m - 1)) + months;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return fmt(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

export function addDays(iso: string, days: number): string {
  const { y, m, d } = parseDate(iso);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return fmt(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** N tranches égales ; la dernière absorbe le reste. Miroir de generate_recurring_tranches(). */
export function generateRecurringTranches(input: {
  totalMinor: number;
  frequency: RecurrenceFreq;
  installments: number;
  startDate: string;
  label?: string;
}): TrancheDraft[] {
  const { totalMinor, frequency, installments: n, startDate } = input;
  if (!Number.isInteger(n) || n < 2 || n > 60) {
    throw new DomainError('PLAN_BAD_COUNT', 'Le nombre d’échéances doit être entre 2 et 60');
  }
  const base = Math.floor(totalMinor / n);
  if (base <= 0) throw new DomainError('PLAN_TOO_SMALL', 'Montant trop faible pour ce nombre d’échéances');
  const label = input.label ?? 'Échéance';
  const out: TrancheDraft[] = [];
  for (let i = 0; i < n; i++) {
    const dueDate =
      frequency === 'WEEKLY' ? addDays(startDate, 7 * i)
      : frequency === 'MONTHLY' ? addMonths(startDate, i)
      : addMonths(startDate, 3 * i);
    out.push({
      label: `${label} ${i + 1}`,
      amountMinor: i === n - 1 ? totalMinor - base * (n - 1) : base,
      dueDate,
    });
  }
  return out;
}
