-- "Bus lleno", marcado por el chofer.
--
-- Hasta ahora la ocupación salía solo de lo que reportaban los pasajeros
-- ("va lleno", por ruta). El chofer es quien la ve de verdad: con un botón
-- marca su bus como lleno o con espacio, y el pasajero lo ve en la ficha del
-- bus. Se guarda en el bus con la hora; buses_en_vivo la devuelve solo si es
-- de los últimos 90 minutos (una marca vieja miente más de lo que ayuda), y
-- la app del chofer la borra al empezar y al terminar cada viaje.

alter table public.buses
  add column if not exists ocupacion text check (ocupacion in ('espacio', 'lleno')),
  add column if not exists ocupacion_en timestamptz;

-- Solo el chofer asignado a ese bus, y solo estas dos columnas. null = sin
-- marca (al empezar o terminar un viaje).
create or replace function public.chofer_set_ocupacion(p_bus_id uuid, p_ocupacion text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_ocupacion is not null and p_ocupacion not in ('espacio', 'lleno') then
    raise exception 'Ocupación no válida: %', p_ocupacion;
  end if;

  update public.buses
  set ocupacion = p_ocupacion,
      ocupacion_en = case when p_ocupacion is null then null else now() end
  where id = p_bus_id
    and chofer_id = auth.uid();

  if not found then
    raise exception 'Ese bus no está asignado a tu cuenta';
  end if;
end;
$$;

revoke execute on function public.chofer_set_ocupacion(uuid, text) from public;
grant  execute on function public.chofer_set_ocupacion(uuid, text) to authenticated;

-- buses_en_vivo: lo mismo que en 20261111120000, más la ocupación.
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
  modelo text,
  retraso_min integer,
  ocupacion text
)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id, l.bus_id, l.latitud, l.longitud, l.velocidad, l.heading, l."timestamp", l.anomalo,
         b.placa, b.numero_unidad, b.empresa_id, e.nombre, e.color_bus, b.ruta_id, r.nombre, r.color,
         b.color_bus, coalesce(b.modelo_bus, e.modelo_bus), t.retraso,
         case when b.ocupacion_en > now() - interval '90 minutes' then b.ocupacion end
  from (
    select distinct on (bl.bus_id) bl.*
    from public.bus_locations bl
    where bl."timestamp" > now() - make_interval(mins => least(greatest(p_max_age_minutes, 1), 60))
    order by bl.bus_id, bl."timestamp" desc
  ) l
  join public.buses b on b.id = l.bus_id
  join public.empresas e on e.id = b.empresa_id and e.estado = 'activo'
  left join public.rutas r on r.id = b.ruta_id
  left join lateral (
    select round(d.diff)::integer as retraso
    from public.viajes v
    cross join lateral (
      select extract(epoch from ((v.inicio at time zone 'America/Costa_Rica')::time - s.hora)) / 60.0 as diff
      from public.horario_salidas s
      where s.ruta_id = coalesce(v.ruta_id, b.ruta_id)
        and s.dia = case extract(dow from (v.inicio at time zone 'America/Costa_Rica'))
                      when 0 then 'domingo' when 6 then 'sabado' else 'lunes_viernes' end
      order by abs(extract(epoch from ((v.inicio at time zone 'America/Costa_Rica')::time - s.hora)))
      limit 1
    ) d
    where v.bus_id = b.id
      and v.estado = 'en_curso'
      and v.inicio > now() - interval '8 hours'
      and abs(d.diff) <= 30
    order by v.inicio desc
    limit 1
  ) t on true
  where b.estado in ('activo', 'en_ruta')
    and (p_ruta_id is null or b.ruta_id = p_ruta_id);
$$;

revoke execute on function public.buses_en_vivo(uuid, integer) from public;
grant execute on function public.buses_en_vivo(uuid, integer) to anon, authenticated;
