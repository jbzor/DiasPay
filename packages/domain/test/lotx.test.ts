import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DomainError, EXTERNAL_CHANNELS, EXTERNAL_EVENTS, REFERENCE_FAILURE_LIMIT,
  answerInfoDecision, emptyDraft, externalNotification, externalNotificationTemplates, internalPath, messageError,
  parseInternalLink, rejectRequestDecision, requestInfoDecision, tokenRevocationError,
  tooManyAttempts, validateNeed, validateStep,
} from '../src';
import type { NeedDraft } from '../src';

const root = join(__dirname, '..', '..', '..');
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as DomainError).code; } return 'OK'; };



describe('X2 : fonctions de décision (miroirs de request_info, answer_info, reject_request)', () => {
  const P = { isPayer: true, isCreator: false };
  const I = { isPayer: false, isCreator: true };
  it('message obligatoire, 3 à 2000 caractères', () => {
    expect(messageError(' a ')).toBe('REASON_REQUIRED');
    expect(messageError('x'.repeat(2001))).toBe('VALIDATION');
    expect(messageError('Pouvez-vous préciser ?')).toBeNull();
  });
  it('mêmes codes et même ordre que le serveur', () => {
    expect(code(() => requestInfoDecision('SUBMITTED', I, 'Question'))).toBe('PAYER_ONLY');
    expect(code(() => requestInfoDecision('PAID', P, 'Question'))).toBe('TRANSITION_UNKNOWN');
    expect(code(() => requestInfoDecision('SUBMITTED', { isPayer: true, isCreator: true }, 'Question'))).toBe('TRANSITION_FORBIDDEN');
    expect(code(() => requestInfoDecision('SUBMITTED', P, ''))).toBe('REASON_REQUIRED');
    expect(code(() => requestInfoDecision('SUBMITTED', { ...P, onHold: true }, 'Question'))).toBe('REQUEST_ON_HOLD');
    expect(requestInfoDecision('SUBMITTED', P, 'Question')).toBe('INFO_REQUESTED');
    expect(code(() => answerInfoDecision('INFO_REQUESTED', P, 'Réponse'))).toBe('INITIATOR_ONLY');
    expect(code(() => answerInfoDecision('SUBMITTED', I, 'Réponse'))).toBe('TRANSITION_UNKNOWN');
    expect(answerInfoDecision('INFO_REQUESTED', I, 'Réponse')).toBe('SUBMITTED');
    expect(code(() => rejectRequestDecision('SUBMITTED', I, 'Non merci'))).toBe('PAYER_ONLY');
    expect(code(() => rejectRequestDecision('PAID', P, 'Non merci'))).toBe('TRANSITION_UNKNOWN');
    expect(code(() => rejectRequestDecision('INFO_REQUESTED', P, ' '))).toBe('REASON_REQUIRED');
    expect(rejectRequestDecision('INFO_REQUESTED', P, 'Non merci')).toBe('REJECTED');
  });
});

describe('X1 : révocation et limitation', () => {
  it('l’initiateur révoque tant que la tranche n’est pas payée ; un administrateur non partie toujours', () => {
    expect(tokenRevocationError('SUBMITTED', { isCreator: true })).toBeNull();
    expect(tokenRevocationError('INFO_REQUESTED', { isCreator: true })).toBeNull();
    expect(tokenRevocationError('PAID', { isCreator: true })).toBe('NOT_REVOCABLE');
    expect(tokenRevocationError('SUBMITTED', { isCreator: false })).toBe('INITIATOR_ONLY');
    expect(tokenRevocationError('PAID', { isCreator: false, isAdminNotParty: true })).toBeNull();
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

