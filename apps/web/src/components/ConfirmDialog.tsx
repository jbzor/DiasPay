'use client';
import { useEffect, useRef } from 'react';

import { t } from '@/i18n';

/**
 * Fenêtre de confirmation (élément <dialog> natif : focus piégé, Échap pour annuler). Le focus va d’abord
 * sur « Annuler » : une décision ne part jamais sur un appui involontaire.
 */
export function ConfirmDialog({ open, title, children, confirmLabel, danger, busy, canConfirm = true, onConfirm, onCancel }: {
  open: boolean; title: string; children: React.ReactNode; confirmLabel: string; danger?: boolean; busy?: boolean; canConfirm?: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) { d.showModal(); cancel.current?.focus(); }
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="modal" aria-labelledby="confirm-title" onCancel={(e) => { e.preventDefault(); if (!busy) onCancel(); }}>
      <h2 id="confirm-title">{title}</h2>
      {children}
      <div className="modal-actions">
        <button ref={cancel} type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>{t('common.cancel')}</button>
        <button type="button" className={danger ? 'btn btn-danger' : 'btn btn-primary'} onClick={onConfirm} disabled={busy || !canConfirm}>{confirmLabel}</button>
      </div>
    </dialog>
  );
}
