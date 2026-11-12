-- Dos cosas que se apoyan en el viaje del bus:
--
-- 1) ATRASO DE CADA BUS (buses_en_vivo.retraso_min)
--    El mapa del pasajero marcaba "Retrasado" con una cuenta equivocada:
--    minutos desde la última salida programada de la ruta abierta, igual para
--    todos los buses en pantalla. Con horarios cargados, casi cualquier bus
--    salía tarde. Ahora se calcula por bus, con la misma regla que ya usan la
--    puntualidad y los informes de la empresa: la hora en que arrancó su viaje
--    en curso contra la salida programada más cercana de su ruta y su tipo de
--    día, en hora de Costa Rica. Positivo = salió tarde. null = no hay viaje
--    en curso, o la salida más cercana está a más de 30 minutos (un viaje
--    extra o un horario sin cargar): ahí no se inventa un atraso.
--
-- 2) PASAJEROS A BORDO (tabla abordajes)
--    El mapa del pasajero ya deduce cuándo alguien va arriba de un bus (su
--    teléfono y el GPS del bus se mueven juntos). Cada subida se anota acá,
--    ANÓNIMA: sin usuario, solo el bus y un id al azar del teléfono que cambia
--    todos los días (sirve para no contar dos veces el mismo viaje y no para
--    seguir a nadie). La empresa ve los totales en Informes: cuánta gente que
--    usa Buxci subió a cada ruta y a qué hora. No es el total de pasajeros,
--    es una muestra, y el panel lo dice así.
--
--    Se escribe solo con registrar_a_bordo, que comprueba que el bus esté
--    transmitiendo y que el pasajero esté al lado; se lee solo agregado, con
--    pasajeros_a_bordo_empresa. La tabla no tiene políticas a propósito.

-- ---------------------------------------------------------------- 1) atraso
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
  retraso_min integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id, l.bus_id, l.latitud, l.longitud, l.velocidad, l.heading, l."timestamp", l.anomalo,
         b.placa, b.numero_unidad, b.empresa_id, e.nombre, e.color_bus, b.ruta_id, r.nombre, r.color,
         b.color_bus, coalesce(b.modelo_bus, e.modelo_bus), t.retraso
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

-- ------------------------------------------------------- 2) pasajeros a bordo
create table if not exists public.abordajes (
  id uuid primary key default gen_random_uuid(),
  bus_id uuid not null references public.buses(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  ruta_id uuid references public.rutas(id) on delete set null,
  -- Id al azar del teléfono, distinto cada día. No identifica a nadie.
  sesion uuid not null,
  subio_en timestamptz not null default now(),
  visto_en timestamptz not null default now()
);

create index if not exists abordajes_empresa_subio_idx on public.abordajes (empresa_id, subio_en);
create index if not exists abordajes_bus_subio_idx on public.abordajes (bus_id, subio_en);
create index if not exists abordajes_sesion_idx on public.abordajes (sesion, subio_en);
create index if not exists abordajes_ruta_idx on public.abordajes (ruta_id);

alter table public.abordajes enable row level security;
revoke all on public.abordajes from anon, authenticated;

-- Anota que este teléfono va arriba de este bus. Devuelve si quedó anotado.
-- Es pública (el mapa se usa sin cuenta), así que no confía en nada: el bus
-- tiene que estar transmitiendo y el pasajero, a menos de 200 m de su último
-- punto. Llamadas repetidas del mismo viaje solo extienden visto_en.
create or replace function public.registrar_a_bordo(
  p_bus_id uuid,
  p_sesion uuid,
  p_lat double precision,
  p_lng double precision
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_lat double precision;
  v_lng double precision;
  v_empresa uuid;
  v_ruta uuid;
  v_id uuid;
begin
  if p_bus_id is null or p_sesion is null or p_lat is null or p_lng is null then
    return false;
  end if;

  select bl.latitud, bl.longitud into v_lat, v_lng
  from public.bus_locations bl
  where bl.bus_id = p_bus_id and bl."timestamp" > now() - interval '1 minute'
  order by bl."timestamp" desc
  limit 1;
  if v_lat is null then return false; end if;

  -- Distancia aproximada en metros (equirectangular: sobra a esta escala).
  if 6371000 * sqrt(power(radians(p_lat - v_lat), 2)
                    + power(radians(p_lng - v_lng) * cos(radians(p_lat)), 2)) > 200 then
    return false;
  end if;

  select b.empresa_id, b.ruta_id into v_empresa, v_ruta
  from public.buses b
  join public.empresas e on e.id = b.empresa_id and e.estado = 'activo'
  where b.id = p_bus_id;
  if v_empresa is null then return false; end if;

  -- El mismo viaje: se lo sigue viendo arriba.
  update public.abordajes a set visto_en = now()
  where a.id = (
    select x.id from public.abordajes x
    where x.bus_id = p_bus_id and x.sesion = p_sesion and x.visto_en > now() - interval '20 minutes'
    order by x.visto_en desc
    limit 1
  )
  returning a.id into v_id;
  if v_id is not null then return true; end if;

  -- Topes contra el relleno: más subidas en 10 minutos de las que caben en un
  -- bus no son reales, y nadie se sube a 30 buses en un día.
  if (select count(*) from public.abordajes x
      where x.bus_id = p_bus_id and x.subio_en > now() - interval '10 minutes') >= 90 then
    return false;
  end if;
  if (select count(*) from public.abordajes x
      where x.sesion = p_sesion and x.subio_en > now() - interval '1 day') >= 30 then
    return false;
  end if;

  insert into public.abordajes (bus_id, empresa_id, ruta_id, sesion)
  values (p_bus_id, v_empresa, v_ruta, p_sesion);
  return true;
end;
$$;

revoke execute on function public.registrar_a_bordo(uuid, uuid, double precision, double precision) from public;
grant execute on function public.registrar_a_bordo(uuid, uuid, double precision, double precision) to anon, authenticated;

-- Totales para Informes del panel de empresa (días en hora de Costa Rica).
-- Solo el admin de la empresa, y solo de la suya. Nunca devuelve filas
-- sueltas ni el id del teléfono.
create or replace function public.pasajeros_a_bordo_empresa(p_desde date, p_hasta date)
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
  if v_emp is null or (select public.get_my_role()) <> 'admin_empresa' then
    raise exception 'Solo el administrador de la empresa ve este informe' using errcode = '42501';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde or p_hasta - p_desde > 366 then
    raise exception 'Período inválido' using errcode = '22023';
  end if;
  v_ini := p_desde::timestamp at time zone 'America/Costa_Rica';
  v_fin := (p_hasta + 1)::timestamp at time zone 'America/Costa_Rica';

  with a as (
    select x.bus_id, x.ruta_id,
           extract(hour from (x.subio_en at time zone 'America/Costa_Rica'))::integer as hora,
           extract(epoch from (x.visto_en - x.subio_en)) / 60.0 as minutos
    from public.abordajes x
    where x.empresa_id = v_emp and x.subio_en >= v_ini and x.subio_en < v_fin
  )
  select jsonb_build_object(
    'total', (select count(*) from a),
    'minutos_promedio', (select round(avg(a.minutos)::numeric, 0) from a where a.minutos >= 1),
    'por_hora', coalesce((
      select jsonb_agg(jsonb_build_object('hora', h.hora, 'n', h.n) order by h.hora)
      from (select a.hora, count(*) as n from a group by a.hora) h
    ), '[]'::jsonb),
    'por_ruta', coalesce((
      select jsonb_agg(jsonb_build_object('id', q.id, 'nombre', q.nombre, 'color', q.color, 'n', q.n) order by q.n desc)
      from (
        select ru.id, ru.nombre, ru.color, count(*) as n
        from a join public.rutas ru on ru.id = a.ruta_id
        group by ru.id, ru.nombre, ru.color
      ) q
    ), '[]'::jsonb),
    'por_bus', coalesce((
      select jsonb_agg(jsonb_build_object('id', q.id, 'placa', q.placa, 'unidad', q.numero_unidad, 'n', q.n) order by q.n desc)
      from (
        select b.id, b.placa, b.numero_unidad, count(*) as n
        from a join public.buses b on b.id = a.bus_id
        group by b.id, b.placa, b.numero_unidad
      ) q
    ), '[]'::jsonb)
  ) into r;
  return r;
end;
$$;

revoke execute on function public.pasajeros_a_bordo_empresa(date, date) from public, anon;
grant execute on function public.pasajeros_a_bordo_empresa(date, date) to authenticated;
