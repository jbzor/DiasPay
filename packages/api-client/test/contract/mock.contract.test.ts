import { MemoryDraftStore, MockApi } from '../../src';
import { contractSuite } from './contract';
import type { Who } from './contract';

// Simulateur : un seul MockApi, l’utilisateur courant change selon l’appel (comme dans l’application).
const api = new MockApi(undefined, undefined, { drafts: new MemoryDraftStore(), uploadDelayMs: 0, seedNotifications: false });
const USERS: Record<Who, { id: string; role: 'PAYER' | 'REQUESTER' }> = {
  PAYER: { id: 'u-contrat-payeur', role: 'PAYER' },
  REQUESTER: { id: 'u-contrat-demandeur', role: 'REQUESTER' },
  OTHER: { id: 'u-contrat-tiers', role: 'PAYER' },
};

contractSuite({
  name: 'simulateur (MockApi)',
  as: async (who) => { api.setUser(USERS[who]); return api; },
  provider: { query: 'hopital', vertical: 'HEALTH', expectName: /Hôpital Central/ },
  file: (kind) => ({ kind: kind as never, name: `${kind}.pdf`, mimeType: 'application/pdf', sizeBytes: 1_000, uri: `file:///${kind}.pdf` }),
  submittedStatuses: ['IN_REVIEW'],
  partyIsolation: false,
  timeout: 5_000,
});
