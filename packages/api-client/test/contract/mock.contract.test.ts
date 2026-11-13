import { MemoryDraftStore, MockApi } from '../../src';
import type { MockUser } from '../../src';
import { contractSuite } from './contract';
import type { Who } from './contract';

// Simulateur : un seul MockApi, l’utilisateur courant change selon l’appel (comme dans l’application).
const api = new MockApi(undefined, undefined, { drafts: new MemoryDraftStore(), uploadDelayMs: 0, seedNotifications: false });
const PHONES: Record<Who, string> = { PAYER: '+33639980011', REQUESTER: '+33639980012', OTHER: '+33639980013' };
// Le demandeur est aussi autorisé à initier une demande en prestataire (lot X), comme le compte de test du serveur (seed).
const USERS: Record<Who, MockUser> = {
  PAYER: { id: 'u-contrat-payeur', role: 'PAYER', phone: PHONES.PAYER },
  REQUESTER: { id: 'u-contrat-demandeur', role: 'REQUESTER', phone: PHONES.REQUESTER, canInitiateRequests: true },
  OTHER: { id: 'u-contrat-tiers', role: 'PAYER', phone: PHONES.OTHER },
};

contractSuite({
  name: 'simulateur (MockApi)',
  as: async (who) => { api.setUser(USERS[who]); return api; },
  provider: { query: 'hopital', vertical: 'HEALTH', expectName: /Hôpital Central/ },
  file: (kind) => ({ kind: kind as never, name: `${kind}.pdf`, mimeType: 'application/pdf', sizeBytes: 1_000, uri: `file:///${kind}.pdf` }),
  refundSettlement: 'IMMEDIATE',   // partenaire simulé : le remboursement est appliqué aussitôt (voir Harness.refundSettlement)
  partyIsolation: false,
  phones: PHONES,
  timeout: 5_000,
});
