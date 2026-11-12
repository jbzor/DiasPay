import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DomainError, EXTERNAL_CHANNELS, EXTERNAL_EVENTS, REFERENCE_FAILURE_LIMIT, TERMINAL_TRANCHE_STATUSES, TRANCHE_TRANSITIONS,
  answerInfoDecision, emptyDraft, externalNotification, externalNotificationTemplates, internalPath, messageError,
  parseInternalLink, paymentOutcome, rejectRequestDecision, requestInfoDecision, shouldCloseTransaction, tokenRevocationError,
  tooManyAttempts, transitionTranche, transitionTx, validateNeed, validateStep,
} from '../src';
import type { Actor, NeedDraft, TrancheState } from '../src';

const root = join(__dirname, '..', '..', '..');
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as DomainError).code; } return 'OK'; };
const tr = (over: Partial<TrancheState> = {}): TrancheState => ({ status: 'AWAITING_PAYMENT', releaseMode: 'PROVIDER_CONFIRM', contestHours: 72, ...over });
const payer: Actor = { kind: 'USER', roles: ['PAYER'], isValidator: false };
const requesterCreator: Actor = { kind: 'USER', roles: ['REQUESTER'], isValidator: false, isCreator: true };
const providerCreator: Actor = { kind: 'USER', roles: ['PROVIDER'], isValidator: false, isCreator: true };
const provider: Actor = { kind: 'USER', roles: ['PROVIDER'], isValidator: false };
const system: Actor = { kind: 'SYSTEM' };

describe('X2 : décisions du payeur (machine d’états)', () => {
  it('demande d’informations par le payeur, réponse par l’initiateur seulement', () => {
    expect(transitionTranche(tr(), 'INFO_REQUESTED', payer).status).toBe('INFO_REQUESTED');
    expect(code(() => transitionTranche(tr(), 'INFO_REQUESTED', provider))).toBe('TRANSITION_FORBIDDEN');
    expect(code(() => transitionTranche(tr(), 'INFO_REQUESTED', { ...payer, isCreator: true }))).toBe('TRANSITION_FORBIDDEN');
    const asked = tr({ status: 'INFO_REQUESTED' });
    expect(transitionTranche(asked, 'AWAITING_PAYMENT', requesterCreator).status).toBe('AWAITING_PAYMENT');
    expect(transitionTranche(asked, 'AWAITING_PAYMENT', providerCreator).status).toBe('AWAITING_PAYMENT');
    expect(code(() => transitionTranche(asked, 'AWAITING_PAYMENT', payer))).toBe('INITIATOR_ONLY');
    expect(code(() => transitionTranche(asked, 'AWAITING_PAYMENT', provider))).toBe('INITIATOR_ONLY');
  });
  it('rejet par le payeur depuis à payer ou informations demandées ; REJECTED est terminal', () => {
    expect(transitionTranche(tr(), 'REJECTED', payer).status).toBe('REJECTED');
    expect(transitionTranche(tr({ status: 'INFO_REQUESTED' }), 'REJECTED', payer).status).toBe('REJECTED');
    expect(code(() => transitionTranche(tr(), 'REJECTED', requesterCreator))).toBe('TRANSITION_FORBIDDEN');
    expect(code(() => transitionTranche(tr({ status: 'PAID_LOCKED' }), 'REJECTED', payer))).toBe('TRANSITION_UNKNOWN');
    expect(code(() => transitionTranche(tr({ status: 'REJECTED' }), 'AWAITING_PAYMENT', requesterCreator))).toBe('TRANSITION_UNKNOWN');
    expect(TERMINAL_TRANCHE_STATUSES).toContain('REJECTED');
    expect(shouldCloseTransaction(['RELEASED', 'REJECTED'])).toBe(true);
    expect(shouldCloseTransaction(['REJECTED', 'INFO_REQUESTED'])).toBe(false);
  });
  it('pas de paiement pendant la demande d’informations', () => {
    expect(code(() => transitionTranche(tr({ status: 'INFO_REQUESTED' }), 'PAID_LOCKED', system))).toBe('TRANSITION_UNKNOWN');
  });
});

describe('X2.6 : paiement direct (IMMEDIATE)', () => {
  it('débloquée dès le paiement en mode IMMEDIATE seulement', () => {
    expect(paymentOutcome('IMMEDIATE')).toBe('RELEASED');
    expect(paymentOutcome('PROVIDER_CONFIRM')).toBe('PAID_LOCKED');
    expect(paymentOutcome('EVIDENCE_REVIEW')).toBe('PAID_LOCKED');
    expect(transitionTranche(tr({ releaseMode: 'IMMEDIATE', contestHours: 0 }), 'RELEASED', system).contestEndsAt).toBeUndefined();
    expect(code(() => transitionTranche(tr(), 'RELEASED', system))).toBe('NOT_PAID');
    expect(code(() => transitionTranche(tr({ releaseMode: 'IMMEDIATE' }), 'RELEASED', payer))).toBe('TRANSITION_FORBIDDEN');
  });
});

describe('X2 : fonctions de décision (miroirs de request_info, answer_info, reject_request)', () => {
  const P = { isPayer: true, isCreator: false };
  const I = { isPayer: false, isCreator: true };
  it('message obligatoire, 3 à 2000 caractères', () => {
    expect(messageError(' a ')).toBe('REASON_REQUIRED');
    expect(messageError('x'.repeat(2001))).toBe('VALIDATION');
    expect(messageError('Pouvez-vous préciser ?')).toBeNull();
  });
  it('mêmes codes et même ordre que le serveur', () => {
    expect(code(() => requestInfoDecision('AWAITING_PAYMENT', I, 'Question'))).toBe('PAYER_ONLY');
    expect(code(() => requestInfoDecision('PAID_LOCKED', P, 'Question'))).toBe('TRANSITION_UNKNOWN');
    expect(code(() => requestInfoDecision('AWAITING_PAYMENT', { isPayer: true, isCreator: true }, 'Question'))).toBe('TRANSITION_FORBIDDEN');
    expect(code(() => requestInfoDecision('AWAITING_PAYMENT', P, ''))).toBe('REASON_REQUIRED');
    expect(requestInfoDecision('AWAITING_PAYMENT', P, 'Question')).toBe('INFO_REQUESTED');
    expect(code(() => answerInfoDecision('INFO_REQUESTED', P, 'Réponse'))).toBe('INITIATOR_ONLY');
    expect(code(() => answerInfoDecision('AWAITING_PAYMENT', I, 'Réponse'))).toBe('TRANSITION_UNKNOWN');
    expect(answerInfoDecision('INFO_REQUESTED', I, 'Réponse')).toBe('AWAITING_PAYMENT');
    expect(code(() => rejectRequestDecision('AWAITING_PAYMENT', I, 'Non merci'))).toBe('PAYER_ONLY');
    expect(code(() => rejectRequestDecision('CONFIRMED', P, 'Non merci'))).toBe('TRANSITION_UNKNOWN');
    expect(code(() => rejectRequestDecision('INFO_REQUESTED', P, ' '))).toBe('REASON_REQUIRED');
    expect(rejectRequestDecision('INFO_REQUESTED', P, 'Non merci')).toBe('REJECTED');
  });
});

describe('X1 : révocation et limitation', () => {
  it('l’initiateur révoque tant que la tranche n’est pas payée ; un administrateur non partie toujours', () => {
    expect(tokenRevocationError('AWAITING_PAYMENT', { isCreator: true })).toBeNull();
    expect(tokenRevocationError('INFO_REQUESTED', { isCreator: true })).toBeNull();
    expect(tokenRevocationError('PAID_LOCKED', { isCreator: true })).toBe('NOT_REVOCABLE');
    expect(tokenRevocationError('AWAITING_PAYMENT', { isCreator: false })).toBe('INITIATOR_ONLY');
    expect(tokenRevocationError('PAID_LOCKED', { isCreator: false, isAdminNotParty: true })).toBeNull();
  });
  it('plus de 10 échecs dans l’heure glissante', () => {
    const now = 10 * 3_600_000;
    const ten = Array.from({ length: REFERENCE_FAILURE_LIMIT }, (_, i) => now - i * 60_000);
    expect(tooManyAttempts(ten.slice(1), now)).toBe(false);
    expect(tooManyAttempts(ten, now)).toBe(true);
    expect(tooManyAttempts(ten.map((t) => t - 3_600_000), now)).toBe(false);
  });
});

describe('X1.2 : liens internes seulement', () => {
  it('diaspay://tranche/<identifiant> accepté', () => {
    expect(parseInternalLink('diaspay://tranche/0d8c4a52-1b5e-4b0e-9d3c-2f6c1a7e9b10')).toEqual({ trancheId: '0d8c4a52-1b5e-4b0e-9d3c-2f6c1a7e9b10' });
    expect(parseInternalLink('diaspay://tranche/tr-12/')).toEqual({ trancheId: 'tr-12' });
    expect(parseInternalLink('exp://192.168.1.2:8081/--/tranche/tr-12')).toEqual({ trancheId: 'tr-12' });
    expect(internalPath('tr-12')).toBe('/tranche/tr-12');
  });
  it.each([
    ['référence de jeton (ancien lien)', 'diaspay://t/4f9a2c71b8e01d3ca9'],
    ['référence de jeton déguisée en tranche', 'diaspay://tranche/4f9a2c71b8e01d3ca9'],
    ['lien https', 'https://liens.exemple.org/t/4f9a2c71b8e01d3ca9'],
    ['https vers une tranche', 'https://diaspay.example/tranche/tr-12'],
    ['autre écran', 'diaspay://pay/tr-12'],
    ['segments en trop', 'diaspay://tranche/tr-12/payer'],
    ['identifiant invalide', 'diaspay://tranche/<script>'],
    ['racine Expo Go', 'exp://192.168.1.2:8081'],
    ['texte', 'pas un lien'],
  ])('ignoré : %s', (_n, url) => {
    expect(parseInternalLink(url)).toBeNull();
  });
});

describe('X1.4 : gabarits des notifications externes (test d’architecture)', () => {
  const all = EXTERNAL_CHANNELS.flatMap((c) => EXTERNAL_EVENTS.flatMap((e) => (['fr', 'en'] as const).map((l) => ({ c, e, l, t: externalNotificationTemplates[c][e][l] }))));
  it('chaque canal, événement et langue a un texte', () => {
    expect(all).toHaveLength(EXTERNAL_CHANNELS.length * EXTERNAL_EVENTS.length * 2);
    for (const x of all) expect(x.t.body.length).toBeGreaterThan(20);
    for (const x of all.filter((y) => y.c === 'EMAIL')) expect(x.t.subject).toBeTruthy();
  });
  it('aucun gabarit ne contient d’adresse, de lien, de référence, de montant ni de paramètre', () => {
    for (const { t } of all) {
      for (const text of [t.body, t.subject ?? '']) {
        expect(text).not.toMatch(/https?:|www\.|:\/\//i);
        expect(text).not.toMatch(/\b[a-z0-9-]+\.(?:[a-z]{2,})(?:\/|\b)/);       // domaine (« diaspay.org », « links.x.example »)
        expect(text).not.toMatch(/[0-9a-f]{18}/i);                              // référence de jeton
        expect(text).not.toMatch(/\d/);                                          // aucun montant, numéro ou code
        expect(text).not.toMatch(/[{}<>$%]/);                                    // aucun paramètre ni balise
      }
    }
  });
  it('le module source lui-même ne contient aucune adresse', () => {
    const src = readFileSync(join(root, 'packages', 'domain', 'src', 'notificationTemplates.ts'), 'utf8');
    expect(src).not.toMatch(/https?:\/\/|www\./i);
  });
  it('tout événement donne un gabarit fixe ; texte français attendu', () => {
    expect(externalNotification('SMS', 'PAYMENT_REQUEST_RECEIVED', 'fr').body)
      .toBe('Vous avez une nouvelle demande de paiement DiasPay. Ouvrez l’application DiasPay pour la consulter.');
    expect(externalNotification('WHATSAPP', 'INFO_REQUESTED', 'en').body).toMatch(/^A DiasPay request has been updated\./);
    expect(externalNotification('EMAIL', 'TYPE_INCONNU', 'fr').subject).toBe('Mise à jour d’une demande DiasPay');
  });
});

describe('X3 : demande initiée par un prestataire', () => {
  const ctx = { totalMinor: 100, tranches: [{ label: 'Inscription', amountMinor: 100 }], hasSupportingDocument: true };
  it('le prestataire créateur soumet, corrige et abandonne son brouillon ; pas celui d’un autre', () => {
    expect(transitionTx('DRAFT', 'SUBMITTED', providerCreator, ctx)).toBe('SUBMITTED');
    expect(transitionTx('REJECTED', 'DRAFT', providerCreator)).toBe('DRAFT');
    expect(transitionTx('REJECTED', 'CANCELLED', providerCreator)).toBe('CANCELLED');
    expect(code(() => transitionTx('DRAFT', 'SUBMITTED', provider, ctx))).toBe('TRANSITION_FORBIDDEN');
    expect(transitionTx('IN_PROGRESS', 'DISPUTED', provider)).toBe('DISPUTED');
  });
  const draft = (over: Partial<NeedDraft>): NeedDraft => ({
    ...emptyDraft('d1', new Date('2026-11-12T10:00:00Z')), vertical: 'EDUCATION', amountMinor: 200_000, currency: 'XAF',
    purpose: 'Frais d’inscription', beneficiaryName: 'Élève', planType: 'SINGLE',
    tranches: [{ label: 'Inscription', amountMinor: 200_000, dueDate: '2026-11-20' }],
    documents: [{ id: 'x', kind: 'ENROLMENT_CERTIFICATE', name: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 10, status: 'UPLOADED' }],
    ...over,
  });
  const today = { today: '2026-11-12' };
  it('rôle PROVIDER explicite : téléphone du payeur exigé, étape prestataire sans objet', () => {
    expect(validateStep('provider', draft({ creatorRole: 'PROVIDER' }), today)).toEqual([]);
    expect(validateNeed(draft({ creatorRole: 'PROVIDER' }), today).map((i) => i.code)).toEqual(['PAYER_PHONE_REQUIRED']);
    expect(validateNeed(draft({ creatorRole: 'PROVIDER', counterpartyPhone: '+33622220009' }), today)).toEqual([]);
  });
  it('sans rôle explicite, un profil prestataire crée comme avant (en payeur)', () => {
    const issues = validateNeed(draft({}), { ...today, creatorRole: 'PROVIDER' }).map((i) => i.code);
    expect(issues).not.toContain('PAYER_PHONE_REQUIRED');
    expect(issues).toContain('PROVIDER_REQUIRED');
  });
});

describe('parité avec le SQL', () => {
  const sql = ['0003_v0_2_tranches.sql', '0008_lotx.sql'].map((f) => readFileSync(join(root, 'supabase', 'migrations', f), 'utf8')).join('\n');
  it('transitions de tranche : domaine = tranche_transitions (hors validateur)', () => {
    const rows = new Set<string>();
    for (const block of sql.matchAll(/insert into tranche_transitions values([\s\S]*?);/g)) {
      for (const m of block[1]!.matchAll(/\('([A-Z_]+)','([A-Z_]+)','([A-Z_]+)',(true|false)\)/g)) {
        if (m[4] === 'false') rows.add(`${m[1]}>${m[2]}:${m[3]}`);
      }
    }
    const domain = new Set(TRANCHE_TRANSITIONS.flatMap(([f, t, who]) => who.map((w) => `${f}>${t}:${w}`)));
    expect([...domain].sort()).toEqual([...rows].sort());
  });
  it('REJECTED compte pour la clôture côté serveur', () => {
    expect(sql).toMatch(/status not in \('RELEASED','CANCELLED','EXPIRED','REJECTED'\)/);
  });
});
