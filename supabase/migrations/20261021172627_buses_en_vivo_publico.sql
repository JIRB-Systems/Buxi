-- Ver los buses sin cuenta.
--
-- Hasta acá el pasajero tenía que registrarse y seguir a una empresa para ver
-- sus buses (20260930000000): el mapa arrancaba vacío. Ninguna app de la
-- competencia hace eso, y es la primera impresión del producto. Ahora
-- cualquiera, con o sin cuenta, ve dónde está cada bus que está transmitiendo.
--
-- Lo que NO cambia, y es lo que protegía aquella decisión:
--   - El historial GPS sigue cerrado (bus_locations no se abre a anon). Esta
--     función devuelve solo el ÚLTIMO punto de cada bus y solo si es de los
--     últimos minutos (máximo 60): no sirve para reconstruir recorridos.
--   - No sale el chofer (ni su id): solo bus, placa, ruta y empresa, que es lo
--     que se ve pintado en el propio bus en la calle.
--   - Solo empresas activas y buses activos o en ruta.
-- Seguir a una empresa sigue sirviendo para sus avisos y para el tiempo real
-- instantáneo; el mapa general se refresca consultando esta función.

create or replace function public.buses_en_vivo(
  p_ruta_id uuid default null,
  p_max_age_minutes integer default 15
)
returns table (
  id uuid,
  bus_id uuid,
  latitud double precision,
  longitud double precision,
  velocidad double precision,
  heading double precision,
  "timestamp" timestamptz,
  anomalo boolean,
  placa text,
  numero_unidad text,
  empresa_id uuid,
  empresa_nombre text,
  empresa_color text,
  ruta_id uuid,
  ruta_nombre text,
  ruta_color text
)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id, l.bus_id, l.latitud, l.longitud, l.velocidad, l.heading, l."timestamp", l.anomalo,
         b.placa, b.numero_unidad, b.empresa_id, e.nombre, e.color_bus, b.ruta_id, r.nombre, r.color
  from (
    select distinct on (bl.bus_id) bl.*
    from public.bus_locations bl
    where bl."timestamp" > now() - make_interval(mins => least(greatest(p_max_age_minutes, 1), 60))
    order by bl.bus_id, bl."timestamp" desc
  ) l
  join public.buses b on b.id = l.bus_id
  join public.empresas e on e.id = b.empresa_id and e.estado = 'activo'
  left join public.rutas r on r.id = b.ruta_id
  where b.estado in ('activo', 'en_ruta')
    and (p_ruta_id is null or b.ruta_id = p_ruta_id);
$$;

revoke execute on function public.buses_en_vivo(uuid, integer) from public;
grant execute on function public.buses_en_vivo(uuid, integer) to anon, authenticated;
