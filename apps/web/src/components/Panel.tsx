'use client';
import { useEffect, useRef } from 'react';

import { t } from '@/i18n';

/**
 * Volet de détail (380 à 400 px à droite) : région nommée par son titre, focalisée à l’ouverture,
 * fermée par Échap (le focus revient à la ligne du tableau, géré par l’écran).
 */
export function Panel({ title, onClose, children, actions, openKey }: {
  title: string; onClose: () => void; children: React.ReactNode; actions?: React.ReactNode; openKey: string;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [openKey]);
  return (
    <aside className="panel" aria-labelledby="panel-title" onKeyDown={(e) => {
      // Échap ferme le volet, sauf dans une fenêtre de confirmation ou le visionneur (qui gèrent leur Échap).
      if (e.key === 'Escape' && !(e.target as HTMLElement).closest('dialog')) { e.preventDefault(); onClose(); }
    }}>
      <h2 id="panel-title" ref={heading} className="panel-title" tabIndex={-1}>{title}</h2>
      <p className="sr-only">{t('panel.escHelp')}</p>
      {children}
      <div className="panel-spacer" />
      {actions}
    </aside>
  );
}

export function PanelEmpty({ text }: { text: string }) {
  return <aside className="panel" aria-label={t('common.panelLabel')}><p className="panel-empty">{text}</p></aside>;
}

/** Lignes libellé / valeur. */
export function KV({ items }: { items: ReadonlyArray<[string, React.ReactNode] | null | false> }) {
  return (
    <dl className="kv">
      {items.filter((x): x is [string, React.ReactNode] => !!x).map(([k, v]) => (
        <div className="kv-row" key={k}><dt>{k}</dt><dd>{v}</dd></div>
      ))}
    </dl>
  );
}

export function Section({ title, children, id }: { title: string; children: React.ReactNode; id?: string }) {
  return <section className="section" aria-labelledby={id}><h3 id={id}>{title}</h3>{children}</section>;
}
