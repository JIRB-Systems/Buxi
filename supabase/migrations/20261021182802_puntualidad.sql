-- Puntualidad de las salidas, para el panel de empresa.
--
-- Cada viaje que arrancó un chofer se compara con la salida programada
-- (horario_salidas) más cercana de su ruta y su tipo de día, en hora de
-- Costa Rica. Cuenta como a tiempo si salió entre 2 minutos antes y 5 después.
-- Si la salida programada más cercana está a más de 30 minutos, el viaje no
-- se compara (es un viaje extra o el horario no está cargado).
--
-- SECURITY INVOKER a propósito: corre con los permisos de quien llama, así que
-- RLS hace que cada empresa vea solo sus viajes.

create or replace function public.puntualidad_empresa(p_dias integer default 30)
returns table (
  ruta_id uuid,
  ruta_nombre text,
  viajes integer,
  comparables integer,
  a_tiempo integer,
  tarde integer,
  temprano integer,
  desvio_promedio numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with v as (
    select v.id, v.ruta_id, (v.inicio at time zone 'America/Costa_Rica') as local
    from public.viajes v
    join public.rutas r on r.id = v.ruta_id
    where r.empresa_id = (select public.get_my_empresa_id())
      and v.inicio > now() - make_interval(days => least(greatest(p_dias, 1), 365))
      and v.estado <> 'cancelado'
  ),
  c as (
    select v.id, v.ruta_id, d.diff
    from v
    cross join lateral (
      select extract(epoch from (v.local::time - s.hora)) / 60.0 as diff
      from public.horario_salidas s
      where s.ruta_id = v.ruta_id
        and s.dia = case extract(dow from v.local)
                      when 0 then 'domingo' when 6 then 'sabado' else 'lunes_viernes' end
      order by abs(extract(epoch from (v.local::time - s.hora)))
      limit 1
    ) d
    where abs(d.diff) <= 30
  )
  select r.id, r.nombre,
         (select count(*) from v where v.ruta_id = r.id)::integer,
         count(c.id)::integer,
         (count(*) filter (where c.diff between -2 and 5))::integer,
         (count(*) filter (where c.diff > 5))::integer,
         (count(*) filter (where c.diff < -2))::integer,
         round(avg(c.diff)::numeric, 1)
  from public.rutas r
  left join c on c.ruta_id = r.id
  where r.empresa_id = (select public.get_my_empresa_id())
  group by r.id, r.nombre
  order by r.nombre;
$$;

revoke execute on function public.puntualidad_empresa(integer) from public, anon;
grant execute on function public.puntualidad_empresa(integer) to authenticated;
