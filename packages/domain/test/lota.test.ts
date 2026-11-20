import { describe, expect, it } from 'vitest';
import { tokenReissueClosed } from '../src';

// Lot A (T2) : miroir de _token_reissue_closed (0032).
describe('tokenReissueClosed (lot A, T2)', () => {
  it('refuse toute demande terminée, quel que soit le mode', () => {
    for (const s of ['REJECTED', 'EXPIRED', 'CANCELLED', 'REFUNDED'] as const) {
      expect(tokenReissueClosed(s, 'DIRECT', 'NONE')).toBe(true);
      expect(tokenReissueClosed(s, 'CONDITIONAL', 'HELD')).toBe(true);
    }
  });
  it('DIRECT : payée = terminée', () => {
    expect(tokenReissueClosed('PAID', 'DIRECT', 'NONE')).toBe(true);
  });
  it('CONDITIONAL : payée, fonds bloqués = confirmation en cours (réémission permise) ; fonds traités = terminée', () => {
    expect(tokenReissueClosed('PAID', 'CONDITIONAL', 'HELD')).toBe(false);
    expect(tokenReissueClosed('PAID', 'CONDITIONAL', 'RELEASED')).toBe(true);
    expect(tokenReissueClosed('PAID', 'CONDITIONAL', 'RETURNED')).toBe(true);
  });
  it('avant paiement : permise', () => {
    for (const s of ['SUBMITTED', 'INFO_REQUESTED', 'ACCEPTED'] as const) expect(tokenReissueClosed(s, 'DIRECT', 'NONE')).toBe(false);
  });
});
