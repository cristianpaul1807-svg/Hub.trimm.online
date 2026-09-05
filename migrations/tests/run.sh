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
  20260831_hub_stripe_webhook.sql
  20260901_hub_audience_access.sql
  20260901_fix_staff_metrics.sql
  20260901_hub_kpis.sql
  20260901_hub_analytics.sql
  20260902_hub_email_templates.sql
  20260902_hub_template_tests.sql
  20260902_hub_campaign_tests.sql
  20260902_hub_pay_per_campaign.sql
  20260902_hub_quote_credits.sql
  20260903_hub_campaign_codes.sql
  20260903_hub_templates_i18n.sql
  20260903_hub_render_cta_url.sql
  20260904_hub_audiencia_por_sucursal.sql
  20260904_hub_render_lang.sql
  20260905_hub_vinculo_solo_con_token.sql
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
echo "→ Ejecutando las comprobaciones del saldo comprado"
echo
psql_run "-f $WORK/02_credits_revoke_test.sql" 2>&1 \
  | sed 's/^psql:[^ ]* NOTICE:  //' \
  | grep -v '^DO$\|^CREATE FUNCTION$\|Pager usage'

echo
echo "→ Ejecutando las comprobaciones de acceso a la audiencia"
echo
psql_run "-f $WORK/03_audience_access_test.sql" 2>&1 \
  | sed 's/^psql:[^ ]* NOTICE:  //' \
  | grep -v '^DO$\|^CREATE FUNCTION$\|Pager usage'

echo
echo "→ Ejecutando las comprobaciones de KPIs"
echo
psql_run "-f $WORK/04_kpis_test.sql" 2>&1 \
  | sed 's/^psql:[^ ]* NOTICE:  //' \
  | grep -v '^DO$\|^CREATE FUNCTION$\|Pager usage'

echo
echo "→ Ejecutando las comprobaciones de análisis"
echo
psql_run "-f $WORK/05_analytics_test.sql" 2>&1 \
  | sed 's/^psql:[^ ]* NOTICE:  //' \
  | grep -v '^DO$\|^CREATE FUNCTION$\|Pager usage'

echo
echo "→ Ejecutando las comprobaciones del cupo de pruebas"
echo
psql_run "-f $WORK/06_test_quota_test.sql" 2>&1 \
  | sed 's/^psql:[^ ]* NOTICE:  //' \
  | grep -v '^DO$\|^CREATE FUNCTION$\|Pager usage'

echo
echo "→ Ejecutando las comprobaciones del pago suelto de campaña"
echo
psql_run "-f $WORK/07_pay_per_campaign_test.sql" 2>&1 \
  | sed 's/^psql:[^ ]* NOTICE:  //' \
  | grep -v '^DO$\|^CREATE FUNCTION$\|Pager usage'

echo
echo "→ Ejecutando las comprobaciones de los códigos de campaña"
echo
psql_run "-f $WORK/08_campaign_codes_test.sql" 2>&1 \
  | sed 's/^psql:[^ ]* NOTICE:  //' \
  | grep -v '^DO$\|^CREATE FUNCTION$\|Pager usage'

echo
echo "→ Ejecutando las comprobaciones del catálogo por idioma"
echo
psql_run "-f $WORK/09_templates_i18n_test.sql" 2>&1 \
  | sed 's/^psql:[^ ]* NOTICE:  //' \
  | grep -v '^DO$\|^CREATE FUNCTION$\|Pager usage'

echo
echo "→ Ejecutando las comprobaciones de la audiencia por sucursal"
echo
psql_run "-f $WORK/10_audiencia_por_sucursal_test.sql" 2>&1 \
  | sed 's/^psql:[^ ]* NOTICE:  //' \
  | grep -v '^DO$\|^CREATE FUNCTION$\|Pager usage'

echo
echo "→ Ejecutando las comprobaciones del vínculo de sucursales"
echo
psql_run "-f $WORK/11_vinculo_token_test.sql" 2>&1 \
  | sed 's/^psql:[^ ]* NOTICE:  //' \
  | grep -v '^DO$\|^CREATE FUNCTION$\|^GRANT$\|Pager usage'

echo
echo "✓ Todo verificado: motor, saldo, accesos, KPIs, análisis, cupos, pago suelto, códigos, idiomas, audiencia y vínculos."
