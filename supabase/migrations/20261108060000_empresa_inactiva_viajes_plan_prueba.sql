-- Lo que quedaba de la auditoría del 2026-11-07.

-- 1) Una empresa inactiva no opera. Su admin y sus choferes se quedan sin rol
--    a los ojos de la base (igual que un perfil suspendido, desde 20261104):
--    todas las políticas que preguntan get_my_role() o get_my_empresa_id() les
--    dicen que no. Los pasajeros y la administración de Buxci no tienen
--    empresa, así que no cambian.
create or replace function public.get_my_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.rol from public.profiles p
  where p.id = auth.uid()
    and coalesce(p.estado, 'activo') = 'activo'
    and (p.empresa_id is null
         or exists (select 1 from public.empresas e where e.id = p.empresa_id and e.estado = 'activo'))
$$;

create or replace function public.get_my_empresa_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.empresa_id from public.profiles p
  where p.id = auth.uid()
    and coalesce(p.estado, 'activo') = 'activo'
    and (p.empresa_id is null
         or exists (select 1 from public.empresas e where e.id = p.empresa_id and e.estado = 'activo'))
$$;

-- El GPS, los tramos y los viajes del chofer solo miraban que el bus fuera
-- suyo: un chofer suspendido, o de una empresa inactiva, seguía transmitiendo.
-- Ahora además tiene que ser chofer activo de una empresa activa.
drop policy if exists "Chofer insert location" on public.bus_locations;
create policy "Chofer insert location" on public.bus_locations
  for insert to authenticated
  with check (
    (select public.get_my_role()) = 'chofer'
    and exists (select 1 from public.buses
                where buses.id = bus_locations.bus_id
                  and buses.chofer_id = (select auth.uid()))
  );

drop policy if exists "Chofer insert tramo" on public.tramos_historial;
create policy "Chofer insert tramo" on public.tramos_historial
  for insert to authenticated
  with check (
    (select public.get_my_role()) = 'chofer'
    and exists (select 1 from public.buses
                where buses.id = tramos_historial.bus_id
                  and buses.chofer_id = (select auth.uid()))
  );

drop policy if exists "Chofer manage own viajes" on public.viajes;
create policy "Chofer manage own viajes" on public.viajes
  for all to authenticated
  using ((select auth.uid()) = chofer_id and (select public.get_my_role()) = 'chofer')
  with check ((select auth.uid()) = chofer_id and (select public.get_my_role()) = 'chofer');

-- 2) Un viaje del chofer es con SU bus y con una ruta de SU empresa. Antes la
--    política solo miraba chofer_id: podía abrir un viaje con el bus de otra
--    empresa o con una ruta ajena.
create or replace function public.validar_viaje()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_empresa uuid;
begin
  if auth.uid() is null or coalesce(public.get_my_role(), '') = 'admin_jirb' then
    return new;
  end if;

  select b.empresa_id into v_empresa
  from public.buses b
  where b.id = new.bus_id and b.chofer_id = new.chofer_id;
  if v_empresa is null then
    raise exception 'Ese bus no está asignado a este chofer' using errcode = '42501';
  end if;

  if new.ruta_id is not null and not exists (
    select 1 from public.rutas r where r.id = new.ruta_id and r.empresa_id = v_empresa
  ) then
    raise exception 'Esa ruta no es de la empresa del bus' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke execute on function public.validar_viaje() from public, anon, authenticated;

drop trigger if exists trg_validar_viaje on public.viajes;
create trigger trg_validar_viaje
  before insert or update of bus_id, chofer_id, ruta_id on public.viajes
  for each row execute function public.validar_viaje();

-- 3) Para que la app le explique a la persona por qué no puede entrar, en vez
--    de mostrarle un panel vacío.
create or replace function public.mi_acceso()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'perfil_activo', coalesce(p.estado, 'activo') = 'activo',
    'empresa_activa', p.empresa_id is null or coalesce(e.estado = 'activo', false),
    'empresa', e.nombre)
  from public.profiles p
  left join public.empresas e on e.id = p.empresa_id
  where p.id = auth.uid()
$$;

revoke execute on function public.mi_acceso() from public, anon;
grant execute on function public.mi_acceso() to authenticated;

-- 4) Toda empresa que se activa sin plan arranca con el Básico de prueba por
--    30 días. Antes quedaba sin plan, y sin plan no había límite de buses ni
--    de rutas. Al vencer, vencer_suscripciones() la pasa a 'vencida' y ya no
--    puede agregar más hasta que pague.
create or replace function public.plan_de_prueba_al_activar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.estado = 'activo'
     and (tg_op = 'INSERT' or old.estado is distinct from 'activo')
     and not exists (select 1 from public.suscripciones s where s.empresa_id = new.id)
  then
    insert into public.suscripciones (empresa_id, plan_id, fecha_inicio, fecha_fin, estado, auto_renovar)
    select new.id, p.id, current_date, current_date + 30, 'prueba', false
    from public.planes p where p.nombre = 'Básico'
    limit 1;
  end if;
  return new;
end;
$$;

revoke execute on function public.plan_de_prueba_al_activar() from public, anon, authenticated;

drop trigger if exists trg_plan_de_prueba_al_activar on public.empresas;
create trigger trg_plan_de_prueba_al_activar
  after insert or update of estado on public.empresas
  for each row execute function public.plan_de_prueba_al_activar();

-- Y si igual una empresa queda sin plan, no se le abre la puerta: antes el
-- límite dejaba pasar todo cuando no encontraba suscripción.
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
    raise exception 'La empresa no tiene un plan activo. Escribinos para activarlo.'
      using errcode = 'P0001';
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

-- 5) Datos, según lo que decidió la administración (2026-11-08):
--    Transtusa vuelve a estar activa (tiene admin y chofer reales; con el
--    bloqueo de arriba se habrían quedado afuera). Al activarse recibe el plan
--    de prueba por el trigger de arriba.
update public.empresas set estado = 'activo'
 where id = '43b94518-da79-4a4e-a801-e3b08b11d4ae' and estado <> 'activo';

--    LancaBus quedó aprobada sin admin, sin plan, sin buses ni rutas, visible
--    para los pasajeros: se desactiva hasta que alguien la vaya a usar.
update public.empresas set estado = 'inactivo'
 where nombre = 'LancaBus' and estado = 'activo'
   and not exists (select 1 from public.profiles p where p.empresa_id = empresas.id and p.rol = 'admin_empresa');
