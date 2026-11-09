import { describe, expect, it } from 'vitest';
import { encodeEqr } from '@diaspay/domain';
import type { ReferenceInfo } from '@diaspay/api-client';
import { DEBOUNCE_MS, initialScanState, precheck, scanReducer, toScanError } from '../src/features/scan/reducer';
import type { ScanAction, ScanState } from '../src/features/scan/reducer';

const REF = '4f9a2c71b8e01d3ca9';
const QR = encodeEqr({ reference: REF, kid: 'SIMULATED', signature: 'SIMULATED.ab' });
const T0 = 1_000_000;
const info = (over: Partial<ReferenceInfo> = {}): ReferenceInfo => ({
  trancheId: 'tr-1', txId: 'tx-1', label: 'Scolarité T1', amountMinor: 300_000, currency: 'XAF', status: 'PAID_LOCKED',
  expiresAt: new Date(T0 + 3_600_000).toISOString(), used: false, providerName: 'École', beneficiaryName: 'Aïcha N.', purpose: 'Scolarité',
  seq: 2, contestHours: 72, ...over,
});
const run = (actions: ScanAction[], from: ScanState = initialScanState) => actions.reduce(scanReducer, from);
const scanning = () => run([{ type: 'START' }]);
const resolving = () => run([{ type: 'SCAN', text: QR, at: T0 }], scanning());
const ready = () => run([{ type: 'RESOLVED', info: info(), now: T0, isProvider: true }], resolving());

describe('machine d’états du scan', () => {
  it('idle → scanning → resolving → ready → confirming → done', () => {
    expect(initialScanState.phase).toBe('idle');
    expect(scanning().phase).toBe('scanning');
    const r = resolving();
    expect(r).toMatchObject({ phase: 'resolving', reference: REF });
    const rd = ready();
    expect(rd).toMatchObject({ phase: 'ready', info: { trancheId: 'tr-1' } });
    const c = run([{ type: 'CONFIRM' }], rd);
    expect(c.phase).toBe('confirming');
    expect(run([{ type: 'CONFIRMED' }], c).phase).toBe('done');
  });

  it('un contenu non conforme à DPQ1 donne une erreur sans passer par resolving', () => {
    for (const text of ['https://exemple.org', 'DPQ2:' + REF + ':k:s', 'DPQ1:court:k:s', '']) {
      const s = run([{ type: 'SCAN', text, at: T0 }], scanning());
      expect(s).toMatchObject({ phase: 'error', error: 'EQR_MALFORMED' });
      expect(s.reference).toBeUndefined();
    }
  });

  it('ignore les scans répétés du même contenu pendant 2 s', () => {
    const s = run([{ type: 'SCAN', text: 'abc', at: T0 }], scanning());
    expect(s.phase).toBe('error');
    const back = run([{ type: 'RESET' }], s);
    expect(back.phase).toBe('scanning');
    // même contenu 1,9 s plus tard : ignoré
    expect(run([{ type: 'SCAN', text: 'abc', at: T0 + DEBOUNCE_MS - 100 }], back).phase).toBe('scanning');
    // contenu différent : pris en compte
    expect(run([{ type: 'SCAN', text: QR, at: T0 + 100 }], back).phase).toBe('resolving');
  });
  it('la fenêtre glisse tant que le QR reste devant la caméra, puis le scan est de nouveau accepté', () => {
    let s = run([{ type: 'SCAN', text: 'abc', at: T0 }, { type: 'RESET' }], scanning());
    for (let i = 1; i <= 5; i++) s = run([{ type: 'SCAN', text: 'abc', at: T0 + i * 1500 }], s); // 7,5 s de présence
    expect(s.phase).toBe('scanning');
    s = run([{ type: 'SCAN', text: 'abc', at: T0 + 5 * 1500 + DEBOUNCE_MS }], s);
    expect(s.phase).toBe('error');
  });
  it('ignore les scans hors phase scanning', () => {
    const r = resolving();
    expect(run([{ type: 'SCAN', text: 'autre', at: T0 + 5000 }], r)).toMatchObject({ phase: 'resolving', reference: REF });
    const rd = ready();
    expect(run([{ type: 'SCAN', text: QR, at: T0 + 5000 }], rd).phase).toBe('ready');
    expect(run([{ type: 'SCAN', text: QR, at: T0 }], initialScanState).phase).toBe('idle');
  });

  it('saisie manuelle : référence valide, formatée ou non', () => {
    expect(run([{ type: 'MANUAL', text: '4F9A-2C71-B8E0-1D3C-A9', at: T0 }], scanning())).toMatchObject({ phase: 'resolving', reference: REF });
    expect(run([{ type: 'MANUAL', text: 'zz', at: T0 }], scanning())).toMatchObject({ phase: 'error', error: 'UNKNOWN_REFERENCE' });
  });

  describe('erreurs locales après résolution', () => {
    const err = (i: ReferenceInfo, isProvider = true, now = T0) => {
      const s = run([{ type: 'RESOLVED', info: i, now, isProvider }], resolving());
      return s.phase === 'error' ? s.error : s.phase;
    };
    it('PROVIDER_ONLY', () => expect(err(info(), false)).toBe('PROVIDER_ONLY'));
    it('TOKEN_USED', () => expect(err(info({ used: true }))).toBe('TOKEN_USED'));
    it('TOKEN_EXPIRED', () => expect(err(info(), true, T0 + 3_600_001)).toBe('TOKEN_EXPIRED'));
    it('NOT_PAID', () => {
      expect(err(info({ status: 'AWAITING_PAYMENT' }))).toBe('NOT_PAID');
      expect(err(info({ status: 'CONFIRMED' }))).toBe('NOT_PAID');
    });
    it('succès', () => expect(err(info())).toBe('ready'));
    it('precheck est pur', () => expect(precheck(info(), T0, true)).toBeNull());
  });

  describe('erreurs serveur', () => {
    it.each(['UNKNOWN_REFERENCE', 'NOT_A_PARTY', 'EQR_MALFORMED'] as const)('à la résolution : %s', (code) => {
      expect(run([{ type: 'FAILED', code }], resolving())).toMatchObject({ phase: 'error', error: code });
    });
    it.each(['TOKEN_EXPIRED', 'TOKEN_USED', 'NOT_PAID', 'WRONG_MODE', 'PROVIDER_ONLY', 'DEVICE_TIME_INVALID'] as const)('à la confirmation : %s', (code) => {
      const s = run([{ type: 'CONFIRM' }, { type: 'FAILED', code }], ready());
      expect(s).toMatchObject({ phase: 'error', error: code });
    });
    it('code inattendu → GENERIC', () => {
      expect(toScanError('BOOM')).toBe('GENERIC');
      expect(toScanError(undefined)).toBe('GENERIC');
      expect(run([{ type: 'FAILED', code: 'BOOM' }], resolving())).toMatchObject({ error: 'GENERIC' });
    });
    it('ignore un échec hors résolution ou confirmation', () => {
      expect(run([{ type: 'FAILED', code: 'TOKEN_USED' }], ready()).phase).toBe('ready');
    });
  });

  it('RESET revient au scan et conserve l’anti-rebond', () => {
    const s = run([{ type: 'RESET' }], ready());
    expect(s).toMatchObject({ phase: 'scanning', last: { text: QR } });
    expect(s.info).toBeUndefined();
  });
  it('CONFIRM et CONFIRMED sont inertes hors de leur phase', () => {
    expect(run([{ type: 'CONFIRM' }], scanning()).phase).toBe('scanning');
    expect(run([{ type: 'CONFIRMED' }], ready()).phase).toBe('ready');
  });
});
