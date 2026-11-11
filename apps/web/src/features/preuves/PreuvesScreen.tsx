'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { evidenceDecisionError } from '@diaspay/domain';

import { ChecksList } from '@/components/Checks';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DataTable } from '@/components/DataTable';
import type { Column } from '@/components/DataTable';
import { DocumentList, Viewer } from '@/components/Documents';
import { ErrorState, LoadingRows } from '@/components/ErrorState';
import { KV, Panel, PanelEmpty, Section } from '@/components/Panel';
import { useStaff } from '@/components/StaffContext';
import { Status } from '@/components/Status';
import { Toast } from '@/components/Toast';
import { useLoad } from '@/hooks/useLoad';
import { useNow } from '@/hooks/useNow';
import { useRealtime } from '@/hooks/useRealtime';
import { errorMessage, t, tMaybe, tn } from '@/i18n';
import { decideEvidence, evidenceDetail, listEvidence, openDocument } from '@/lib/bo';
import type { DocumentInfo, EvidenceDetail, EvidenceRow } from '@/lib/bo';
import { formatAmount, formatTime, relativeTime } from '@/lib/format';
import { dossierTitle } from '@/lib/labels';

/**
 * Preuves de jalons (BO6) : tranches dont le prestataire a déposé une preuve (EVIDENCE_SUBMITTED), double
 * validation (RG-04), motif obligatoire au rejet. La pièce est affichée dans le volet (consultation journalisée).
 */
export function PreuvesScreen() {
  const staff = useStaff();
  const now = useNow();
  const list = useLoad(listEvidence, []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const reloadQuiet = useCallback(() => { void list.reload(true); }, [list]);
  useRealtime(['tranches'], reloadQuiet, 'preuves');

  const rows = useMemo(() => [...(list.data ?? [])].sort((a, b) => (a.submittedAt ?? '').localeCompare(b.submittedAt ?? '')), [list.data]);
  const selected = rows.find((r) => r.trancheId === selectedId) ?? null;

  function close(focusRow = true) {
    const id = selectedId;
    setSelectedId(null);
    if (focusRow && id) setFocusKey(id);
  }

  const columns: Array<Column<EvidenceRow>> = [
    { key: 'jalon', header: t('preuves.col.jalon'), render: (r) => <span className="cell-title">{r.label}</span> },
    { key: 'dossier', header: t('preuves.col.dossier'), render: (r) => dossierTitle(r) },
    { key: 'amount', header: t('preuves.col.amount'), numeric: true, render: (r) => <span className="amount">{formatAmount(r.amountMinor, r.currency)}</span> },
    { key: 'deposited', header: t('preuves.col.deposited'), render: (r) => <span className="muted">{relativeTime(r.submittedAt, now)}</span> },
    { key: 'validations', header: t('preuves.col.validations'), render: (r) => (
      <Status tone="pending">{t('dossiers.validations', { got: r.received, need: r.required })}</Status>
    ) },
  ];

  return (
    <div className="workspace">
      <main className="main" aria-labelledby="page-title">
        <div className="page-head">
          <h1 id="page-title">{t('preuves.title')}</h1>
          <p className="page-meta">{tn('preuves.count', rows.length)}</p>
        </div>
        {list.error && !list.data ? <ErrorState error={list.error} onRetry={() => void list.reload()} />
          : list.loading && !list.data ? <LoadingRows />
          : <DataTable caption={t('preuves.table')} rows={rows} columns={columns} rowKey={(r) => r.trancheId} selectedKey={selectedId}
              onOpen={(r) => { setSelectedId(r.trancheId); setFocusKey(null); }} focusKey={focusKey} empty={t('preuves.empty')} />}
      </main>
      {selected
        ? <EvidencePanel key={selected.trancheId} row={selected} staffName={staff.name} onClose={close}
            onDone={(m) => { setToast(m); close(false); void list.reload(true); }} onStale={() => void list.reload(true)} />
        : <PanelEmpty text={t('common.selectHint')} />}
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}

function EvidencePanel({ row, staffName, onClose, onDone, onStale }: {
  row: EvidenceRow; staffName: string; onClose: () => void; onDone: (m: string) => void; onStale: () => void;
}) {
  const detail = useLoad<EvidenceDetail>(() => evidenceDetail(row.txId, row.trancheId), [row.trancheId, row.received]);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'approve' | 'reject' | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const amount = formatAmount(row.amountMinor, row.currency);
  const readOnly = row.isParty ? t('preuves.isParty') : row.decidedByMe ? t('dossiers.alreadyDecided') : null;
  const d = detail.data;

  function askReject() {
    if (evidenceDecisionError({ approved: false, reason })) { setReasonError(t('common.reasonRequired')); reasonRef.current?.focus(); return; }
    setReasonError(null);
    setConfirm('reject');
  }

  async function decide() {
    if (!confirm) return;
    setBusy(true);
    setActionError(null);
    try {
      const approved = confirm === 'approve';
      const status = await decideEvidence(row.trancheId, { approved, reason: approved ? undefined : reason });
      setConfirm(null);
      onDone(!approved ? t('preuves.doneRejected', { title: row.label }) : status === 'EVIDENCE_SUBMITTED' ? t('preuves.donePartial', { title: row.label }) : t('preuves.doneApproved', { title: row.label }));
    } catch (e) {
      setConfirm(null);
      setActionError(errorMessage(e));
      const code = (e as { code?: string }).code;
      if (code === 'NO_EVIDENCE_PENDING' || code === 'ALREADY_DECIDED') onStale();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={row.label} onClose={onClose} openKey={row.trancheId} actions={readOnly ? null : (
      <div className="panel-actions">
        <button type="button" className="btn btn-danger" onClick={askReject} disabled={busy}>{t('common.reject')}</button>
        <button type="button" className="btn btn-primary" onClick={() => setConfirm('approve')} disabled={busy}>{t('common.approve')}</button>
      </div>
    )}>
      <KV items={[
        [t('preuves.dossier'), dossierTitle(row)],
        [t('dossiers.col.amount'), <span className="amount" key="a">{amount}</span>],
        [t('dossiers.provider'), row.providerName ?? t('common.none')],
        [t('dossiers.reference'), <span className="mono" key="r">{row.reference}</span>],
      ]} />
      {readOnly ? <p className="note-warn" role="note">{readOnly}</p> : null}
      {detail.error ? <ErrorState error={detail.error} onRetry={() => void detail.reload()} /> : null}
      {!d && !detail.error ? <LoadingRows /> : null}
      {d ? (
        <>
          {d.documents[0] ? <EvidencePreview doc={d.documents[0]} /> : null}
          {d.documents.length > 1 ? <Section title={t('dossiers.documents')} id="sec-docs"><DocumentList documents={d.documents.slice(1)} label={t('dossiers.documents')} /></Section> : null}
          <Section title={tn('dossiers.decisions', row.required)} id="sec-decisions">
            <ul className="lines decisions">
              {d.decisions.map((v) => (
                <li key={v.validatorId + v.decidedAt}>
                  <span className="who"><span className={`dot ${v.approved ? 'active' : 'error'}`} aria-hidden="true" />{v.isMe ? `${t('common.you')} (${v.validatorName})` : v.validatorName}</span>
                  <span className="muted">{t(v.approved ? 'dossiers.decidedAt' : 'dossiers.rejectedAt', { time: formatTime(v.decidedAt) })}</span>
                </li>
              ))}
              {!row.isParty && !row.decidedByMe ? (
                <li><span className="who"><span className="dot pending" aria-hidden="true" />{t('dossiers.youPending', { name: staffName })}</span><span className="muted">{t('dossiers.pending')}</span></li>
              ) : null}
            </ul>
          </Section>
          <Section title={t('dossiers.checks')} id="sec-checks"><ChecksList checks={d.checks} currency={row.currency} /></Section>
        </>
      ) : null}
      {!readOnly ? (
        <div className="field section">
          <label className="field-label" htmlFor="reason">{t('common.reasonLabel')}</label>
          <textarea id="reason" ref={reasonRef} className="textarea" value={reason} maxLength={500}
            onChange={(e) => { setReason(e.target.value); if (reasonError) setReasonError(null); }}
            aria-invalid={reasonError ? true : undefined} aria-describedby={reasonError ? 'reason-error' : undefined} />
          {reasonError ? <p id="reason-error" className="field-error" role="alert">{reasonError}</p> : null}
        </div>
      ) : null}
      {actionError ? <p className="banner err section" role="alert">{actionError}</p> : null}
      <ConfirmDialog open={confirm !== null} busy={busy} danger={confirm === 'reject'} onCancel={() => setConfirm(null)} onConfirm={decide}
        title={confirm === 'reject' ? t('preuves.confirmRejectTitle') : t('preuves.confirmApproveTitle')}
        confirmLabel={confirm === 'reject' ? t('common.reject') : t('common.approve')}>
        <p>{confirm === 'reject' ? t('preuves.confirmReject', { title: row.label, reason: reason.trim() }) : t('preuves.confirmApprove', { title: row.label, amount })}</p>
      </ConfirmDialog>
    </Panel>
  );
}

/** Aperçu de la preuve dans le volet (consultation journalisée par la base), agrandissable dans le visionneur. */
function EvidencePreview({ doc }: { doc: DocumentInfo }) {
  const [opened, setOpened] = useState<{ url: string; name: string; mimeType: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [big, setBig] = useState(false);
  const enlarge = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    openDocument(doc.id).then((o) => { url = o.url; if (!cancelled) setOpened(o); else URL.revokeObjectURL(o.url); }, (e) => { if (!cancelled) setError(errorMessage(e)); });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [doc.id]);
  const kind = tMaybe(`doc.${doc.kind}`) ?? doc.kind;
  return (
    <section className="preview" aria-label={t('preuves.evidence')}>
      {opened ? (opened.mimeType === 'application/pdf'
        ? <iframe src={opened.url} title={opened.name} />
        : <img src={opened.url} alt={opened.name} />)
        : error ? <p className="inline-error" role="alert">{error}</p> : <span className="skeleton" />}
      <div className="preview-caption">
        <span>{t('preuves.page', { name: doc.name, kind })}</span>
        {opened ? <button ref={enlarge} type="button" className="btn-link" onClick={() => setBig(true)}>{t('preuves.enlarge')}</button> : null}
      </div>
      <Viewer doc={big ? opened : null} onClose={() => { setBig(false); requestAnimationFrame(() => enlarge.current?.focus()); }} />
    </section>
  );
}
