import { describe, expect, it } from 'vitest';
import { parseLocalDate, composePhone, countryKey, fillDigits, formatCountdown, initials, isValidPhone } from '../src/lib/format';
import { bioIcon, bioKind, capitalize } from '../src/lib/biometry';
import { canSetup, canUseApp, startRoute } from '../src/lib/flow';

describe('minuteur m:ss', () => {
  it.each([
    [60_000, '1:00'], [59_001, '1:00'], [59_000, '0:59'], [9_000, '0:09'], [1, '0:01'], [0, '0:00'], [-5_000, '0:00'], [300_000, '5:00'],
  ])('%i ms → %s', (ms, out) => expect(formatCountdown(ms)).toBe(out));
});

describe('normalisation du numéro', () => {
  it('assemble indicatif et numéro local', () => {
    expect(composePhone('+33', '06 12 34 56 78')).toBe('+33612345678');
    expect(composePhone('+237', '6 99-00-11-22')).toBe('+237699001122');
    expect(composePhone('0032', '470 12 34 56')).toBe('+32470123456');
  });
  it('valide le numéro pour activer le bouton', () => {
    expect(isValidPhone('+33', '06 12 34 56 78')).toBe(true);
    expect(isValidPhone('+33', '')).toBe(false);
    expect(isValidPhone('+33', '0612')).toBe(false);
    expect(isValidPhone('', '0612345678')).toBe(false);
    expect(isValidPhone('+33', '06 12 34 56 78 90 12 34 56')).toBe(false);
  });
});

describe('initiales', () => {
  it.each([
    ['Marie Ngo Ndjock', 'MN'], ['marie', 'M'], ['  Jean-Paul  Kamga ', 'JK'], ['Éloïse d’Almeida', 'ÉA'], ['', ''], ['   ', ''],
  ])('« %s » → « %s »', (name, out) => expect(initials(name)).toBe(out));
});

describe('saisie du code en six cases', () => {
  const empty = ['', '', '', '', '', ''];
  it('un chiffre avance à la case suivante', () => {
    expect(fillDigits(empty, 0, '4')).toEqual({ digits: ['4', '', '', '', '', ''], focus: 1 });
  });
  it('un code complet collé remplit toutes les cases', () => {
    expect(fillDigits(empty, 2, '123 456')).toEqual({ digits: ['1', '2', '3', '4', '5', '6'], focus: 5 });
  });
  it('remplace le chiffre existant', () => {
    expect(fillDigits(['1', '', '', '', '', ''], 0, '17').digits[0]).toBe('7');
  });
  it('un effacement vide la case', () => {
    expect(fillDigits(['1', '2', '', '', '', ''], 1, '')).toEqual({ digits: ['1', '', '', '', '', ''], focus: 1 });
  });
  it('ignore les caractères non numériques', () => {
    expect(fillDigits(empty, 0, 'a').digits).toEqual(empty);
  });
});

describe('parcours de démarrage', () => {
  const s = { userId: 'u', phone: '+33612345678', biometricEnabled: false };
  it.each([
    [null, false, '/slides'],
    [null, true, '/login'],
    [s, true, '/profile-setup'],
    [{ ...s, profile: { fullName: 'M N', country: 'FR', primaryRole: 'PAYER' as const } }, true, '/home'],
  ])('session %j, présentation vue %s → %s', (session, onboardingSeen, out) => {
    expect(startRoute({ session, onboardingSeen })).toBe(out);
  });
  it('protège les onglets et l’étape profil', () => {
    expect(canUseApp(null)).toBe(false);
    expect(canUseApp(s)).toBe(false);
    expect(canSetup(s)).toBe(true);
    expect(canSetup(null)).toBe(false);
  });
});

describe('biométrie', () => {
  it('adapte le nom du moyen à la plateforme', () => {
    expect(bioKind('ios', [2])).toBe('faceid');
    expect(bioKind('ios', [1])).toBe('touchid');
    expect(bioKind('android', [1, 2])).toBe('face');
    expect(bioKind('android', [1])).toBe('fingerprint');
    expect(bioKind('android', [])).toBe('generic');
    expect(bioIcon('fingerprint')).toBe('fingerprint');
    expect(capitalize('l’empreinte digitale')).toBe('L’empreinte digitale');
  });
  it('retombe sur « Autre » pour un pays inconnu', () => {
    expect(countryKey('FR')).toBe('country_FR');
    expect(countryKey('ZZ')).toBe('country_OTHER');
  });
});

describe('dates du calendrier', () => {
  it('lit AAAA-MM-JJ comme un jour local, sans décalage de fuseau', () => {
    const d = parseLocalDate('2026-11-15');
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 10, 15, 0]);
    expect(parseLocalDate('2026-11-15T10:00:00Z').toISOString()).toBe('2026-11-15T10:00:00.000Z');
  });
});
