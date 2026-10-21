-- Una vez por semana (lunes 3:00 a. m. de Costa Rica = 09:00 UTC) se piden
-- las tarifas a ARESEP. ARESEP las revisa cada semestre, pero también hay
-- ajustes por ruta en cualquier momento.
--
-- La función decide sola si sincroniza (ver supabase/functions/
-- sync-tarifas-aresep): con la clave pública solo lo hace si pasaron 6 días.
-- La clave que va acá es la publicable, la misma que viaja en la app web; no
-- es un secreto.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'sync-tarifas-aresep',
  '0 9 * * 1',
  $$
  select net.http_post(
    url := 'https://gduxelmqqnqupimfcdeb.supabase.co/functions/v1/sync-tarifas-aresep',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'sb_publishable_s8kfM1PQVM125VtKlCK2uA_ZwGgA-d8'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
