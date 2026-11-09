import { describe, expect, it } from 'vitest';
import { countdown, tokenState } from '../src/lib/expiry';

const NOW = new Date('2026-11-08T10:00:00Z');
const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
const MIN = 60_000, H = 3_600_000;

describe('décompte d’expiration', () => {
  it('pas de décompte à 24 h ou plus, ni une fois expiré', () => {
    expect(countdown(24 * H)).toBeNull();
    expect(countdown(5 * 24 * H)).toBeNull();
    expect(countdown(0)).toBeNull();
    expect(countdown(-5)).toBeNull();
  });
  it('heures et minutes sous 24 h', () => {
    expect(countdown(24 * H - 1)).toEqual({ hours: 24, minutes: 0 });
    expect(countdown(5 * H + 12 * MIN)).toEqual({ hours: 5, minutes: 12 });
    expect(countdown(45 * MIN)).toEqual({ hours: 0, minutes: 45 });
  });
  it('arrondi à la minute supérieure : jamais 0 min tant que valide', () => {
    expect(countdown(1)).toEqual({ hours: 0, minutes: 1 });
    expect(countdown(59 * MIN + 1)).toEqual({ hours: 1, minutes: 0 });
  });
  it('état du jeton : utilisé prime sur expiré', () => {
    expect(tokenState({ expiresAt: at(-1), usedAt: at(-100) }, NOW)).toEqual({ kind: 'used' });
    expect(tokenState({ expiresAt: at(0) }, NOW)).toEqual({ kind: 'expired' });
    expect(tokenState({ expiresAt: at(-H) }, NOW)).toEqual({ kind: 'expired' });
  });
  it('jeton valide : décompte seulement sous 24 h', () => {
    expect(tokenState({ expiresAt: at(3 * H) }, NOW)).toEqual({ kind: 'valid', msLeft: 3 * H, countdown: { hours: 3, minutes: 0 } });
    expect(tokenState({ expiresAt: at(3 * 24 * H) }, NOW)).toMatchObject({ kind: 'valid', countdown: null });
  });
});
