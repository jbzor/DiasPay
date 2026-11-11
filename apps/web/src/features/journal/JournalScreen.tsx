'use client';
import { useEffect, useRef, useState } from 'react';

import { ErrorState, LoadingRows } from '@/components/ErrorState';
import { Toast } from '@/components/Toast';
import { errorMessage, t, tMaybe } from '@/i18n';
import { actorLabel, eventLabel, trancheLabel } from '@/lib/audit';
import { auditRows, auditVerify, findTransactions, logAuditExport } from '@/lib/bo';
import type { AuditCheck, AuditRow, FoundTransaction } from '@/lib/bo';
import { toCsv } from '@/lib/csv';
import { formatAmount, formatShortDateTime, shortHash } from '@/lib/format';
import { dossierTitle } from '@/lib/labels';

interface Loaded { rows: AuditRow[]; check: AuditCheck }

/**
 * Journal d’audit (BO5) : recherche d’une transaction, lignes du journal (ajout seul, chaînées par empreinte),
 * état de la chaîne vérifié par la base (bo_audit_verify), export CSV complet, lui-même journalisé.
 */
export function JournalScreen() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FoundTransaction[] | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [tx, setTx] = useState<FoundTransaction | null>(null);
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // Recherche différée (300 ms) ; résultats sans accents ni casse, par objectif, nom ou référence (côté base).
  useEffect(() => {
    if (!listOpen) return;
    let cancelled = false;
    const id = setTimeout(() => {
      findTransactions(query).then((r) => { if (!cancelled) { setResults(r); setActive(r.length ? 0 : -1); } }, (e) => { if (!cancelled) setError(e); });
    }, 300);
    return () => { cancelled = true; clearTimeout(id); };
  }, [query, listOpen]);

  async function load(target: FoundTransaction) {
    setLoading(true);
    setError(null);
    try {
      const [rows, check] = await Promise.all([auditRows(target.id), auditVerify(target.id)]);
      setData({ rows, check });
    } catch (e) { setError(e); setData(null); } finally { setLoading(false); }
  }

  function pick(r: FoundTransaction) {
    setTx(r);
    setQuery(dossierTitle(r));
    setListOpen(false);
    void load(r);
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    const n = results?.length ?? 0;
    if (e.key === 'ArrowDown') { e.preventDefault(); setListOpen(true); setActive((a) => Math.min(n - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter' && listOpen && results && results[active]) { e.preventDefault(); pick(results[active]!); }
    else if (e.key === 'Escape' && listOpen) { e.preventDefault(); setListOpen(false); }
  }

  async function exportCsv() {
    if (!tx) return;
    setExporting(true);
    try {
      // L’export est inscrit au journal avant la lecture : la ligne d’export figure dans le fichier.
      await logAuditExport(tx.id, data?.rows.length ?? 0);
      const [rows, check] = await Promise.all([auditRows(tx.id), auditVerify(tx.id)]);
      setData({ rows, check });
      const csv = toCsv(
        [t('journal.csv.time'), t('journal.csv.actor'), t('journal.csv.actorRole'), t('journal.csv.event'), t('journal.csv.eventCode'),
          t('journal.csv.from'), t('journal.csv.to'), t('journal.csv.tranche'), t('journal.csv.payload'), t('journal.csv.prevHash'), t('journal.csv.hash')],
        rows.map((r) => [r.createdAt, r.actorId ? r.actorName : t('common.system'), r.actorRole ?? '', eventLabel(r), r.event,
          r.fromStatus ?? '', r.toStatus ?? '', r.trancheSeq ?? '', r.payload, r.prevHash ?? '', r.hash]),
      );
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `journal-${tx.reference}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setToast(t('journal.exported', { n: rows.length }));
    } catch (e) {
      setToast(errorMessage(e));
    } finally {
      setExporting(false);
    }
  }

  async function copy(hash: string) {
    try { await navigator.clipboard.writeText(hash); setToast(`${t('common.copied')} : ${hash}`); } catch { setToast(hash); }
  }

  const showList = listOpen && results !== null;
  return (
    <div className="workspace no-panel">
      <main className="main" aria-labelledby="page-title">
        <div className="page-head">
          <h1 id="page-title">{t('journal.title')}</h1>
          <p className="page-meta">{t('journal.subtitle')}</p>
        </div>
        {data ? (
          <p className={`banner ${data.check.valid ? 'ok' : 'err'}`} role={data.check.valid ? 'status' : 'alert'} data-chain={data.check.valid ? 'valid' : 'broken'}>
            {t(data.check.valid ? 'journal.valid' : 'journal.broken', { n: data.check.count })}
          </p>
        ) : null}
        <div className="search-row">
          <label className="sr-only" htmlFor="tx-search">{t('journal.searchLabel')}</label>
          <input id="tx-search" ref={input} className="input" type="search" role="combobox" autoComplete="off"
            aria-expanded={showList} aria-controls="tx-results" aria-autocomplete="list"
            aria-activedescendant={showList && active >= 0 ? `tx-opt-${active}` : undefined}
            placeholder={t('journal.search')} value={query}
            onChange={(e) => { setQuery(e.target.value); setListOpen(true); }} onFocus={() => setListOpen(true)} onKeyDown={onKey} />
          <button type="button" className="btn btn-secondary" onClick={exportCsv} disabled={!tx || !data || exporting}>{t('journal.export')}</button>
        </div>
        {showList ? (
          results!.length ? (
            <ul id="tx-results" role="listbox" className="results" aria-label={t('journal.results')}>
              {results!.map((r, i) => (
                <li key={r.id} id={`tx-opt-${i}`} role="option" aria-selected={i === active} onMouseDown={(e) => { e.preventDefault(); pick(r); }}>
                  <strong>{dossierTitle(r)}</strong>
                  <span className="cell-sub">{r.reference} · {formatAmount(r.amountMinor, r.currency)} · {tMaybe(`txStatus.${r.status}`) ?? r.status}{r.payerName ? ` · ${r.payerName}` : ''}</span>
                </li>
              ))}
            </ul>
          ) : <p id="tx-results" className="muted" role="status">{t('journal.noResult')}</p>
        ) : null}
        {error ? <ErrorState error={error} onRetry={() => tx && void load(tx)} /> : null}
        {loading && !data ? <LoadingRows /> : null}
        {!tx && !showList ? <p className="muted">{t('journal.pick')}</p> : null}
        {data ? (
          <table className="grid static-grid">
            <caption className="sr-only">{t('journal.table')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('journal.col.time')}</th>
                <th scope="col">{t('journal.col.actor')}</th>
                <th scope="col">{t('journal.col.event')}</th>
                <th scope="col">{t('journal.col.tranche')}</th>
                <th scope="col">{t('journal.col.hash')}</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} data-event={r.event}>
                  <td className="nowrap num-time">{formatShortDateTime(r.createdAt)}</td>
                  <td>{actorLabel(r)}</td>
                  <td>{eventLabel(r)}</td>
                  <td>{trancheLabel(r)}</td>
                  <td><button type="button" className="hash-btn" title={r.hash} aria-label={t('journal.copyHash', { hash: r.hash })} onClick={() => copy(r.hash)}>{shortHash(r.hash)}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </main>
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}
