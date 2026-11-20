import { afterAll, describe, expect, it } from 'vitest';
import { SupabaseApi, SupabaseAuth, createDiasPayClient, newUuid } from '../../src';
import type { DiasPayClient } from '../../src';
import { contractSuite, healthDraft } from './contract';
import type { ContractApi, Who } from './contract';

/**
 * Même suite contre un vrai projet Supabase (développement, mock_mode = 'true', seed exécuté).
 *   SUPABASE_TEST_URL=… SUPABASE_TEST_ANON_KEY=… pnpm --filter @diaspay/api-client test
 * ou `pnpm test:supabase` (lit apps/mobile/.env.local). Clé publique uniquement, jamais service_role.
 * Comptes : numéros de test réservés (+33 6 39 98 00 11 à 13, code fixe), distincts des comptes de démonstration.
 */
const URL = process.env.SUPABASE_TEST_URL;
const KEY = process.env.SUPABASE_TEST_ANON_KEY;

const PHONES: Record<Who, { phone: string; role: 'PAYER' | 'REQUESTER' }> = {
  PAYER: { phone: '+33639980011', role: 'PAYER' },
  REQUESTER: { phone: '+33639980012', role: 'REQUESTER' },
  OTHER: { phone: '+33639980013', role: 'PAYER' },
};
const sessions = new Map<Who, Promise<ContractApi>>();
const clients = new Map<Who, DiasPayClient>();

async function signIn(who: Who): Promise<ContractApi> {
  const mem = new Map<string, string>();
  const sb = createDiasPayClient({
    url: URL!, anonKey: KEY!,
    storage: { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => { mem.set(k, v); }, removeItem: (k) => { mem.delete(k); } },
  });
  const auth = new SupabaseAuth(sb, { get: async () => null, set: async () => undefined });
  const { phone, role } = PHONES[who];
  await auth.requestOtp(phone);
  const s = await auth.verifyOtp(phone, '123456');
  if (!s.profile || s.profile.primaryRole !== role) {
    await auth.saveProfile({ fullName: `Test de contrat ${who.toLowerCase()}`, country: 'FR', primaryRole: role });
  }
  clients.set(who, sb);
  // La suite commune attend le comportement de démonstration : le partenaire simulé confirme chaque paiement (demoSettle).
  return new SupabaseApi(sb, { anonKey: KEY!, demoSettle: true });
}

// PDF minimal (1 page) : contenu réel envoyé au bucket par URL signée.
const PDF = 'JVBERi0xLjQKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+ZW5kb2JqIDIgMCBvYmo8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PmVuZG9iaiAzIDAgb2JqPDwvVHlwZS9QYWdlL01lZGlhQm94WzAgMCAzIDNdPj5lbmRvYmoKdHJhaWxlcjw8L1Jvb3QgMSAwIFI+Pg==';
const file = (kind: string) => ({ kind: kind as never, name: `${kind}.pdf`, mimeType: 'application/pdf', sizeBytes: Math.floor(PDF.length * 3 / 4), uri: `data:application/pdf;base64,${PDF}` });

const signedIn = (who: Who) => { if (!sessions.has(who)) sessions.set(who, signIn(who)); return sessions.get(who)!; };
/** Même session, mais sans démonstration (demoSettle faux, le défaut) : le chemin de paiement réel, lot X-C (T2). */
const noDemo = async (who: Who) => { await signedIn(who); return new SupabaseApi(clients.get(who)!, { anonKey: KEY! }); };

if (URL && KEY) {
  contractSuite({
    name: 'Supabase (SupabaseApi)',
    as: (who) => { if (!sessions.has(who)) sessions.set(who, signIn(who)); return sessions.get(who)!; },
    provider: { query: 'clinique sainte', vertical: 'HEALTH', expectName: /Clinique Sainte-Élise/ },
    file,
    refundSettlement: 'AWAITING_PARTNER_EVENT',   // remboursement PENDING jusqu’à l’événement du partenaire (voir Harness.refundSettlement)
    partyIsolation: true,
    phones: { PAYER: PHONES.PAYER.phone, REQUESTER: PHONES.REQUESTER.phone, OTHER: PHONES.OTHER.phone },
    userId: async (who) => (await signedIn(who) as unknown as { userId(): Promise<string> }).userId(),
    timeout: 30_000,
  });

  // Lot A (T3) : hors démonstration, la tentative est en cours (ACCEPTED), rejouable, puis le simulateur du partenaire
  // (tâche planifiée du serveur, scénario SUCCESS par défaut) la confirme par le chemin des événements signés :
  // la demande passe « payée » sans aucun appel de démonstration. Propre à Supabase : le simulateur de l’appareil
  // confirme aussitôt (écart documenté, docs/supabase-setup.md).
  describe('lot A (T3) : paiement hors démonstration, confirmé par le simulateur du serveur', () => {
    it('ACCEPTED, rejouable, puis PAID par la tâche planifiée', async () => {
      const requester = await signedIn('REQUESTER');
      const id = newUuid();
      await requester.saveDraft(healthDraft(id, { counterpartyPhone: PHONES.PAYER.phone }));
      await requester.attachDocument(id, file('QUOTE'));
      const tx0 = await requester.submitNeed(id);
      const tr = tx0.tranches[0]!;

      const payer = await noDemo('PAYER');
      const key = newUuid();
      const after = await payer.payTranche(tr.id, key);
      expect(after.tranches[0]).toMatchObject({ status: 'ACCEPTED', fundsState: 'NONE' }); // en cours, pas PAID
      // Rejeu de la même clé : même tentative, aucun nouveau paiement.
      expect(['ACCEPTED', 'PAID']).toContain((await payer.payTranche(tr.id, key)).tranches[0]!.status);
      // Délai du simulateur (sim_payment_delay_seconds) + période de la tâche (10 s) : moins d’une minute.
      let status = '';
      for (let i = 0; i < 30 && status !== 'PAID'; i++) {
        await new Promise((r) => setTimeout(r, 2_000));
        status = (await payer.getTranche(tr.id)).tranche.status;
      }
      expect(status).toBe('PAID');
      const receipt = await payer.getReceipt(tr.id);
      expect(receipt.amountMinor).toBe(tr.amountMinor);
    }, 90_000);
  });

  // Nettoyage : dossiers, journal et alertes des comptes de test (demo_reset, permis en mock_mode uniquement).
  afterAll(async () => {
    for (const p of sessions.values()) await (await p as SupabaseApi).resetDemoData().catch(() => undefined);
  }, 60_000);
} else {
  describe('contrat TransactionApi : Supabase', () => {
    it.skip('ignoré : SUPABASE_TEST_URL et SUPABASE_TEST_ANON_KEY non définis', () => undefined);
  });
}
