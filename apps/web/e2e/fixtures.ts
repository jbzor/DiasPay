import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { SupabaseApi, SupabaseAuth, createDiasPayClient } from '@diaspay/api-client';
import type { Transaction } from '@diaspay/api-client';
import { emptyDraft } from '@diaspay/domain';
import type { NeedDraft } from '@diaspay/domain';

import { STAFF, SUPABASE_KEY, SUPABASE_URL, STAFF_PASSWORD } from './env';

/**
 * Données de bout en bout créées comme le fait l’application mobile : connexion par SMS des comptes de test
 * (numéros réservés, code fixe), brouillon, pièces envoyées au bucket, soumission. Nettoyage par demo_reset.
 *
 * Lot X version 2 (docs/specs/modele-cible-v2.md) : à la soumission, une opération devient ACTIVE sans revue
 * (platform_review = NEVER, défaut de tous les modules), sauf double validation. Pour remplir la file du bureau, les
 * fixtures passent le module en ALWAYS le temps du test (compte administrateur, politique request_modules_admin_write),
 * et le rétablissent dans cleanup().
 */
export type Party = 'PAYER' | 'REQUESTER' | 'OTHER';
const PHONES: Record<Party, { phone: string; role: 'PAYER' | 'REQUESTER'; name: string }> = {
  PAYER: { phone: '+33639980011', role: 'PAYER', name: 'Marie Payeuse (e2e)' },
  REQUESTER: { phone: '+33639980012', role: 'REQUESTER', name: 'Jean Demandeur (e2e)' },
  OTHER: { phone: '+33639980013', role: 'PAYER', name: 'Paul Payeur (e2e)' },
};
const apis = new Map<Party, Promise<SupabaseApi>>();
const raws = new Map<Party, ReturnType<typeof createDiasPayClient>>();

async function signIn(who: Party): Promise<SupabaseApi> {
  const mem = new Map<string, string>();
  const sb = createDiasPayClient({
    url: SUPABASE_URL, anonKey: SUPABASE_KEY,
    storage: { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => { mem.set(k, v); }, removeItem: (k) => { mem.delete(k); } },
  });
  raws.set(who, sb);
  const auth = new SupabaseAuth(sb, { get: async () => null, set: async () => undefined });
  const { phone, role, name } = PHONES[who];
  await auth.requestOtp(phone);
  const s = await auth.verifyOtp(phone, '123456');
  if (!s.profile || s.profile.primaryRole !== role || s.profile.fullName !== name) {
    await auth.saveProfile({ fullName: name, country: 'FR', primaryRole: role });
  }
  // Lot X-C (T2) : les parcours de test attendent le comportement de démonstration (paiement confirmé aussitôt).
  return new SupabaseApi(sb, { anonKey: SUPABASE_KEY, demoSettle: true });
}

export function party(who: Party): Promise<SupabaseApi> {
  if (!apis.has(who)) apis.set(who, signIn(who));
  return apis.get(who)!;
}

// PDF minimal (1 page) et PNG 1×1 : contenus réels envoyés au bucket.
const PDF = 'JVBERi0xLjQKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+ZW5kb2JqIDIgMCBvYmo8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PmVuZG9iaiAzIDAgb2JqPDwvVHlwZS9QYWdlL01lZGlhQm94WzAgMCAzIDNdPj5lbmRvYmoKdHJhaWxlcjw8L1Jvb3QgMSAwIFI+Pg==';
export function pdf(kind: string, name = `${kind.toLowerCase()}.pdf`) {
  return { kind: kind as never, name, mimeType: 'application/pdf', sizeBytes: Math.floor(PDF.length * 3 / 4), uri: `data:application/pdf;base64,${PDF}` };
}

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
/** Identifiant de série : rend les objectifs uniques d’une exécution à l’autre. */
export const RUN = Math.random().toString(36).slice(2, 7).toUpperCase();

type ModuleCode = 'EDUCATION' | 'HEALTH' | 'RENT';
type ModuleSettings = { platform_review: 'NEVER' | 'RISK_BASED' | 'ALWAYS'; settlement_mode: 'DIRECT' | 'CONDITIONAL' };
const moduleBackup = new Map<string, ModuleSettings>();

/** Réglage d’un module le temps des tests (administrateur) ; la valeur d’origine est gardée pour restoreModules(). */
async function setModule(code: ModuleCode, patch: Partial<ModuleSettings>): Promise<void> {
  const admin = await staffClient(STAFF.ADMIN.email);
  if (!moduleBackup.has(code)) {
    const cur = await admin.from('request_modules').select('platform_review, settlement_mode').eq('code', code).single();
    if (cur.error) throw cur.error;
    moduleBackup.set(code, cur.data as ModuleSettings);
  }
  const res = await admin.from('request_modules').update(patch).eq('code', code).select('code');
  if (res.error) throw res.error;
  if ((res.data ?? []).length !== 1) throw new Error(`request_modules ${code} : mise à jour refusée (compte administrateur requis)`);
}

/** Rétablit les réglages d’origine des modules modifiés par les tests. */
export async function restoreModules(): Promise<void> {
  if (moduleBackup.size === 0) return;
  const admin = await staffClient(STAFF.ADMIN.email);
  for (const [code, v] of moduleBackup) {
    const res = await admin.from('request_modules').update(v).eq('code', code);
    if (res.error) throw res.error;
  }
  moduleBackup.clear();
}

export interface DossierSpec {
  by?: Party;
  vertical?: ModuleCode;
  amountMinor: number;
  purpose: string;
  payerPhone?: string;
  provider?: { id?: string; name: string; invitedPhone?: string };
  tranches?: Array<{ label: string; amountMinor: number; dueInDays: number }>;
}

/** Dossier en attente de revue du bureau (PENDING_REVIEW) : module en ALWAYS le temps du test. */
export async function submittedDossier(spec: DossierSpec): Promise<Transaction> {
  await setModule(spec.vertical ?? 'EDUCATION', { platform_review: 'ALWAYS' });
  const tx = await submitDossier(spec);
  if (tx.status !== 'PENDING_REVIEW') throw new Error(`Dossier ${tx.id} : PENDING_REVIEW attendu, ${tx.status} obtenu`);
  return tx;
}

/**
 * Opération active dès la soumission (platform_review NEVER, montant sans double validation) : la première demande est
 * envoyée au payeur. conditional : règlement CONDITIONAL (fonds bloqués après paiement), sinon DIRECT.
 */
export async function activeDossier(spec: DossierSpec & { conditional?: boolean }): Promise<Transaction> {
  await setModule(spec.vertical ?? 'EDUCATION', { platform_review: 'NEVER', settlement_mode: spec.conditional ? 'CONDITIONAL' : 'DIRECT' });
  const tx = await submitDossier(spec);
  if (tx.status !== 'ACTIVE') throw new Error(`Dossier ${tx.id} : ACTIVE attendu, ${tx.status} obtenu (double validation ?)`);
  return tx;
}

/** Brouillon complet (pièces obligatoires de la scolarité, de la santé ou du loyer), puis soumission. */
async function submitDossier(spec: DossierSpec): Promise<Transaction> {
  const api = await party(spec.by ?? 'REQUESTER');
  const id = randomUUID();
  const vertical = spec.vertical ?? 'EDUCATION';
  const tranches = (spec.tranches ?? [{ label: 'Année', amountMinor: spec.amountMinor, dueInDays: 3 }])
    .map((t) => ({ label: t.label, amountMinor: t.amountMinor, dueDate: inDays(t.dueInDays) }));
  const draft: NeedDraft = {
    ...emptyDraft(id, new Date()), vertical, amountMinor: spec.amountMinor, currency: 'XAF', purpose: spec.purpose,
    ...(vertical === 'HEALTH' ? { beneficiaryReference: 'AWA-E2E' } : { beneficiaryName: 'Awa (e2e)' }),
    desiredDate: tranches[0]!.dueDate, counterpartyPhone: spec.payerPhone ?? (spec.by === 'PAYER' ? undefined : PHONES.PAYER.phone),
    provider: spec.provider ?? { name: 'Collège Les Manguiers' },
    planType: tranches.length > 1 ? 'PARTIAL' : 'SINGLE', tranches, step: 'recap',
  } as NeedDraft;
  await api.saveDraft(draft);
  if (vertical === 'EDUCATION') await api.attachDocument(id, pdf('ENROLMENT_CERTIFICATE', 'attestation_inscription.pdf'));
  if (vertical === 'HEALTH') { await api.attachDocument(id, pdf('QUOTE', 'devis.pdf')); }   // K13 (0022) : le devis seul
  if (vertical === 'RENT') await api.attachDocument(id, pdf('LEASE', 'bail.pdf'));
  return api.submitNeed(id);
}

/** Client Supabase d’un membre du personnel (connexion par mot de passe), pour préparer ou vérifier côté API. */
export async function staffClient(email: string) {
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await sb.auth.signInWithPassword({ email, password: STAFF_PASSWORD });
  if (error) throw error;
  return sb;
}

/**
 * Nettoyage : dossiers, journal et alertes créés par les comptes de test (demo_reset, mock_mode seulement), puis réglages
 * d’origine des modules.
 */
export async function cleanup(): Promise<void> {
  for (const p of apis.values()) await (await p).resetDemoData().catch(() => undefined);
  apis.clear();
  await restoreModules();
}

/**
 * Preuve de jalon (vague 2) : le demandeur crée un brouillon terrain et y dépose la preuve (envoi réel au bucket,
 * permis tant que le dossier est un brouillon), puis supabase/seed-evidence.sql amène l’opération (CONDITIONAL) jusqu’à
 * la preuve en attente : ACTIVE, première demande PAID, fonds HELD, preuve déposée (scripts/db.sh seed-evidence <tx>).
 * Renvoie l’identifiant du dossier.
 */
export async function landWithPendingEvidence(purpose: string): Promise<string> {
  const api = await party('REQUESTER');
  const id = randomUUID();
  await api.saveDraft({
    ...emptyDraft(id, new Date()), vertical: 'LAND', amountMinor: 10_000_000, currency: 'XAF', purpose, beneficiaryName: 'Famille M. (e2e)',
    counterpartyPhone: PHONES.PAYER.phone, provider: { name: 'Étude notariale Mbarga (e2e)', invitedPhone: PHONES.OTHER.phone },
    planType: 'PARTIAL', step: 'recap',
    tranches: [{ label: 'Signature de l’acte notarié', amountMinor: 4_000_000, dueDate: inDays(5) }, { label: 'Remise du titre foncier', amountMinor: 6_000_000, dueDate: inDays(60) }],
  } as NeedDraft);
  await api.attachDocument(id, pdf('SUPPORTING_DOCUMENT', 'promesse_de_vente.pdf'));
  await api.attachDocument(id, pdf('EVIDENCE', 'acte_notarie.pdf'));
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  execFileSync(join(root, 'scripts', 'db.sh'), ['seed-evidence', id], { cwd: root, stdio: 'pipe' });
  return id;
}

/** Client Supabase brut d’une partie (fonctions sans équivalent dans SupabaseApi, comme respond_dispute). */
export async function partyClient(who: Party) {
  await party(who);
  return raws.get(who)!;
}

/**
 * Litige ouvert sur la première demande d’une opération de scolarité active dès la soumission (lot X v2). Par défaut,
 * la demande est payée (règlement DIRECT, ou CONDITIONAL avec fonds bloqués) ; beforePayment : litige ouvert sur la
 * demande non payée (demande suspendue, opération SUSPENDED). Le prestataire est le compte de test OTHER.
 */
export async function openedDispute(purpose: string, opts: { by: 'PAYER' | 'PROVIDER'; answer?: string; conditional?: boolean; beforePayment?: boolean }):
  Promise<{ txId: string; trancheId: string; disputeId: string }> {
  const tx = await activeDossier({ amountMinor: 300_000, purpose, conditional: opts.conditional, provider: { name: 'École Les Palmiers (e2e)', invitedPhone: PHONES.OTHER.phone } });
  const payer = await party('PAYER');
  const trancheId = (await payer.getTransaction(tx.id)).tranches[0]!.id;
  if (!opts.beforePayment) await payer.payTranche(trancheId);
  const opener = opts.by === 'PAYER' ? payer : await party('OTHER');
  await opener.openDispute(trancheId, opts.by === 'PAYER' ? 'NOT_DELIVERED' : 'OTHER',
    opts.by === 'PAYER' ? 'L’élève n’a pas reçu les cours prévus.' : 'Le payeur conteste une prestation livrée.');
  const disputeId = (await payer.getDispute(trancheId))!.id;
  if (opts.answer) {
    const res = await (await partyClient(opts.by === 'PAYER' ? 'OTHER' : 'PAYER')).rpc('respond_dispute', { p_dispute: disputeId, p_text: opts.answer });
    if (res.error) throw res.error;
  }
  return { txId: tx.id, trancheId, disputeId };
}
