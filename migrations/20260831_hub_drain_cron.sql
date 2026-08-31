-- ============================================================
-- TRIMM Hub — Cron que drena la cola de campañas
--
-- El worker (hub-send-campaign) procesa un tramo por invocación y sale.
-- Alguien tiene que volver a llamarlo hasta que la cola quede vacía: eso
-- es este cron.
--
-- Dos detalles que importan:
--
--  · La clave de servicio no se escribe aquí. Se lee de un cron que ya
--    existe en el proyecto, así este fichero puede vivir en el repositorio
--    sin llevar ningún secreto dentro.
--
--  · La llamada sólo sale si hay algo que enviar. Sin el guardado
--    WHERE EXISTS serían 1.440 invocaciones al día para no hacer nada.
--
-- Es idempotente: cron.schedule con el mismo nombre reescribe el trabajo.
-- ============================================================

DO $do$
DECLARE
  v_key text;
BEGIN
  SELECT (regexp_match(command, 'Bearer ([A-Za-z0-9._-]+)'))[1]
    INTO v_key
    FROM cron.job
   WHERE command LIKE '%Bearer %'
     AND jobname <> 'hub-drain-campaign-queue'
   LIMIT 1;

  IF v_key IS NULL THEN
    RAISE EXCEPTION
      'No hay ningún cron previo del que leer la clave de servicio. '
      'Programa este trabajo a mano con la clave service_role del proyecto.';
  END IF;

  PERFORM cron.schedule(
    'hub-drain-campaign-queue',
    '* * * * *',
    format($f$
      SELECT net.http_post(
        url := 'https://rdbmobnnhrowlqcdettu.supabase.co/functions/v1/hub-send-campaign',
        headers := jsonb_build_object(
          'Authorization', 'Bearer %s',
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb
      )
      WHERE EXISTS (
        SELECT 1 FROM public.hub_campaigns
        WHERE status IN ('queued', 'sending')
      );
    $f$, v_key)
  );
END
$do$;
