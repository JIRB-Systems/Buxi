-- Hasta ahora la publicación `supabase_realtime` tenía UNA sola tabla:
-- bus_locations (agregada en 20260629000000). Postgres no emite ningún evento
-- de replicación para las demás, así que por más que la app se suscriba a
-- reportes_bugs o a boletos no le llega nada — de ahí que los paneles solo se
-- actualicen recargando la página.
--
-- Se agregan las tablas que representan algo que el usuario está mirando y que
-- puede cambiar mientras lo mira. Realtime respeta RLS: cada suscriptor recibe
-- únicamente las filas que ya podría leer con un select, así que esto no abre
-- ninguna puerta nueva.
--
-- Esta migración se escribió el 2026-08-21 pero no se subió hasta septiembre;
-- se renombró para que quede después de 20260830000000 y no rompa el orden.
--
-- Quedan FUERA a propósito:
--   * activity_logs, tramos_historial   -> volumen alto, nadie los mira en vivo
--   * geocode_rate_limit                -> tabla interna del limitador
--   * user_preferences, favoritos, favoritos_empresa,
--     lugares_personalizados            -> son del propio usuario; ya se
--                                          refrescan cuando él las cambia
--   * system_config                     -> se lee una vez al abrir la pantalla
--
-- REPLICA IDENTITY FULL en las tablas donde importa el evento de UPDATE/DELETE:
-- sin eso el payload `old` sólo trae la clave primaria, y una pantalla que
-- filtra por empresa_id no puede saber si la fila que se borró era suya.

do $$
declare
  t text;
  tablas text[] := array[
    'reportes_bugs', 'mensajes_chofer', 'boletos', 'buses', 'viajes',
    'rutas', 'paradas', 'horarios', 'horario_salidas', 'empresas',
    'profiles', 'solicitudes_empresa', 'solicitudes_plan', 'avisos_sistema',
    'anuncios', 'facturas', 'calificaciones', 'suscripciones', 'planes',
    -- Ya publicada por 20260830000000; se incluye por la REPLICA IDENTITY: la
    -- empresa puede BORRAR avisos, y sin FULL el evento de borrado no trae el
    -- empresa_id para saber de quién era.
    'notificaciones_empresa'
  ];
begin
  foreach t in array tablas loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
    execute format('alter table public.%I replica identity full', t);
  end loop;
end $$;
