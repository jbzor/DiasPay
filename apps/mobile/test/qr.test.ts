import { describe, expect, it } from 'vitest';
import { encodeEqr } from '@diaspay/domain';
import { QUIET_ZONE, qrMatrix, qrPath } from '../src/lib/qr';

describe('QR', () => {
  const text = encodeEqr({ reference: '4f9a2c71b8e01d3ca9', kid: 'SIMULATED', signature: 'SIMULATED.0123456789abcdef0123456789abcdef' });
  const m = qrMatrix(text);

  it('matrice carrée, version raisonnable pour un eQR', () => {
    expect(m.length).toBe(m[0]!.length);
    expect(m.length).toBeGreaterThanOrEqual(33);
    expect(m.length).toBeLessThanOrEqual(45);
  });
  it('contient les trois repères de position', () => {
    const n = m.length;
    for (const [r, c] of [[0, 0], [0, n - 7], [n - 7, 0]] as const) {
      expect(m[r]![c]).toBe(true);
      expect(m[r + 3]![c + 3]).toBe(true); // centre noir
      expect(m[r + 1]![c + 1]).toBe(false); // anneau clair
    }
  });
  it('est déterministe', () => {
    expect(qrMatrix(text)).toEqual(m);
  });
  it('le tracé reste dans le repère, marge de silence de 4 modules comprise', () => {
    const d = qrPath(m);
    const xs = [...d.matchAll(/M(\d+) (\d+)h(\d+)/g)].map((x) => [Number(x[1]), Number(x[2]), Number(x[3])] as const);
    expect(xs.length).toBeGreaterThan(0);
    expect(Math.min(...xs.map((x) => x[0]))).toBeGreaterThanOrEqual(QUIET_ZONE);
    expect(Math.min(...xs.map((x) => x[1]))).toBeGreaterThanOrEqual(QUIET_ZONE);
    expect(Math.max(...xs.map((x) => x[0] + x[2]))).toBeLessThanOrEqual(m.length + QUIET_ZONE);
    expect(Math.max(...xs.map((x) => x[1] + 1))).toBeLessThanOrEqual(m.length + QUIET_ZONE);
  });
});
