-- El color y el modelo de cada bus llegan al mapa del pasajero.
--
-- En Personalización (20261024180000) la empresa elige un color y un modelo
-- para la flota o para buses sueltos, pero buses_en_vivo —de donde sale el
-- mapa del pasajero, con o sin cuenta— solo devolvía el color de la empresa.
-- Resultado: lo que la empresa elegía para un bus no se veía en ninguna parte.
--
-- Se agregan dos columnas al final:
--   bus_color: el color propio del bus (null si usa el de la flota).
--   modelo:    el modelo del bus o, si no tiene, el de la flota (null si
--              ninguno eligió; la app usa entonces el urbano).
-- Cambia el tipo de retorno, así que hay que borrar la función y crearla de
-- nuevo; los permisos se vuelven a dar igual que antes.

drop function if exists public.buses_en_vivo(uuid, integer);

create function public.buses_en_vivo(
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
  ruta_color text,
  bus_color text,
  modelo text
)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id, l.bus_id, l.latitud, l.longitud, l.velocidad, l.heading, l."timestamp", l.anomalo,
         b.placa, b.numero_unidad, b.empresa_id, e.nombre, e.color_bus, b.ruta_id, r.nombre, r.color,
         b.color_bus, coalesce(b.modelo_bus, e.modelo_bus)
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
