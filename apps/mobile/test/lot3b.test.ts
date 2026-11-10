import { describe, expect, it } from 'vitest';
import { filterTransactions } from '@diaspay/api-client';
import type { Transaction } from '@diaspay/api-client';
import type { DraftDocument } from '@diaspay/domain';
import { demoReleaseViolation } from '../src/lib/releaseGuard';
import { filesForKind, occupiedSlots } from '../src/features/need/documents';

describe('garde de production du mode démonstration', () => {
  it('bloque un build de production avec EXPO_PUBLIC_DEMO=1', () => {
    expect(demoReleaseViolation({ dev: false, demo: '1' })).toBe(true);
  });
  it('laisse passer le développement, un build sans démonstration, ou un build interne déclaré', () => {
    expect(demoReleaseViolation({ dev: true, demo: '1' })).toBe(false);
    expect(demoReleaseViolation({ dev: false })).toBe(false);
    expect(demoReleaseViolation({ dev: false, demo: '0' })).toBe(false);
    expect(demoReleaseViolation({ dev: false, demo: '1', allow: '1' })).toBe(false);
  });
});

describe('« Clôturées » inclut les dossiers abandonnés', () => {
  const tx = (id: string, status: Transaction['status']) => ({ id, status, tranches: [] }) as unknown as Transaction;
  it('filtre', () => {
    const list = [tx('a', 'CLOSED'), tx('b', 'CANCELLED'), tx('c', 'IN_PROGRESS'), tx('d', 'REJECTED')];
    expect(filterTransactions(list, 'CLOSED').map((t) => t.id)).toEqual(['a', 'b']);
    expect(filterTransactions(list, 'ACTIVE').map((t) => t.id)).toEqual(['c']);
  });
});

describe('fichiers par type de pièce', () => {
  const d = (id: string, kind: string, status: DraftDocument['status']): DraftDocument =>
    ({ id, kind: kind as DraftDocument['kind'], name: id, mimeType: 'image/jpeg', sizeBytes: 1, status });
  it('compte les emplacements occupés (un fichier « à rajouter » ne compte pas)', () => {
    const docs = [d('1', 'BENEFICIARY_ID', 'UPLOADED'), d('2', 'BENEFICIARY_ID', 'FAILED'), d('3', 'BENEFICIARY_ID', 'MISSING'), d('4', 'QUOTE', 'UPLOADED')];
    expect(filesForKind(docs, 'BENEFICIARY_ID').map((x) => x.id)).toEqual(['1', '2', '3']);
    expect(occupiedSlots(docs, 'BENEFICIARY_ID')).toBe(2);
    expect(occupiedSlots(docs, 'LEASE')).toBe(0);
  });
});
