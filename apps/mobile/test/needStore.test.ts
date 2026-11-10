import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DraftDocument } from '@diaspay/domain';
import { reviveDocuments } from '../src/features/need/documents';
import { createAutosaver } from '../src/features/need/autosave';

const d = (status: DraftDocument['status'], uri?: string): DraftDocument =>
  ({ id: status, kind: 'QUOTE', name: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 1, status, uri });

describe('pièces au rechargement', () => {
  it('garde les pièces envoyées, marque « à rajouter » si le fichier a disparu', () => {
    const exists = (uri: string) => uri === 'file:///ok.pdf';
    expect(reviveDocuments([
      d('UPLOADED', 'file:///gone.pdf'), d('UPLOADING', 'file:///ok.pdf'), d('FAILED', 'file:///gone.pdf'), d('UPLOADING'), d('MISSING'),
    ], exists).map((x) => x.status)).toEqual(['UPLOADED', 'FAILED', 'MISSING', 'MISSING', 'MISSING']);
    expect(reviveDocuments(undefined, exists)).toEqual([]);
  });
});

describe('sauvegarde automatique', () => {
  afterEach(() => { vi.useRealTimers(); });
  it('regroupe les modifications rapprochées (500 ms) et n’enregistre que la dernière', async () => {
    vi.useFakeTimers();
    const save = vi.fn(async (_v: number) => undefined);
    const a = createAutosaver(save);
    a.schedule(1); vi.advanceTimersByTime(300);
    a.schedule(2); vi.advanceTimersByTime(499);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenLastCalledWith(2);
  });
  it('enregistre immédiatement au changement d’étape (flush)', async () => {
    vi.useFakeTimers();
    const save = vi.fn(async (_v: string) => undefined);
    const a = createAutosaver(save);
    a.schedule('x');
    expect(a.pending()).toBe(true);
    await a.flush();
    expect(save).toHaveBeenCalledWith('x');
    expect(a.pending()).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(save).toHaveBeenCalledTimes(1);
    await a.flush();
    expect(save).toHaveBeenCalledTimes(1);
  });
});
