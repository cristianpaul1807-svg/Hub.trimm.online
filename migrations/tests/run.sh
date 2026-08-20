#!/usr/bin/env bash
#
# Prueba las migraciones del Hub contra un PostgreSQL efímero.
#
# Levanta un cluster desechable, reproduce el esquema de Trimm con las mismas
# columnas que producción, aplica las cuatro migraciones en orden y ejecuta la
# batería de comprobaciones del motor de campañas.
#
# No toca la base de datos real en ningún momento.
#
#   ./migrations/tests/run.sh
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS="$(dirname "$HERE")"
WORK="${HUB_TEST_DIR:-/var/tmp/hub-migration-test}"
PORT="${HUB_TEST_PORT:-55432}"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"

# El orden importa: las migraciones de junio crean las tablas hub_* sobre las
# que se apoyan las de agosto.
MIGRATION_FILES=(
  20260628_trimm_hub.sql
  20260628_hub_marketing.sql
  20260820_hub_campaign_engine.sql
  20260820_hub_credits_packs.sql
)

command -v "$PGBIN/initdb" >/dev/null 2>&1 || {
  echo "No se encuentra PostgreSQL en $PGBIN. Instala postgresql-16 o ajusta PGBIN." >&2
  exit 1
}

# initdb se niega a correr como root; si lo somos, usamos el usuario postgres.
if [ "$(id -u)" -eq 0 ]; then
  RUN_AS="su postgres -c"
else
  RUN_AS="bash -c"
fi

cleanup() {
  $RUN_AS "PATH=$PGBIN:\$PATH pg_ctl -D $WORK/data -m immediate stop" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "→ Preparando cluster efímero en $WORK"
rm -rf "$WORK"
mkdir -p "$WORK/data" "$WORK/run"
cp "$HERE"/*.sql "$WORK/"
for f in "${MIGRATION_FILES[@]}"; do cp "$MIGRATIONS/$f" "$WORK/"; done
[ "$(id -u)" -eq 0 ] && chown -R postgres "$WORK"

$RUN_AS "PATH=$PGBIN:\$PATH initdb -D $WORK/data -A trust -U postgres" >/dev/null
$RUN_AS "PATH=$PGBIN:\$PATH pg_ctl -D $WORK/data \
  -o '-k $WORK/run -p $PORT -c listen_addresses=' -l $WORK/pg.log start" >/dev/null

psql_run() {
  $RUN_AS "psql -h $WORK/run -p $PORT -U postgres -d postgres -v ON_ERROR_STOP=1 $*"
}

echo "→ Reproduciendo el esquema de Trimm"
psql_run "-q -f $WORK/00_schema_stub.sql"

for f in "${MIGRATION_FILES[@]}"; do
  echo "→ Aplicando $f"
  psql_run "-q -f $WORK/$f"
done

echo "→ Ejecutando las comprobaciones del motor"
echo
psql_run "-f $WORK/01_campaign_engine_test.sql" 2>&1 \
  | sed 's/^psql:[^ ]* NOTICE:  //' \
  | grep -v '^DO$\|^CREATE FUNCTION$\|Pager usage'

echo
echo "✓ Migraciones y motor de campañas verificados."
