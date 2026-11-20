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
import { deviceAuthMessageKey, verifyDeviceOwner } from '../src/lib/deviceAuth';
import { apiReleaseReason } from '../src/lib/releaseGuard';

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

// Lot A (T8b) : jamais de paiement sans vérification. Biométrie, sinon code de l’appareil ; aucun verrouillage : refusé.
describe('lot A (T8b) : vérification de l’appareil avant paiement', () => {
  type Call = { promptMessage: string; disableDeviceFallback: boolean };
  const fakeLa = (level: number, result: { success: true } | { success: false; error: string } | Error) => {
    const calls: Call[] = [];
    return {
      calls,
      la: {
        getEnrolledLevelAsync: async () => level,
        authenticateAsync: async (o: Call) => { calls.push(o); if (result instanceof Error) throw result; return result; },
      },
    };
  };
  const native = { reason: 'Confirmez le paiement', platform: 'ios', webBypass: false };

  it('biométrie enregistrée : invite système, paiement autorisé si elle réussit, refusé sinon', async () => {
    const ok = fakeLa(3, { success: true });
    expect(await verifyDeviceOwner(ok.la, native)).toBe('OK');
    expect(ok.calls).toEqual([expect.objectContaining({ promptMessage: 'Confirmez le paiement', disableDeviceFallback: false })]);
    expect(await verifyDeviceOwner(fakeLa(3, { success: false, error: 'user_cancel' }).la, native)).toBe('DECLINED');
    expect(await verifyDeviceOwner(fakeLa(2, { success: false, error: 'authentication_failed' }).la, native)).toBe('DECLINED');
  });

  it('sans biométrie mais avec un code : le code est demandé (repli du système activé), jamais de passage d’office', async () => {
    const code = fakeLa(1, { success: true });
    expect(await verifyDeviceOwner(code.la, { ...native, platform: 'android' })).toBe('OK');
    expect(code.calls).toHaveLength(1);
    expect(code.calls[0]!.disableDeviceFallback).toBe(false);
    expect(await verifyDeviceOwner(fakeLa(1, { success: false, error: 'user_cancel' }).la, native)).toBe('DECLINED');
  });

  it('aucun verrouillage : refusé avec l’explication, sans invite', async () => {
    const none = fakeLa(0, { success: true });
    expect(await verifyDeviceOwner(none.la, native)).toBe('NO_LOCK');
    expect(none.calls).toHaveLength(0);
    expect(await verifyDeviceOwner(fakeLa(1, { success: false, error: 'not_enrolled' }).la, native)).toBe('NO_LOCK');
    expect(await verifyDeviceOwner(fakeLa(1, { success: false, error: 'passcode_not_set' }).la, native)).toBe('NO_LOCK');
    expect(deviceAuthMessageKey('NO_LOCK')).toBe('noDeviceLock');
    expect(fr.noDeviceLock).toMatch(/Réglages > Face ID et code/);
    expect(fr.noDeviceLock).toMatch(/Paramètres > Sécurité/);
    expect(en.noDeviceLock).toMatch(/Settings > Face ID & Passcode/);
  });

  it('erreur imprévue : refusé (échec fermé) ; navigateur : refusé sauf export de test déclaré', async () => {
    expect(await verifyDeviceOwner(fakeLa(3, new Error('module absent')).la, native)).toBe('DECLINED');
    const broken = { getEnrolledLevelAsync: async () => { throw new Error('x'); }, authenticateAsync: async () => ({ success: true as const }) };
    expect(await verifyDeviceOwner(broken, native)).toBe('DECLINED');
    expect(await verifyDeviceOwner(fakeLa(0, { success: true }).la, { ...native, platform: 'web' })).toBe('UNAVAILABLE');
    expect(await verifyDeviceOwner(fakeLa(0, { success: true }).la, { ...native, platform: 'web', webBypass: true })).toBe('OK');
    expect(deviceAuthMessageKey('UNAVAILABLE')).toBe('deviceAuthUnavailable');
    expect(deviceAuthMessageKey('DECLINED')).toBe('bioFailed');
  });

  it('paiement et confirmation passent par verifyOwner ; plus aucun « return true » de démonstration', () => {
    expect(src('app/pay/[trancheId].tsx')).toMatch(/await verifyOwner\(/);
    expect(src('app/(tabs)/scan.tsx')).toMatch(/await verifyOwner\(/);
    expect(src('lib/biometric.ts')).not.toMatch(/return true/);
    expect(src('lib/biometric.ts')).toMatch(/Platform\.OS/);
    expect(src('lib/biometric.ts')).toMatch(/EXPO_PUBLIC_WEB_SKIP_DEVICE_AUTH === '1'/);
  });
});

describe('lot A (T8b) : « Programmée » dans l’application', () => {
  it('libellé en français et en anglais, couleur neutre', () => {
    expect(fr.track_SCHEDULED).toBe('Programmée');
    expect(en.track_SCHEDULED).toBe('Scheduled');
    const now = new Date(2026, 10, 19, 12);
    const tr = { status: 'DRAFT', amountMinor: 1000, refundedMinor: 0, dueDate: '2027-01-15' } as unknown as Tranche;
    const t = trackingOf({ status: 'ACTIVE' } as unknown as Transaction, tr, now);
    expect(trackingKey(t)).toBe('track_SCHEDULED');
    expect(trackingKind(t)).toBe('draft');
  });
});

// Lot A (T8b) : la garde de boutique dit exactement ce qui bloque.
describe('lot A (T8b) : texte de la garde de boutique', () => {
  it('raison exacte : simulateur, variable absente ou valeur inattendue', () => {
    expect(apiReleaseReason('mock')).toBe('mock');
    expect(apiReleaseReason(undefined)).toBe('missing');
    expect(apiReleaseReason('  ')).toBe('missing');
    expect(apiReleaseReason('supabse')).toBe('other');
  });
  it('« simulateur » seulement quand le simulateur est demandé', () => {
    expect(fr.apiInReleaseText_mock).toMatch(/simulateur/);
    expect(fr.apiInReleaseText_missing).not.toMatch(/simulateur/);
    expect(fr.apiInReleaseText_missing).toMatch(/EXPO_PUBLIC_API est absente/);
    expect(fr.apiInReleaseText_other).not.toMatch(/simulateur/);
    expect(fr.apiInReleaseText_other).toMatch(/\{value\}/);
    expect(en.apiInReleaseText_missing).not.toMatch(/simulator/);
    expect(src('app/_layout.tsx')).toMatch(/apiInReleaseText_\$\{API_REASON\}/);
  });
});

describe('lot A (T8b) : état vide de l’accueil', () => {
  it('« Mes transactions » vide : composant d’état vide partagé, avec « Nouveau besoin »', () => {
    const home = src('app/(tabs)/home.tsx');
    expect(home).toMatch(/<EmptyState title=\{t\('homeEmptyTitle'\)\}/);
    expect(home).toMatch(/label=\{t\('newNeed'\)\} onPress=\{newNeed\}/);
    expect(src('app/(tabs)/alerts.tsx')).toMatch(/<EmptyState fill/);
    expect(fr.homeEmptyTitle).toBe('Aucune transaction pour le moment');
  });
});
