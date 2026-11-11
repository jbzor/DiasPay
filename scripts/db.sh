#!/usr/bin/env bash
# Outils base de données pour le projet Supabase lié (supabase link). Lit .env.local ; n’affiche jamais le mot de passe.
#
#   scripts/db.sh test            # exécute supabase/tests/NN_*.sql (00_smoke, 01_lot4…) : échoue au moindre FAIL
#   scripts/db.sh push            # applique les nouvelles migrations (supabase db push)
#   scripts/db.sh seed            # comptes et prestataires de démonstration (refusé si mock_mode <> 'true')
#   scripts/db.sh psql [args…]    # console psql sur le projet lié
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
  # Affiche les lignes PASS/FAIL et le résumé ; code de sortie non nul au moindre échec.
  "$PSQL" "$POOLER" -v ON_ERROR_STOP=1 -q -f "$1" 2>&1 | sed -E 's/^psql:[^ ]+ //; s/^(NOTICE|ERROR):  //'
  return "${PIPESTATUS[0]}"
}

case "${1:-}" in
  test)
    status=0
    for f in supabase/tests/[0-9][0-9]_*.sql; do
      echo "== $f"
      if [ "${VERBOSE:-0}" = 1 ]; then run_sql "$f" || status=1
      else run_sql "$f" | grep -E "FAIL|RESULTAT|ECHEC|ERROR|ERREUR" || true; [ "${PIPESTATUS[0]}" = 0 ] || status=1; fi
    done
    exit $status ;;
  push) supabase db push --db-url "$DB_URL" ;;
  seed) run_sql supabase/seed.sql ;;
  psql) shift; exec "$PSQL" "$POOLER" "$@" ;;
  *) sed -n '2,9p' "$0"; exit 2 ;;
esac
