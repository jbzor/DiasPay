import { describe, expect, it } from 'vitest';
import { formatAmount, formatDate, formatDayMonth, formatShortDateTime, formatSize, relativeTime, shortHash } from '@/lib/format';
import { fold, includesFolded } from '@/lib/search';

const nbsp = (s: string) => s.replace(/[  ]/g, ' ');

describe('durées relatives (maquette : « il y a 2 h », « hier », « il y a 3 j »)', () => {
  const now = new Date(2026, 10, 11, 14, 0); // 11 nov. 2026, 14:00 (heure locale)
  const at = (d: number, h: number, m = 0, sec = 0) => new Date(2026, 10, d, h, m, sec).toISOString();
  it('moins d’une minute', () => expect(relativeTime(at(11, 13, 59, 30), now)).toBe('à l’instant'));
  it('minutes', () => expect(relativeTime(at(11, 13, 48), now)).toBe('il y a 12 min'));
  it('heures, le même jour', () => expect(relativeTime(at(11, 12, 0), now)).toBe('il y a 2 h'));
  it('la veille, même à moins de 24 h', () => expect(relativeTime(at(10, 23, 0), now)).toBe('hier'));
  it('la veille, à plus de 24 h', () => expect(relativeTime(at(10, 8, 0), now)).toBe('hier'));
  it('jours', () => expect(relativeTime(at(8, 9, 0), now)).toBe('il y a 3 j'));
  it('absente', () => expect(relativeTime(null, now)).toBe('—'));
});

describe('montants et dates', () => {
  it('montants en FCFA sans décimales, euros avec deux décimales', () => {
    expect(nbsp(formatAmount(12_500_000, 'XAF'))).toBe('12 500 000 FCFA');
    expect(nbsp(formatAmount(180_000, 'XAF'))).toBe('180 000 FCFA');
    expect(nbsp(formatAmount(123_456, 'EUR'))).toBe('1 234,56 €');
  });
  it('dates courtes de la maquette', () => {
    expect(formatDayMonth(new Date(2026, 10, 9, 10, 12).toISOString())).toBe('9 nov.');
    expect(formatShortDateTime(new Date(2026, 10, 8, 9, 12).toISOString())).toBe('8 nov., 09:12');
    expect(formatDate('2026-11-15')).toBe('15 nov. 2026');
  });
  it('tailles de fichier', () => {
    expect(formatSize(512)).toBe('512 o');
    expect(nbsp(formatSize(2048))).toBe('2 Ko');
    expect(nbsp(formatSize(1_258_291))).toBe('1,2 Mo');
  });
});

describe('empreintes abrégées', () => {
  it('« 3f9a…c71b » pour une empreinte SHA-256 entière', () => {
    expect(shortHash('3f9a' + '0'.repeat(56) + 'c71b')).toBe('3f9a…c71b');
  });
  it('empreinte courte inchangée', () => expect(shortHash('abcd')).toBe('abcd'));
});

describe('recherche sans accents ni casse (comme _fold côté base)', () => {
  it('replie accents et majuscules', () => expect(fold('  Scolarité ÉCOLE ')).toBe('scolarite ecole'));
  it('cherche dans plusieurs champs', () => {
    expect(includesFolded(['Hôpital Central', null, 'Jean K.'], 'hopital')).toBe(true);
    expect(includesFolded(['Hôpital Central'], 'clinique')).toBe(false);
    expect(includesFolded(['x'], '  ')).toBe(true);
  });
});
