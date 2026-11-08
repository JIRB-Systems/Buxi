-- Informe de la empresa para un período (días en hora de Costa Rica): lo que
-- muestra la sección Informes del panel. Todo se calcula acá para no bajar
-- cada viaje al navegador. El panel lo pide dos veces (el período y el
-- anterior) para comparar.
--
-- Puntualidad: igual que puntualidad_empresa, cada salida contra la salida
-- programada más cercana del mismo tipo de día; a tiempo = de 2 min antes a
-- 5 después. Sin horarios cargados, comparables = 0 y el panel lo dice.
create or replace function public.informe_empresa(p_desde date, p_hasta date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_emp uuid := public.get_my_empresa_id();
  v_ini timestamptz;
  v_fin timestamptz;
  r jsonb;
begin
  if v_emp is null then
    raise exception 'No hay una empresa activa para esta cuenta' using errcode = '42501';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde or p_hasta - p_desde > 366 then
    raise exception 'Período inválido' using errcode = '22023';
  end if;
  v_ini := p_desde::timestamp at time zone 'America/Costa_Rica';
  v_fin := (p_hasta + 1)::timestamp at time zone 'America/Costa_Rica';

  with v as (
    select vi.id, vi.ruta_id, vi.chofer_id, vi.estado,
           coalesce(vi.distancia_km, 0) as km,
           (vi.inicio at time zone 'America/Costa_Rica') as local,
           case when vi.estado = 'completado' and vi.fin is not null
                then greatest(extract(epoch from (vi.fin - vi.inicio)) / 3600.0, 0) else 0 end as horas
    from public.viajes vi
    join public.buses b on b.id = vi.bus_id
    where b.empresa_id = v_emp
      and vi.inicio >= v_ini and vi.inicio < v_fin
  ),
  p as (
    select v.id, v.ruta_id, v.chofer_id, d.diff
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
    where v.estado <> 'cancelado' and abs(d.diff) <= 30
  ),
  rutas as (
    select ru.id, ru.nombre, ru.color,
           count(v.id) filter (where v.estado = 'completado') as completados,
           count(v.id) filter (where v.estado = 'cancelado') as cancelados,
           round(coalesce(sum(v.horas), 0)::numeric, 1) as horas,
           (select count(*) from p where p.ruta_id = ru.id) as comparables,
           (select count(*) from p where p.ruta_id = ru.id and p.diff between -2 and 5) as a_tiempo
    from public.rutas ru
    left join v on v.ruta_id = ru.id
    where ru.empresa_id = v_emp
    group by ru.id, ru.nombre, ru.color
  ),
  choferes as (
    select pr.id, pr.nombre_completo as nombre,
           count(v.id) filter (where v.estado = 'completado') as completados,
           count(v.id) filter (where v.estado = 'cancelado') as cancelados,
           round(coalesce(sum(v.horas), 0)::numeric, 1) as horas,
           round(coalesce(sum(v.km) filter (where v.estado = 'completado'), 0)::numeric, 1) as km,
           (select count(*) from p where p.chofer_id = pr.id) as comparables,
           (select count(*) from p where p.chofer_id = pr.id and p.diff between -2 and 5) as a_tiempo
    from public.profiles pr
    left join v on v.chofer_id = pr.id
    where pr.empresa_id = v_emp and pr.rol = 'chofer'
    group by pr.id, pr.nombre_completo
  )
  select jsonb_build_object(
    'totales', (select jsonb_build_object(
        'completados', count(*) filter (where estado = 'completado'),
        'cancelados', count(*) filter (where estado = 'cancelado'),
        'abiertos', count(*) filter (where estado = 'en_curso'),
        'horas', round(coalesce(sum(horas), 0)::numeric, 1),
        'km', round(coalesce(sum(km) filter (where estado = 'completado'), 0)::numeric, 1))
      from v),
    'puntualidad', (select jsonb_build_object(
        'comparables', count(*),
        'a_tiempo', count(*) filter (where diff between -2 and 5),
        'tarde', count(*) filter (where diff > 5),
        'temprano', count(*) filter (where diff < -2))
      from p),
    'por_dia', (select coalesce(jsonb_agg(jsonb_build_object(
        'dia', g.d::date,
        'completados', (select count(*) from v where v.local::date = g.d::date and v.estado = 'completado'),
        'cancelados', (select count(*) from v where v.local::date = g.d::date and v.estado = 'cancelado'))
        order by g.d), '[]'::jsonb)
      from generate_series(p_desde::timestamp, p_hasta::timestamp, interval '1 day') as g(d)),
    'por_ruta', (select coalesce(jsonb_agg(to_jsonb(rutas) order by rutas.completados desc, rutas.nombre), '[]'::jsonb) from rutas),
    'por_chofer', (select coalesce(jsonb_agg(to_jsonb(choferes) order by choferes.completados desc, choferes.nombre), '[]'::jsonb) from choferes)
  ) into r;

  return r;
end;
$$;

revoke execute on function public.informe_empresa(date, date) from public, anon;
grant execute on function public.informe_empresa(date, date) to authenticated;
