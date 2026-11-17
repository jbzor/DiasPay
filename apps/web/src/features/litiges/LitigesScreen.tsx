'use client';
import { useCallback, useMemo, useRef, useState } from 'react';
import { formatAmountInput, parseAmountInput } from '@diaspay/domain';
import type { Currency, DisputeOutcome } from '@diaspay/domain';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DataTable } from '@/components/DataTable';
import type { Column } from '@/components/DataTable';
import { DocumentList } from '@/components/Documents';
import { ErrorState, LoadingRows } from '@/components/ErrorState';
import { KV, Panel, PanelEmpty, Section } from '@/components/Panel';
import { Status } from '@/components/Status';
import type { Tone } from '@/components/Status';
import { Toast } from '@/components/Toast';
import { useLoad } from '@/hooks/useLoad';
import { useRealtime } from '@/hooks/useRealtime';
import { errorMessage, t, tMaybe, tn } from '@/i18n';
import type { Key } from '@/i18n';
import { disputeDocuments, listDisputes, resolveDispute } from '@/lib/bo';
import type { DisputeRow } from '@/lib/bo';
import { availableOutcomes, disputeInputError, isOpenDispute } from '@/lib/disputes';
import { formatAmount, formatDateTime, formatDayMonth, formatShortDateTime } from '@/lib/format';
import { dossierTitle } from '@/lib/labels';
import { fold } from '@/lib/search';

const STATUS_TONE: Record<DisputeRow['status'], Tone> = { OPEN: 'pending', AWAITING_RESPONSE: 'pending', IN_MEDIATION: 'pending', RESOLVED: 'active' };
const reasonLabel = (r: DisputeRow) => tMaybe(`litiges.reason.${r.reasonCode}`) ?? r.reasonCode;
/** Statut affiché : en cours (ouvert, réponse attendue, médiation) ou, une fois résolu, l’issue retenue. */
const statusLabel = (r: DisputeRow) => (r.status === 'RESOLVED' && r.outcome ? t(`litiges.result.${r.outcome}`) : t(`litiges.status.${r.status}`));
/** Issues qui rendent de l’argent au payeur : bouton et confirmation en rouge. */
const DANGER: ReadonlySet<DisputeOutcome> = new Set(['REFUND_FULL', 'REFUND_PARTIAL', 'FUNDS_RETURNED']);

/**
 * Litiges (BO7), administrateurs seulement (RG-09 ; la vue bo_disputes est vide pour tout autre compte).
 * Décision irréversible : note obligatoire, puis double confirmation de l’intention (case et mot à saisir).
 */
export function LitigesScreen() {
  const list = useLoad(listDisputes, []);
  const [show, setShow] = useState<'OPEN' | 'RESOLVED'>('OPEN');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const reloadQuiet = useCallback(() => { void list.reload(true); }, [list]);
  useRealtime(['disputes', 'tranches'], reloadQuiet, 'litiges');

  const all = list.data ?? [];
  const openCount = all.filter((d) => isOpenDispute(d.status)).length;
  const rows = useMemo(() => all.filter((d) => (show === 'OPEN') === isOpenDispute(d.status)), [all, show]);
  const selected = all.find((d) => d.id === selectedId) ?? null;

  function close(focusRow = true) {
    const id = selectedId;
    setSelectedId(null);
    if (focusRow && id) setFocusKey(id);
  }

  const columns: Array<Column<DisputeRow>> = [
    { key: 'litige', header: t('litiges.col.litige'), render: (r) => <span className="cell-title">{reasonLabel(r)}</span> },
    { key: 'dossier', header: t('litiges.col.dossier'), render: (r) => dossierTitle(r) },
    { key: 'amount', header: t('litiges.col.amount'), numeric: true, render: (r) => <span className="amount">{formatAmount(r.amountMinor, r.currency)}</span> },
    { key: 'by', header: t('litiges.col.openedBy'), render: (r) => t(`litiges.by.${r.openedByRole}`) },
    { key: 'at', header: t('litiges.col.openedAt'), render: (r) => <span className="muted">{formatDayMonth(r.openedAt)}</span> },
    { key: 'status', header: t('litiges.col.status'), render: (r) => <Status tone={STATUS_TONE[r.status] ?? 'pending'}>{statusLabel(r)}</Status> },
  ];

  return (
    <div className="workspace">
      <main className="main" aria-labelledby="page-title">
        <div className="page-head">
          <h1 id="page-title">{t('litiges.title')}</h1>
          <p className="page-meta">{tn('litiges.count', openCount)}</p>
        </div>
        <div className="toolbar">
          <div className="field">
            <label className="field-label" htmlFor="f-show">{t('litiges.filter')}</label>
            <select id="f-show" className="select" value={show} onChange={(e) => { setShow(e.target.value as 'OPEN' | 'RESOLVED'); setSelectedId(null); }}>
              <option value="OPEN">{t('litiges.filterOpen')}</option>
              <option value="RESOLVED">{t('litiges.filterResolved')}</option>
            </select>
          </div>
        </div>
        {list.error && !list.data ? <ErrorState error={list.error} onRetry={() => void list.reload()} />
          : list.loading && !list.data ? <LoadingRows />
          : <DataTable caption={t('litiges.table')} rows={rows} columns={columns} rowKey={(r) => r.id} selectedKey={selectedId}
              onOpen={(r) => { setSelectedId(r.id); setFocusKey(null); }} focusKey={focusKey} empty={t('litiges.empty')} />}
      </main>
      {selected
        ? <DisputePanel key={selected.id} row={selected} onClose={close}
            onDone={(m) => { setToast(m); close(false); void list.reload(true); }} onStale={() => void list.reload(true)} />
        : <PanelEmpty text={t('common.selectHint')} />}
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}

function DisputePanel({ row, onClose, onDone, onStale }: { row: DisputeRow; onClose: () => void; onDone: (m: string) => void; onStale: () => void }) {
  const docs = useLoad(() => disputeDocuments(row.txId, row.trancheId), [row.id]);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<DisputeOutcome | null>(null);
  const [partial, setPartial] = useState('');
  const [partialMinor, setPartialMinor] = useState<number | null>(null);
  const [partialError, setPartialError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const partialRef = useRef<HTMLInputElement>(null);
  const amount = formatAmount(row.amountMinor, row.currency);
  const open = isOpenDispute(row.status);
  const canDecide = open && !row.isParty;
  const outcomes = availableOutcomes(row);
  const remainingMinor = Math.max(0, row.amountMinor - row.refundedMinor);
  const remaining = formatAmount(remainingMinor, row.currency);
  const payerVersion = row.openedByRole === 'PAYER' ? row.description : row.response;
  const providerVersion = row.openedByRole === 'PROVIDER' ? row.description : row.response;
  const word = outcome ? t(`litiges.confirmWord.${outcome}`) : '';
  const intentConfirmed = checked && fold(typed) === fold(word);

  function ask(o: DisputeOutcome) {
    let minor: number | null = null;
    if (o === 'REFUND_PARTIAL') {
      try { minor = parseAmountInput(partial, row.currency as Currency, 'fr'); } catch { minor = null; }
    }
    const err = disputeInputError({ outcome: o, note, amountMinor: minor, remainingMinor });
    if (err === 'REASON_REQUIRED') { setNoteError(t('litiges.noteRequired')); noteRef.current?.focus(); return; }
    setNoteError(null);
    if (err) { setPartialError(t('litiges.partialRequired', { max: remaining })); partialRef.current?.focus(); return; }
    setPartialError(null);
    setPartialMinor(minor);
    setChecked(false);
    setTyped('');
    setOutcome(o);
  }

  async function decide() {
    if (!outcome || !intentConfirmed) return;
    setBusy(true);
    setActionError(null);
    try {
      await resolveDispute(row.id, outcome, note, partialMinor ?? undefined);
      const done = outcome;
      setOutcome(null);
      onDone(t(`litiges.done.${done}`, { refund: partialMinor ? formatAmount(partialMinor, row.currency) : remaining }));
    } catch (e) {
      setOutcome(null);
      setActionError(errorMessage(e));
      const code = (e as { code?: string }).code;
      if (code === 'NO_OPEN_DISPUTE' || code === 'INVALID_OUTCOME') onStale();
    } finally {
      setBusy(false);
    }
  }

  const informedKey: Key = row.openedByRole === 'PAYER' ? 'litiges.tl.informed' : 'litiges.tl.informedPayer';
  return (
    <Panel title={reasonLabel(row)} onClose={onClose} openKey={row.id} actions={canDecide ? (
      <div className="panel-actions">
        {outcomes.map((o) => (
          <button key={o} type="button" className={`btn ${DANGER.has(o) ? 'btn-danger' : o === 'NO_ACTION' ? 'btn-secondary' : 'btn-primary'}`}
            onClick={() => ask(o)} disabled={busy}>{t(`litiges.outcome.${o}`)}</button>
        ))}
      </div>
    ) : null}>
      <KV items={[
        [t('litiges.col.dossier'), dossierTitle(row)],
        [t('litiges.tranche'), t('litiges.trancheValue', { seq: row.trancheSeq, amount })],
        [t('litiges.openedAt'), formatDateTime(row.openedAt)],
        [t('litiges.col.status'), statusLabel(row)],
        row.refundedMinor > 0 ? [t('litiges.refunded'), formatAmount(row.refundedMinor, row.currency)] : null,
        [t('dossiers.payer'), row.payerName ?? t('common.none')],
        [t('dossiers.provider'), row.providerName ?? t('common.none')],
        [t('dossiers.reference'), <span className="mono" key="r">{row.reference}</span>],
      ]} />
      <div className="versions">
        <div><h3>{t('litiges.payerVersion')}</h3><p>{payerVersion ?? t('litiges.noAnswer')}</p></div>
        <div><h3>{t('litiges.providerVersion')}</h3><p>{providerVersion ?? t('litiges.noAnswer')}</p></div>
      </div>
      <Section title={t('litiges.documents')} id="sec-docs">
        {docs.error ? <ErrorState error={docs.error} onRetry={() => void docs.reload()} /> : docs.data ? <DocumentList documents={docs.data} label={t('litiges.documents')} /> : <LoadingRows />}
      </Section>
      <Section title={t('litiges.timeline')} id="sec-timeline">
        <ul className="lines decisions">
          <li><span className="who"><span className="dot active" aria-hidden="true" />{t('litiges.tl.opened')}</span><span className="muted">{formatShortDateTime(row.openedAt)}</span></li>
          {row.notifiedAt ? <li><span className="who"><span className="dot active" aria-hidden="true" />{t(informedKey)}</span><span className="muted">{formatShortDateTime(row.notifiedAt)}</span></li> : null}
          {row.respondedAt ? <li><span className="who"><span className="dot active" aria-hidden="true" />{t('litiges.tl.answered')}</span><span className="muted">{formatShortDateTime(row.respondedAt)}</span></li> : null}
          <li><span className="who"><span className={`dot ${open ? 'pending' : 'active'}`} aria-hidden="true" />{t('litiges.tl.decision')}</span>
            <span className="muted">{row.resolvedAt ? formatShortDateTime(row.resolvedAt) : t('litiges.tl.toDecide')}</span></li>
        </ul>
      </Section>
      {!open ? (
        <div className="note-ok" role="note">
          <p>{t('litiges.resolved', { date: formatDateTime(row.resolvedAt ?? row.openedAt), outcome: statusLabel(row) })}</p>
          {row.resolutionNote ? <p className="muted">« {row.resolutionNote} »{row.resolvedByName ? ` — ${row.resolvedByName}` : ''}</p> : null}
        </div>
      ) : row.isParty ? <p className="note-warn" role="note">{t('litiges.isParty')}</p>
        : <p className="note-ok" role="note">{t('litiges.canDecide')}</p>}
      {open && row.onHold ? <p className="note-warn" role="note">{t('litiges.onHold')}</p> : null}
      {canDecide ? (
        <div className="field section">
          <label className="field-label" htmlFor="note">{t('litiges.note')}</label>
          <textarea id="note" ref={noteRef} className="textarea" value={note} maxLength={1000}
            onChange={(e) => { setNote(e.target.value); if (noteError) setNoteError(null); }}
            aria-invalid={noteError ? true : undefined} aria-describedby={noteError ? 'note-error' : undefined} />
          {noteError ? <p id="note-error" className="field-error" role="alert">{noteError}</p> : null}
        </div>
      ) : null}
      {canDecide && outcomes.includes('REFUND_PARTIAL') ? (
        <div className="field section">
          <label className="field-label" htmlFor="partial">{t('litiges.partialAmount')}</label>
          <input id="partial" ref={partialRef} className="input" inputMode="decimal" autoComplete="off" value={partial}
            placeholder={formatAmountInput(remainingMinor, row.currency as Currency, 'fr')}
            onChange={(e) => { setPartial(e.target.value); if (partialError) setPartialError(null); }}
            aria-invalid={partialError ? true : undefined} aria-describedby={partialError ? 'partial-error' : 'partial-help'} />
          <span id="partial-help" className="field-help">{t('litiges.partialHelp', { max: remaining })}</span>
          {partialError ? <p id="partial-error" className="field-error" role="alert">{partialError}</p> : null}
        </div>
      ) : null}
      {actionError ? <p className="banner err section" role="alert">{actionError}</p> : null}
      <ConfirmDialog open={outcome !== null} busy={busy} danger={outcome !== null && DANGER.has(outcome)} canConfirm={intentConfirmed}
        onCancel={() => setOutcome(null)} onConfirm={decide}
        title={outcome ? t(`litiges.confirmTitle.${outcome}`) : ''} confirmLabel={outcome ? t(`litiges.outcome.${outcome}`) : ''}>
        {outcome ? (
          <>
            <p>{t(outcome === 'NO_ACTION' && row.onHold ? 'litiges.confirm.NO_ACTION.onHold' : `litiges.confirm.${outcome}`, {
              seq: row.trancheSeq, amount, refund: partialMinor ? formatAmount(partialMinor, row.currency) : remaining,
            })}</p>
            <label className="checkbox" htmlFor="intent-check">
              <input id="intent-check" type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
              <span>{t('litiges.confirmCheck')}</span>
            </label>
            <div className="field">
              <label className="field-label" htmlFor="intent-word">{t('litiges.confirmTyped', { word })}</label>
              <input id="intent-word" className="input" value={typed} autoComplete="off" onChange={(e) => setTyped(e.target.value)} />
            </div>
          </>
        ) : null}
      </ConfirmDialog>
    </Panel>
  );
}
