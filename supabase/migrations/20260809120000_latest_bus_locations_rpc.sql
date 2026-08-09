-- El mapa del pasajero traía TODA la tabla bus_locations ordenada por
-- timestamp y deduplicaba en el cliente para quedarse con el último punto de
-- cada bus. Con buses emitiendo cada 5 segundos son ~17.000 filas por bus por
-- día: la consulta crece sin techo y el mapa deja de abrir en semanas.
--
-- Estas funciones resuelven el "último punto por bus" en Postgres con
-- DISTINCT ON, que con el índice de abajo es un salto por bus en vez de un
-- scan completo. Además descartan buses que llevan rato sin transmitir, que
-- el cliente igual iba a tirar (la UI borra el marcador a los 5 minutos).

-- DISTINCT ON (bus_id) ... ORDER BY bus_id, timestamp DESC necesita
-- exactamente este índice compuesto para no ordenar toda la tabla.
create index if not exists idx_bus_locations_bus_id_timestamp
  on public.bus_locations (bus_id, "timestamp" desc);

-- security invoker: las políticas RLS de bus_locations se siguen aplicando
-- igual que en un select normal.
create or replace function public.latest_bus_locations(p_max_age_minutes integer default 15)
returns setof public.bus_locations
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct on (bus_id) *
  from public.bus_locations
  where "timestamp" > now() - make_interval(mins => greatest(p_max_age_minutes, 1))
  order by bus_id, "timestamp" desc;
$$;

create or replace function public.latest_bus_locations_by_ruta(
  p_ruta_id uuid,
  p_max_age_minutes integer default 15
)
returns setof public.bus_locations
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct on (bl.bus_id) bl.*
  from public.bus_locations bl
  join public.buses b on b.id = bl.bus_id
  where b.ruta_id = p_ruta_id
    and b.estado in ('activo', 'en_ruta')
    and bl."timestamp" > now() - make_interval(mins => greatest(p_max_age_minutes, 1))
  order by bl.bus_id, bl."timestamp" desc;
$$;

-- Mismo alcance de lectura que ya tiene la tabla ("Public read bus_locations").
grant execute on function public.latest_bus_locations(integer) to anon, authenticated;
grant execute on function public.latest_bus_locations_by_ruta(uuid, integer) to anon, authenticated;
