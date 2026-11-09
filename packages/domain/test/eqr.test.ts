import { describe, expect, it } from 'vitest';
import { DomainError, buildLink, decodeEqr, encodeEqr, formatReference, normalizeReference, parseDeepLink } from '../src';

const REF = '4f9a2c71b8e01d3ca9';
const codeOf = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as DomainError).code; } return 'NO_ERROR'; };

describe('eQR', () => {
  it('aller-retour', () => {
    const text = encodeEqr({ reference: REF, kid: 'SIMULATED', signature: 'SIMULATED.ab12' });
    expect(text).toBe(`DPQ1:${REF}:SIMULATED:SIMULATED.ab12`);
    expect(decodeEqr(text)).toEqual({ reference: REF, kid: 'SIMULATED', signature: 'SIMULATED.ab12' });
  });
  it('insensible à la casse de la référence', () => {
    expect(decodeEqr(`DPQ1:${REF.toUpperCase()}:k:s`).reference).toBe(REF);
  });
  it.each([
    ['version inconnue', `DPQ2:${REF}:k:s`],
    ['champ manquant', `DPQ1:${REF}:k`],
    ['signature vide', `DPQ1:${REF}:k:`],
    ['kid vide', `DPQ1:${REF}::s`],
    ['deux-points en trop', `DPQ1:${REF}:k:s:x`],
    ['référence trop courte', 'DPQ1:4f9a:k:s'],
    ['référence non hexadécimale', `DPQ1:${'z'.repeat(18)}:k:s`],
    ['texte quelconque', 'https://exemple.org'],
    ['vide', ''],
  ])('refuse : %s', (_n, text) => {
    expect(codeOf(() => decodeEqr(text))).toBe('EQR_MALFORMED');
  });
  it('encodeEqr refuse un deux-points dans un champ', () => {
    expect(codeOf(() => encodeEqr({ reference: REF, kid: 'a:b', signature: 's' }))).toBe('EQR_MALFORMED');
    expect(codeOf(() => encodeEqr({ reference: REF, kid: 'k', signature: '' }))).toBe('EQR_MALFORMED');
  });
  it('formate et normalise la référence', () => {
    expect(formatReference(REF)).toBe('4F9A-2C71-B8E0-1D3C-A9');
    expect(normalizeReference(' 4F9A-2C71-B8E0-1D3C-A9 ')).toBe(REF);
    expect(codeOf(() => normalizeReference('4F9A-2C71'))).toBe('EQR_MALFORMED');
  });
  it('liens profonds', () => {
    expect(parseDeepLink(`diaspay://t/${REF}`)).toEqual({ reference: REF });
    expect(parseDeepLink(`diaspay://t/${REF.toUpperCase()}/`)).toEqual({ reference: REF });
    expect(parseDeepLink(`https://liens.exemple.org/t/${REF}`, 'liens.exemple.org')).toEqual({ reference: REF });
    expect(parseDeepLink(`https://liens.exemple.org/t/${REF}`, 'https://liens.exemple.org')).toEqual({ reference: REF });
  });
  it('liens invalides', () => {
    expect(parseDeepLink(`https://autre.org/t/${REF}`, 'liens.exemple.org')).toBeNull();
    expect(parseDeepLink(`https://liens.exemple.org/t/${REF}`)).toBeNull();
    expect(parseDeepLink('diaspay://t/abc')).toBeNull();
    expect(parseDeepLink(`diaspay://x/${REF}`)).toBeNull();
    expect(parseDeepLink(`http://liens.exemple.org/t/${REF}`, 'liens.exemple.org')).toBeNull();
    expect(parseDeepLink('pas un lien')).toBeNull();
    expect(parseDeepLink('diaspay://t/%E0%A4%A')).toBeNull();
  });
  it('construit le lien partageable', () => {
    expect(buildLink('liens.exemple.org', REF.toUpperCase())).toBe(`https://liens.exemple.org/t/${REF}`);
    expect(buildLink('https://liens.exemple.org/', REF)).toBe(`https://liens.exemple.org/t/${REF}`);
  });
});
