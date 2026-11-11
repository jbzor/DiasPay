'use client';
import { useCallback, useMemo, useRef, useState } from 'react';
import { validatorDecisionError } from '@diaspay/domain';

import { ChecksList } from '@/components/Checks';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DataTable } from '@/components/DataTable';
import type { Column } from '@/components/DataTable';
import { DocumentList } from '@/components/Documents';
import { ErrorState, LoadingRows } from '@/components/ErrorState';
import { KV, Panel, PanelEmpty, Section } from '@/components/Panel';
import { useStaff } from '@/components/StaffContext';
import { Status } from '@/components/Status';
import { Toast } from '@/components/Toast';
import { useLoad } from '@/hooks/useLoad';
import { useNow } from '@/hooks/useNow';
import { useRealtime } from '@/hooks/useRealtime';
import { errorMessage, t, tMaybe, tn } from '@/i18n';
import { claimDossier, decideDossier, dossierDetail, listDossiers } from '@/lib/bo';
import type { DossierDetail, DossierRow } from '@/lib/bo';
import { formatAmount, formatDate, formatTime, relativeTime } from '@/lib/format';
import { includesFolded } from '@/lib/search';
import { dossierTitle } from '@/lib/labels';

const VERTICALS = ['EDUCATION', 'HEALTH', 'RENT', 'AGRO', 'REAL_ESTATE', 'LAND'] as const;

/**
 * Dossiers à valider (BO1). Liste des dossiers soumis ou en validation, du plus ancien au plus récent ; volet de
 * détail avec pièces, contrôles automatiques (D6), case de vérification du montant, motif de rejet, décision.
 * Ouvrir un dossier le prend en charge (D8).
 */
export function DossiersScreen() {
  const staff = useStaff();
  const now = useNow();
  const list = useLoad(listDossiers, []);
  const [vertical, setVertical] = useState('');
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [dir, setDir] = useState<'ascending' | 'descending'>('ascending');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const reloadQuiet = useCallback(() => { void list.reload(true); }, [list]);
  useRealtime(['transactions'], reloadQuiet, 'dossiers');

  const rows = useMemo(() => {
    const all = list.data ?? [];
    const filtered = all.filter((r) => (!vertical || r.vertical === vertical) && (!status || r.status === status)
      && (!query.trim() || includesFolded([r.purpose, r.reference, r.requesterName, r.payerName, r.providerName, r.beneficiaryName], query)));
    const sorted = [...filtered].sort((a, b) => (a.submittedAt ?? '').localeCompare(b.submittedAt ?? ''));
    return dir === 'ascending' ? sorted : sorted.reverse();
  }, [list.data, vertical, status, query, dir]);
  const selected = (list.data ?? []).find((r) => r.id === selectedId) ?? null;
  const dualCount = (list.data ?? []).filter((r) => r.required > 1).length;

  async function open(row: DossierRow) {
    setSelectedId(row.id);
    setFocusKey(null);
    if (row.status === 'SUBMITTED' && !row.isParty) {
      try { await claimDossier(row.id); await list.reload(true); } catch { /* lecture seule : expliquée dans le volet */ }
    }
  }

  function close(focusRow = true) {
    const id = selectedId;
    setSelectedId(null);
    if (focusRow && id) setFocusKey(id);
  }

  const columns: Array<Column<DossierRow>> = [
    { key: 'dossier', header: t('dossiers.col.dossier'), render: (r) => <span className="cell-title">{dossierTitle(r)}</span> },
    { key: 'amount', header: t('dossiers.col.amount'), numeric: true, render: (r) => <span className="amount">{formatAmount(r.amountMinor, r.currency)}</span> },
    { key: 'received', header: t('dossiers.col.received'), sortable: true, render: (r) => <span className="muted">{relativeTime(r.submittedAt, now)}</span> },
    { key: 'validations', header: t('dossiers.col.validations'), render: (r) => (
      <Status tone={r.received >= r.required ? 'active' : 'pending'}>{t('dossiers.validations', { got: r.received, need: r.required })}</Status>
    ) },
  ];

  return (
    <div className="workspace">
      <main className="main" aria-labelledby="page-title">
        <div className="page-head">
          <h1 id="page-title">{t('dossiers.title')}</h1>
          <p className="page-meta">{tn('dossiers.count', list.data?.length ?? 0, { d: dualCount })}</p>
        </div>
        <div className="toolbar" role="search">
          <div className="field">
            <label className="field-label" htmlFor="f-vertical">{t('dossiers.filterVertical')}</label>
            <select id="f-vertical" className="select" value={vertical} onChange={(e) => setVertical(e.target.value)}>
              <option value="">{t('common.allF')}</option>
              {VERTICALS.map((v) => <option key={v} value={v}>{t(`vertical.${v}`)}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="f-status">{t('dossiers.filterStatus')}</label>
            <select id="f-status" className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t('common.all')}</option>
              <option value="SUBMITTED">{t('txStatus.SUBMITTED')}</option>
              <option value="IN_REVIEW">{t('txStatus.IN_REVIEW')}</option>
            </select>
          </div>
          <div className="field search">
            <label className="field-label" htmlFor="f-query">{t('common.search')}</label>
            <input id="f-query" className="input" type="search" value={query} placeholder={t('dossiers.search')} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <span className="live" aria-hidden="true"><span className="dot active" />{t('common.live')}</span>
        </div>
        {list.error && !list.data ? <ErrorState error={list.error} onRetry={() => void list.reload()} />
          : list.loading && !list.data ? <LoadingRows />
          : (
            <DataTable caption={t('dossiers.table')} rows={rows} columns={columns} rowKey={(r) => r.id} selectedKey={selectedId}
              onOpen={open} focusKey={focusKey} empty={(list.data?.length ?? 0) === 0 ? t('dossiers.empty') : t('dossiers.emptyFiltered')}
              sort={{ key: 'received', dir }} onSort={() => setDir((d) => (d === 'ascending' ? 'descending' : 'ascending'))} />
          )}
      </main>
      {selected
        ? <DossierPanel key={selected.id} row={selected} staffName={staff.name} onClose={close}
            onDone={(message) => { setToast(message); close(false); void list.reload(true); }}
            onStale={() => void list.reload(true)} />
        : <PanelEmpty text={t('common.selectHint')} />}
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}

function DossierPanel({ row, staffName, onClose, onDone, onStale }: {
  row: DossierRow; staffName: string; onClose: () => void; onDone: (message: string) => void; onStale: () => void;
}) {
  const detail = useLoad<DossierDetail>(() => dossierDetail(row.id), [row.id, row.status, row.received]);
  const [amountChecked, setAmountChecked] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'approve' | 'reject' | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const title = dossierTitle(row);
  const amount = formatAmount(row.amountMinor, row.currency);

  // Un dossier SUBMITTED est en cours de prise en charge (D8) : les contrôles sont affichés tout de suite, la base
  // refusera une décision si la prise en charge échoue.
  const readOnly = row.isParty ? t('dossiers.isParty') : row.decidedByMe ? t('dossiers.alreadyDecided')
    : row.status !== 'IN_REVIEW' && row.status !== 'SUBMITTED' ? t('dossiers.notInReview') : null;
  const canApprove = !readOnly && validatorDecisionError({ approved: true, amountChecked }) === null;

  function askReject() {
    const err = validatorDecisionError({ approved: false, amountChecked, reason });
    if (err) { setReasonError(t('common.reasonRequired')); reasonRef.current?.focus(); return; }
    setReasonError(null);
    setConfirm('reject');
  }

  async function decide() {
    if (!confirm) return;
    setBusy(true);
    setActionError(null);
    try {
      const approved = confirm === 'approve';
      // Prise en charge d’abord (sans effet si elle a déjà eu lieu) : la décision suit toujours SUBMITTED → IN_REVIEW.
      if (row.status === 'SUBMITTED') await claimDossier(row.id);
      const result = await decideDossier(row.id, { approved, amountChecked, reason: approved ? undefined : reason });
      setConfirm(null);
      onDone(!approved ? t('dossiers.doneRejected', { title }) : result === 'IN_REVIEW' ? t('dossiers.donePartial', { title }) : t('dossiers.doneApproved', { title }));
    } catch (e) {
      setConfirm(null);
      setActionError(errorMessage(e));
      const code = (e as { code?: string }).code;
      if (code === 'NOT_IN_REVIEW' || code === 'ALREADY_DECIDED' || code === 'VALIDATOR_IS_PARTY') onStale();
    } finally {
      setBusy(false);
    }
  }

  const d = detail.data;
  const pendingMine = !row.isParty && !row.decidedByMe && row.received < row.required;
  const releaseMode = d?.tranches[0];

  return (
    <Panel title={title} onClose={onClose} openKey={row.id} actions={readOnly ? null : (
      <div className="panel-actions">
        <button type="button" className="btn btn-danger" onClick={askReject} disabled={busy}>{t('common.reject')}</button>
        <button type="button" className="btn btn-primary" onClick={() => setConfirm('approve')} disabled={busy || !canApprove}
          aria-describedby="amount-check-help">{t('common.approve')}</button>
      </div>
    )}>
      <KV items={[
        [t('dossiers.col.amount'), <span className="amount" key="a">{amount}</span>],
        [t('dossiers.requester'), row.requesterName ?? t('common.none')],
        [t('dossiers.payer'), row.payerName ?? t('common.none')],
        [t('dossiers.provider'), row.providerName ?? t('common.none')],
        row.beneficiaryName ? [t('dossiers.beneficiary'), row.beneficiaryName] : null,
        [t('dossiers.reference'), <span className="mono" key="r">{row.reference}</span>],
        [t('dossiers.validation'), t('dossiers.validationsLong', { got: row.received, need: row.required })],
      ]} />
      {readOnly ? <p className="note-warn" role="note">{readOnly}</p> : null}
      {detail.error ? <ErrorState error={detail.error} onRetry={() => void detail.reload()} /> : null}
      {!d && !detail.error ? <LoadingRows /> : null}
      {d ? (
        <>
          <Section title={t('dossiers.plan')} id="sec-plan">
            <ul className="lines">
              {d.tranches.map((tr) => (
                <li key={tr.id} className="plan-line">
                  <span className="grow">{t('dossiers.trancheLine', { seq: tr.seq, label: tr.label })}
                    <span className="cell-sub">{tr.dueDate ? t('dossiers.dueOn', { date: formatDate(tr.dueDate) }) : t('dossiers.milestone')}</span></span>
                  <span className="amount">{formatAmount(tr.amountMinor, row.currency)}</span>
                </li>
              ))}
            </ul>
          </Section>
          {releaseMode ? (
            <Section title={t('dossiers.releaseRule')} id="sec-rule">
              <p className="muted">{tMaybe(`releaseMode.${releaseMode.releaseMode}`, { h: releaseMode.contestHours }) ?? releaseMode.releaseMode}</p>
            </Section>
          ) : null}
          <Section title={t('dossiers.documents')} id="sec-docs">
            <DocumentList documents={d.documents} label={t('dossiers.documents')} />
          </Section>
          <Section title={t('dossiers.checks')} id="sec-checks">
            <ChecksList checks={d.checks} currency={row.currency} />
          </Section>
          <Section title={tn('dossiers.decisions', row.required)} id="sec-decisions">
            <ul className="lines decisions">
              {d.decisions.map((v) => (
                <li key={v.validatorId + v.decidedAt}>
                  <span className="who"><span className={`dot ${v.approved ? 'active' : 'error'}`} aria-hidden="true" />{v.isMe ? `${t('common.you')} (${v.validatorName})` : v.validatorName}</span>
                  <span className="muted">{t(v.approved ? 'dossiers.decidedAt' : 'dossiers.rejectedAt', { time: formatTime(v.decidedAt) })}</span>
                </li>
              ))}
              {pendingMine ? (
                <li><span className="who"><span className="dot pending" aria-hidden="true" />{t('dossiers.youPending', { name: staffName })}</span><span className="muted">{t('dossiers.pending')}</span></li>
              ) : null}
            </ul>
          </Section>
        </>
      ) : null}
      {!readOnly ? (
        <>
          <label className="checkbox section" htmlFor="amount-check">
            <input id="amount-check" type="checkbox" checked={amountChecked} onChange={(e) => setAmountChecked(e.target.checked)} />
            <span>{t('dossiers.amountCheck')}</span>
            <span id="amount-check-help" className="field-help">{t('dossiers.amountCheckHelp')}</span>
          </label>
          <div className="field section">
            <label className="field-label" htmlFor="reason">{t('common.reasonLabel')}</label>
            <textarea id="reason" ref={reasonRef} className="textarea" value={reason} maxLength={500}
              onChange={(e) => { setReason(e.target.value); if (reasonError) setReasonError(null); }}
              aria-invalid={reasonError ? true : undefined} aria-describedby={reasonError ? 'reason-error' : undefined} />
            {reasonError ? <p id="reason-error" className="field-error" role="alert">{reasonError}</p> : null}
          </div>
        </>
      ) : null}
      {actionError ? <p className="banner err section" role="alert">{actionError}</p> : null}
      <ConfirmDialog open={confirm !== null} busy={busy} danger={confirm === 'reject'} onCancel={() => setConfirm(null)} onConfirm={decide}
        title={confirm === 'reject' ? t('dossiers.confirmRejectTitle') : t('dossiers.confirmApproveTitle')}
        confirmLabel={confirm === 'reject' ? t('common.reject') : t('common.approve')}>
        <p>{confirm === 'reject' ? t('dossiers.confirmReject', { title, reason: reason.trim() })
          : row.received + 1 < row.required ? t('dossiers.confirmApprovePartial', { title, amount }) : t('dossiers.confirmApprove', { title, amount })}</p>
      </ConfirmDialog>
    </Panel>
  );
}

