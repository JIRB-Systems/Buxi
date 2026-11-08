-- El recorrido de un bus en un día (hora de Costa Rica), para dibujarlo en el
-- mapa de flota del panel de empresa. Un punto cada 20 segundos: con el GPS
-- cada pocos segundos, un día completo son miles de filas, y para una línea
-- en el mapa alcanza con esto.
--
-- Solo la empresa dueña del bus (o la administración de Buxci) lo puede ver.
create or replace function public.recorrido_bus(p_bus_id uuid, p_dia date)
returns table (latitud double precision, longitud double precision, velocidad double precision, ts timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_desde timestamptz := (p_dia::timestamp at time zone 'America/Costa_Rica');
  v_hasta timestamptz := ((p_dia + 1)::timestamp at time zone 'America/Costa_Rica');
begin
  if not exists (
    select 1 from public.buses b
    where b.id = p_bus_id
      and (b.empresa_id = public.get_my_empresa_id() or public.get_my_role() = 'admin_jirb')
  ) then
    raise exception 'Ese bus no es de tu empresa' using errcode = '42501';
  end if;

  return query
  select distinct on (floor(extract(epoch from l."timestamp") / 20))
         l.latitud::double precision, l.longitud::double precision,
         coalesce(l.velocidad, 0)::double precision, l."timestamp"
  from public.bus_locations l
  where l.bus_id = p_bus_id
    and l."timestamp" >= v_desde
    and l."timestamp" < v_hasta
    and coalesce(l.anomalo, false) = false
  order by floor(extract(epoch from l."timestamp") / 20), l."timestamp"
  limit 5000;
end;
$$;

revoke execute on function public.recorrido_bus(uuid, date) from public, anon;
grant execute on function public.recorrido_bus(uuid, date) to authenticated;
