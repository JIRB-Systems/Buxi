-- Auditoría de noviembre 2026: hacer cumplir lo que los planes prometen y
-- poner tope a lo que crece sin límite.

-- 1) Límites del plan: max_buses y max_rutas solo se mostraban, nunca se
--    exigían. Se valida al INSERTAR. Una empresa sin suscripción no tiene
--    límite (no se rompe a quien aún no tiene plan asignado). Con la
--    suscripción vencida no puede agregar buses ni rutas, pero lo que ya
--    tiene sigue operando.
create or replace function public.hacer_cumplir_limite_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_estado text;
  v_max int;
  v_actual int;
  v_plan text;
begin
  select s.estado, p.nombre,
         case when tg_table_name = 'buses' then p.max_buses else p.max_rutas end
    into v_estado, v_plan, v_max
  from public.suscripciones s
  join public.planes p on p.id = s.plan_id
  where s.empresa_id = new.empresa_id
    and s.estado in ('activa', 'prueba', 'vencida')
  order by s.created_at desc
  limit 1;

  if not found then
    return new;
  end if;

  if v_estado = 'vencida' then
    raise exception 'La suscripción de la empresa está vencida. Renová tu plan para agregar % nuevos.',
      case when tg_table_name = 'buses' then 'buses' else 'rutas' end
      using errcode = 'P0001';
  end if;

  if tg_table_name = 'buses' then
    select count(*) into v_actual from public.buses where empresa_id = new.empresa_id;
  else
    select count(*) into v_actual from public.rutas where empresa_id = new.empresa_id;
  end if;

  if v_actual >= v_max then
    raise exception 'El plan % permite hasta % % y ya llegaste al límite. Pedí un cambio de plan para agregar más.',
      v_plan, v_max, case when tg_table_name = 'buses' then 'buses' else 'rutas' end
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke execute on function public.hacer_cumplir_limite_plan() from public, anon, authenticated;

drop trigger if exists buses_limite_plan on public.buses;
create trigger buses_limite_plan
  before insert on public.buses
  for each row execute function public.hacer_cumplir_limite_plan();

drop trigger if exists rutas_limite_plan on public.rutas;
create trigger rutas_limite_plan
  before insert on public.rutas
  for each row execute function public.hacer_cumplir_limite_plan();

-- 2) Suscripciones vencidas: nada las marcaba. Revisión diaria.
create or replace function public.vencer_suscripciones()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  update public.suscripciones
     set estado = 'vencida'
   where estado in ('activa', 'prueba')
     and fecha_fin is not null
     and fecha_fin < current_date;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.vencer_suscripciones() from public, anon, authenticated;

select cron.schedule('vencer-suscripciones', '0 6 * * *', $$select public.vencer_suscripciones()$$);

-- 3) bus_locations crecía sin límite (un punto cada 5 s por bus, sin TTL).
--    Purga diaria de lo que tenga más de 14 días y tope de frecuencia en la
--    base: un bus no puede insertar más de un punto cada 2 s aunque el
--    cliente se comporte mal.
create or replace function public.purgar_bus_locations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  delete from public.bus_locations where "timestamp" < now() - interval '14 days';
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.purgar_bus_locations() from public, anon, authenticated;

select cron.schedule('purgar-bus-locations', '0 7 * * *', $$select public.purgar_bus_locations()$$);

create or replace function public.limitar_frecuencia_gps()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.bus_locations
    where bus_id = new.bus_id and "timestamp" > now() - interval '2 seconds'
  ) then
    return null;
  end if;
  return new;
end;
$$;

revoke execute on function public.limitar_frecuencia_gps() from public, anon, authenticated;

drop trigger if exists trg_00_limitar_frecuencia_gps on public.bus_locations;
create trigger trg_00_limitar_frecuencia_gps
  before insert on public.bus_locations
  for each row execute function public.limitar_frecuencia_gps();

-- 4) "suspendido" (e "inactivo") era solo una columna: el usuario seguía
--    entrando con todos sus permisos. Las políticas se apoyan en estas dos
--    funciones, así que si el perfil no está activo dejan de devolver rol y
--    empresa, y las políticas por rol dejan de aplicarle. Las políticas por
--    auth.uid() (ver su propio perfil) siguen funcionando para que la app
--    pueda avisarle por qué no puede operar.
create or replace function public.get_my_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select rol from public.profiles
  where id = auth.uid() and coalesce(estado, 'activo') = 'activo'
$$;

create or replace function public.get_my_empresa_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select empresa_id from public.profiles
  where id = auth.uid() and coalesce(estado, 'activo') = 'activo'
$$;
