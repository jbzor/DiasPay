'use client';
import { useEffect, useRef, useState } from 'react';

import { errorMessage, t, tMaybe } from '@/i18n';
import { openDocument } from '@/lib/bo';
import type { DocumentInfo } from '@/lib/bo';
import { formatSize } from '@/lib/format';

interface Opened { url: string; name: string; mimeType: string }

/**
 * Pièces d’un dossier : « Voir » ouvre la pièce dans un visionneur intégré (PDF et images), à partir d’une URL
 * signée de courte durée ; chaque ouverture est journalisée par la base (DOCUMENT_VIEWED).
 */
export function DocumentList({ documents, label }: { documents: readonly DocumentInfo[]; label: string }) {
  const [opened, setOpened] = useState<Opened | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);

  async function view(doc: DocumentInfo, button: HTMLButtonElement) {
    if (busy) return;
    opener.current = button;
    setBusy(doc.id);
    setError(null);
    try { setOpened(await openDocument(doc.id)); } catch (e) { setError(errorMessage(e)); } finally { setBusy(null); }
  }

  function close() {
    if (opened) URL.revokeObjectURL(opened.url);
    setOpened(null);
    // Après la fermeture effective de la fenêtre (qui rend elle-même le focus), retour au bouton « Voir ».
    requestAnimationFrame(() => opener.current?.focus());
  }

  if (documents.length === 0) return <p className="muted">{t('dossiers.noDocument')}</p>;
  return (
    <>
      <ul className="lines" aria-label={label}>
        {documents.map((d) => (
          <li key={d.id}>
            <span className="grow">
              {d.name}
              <span className="cell-sub">{tMaybe(`doc.${d.kind}`) ?? d.kind} · {formatSize(d.sizeBytes)}</span>
            </span>
            <button type="button" className="btn-link" aria-label={`${t('common.view')} ${d.name}`} aria-busy={busy === d.id || undefined}
              onClick={(e) => view(d, e.currentTarget)}>{busy === d.id ? t('common.loading') : t('common.view')}</button>
          </li>
        ))}
      </ul>
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
      <Viewer doc={opened} onClose={close} />
    </>
  );
}

/** Visionneur intégré (fenêtre modale) : PDF dans un cadre, image ajustée. */
export function Viewer({ doc, onClose }: { doc: Opened | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (doc && !d.open) d.showModal();
    if (!doc && d.open) d.close();
  }, [doc]);
  return (
    <dialog ref={ref} className="viewer" aria-label={doc?.name ?? t('viewer.title')} onCancel={(e) => { e.preventDefault(); onClose(); }}>
      {doc ? (
        <div className="viewer-inner">
          <div className="viewer-head">
            <strong>{doc.name}</strong>
            <button type="button" className="btn btn-secondary" onClick={onClose} autoFocus>{t('common.close')}</button>
          </div>
          <div className="viewer-body">
            {doc.mimeType === 'application/pdf'
              ? <iframe src={doc.url} title={doc.name} />
              : <img src={doc.url} alt={doc.name} />}
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
