#!/usr/bin/env bash
# Outils base de données pour le projet Supabase lié (supabase link). Lit .env.local ; n’affiche jamais le mot de passe.
#
#   scripts/db.sh test            # exécute supabase/tests/NN_*.sql (00_smoke, 01_lot4, 02_lot5…) : échoue au moindre FAIL
#   scripts/db.sh test-editor     # exécute leurs variantes pour l’éditeur SQL (NN_*_editor.sql) : attend « RESULTAT »
#   scripts/db.sh seed-staff      # comptes du personnel de test (e-mail, mot de passe E2E_STAFF_PASSWORD) : développement seulement
#   scripts/db.sh seed-evidence [tx] # dossier terrain avec une preuve de jalon en attente (écran Preuves) : développement seulement
#   scripts/db.sh push            # applique les nouvelles migrations (supabase db push)
#   scripts/db.sh seed            # comptes et prestataires de démonstration (refusé si mock_mode <> 'true')
#   scripts/db.sh psql [args…]    # console psql sur le projet lié
#   scripts/db.sh types           # régénère packages/api-client/src/supabase/database.types.ts (jamais édité à la main)
#
# Connexion par le pooler en mode session (supabase/.temp/pooler-url, écrit par `supabase link`) :
# la connexion directe db.<ref>.supabase.co n’est joignable qu’en IPv6 sur l’offre gratuite.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env.local ] || { echo "Fichier .env.local absent (voir .env.example et docs/supabase-setup.md)." >&2; exit 1; }
set -a; . ./.env.local; set +a
: "${SUPABASE_DB_PASSWORD:?SUPABASE_DB_PASSWORD manquant dans .env.local}"
[ -f supabase/.temp/pooler-url ] || { echo "Projet non lié : supabase link --project-ref <ref>" >&2; exit 1; }

PSQL="$(command -v psql || echo /opt/homebrew/opt/libpq/bin/psql)"
POOLER="$(cat supabase/.temp/pooler-url)"
export PGPASSWORD="$SUPABASE_DB_PASSWORD"
DB_URL="$(python3 -c "import os,sys,urllib.parse; u=sys.argv[1]; print(u.replace('@', ':' + urllib.parse.quote(os.environ['SUPABASE_DB_PASSWORD'], safe='') + '@', 1))" "$POOLER")"

run_sql() {
  # Affiche les lignes PASS/FAIL et le résumé ; code de sortie non nul au moindre échec. Arguments suivants : options psql.
  local f="$1"; shift
  "$PSQL" "$POOLER" -v ON_ERROR_STOP=1 -q "$@" -f "$f" 2>&1 | sed -E 's/^psql:[^ ]+ //; s/^(NOTICE|ERROR):  //'
  return "${PIPESTATUS[0]}"
}

case "${1:-}" in
  test)
    status=0
    node scripts/sql-editor-variant.mjs --check || status=1
    for f in $(ls supabase/tests/[0-9][0-9]_*.sql | grep -v '_editor\.sql$'); do
      echo "== $f"
      if [ "${VERBOSE:-0}" = 1 ]; then run_sql "$f" || status=1
      else
        out="$(run_sql "$f")" && rc=0 || rc=$?
        printf '%s\n' "$out" | grep -E "FAIL|RESULTAT|ECHEC" || true
        if [ "$rc" != 0 ]; then status=1; echo "-- arrêt sur erreur :"; printf '%s\n' "$out" | tail -8; fi
      fi
    done
    exit $status ;;
  test-editor)
    # Les variantes se terminent toujours par une erreur (qui annule le test) : on attend le message RESULTAT.
    status=0
    for f in supabase/tests/[0-9][0-9]_*_editor.sql; do
      echo "== $f"
      out="$("$PSQL" "$POOLER" -q -f "$f" 2>&1 || true)"
      if printf '%s\n' "$out" | grep -q "RESULTAT :"; then printf '%s\n' "$out" | grep -o "RESULTAT :.*"
      else status=1; printf '%s\n' "$out" | grep -E "ECHEC|ERROR" | tail -5; fi
    done
    exit $status ;;
  seed-staff)
    : "${E2E_STAFF_PASSWORD:?E2E_STAFF_PASSWORD manquant dans .env.local (mot de passe des comptes du personnel de test)}"
    "$PSQL" "$POOLER" -v ON_ERROR_STOP=1 -q -v staff_password="$E2E_STAFF_PASSWORD" -f supabase/seed-staff.sql 2>&1 | sed -E 's/^psql:[^ ]+ //; s/^(NOTICE|ERROR):  //'
    exit "${PIPESTATUS[0]}" ;;
  seed-evidence)
    if [ -n "${2:-}" ]; then run_sql supabase/seed-evidence.sql -v tx="$2"; else run_sql supabase/seed-evidence.sql; fi ;;
  push) supabase db push --db-url "$DB_URL" ;;
  seed) run_sql supabase/seed.sql ;;
  types)
    out=packages/api-client/src/supabase/database.types.ts
    mkdir -p "$(dirname "$out")"
    { echo "// Fichier généré par \`pnpm db:types\` (supabase gen types) : ne pas modifier à la main."; supabase gen types typescript --db-url "$DB_URL" --schema public; } > "$out.tmp" && mv "$out.tmp" "$out"
    echo "Types écrits dans $out" ;;
  psql) shift; exec "$PSQL" "$POOLER" "$@" ;;
  *) sed -n '2,14p' "$0"; exit 2 ;;
esac
