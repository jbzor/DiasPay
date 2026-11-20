import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { missingConfig } from '../src/lib/config';

const src = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');

describe('lot A (T4) : choix du serveur', () => {
  it('sans EXPO_PUBLIC_API : configuration manquante (jamais de repli silencieux sur le simulateur)', () => {
    expect(missingConfig({})).toEqual(['EXPO_PUBLIC_API', 'EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY']);
    expect(missingConfig({ url: 'https://x.supabase.co', key: 'k' })).toEqual(['EXPO_PUBLIC_API']);
    expect(missingConfig({ api: 'autre', url: 'https://x.supabase.co', key: 'k' })).toEqual(['EXPO_PUBLIC_API']);
  });
  it('supabase : URL et clé publique requises', () => {
    expect(missingConfig({ api: 'supabase', url: 'https://x.supabase.co', key: 'k' })).toEqual([]);
    expect(missingConfig({ api: 'supabase', url: ' ', key: 'k' })).toEqual(['EXPO_PUBLIC_SUPABASE_URL']);
    expect(missingConfig({ api: 'supabase', url: 'https://x.supabase.co' })).toEqual(['EXPO_PUBLIC_SUPABASE_ANON_KEY']);
  });
  it('mock seulement s’il est écrit explicitement', () => {
    expect(missingConfig({ api: 'mock' })).toEqual([]);
    expect(src('state/backend.ts')).toMatch(/process\.env\.EXPO_PUBLIC_API === 'mock' \? 'mock' : 'supabase'/);
  });
  it('le simulateur (et son jeu de démonstration) n’est créé qu’en mode mock', () => {
    expect(src('state/api.ts')).toMatch(/mockApi: MockApi \| null = API_MODE === 'mock' \? new MockApi/);
    // Aucune autre création du simulateur ni de l’authentification simulée dans l’application.
    const files = ['state/auth.ts', 'state/queries.ts', 'app/_layout.tsx', 'state/needWizard.ts'];
    for (const f of files) expect(src(f), f).not.toMatch(/new Mock(Api|Auth)\(/);
    expect(src('state/auth.ts')).toMatch(/mockApi\?\.hydrate\(\)/);
  });
});

// Lot A (T6) : libellés de suivi affichés (clé i18n, couleur), dans les deux langues.
import { trackingKey, trackingKind, trackingOf } from '../src/features/tx/tracking';
import { en, fr } from '../src/i18n/messages';
import { TRACKING_LABELS } from '@diaspay/domain';
import type { Tranche, Transaction } from '@diaspay/api-client';

describe('lot A (T6) : libellés de suivi', () => {
  const tr = (over: Partial<Tranche>): Tranche => ({ id: 'r1', seq: 1, label: '', amountMinor: 1000, status: 'SUBMITTED', releaseMode: 'PROVIDER_CONFIRM',
    contestHours: 0, evidenceCount: 0, fundsState: 'NONE', onHold: false, refundedMinor: 0, ...over });
  const tx = (over: Partial<Transaction>, r: Tranche): Transaction => ({ id: 't1', vertical: 'HEALTH', settlementMode: 'DIRECT', purpose: '',
    amount: { amountMinor: 1000, currency: 'XAF' }, status: 'ACTIVE', providerName: '', beneficiaryName: '', createdAt: '', tranches: [r], ...over });
  const now = new Date(2026, 10, 19, 12);

  it('chaque libellé a sa traduction en français et en anglais', () => {
    for (const l of [...TRACKING_LABELS.map((x) => `track_${x}`), 'track_REFUNDED_PARTIAL', 'overdue']) {
      expect((fr as Record<string, string>)[l], l).toBeTruthy();
      expect((en as Record<string, string>)[l], l).toBeTruthy();
    }
  });
  it('données de l’opération : ouverture, pièces consultées, litige, retard, remboursement partiel', () => {
    const seen = tr({ firstViewedAt: '2026-11-18T10:00:00.000Z' });
    expect(trackingOf(tx({}, seen), seen, now).label).toBe('RECEIVED');
    expect(trackingOf(tx({ payerDocumentsViewedAt: '2026-11-18T11:00:00.000Z' }, seen), seen, now).label).toBe('UNDER_REVIEW');
    const disputed = tr({ status: 'PAID', disputeOpen: true });
    expect(trackingOf(tx({}, disputed), disputed, now).label).toBe('DISPUTED');
    const late = tr({ dueDate: '2026-11-01' });
    const t1 = trackingOf(tx({}, late), late, now);
    expect(t1).toMatchObject({ label: 'SUBMITTED', overdue: true });
    expect(trackingKind(t1)).toBe('error');
    const partial = tr({ status: 'REFUNDED', refundedMinor: 300 });
    expect(trackingKey(trackingOf(tx({}, partial), partial, now))).toBe('track_REFUNDED_PARTIAL');
  });
  it('le détail enregistre la première ouverture par le payeur (mark_received)', () => {
    const detail = src('app/tx/[id].tsx');
    expect(detail).toMatch(/placeIn\(tx, getCurrentUser\(\)\?\.id\)\.payer/);
    expect(detail).toMatch(/api\.markReceived\(trId\)/);
  });
});
