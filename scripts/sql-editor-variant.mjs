#!/usr/bin/env node
// Génère la variante « éditeur SQL » de chaque test supabase/tests/NN_*.sql (NN_*_editor.sql).
// L’éditeur SQL de Supabase n’affiche pas les NOTICE (lignes PASS / FAIL) : la variante rend le résultat sous la forme
// d’une erreur finale, toujours levée, qui annule aussi tout le test (rien n’est conservé) :
//   « RESULTAT : N vérifications, toutes réussies… » ou « ECHEC : k vérification(s) sur N : » suivi des libellés en échec.
//
//   node scripts/sql-editor-variant.mjs           # (ré)écrit les variantes
//   node scripts/sql-editor-variant.mjs --check   # échoue si une variante n’est pas à jour (appelé par scripts/db.sh test)
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'tests');
const MARK = '-- ---------- Résumé';
const SUMMARY = `-- ---------- Résumé (éditeur SQL) ----------
-- Le résultat est rendu par une erreur, toujours levée : elle s’affiche dans l’éditeur et annule tout le test.
do $$
declare total int; bad int; failed text;
begin
  select count(*), count(*) filter (where not ok), string_agg(n || '. ' || label, ' | ' order by n) filter (where not ok)
    into total, bad, failed from t.results;
  if bad > 0 then raise exception 'ECHEC : % vérification(s) sur % : %', bad, total, failed; end if;
  raise exception 'RESULTAT : % vérifications, toutes réussies (test annulé : rien n’est conservé)', total;
end $$;
`;

export function variant(name, sql) {
  const i = sql.indexOf(MARK);
  if (i < 0) throw new Error(`${name} : bloc « Résumé » introuvable`);
  const head = `-- VARIANTE POUR L’ÉDITEUR SQL DE SUPABASE, générée depuis ${name} par scripts/sql-editor-variant.mjs : ne pas modifier.\n`
    + '-- Coller tout le fichier dans l’éditeur et exécuter : lire le message d’erreur final (RESULTAT ou ECHEC).\n';
  return head + sql.slice(0, i) + SUMMARY;
}

const check = process.argv.includes('--check');
let stale = 0;
for (const f of readdirSync(dir).filter((x) => /^\d\d_.*\.sql$/.test(x) && !x.endsWith('_editor.sql')).sort()) {
  const out = join(dir, f.replace(/\.sql$/, '_editor.sql'));
  const content = variant(f, readFileSync(join(dir, f), 'utf8'));
  if (check) {
    if (!existsSync(out) || readFileSync(out, 'utf8') !== content) { console.error(`Variante éditeur périmée : ${out} (node scripts/sql-editor-variant.mjs)`); stale++; }
  } else {
    writeFileSync(out, content);
    console.log(`écrit ${out}`);
  }
}
process.exit(stale ? 1 : 0);
