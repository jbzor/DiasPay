import { formatAmount } from '@/lib/format';
import { t, tMaybe } from '@/i18n';
import type { Check } from '@/lib/bo';

const ICON: Record<string, string> = { OK: '✓', ATTENTION: '!', ECHEC: '✗' };

/** Libellé détaillé d’un contrôle (structure fixée par dossier_checks et evidence_checks, 0006). */
export function checkDetail(c: Check, currency: string): string | null {
  const d = c.detail;
  switch (c.code) {
    case 'DOCUMENTS': {
      const missing = Array.isArray(d.missing) ? (d.missing as string[]) : [];
      return missing.length ? t('checkDetail.missing', { kinds: missing.map((k) => tMaybe(`doc.${k}`) ?? k).join(', ') }) : null;
    }
    case 'PROVIDER_VERIFIED':
      return d.reason === 'UNVERIFIED' ? t('checkDetail.unverified') : d.reason === 'OUTSIDE_DIRECTORY' ? t('checkDetail.outside') : null;
    case 'DUPLICATE': {
      const refs = Array.isArray(d.references) ? (d.references as string[]) : [];
      return refs.length ? t('checkDetail.duplicates', { refs: refs.join(', ') }) : null;
    }
    case 'DOCUMENT_REUSED': {
      // Lot X (X4) : même empreinte SHA-256 qu’une pièce d’un autre dossier (type de pièce et références de ces dossiers).
      const docs = Array.isArray(d.documents) ? (d.documents as Array<{ kind?: string; references?: string[] }>) : [];
      return docs.length
        ? docs.map((x) => t('checkDetail.reused', { kind: tMaybe(`doc.${x.kind ?? ''}`) ?? x.kind ?? '', refs: (x.references ?? []).join(', ') })).join(' ; ')
        : null;
    }
    case 'PLAN_SUM':
      return c.result === 'OK' ? null : t('checkDetail.gap', { gap: formatAmount(Number(d.gap ?? 0), currency) });
    case 'EVIDENCE_PRESENT':
      return c.result === 'OK' ? null : t('checkDetail.noEvidence');
    default:
      return null;
  }
}

/** Contrôles automatiques (D6) : coche verte, point d’exclamation jaune (alerte sans blocage), croix rouge. */
export function ChecksList({ checks, currency }: { checks: readonly Check[]; currency: string }) {
  return (
    <ul className="checks">
      {checks.map((c) => {
        const detail = checkDetail(c, currency);
        return (
          <li key={c.code} data-check={c.code} data-result={c.result}>
            <span className={`check-icon ${c.result}`} aria-hidden="true">{ICON[c.result] ?? '?'}</span>
            <span>{tMaybe(`check.${c.code}.${c.result}`) ?? c.code}<span className="sr-only"> : {t(`checkResult.${c.result}` as 'checkResult.OK')}</span></span>
            {detail ? <span className={`check-detail ${c.result}`}>{detail}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}
