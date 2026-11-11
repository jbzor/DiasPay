'use client';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { t } from '@/i18n';

export interface Column<R> {
  key: string;
  header: string;
  numeric?: boolean;
  render: (row: R) => ReactNode;
  /** Tri proposé sur cette colonne (en-tête cliquable, aria-sort). */
  sortable?: boolean;
}

interface Props<R> {
  caption: string;
  rows: readonly R[];
  columns: ReadonlyArray<Column<R>>;
  rowKey: (row: R) => string;
  selectedKey: string | null;
  onOpen: (row: R) => void;
  empty: string;
  sort?: { key: string; dir: 'ascending' | 'descending' };
  onSort?: (key: string) => void;
  /** Ligne à focaliser (retour depuis le volet de détail). */
  focusKey?: string | null;
}

/**
 * Tableau à filets (vrai <table>), navigable au clavier : une seule ligne dans l’ordre de tabulation,
 * flèches haut et bas (Début, Fin) pour parcourir, Entrée ou Espace pour ouvrir le détail.
 */
export function DataTable<R>({ caption, rows, columns, rowKey, selectedKey, onOpen, empty, sort, onSort, focusKey }: Props<R>) {
  const body = useRef<HTMLTableSectionElement>(null);
  const [active, setActive] = useState(0);
  const keys = rows.map(rowKey);
  const activeIndex = Math.min(active, Math.max(rows.length - 1, 0));

  useEffect(() => {
    if (!focusKey) return;
    const i = keys.indexOf(focusKey);
    if (i >= 0) { setActive(i); body.current?.querySelectorAll<HTMLTableRowElement>('tr')[i]?.focus(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey]);

  function focusRow(i: number) {
    const target = Math.max(0, Math.min(rows.length - 1, i));
    setActive(target);
    body.current?.querySelectorAll<HTMLTableRowElement>('tr')[target]?.focus();
  }

  function onKey(e: React.KeyboardEvent, i: number, row: R) {
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); focusRow(i + 1); break;
      case 'ArrowUp': e.preventDefault(); focusRow(i - 1); break;
      case 'Home': e.preventDefault(); focusRow(0); break;
      case 'End': e.preventDefault(); focusRow(rows.length - 1); break;
      case 'Enter': case ' ': e.preventDefault(); onOpen(row); break;
      default: break;
    }
  }

  return (
    <table className="grid">
      <caption className="sr-only">{caption}. {t('table.keyboardHelp')}</caption>
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.key} scope="col" className={c.numeric ? 'num' : undefined}
              aria-sort={sort && sort.key === c.key ? sort.dir : undefined}>
              {c.sortable && onSort
                ? <button type="button" className="sort" onClick={() => onSort(c.key)}>{c.header}{sort?.key === c.key ? (sort.dir === 'ascending' ? ' ↑' : ' ↓') : ''}</button>
                : c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody ref={body}>
        {rows.length === 0 ? (
          <tr><td colSpan={columns.length} className="table-empty">{empty}</td></tr>
        ) : rows.map((row, i) => {
          const k = rowKey(row);
          return (
            <tr key={k} tabIndex={i === activeIndex ? 0 : -1} aria-current={k === selectedKey ? 'true' : undefined}
              data-key={k} onClick={() => { setActive(i); onOpen(row); }} onKeyDown={(e) => onKey(e, i, row)} onFocus={() => setActive(i)}>
              {columns.map((c) => <td key={c.key} className={c.numeric ? 'num' : undefined}>{c.render(row)}</td>)}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
