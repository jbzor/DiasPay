import { describe, expect, it } from 'vitest';
import { emptyDraft } from '@diaspay/domain';
import type { NeedDraft } from '@diaspay/domain';
import { mergeDrafts } from '../src/features/need/mergeDrafts';

const d = (id: string, at: string, over: Partial<NeedDraft> = {}): NeedDraft => ({ ...emptyDraft(id, new Date(at)), updatedAt: at, ...over });
const doc = { id: 'srv', kind: 'QUOTE' as const, name: 'q.pdf', mimeType: 'application/pdf', sizeBytes: 1, status: 'UPLOADED' as const };

describe('brouillons : serveur et tampon local (mode Supabase)', () => {
  it('le tampon local plus récent gagne, mais garde les pièces du serveur', () => {
    const remote = [d('a', '2026-11-11T10:00:00.000Z', { purpose: 'serveur', documents: [doc] })];
    const local = [d('a', '2026-11-11T10:05:00.000Z', { purpose: 'local', documents: [] })];
    const [m] = mergeDrafts(remote, local);
    expect(m).toMatchObject({ purpose: 'local', documents: [doc] });
  });
  it('une version serveur plus récente n’est jamais écrasée', () => {
    const [m] = mergeDrafts([d('a', '2026-11-11T10:10:00.000Z', { purpose: 'serveur' })], [d('a', '2026-11-11T10:05:00.000Z', { purpose: 'local' })]);
    expect(m?.purpose).toBe('serveur');
  });
  it('un brouillon jamais synchronisé (hors connexion) apparaît ; une correction locale orpheline non', () => {
    const out = mergeDrafts([], [d('n', '2026-11-11T10:00:00.000Z'), d('c', '2026-11-11T10:00:00.000Z', { correctionOf: 'c' })]);
    expect(out.map((x) => x.id)).toEqual(['n']);
  });
  it('tri du plus récent au plus ancien', () => {
    const out = mergeDrafts([d('a', '2026-11-11T09:00:00.000Z'), d('b', '2026-11-11T11:00:00.000Z')], []);
    expect(out.map((x) => x.id)).toEqual(['b', 'a']);
  });
});
