-- Rendimiento de RLS y cierre de fugas de permisos, revisión del 2026-09-16.
--
-- Las fugas salieron de una "foto" de permisos: se simuló a un usuario de cada
-- rol (set role authenticated + request.jwt.claims) y se contó cuántas filas de
-- cada tabla podía leer. Lo que no cuadraba con el rol está abajo.


-- ===========================================================================
-- PARTE 1 — FUGAS DE PERMISOS
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1.1 viajes: cualquier usuario logueado veía los turnos de todos los choferes
-- ---------------------------------------------------------------------------
-- 20260823000000 le sacó esta lectura a `anon` pero la dejó abierta a
-- `authenticated`. Como registrarse es libre y gratis, `authenticated` equivale
-- en la práctica a "cualquiera": un pasajero recién creado veía los 32 viajes de
-- la plataforma, con chofer_id, inicio y fin; y la empresa TransBuxi veía los
-- turnos de los choferes de Transtusa.
--
-- Además, desde 20260917000000 viajes emite eventos de Realtime, y Realtime
-- respeta RLS: con esta policy abierta, cada pasajero conectado recibía EN VIVO
-- cada inicio y fin de turno de cada chofer.
--
-- Nadie más la necesita: el chofer lee los suyos ("Chofer manage own viajes"),
-- la empresa los de sus buses ("Admin empresa read viajes") y JIRB todos. Se
-- verificó que la app solo lee viajes desde admin-empresa, admin-jirb y chofer.
drop policy if exists "Public read viajes" on public.viajes;


-- ---------------------------------------------------------------------------
-- 1.2 Datos de la empresa legibles por sus CHOFERES
-- ---------------------------------------------------------------------------
-- Cuatro policies filtraban por empresa pero no exigían el rol, así que
-- cualquier perfil con ese empresa_id —un chofer— pasaba igual:
--   * suscripciones        -> el chofer veía el plan y el estado de pago
--   * facturas             -> el chofer veía la facturación
--   * solicitudes_plan     -> el chofer veía Y CREABA pedidos de cambio de plan
--
-- get_my_empresa_id() hace exactamente `select empresa_id from profiles where
-- id = auth.uid()`, la misma subconsulta que usaban; se usa la función para que
-- todas las policies del proyecto se lean igual.

drop policy if exists "Admin empresa read own sub" on public.suscripciones;
create policy "Admin empresa read own sub" on public.suscripciones
  for select to authenticated
  using (
    (select public.get_my_role()) = 'admin_empresa'
    and empresa_id = (select public.get_my_empresa_id())
  );

drop policy if exists "Admin empresa lee sus facturas" on public.facturas;
create policy "Admin empresa lee sus facturas" on public.facturas
  for select to authenticated
  using (
    (select public.get_my_role()) = 'admin_empresa'
    and empresa_id = (select public.get_my_empresa_id())
  );

drop policy if exists "Admin empresa lee sus solicitudes de plan" on public.solicitudes_plan;
create policy "Admin empresa lee sus solicitudes de plan" on public.solicitudes_plan
  for select to authenticated
  using (
    (select public.get_my_role()) = 'admin_empresa'
    and empresa_id = (select public.get_my_empresa_id())
  );

drop policy if exists "Admin empresa crea sus solicitudes de plan" on public.solicitudes_plan;
create policy "Admin empresa crea sus solicitudes de plan" on public.solicitudes_plan
  for insert to authenticated
  with check (
    (select public.get_my_role()) = 'admin_empresa'
    and empresa_id = (select public.get_my_empresa_id())
  );

-- La solicitud nace 'pendiente' por default, pero nada impedía mandarla ya como
-- 'resuelta': no escala privilegios, pero la esconde de la bandeja de JIRB, que
-- lista solo las pendientes. La app manda únicamente empresa_id y plan_id
-- (AdminEmpresaService.solicitarPlan). Tabla primero, columnas después: al
-- revés no tiene efecto (ver 20260824000000).
revoke insert on public.solicitudes_plan from anon, authenticated;
grant  insert (empresa_id, plan_id) on public.solicitudes_plan to authenticated;


-- ---------------------------------------------------------------------------
-- 1.3 rutas.color: solo colores hex
-- ---------------------------------------------------------------------------
-- El color de la ruta se interpolaba dentro de atributos `style="..."` en los
-- marcadores del mapa del pasajero, del panel de empresa y del de JIRB. Un
-- color como `red" onmouseover="...` permitía inyectar atributos, y en la app
-- nativa (sin la CSP de Vercel) eso es XSS contra todos los pasajeros. El
-- cliente ahora lo sanea con colorSeguro(), pero la base no debe depender de
-- que nadie se olvide. Verificado: las 14 rutas actuales ya son hex válidos.
alter table public.rutas
  add constraint rutas_color_hex check (color ~ '^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$');


-- ---------------------------------------------------------------------------
-- 1.4 Límite de frecuencia de GPS: un punto por segundo por bus
-- ---------------------------------------------------------------------------
-- Pendiente desde agosto: un chofer autenticado podía insertar ubicaciones sin
-- límite. Se resuelve DENTRO del trigger anti-spoofing porque ese trigger ya
-- trae el punto anterior del bus en cada insert (usando el índice
-- bus_id+timestamp): el límite no agrega ni una consulta extra al camino
-- caliente, que era la objeción para no hacerlo antes.
--
-- La app manda un punto cada 5 s y no tiene cola offline, así que un piso de 1 s
-- no toca el uso real. El timestamp lo pone la base (20260824000000), así que
-- el cliente no puede esquivarlo mandando fechas separadas.
create or replace function public.flag_anomalous_location()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  prev record;
  dist_km double precision;
  horas double precision;
  velocidad_kmh double precision;
begin
  select latitud, longitud, "timestamp" into prev
  from public.bus_locations
  where bus_id = new.bus_id
  order by "timestamp" desc
  limit 1;

  if prev is not null then
    if new."timestamp" - prev."timestamp" < interval '1 second' then
      raise exception 'Demasiadas ubicaciones para el bus %: máximo una por segundo', new.bus_id
        using errcode = '54000';
    end if;

    dist_km := 6371 * 2 * asin(sqrt(
      power(sin(radians(new.latitud - prev.latitud) / 2), 2) +
      cos(radians(prev.latitud)) * cos(radians(new.latitud)) *
      power(sin(radians(new.longitud - prev.longitud) / 2), 2)
    ));
    horas := extract(epoch from (new."timestamp" - prev."timestamp")) / 3600.0;

    if horas > 0 then
      velocidad_kmh := dist_km / horas;
      if velocidad_kmh > 200 then
        new.anomalo := true;
      end if;
    elsif dist_km > 0.5 then
      new.anomalo := true;
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.flag_anomalous_location() from public, anon, authenticated;


-- ===========================================================================
-- PARTE 2 — RENDIMIENTO
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 2.1 auth.uid() y get_my_role() evaluados UNA vez por consulta, no por fila
-- ---------------------------------------------------------------------------
-- Escritas a secas dentro de una policy, Postgres vuelve a llamar a estas
-- funciones por cada fila que evalúa. Envueltas en (select ...), el planner las
-- resuelve una sola vez como initPlan y reusa el resultado. Es lo que marca el
-- advisor auth_rls_initplan, y es la recomendación oficial de Supabase. El
-- resultado es idéntico: son STABLE y no dependen de la fila.
--
-- En agosto (20260822000000) se dejó pendiente porque obligaba a reescribir
-- decenas de expresiones a mano, y ahí es donde se cuela una regresión de
-- seguridad. Por eso NO se reescriben a mano: este bloque lee cada policy del
-- catálogo tal como está y solo envuelve esas tres llamadas. No hay ninguna
-- expresión transcrita en este archivo.
--
-- Es idempotente: el lookbehind (?<!SELECT ) salta las llamadas que ya están
-- envueltas (Postgres las guarda como "SELECT auth.uid() AS uid"), así que
-- volver a correrlo no las envuelve dos veces. También saltea las cuatro
-- policies recreadas arriba, que ya nacen envueltas.
do $$
declare
  p record;
  q text;
  w text;
  sentencia text;
  n integer := 0;
begin
  for p in
    select tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') || coalesce(with_check, ''))
          ~ '(?<!SELECT )(auth\.uid\(\)|get_my_role\(\)|get_my_empresa_id\(\))'
  loop
    q := p.qual;
    w := p.with_check;
    if q is not null then
      q := regexp_replace(q, '(?<!SELECT )auth\.uid\(\)', '(select auth.uid())', 'g');
      q := regexp_replace(q, '(?<!SELECT )get_my_role\(\)', '(select public.get_my_role())', 'g');
      q := regexp_replace(q, '(?<!SELECT )get_my_empresa_id\(\)', '(select public.get_my_empresa_id())', 'g');
    end if;
    if w is not null then
      w := regexp_replace(w, '(?<!SELECT )auth\.uid\(\)', '(select auth.uid())', 'g');
      w := regexp_replace(w, '(?<!SELECT )get_my_role\(\)', '(select public.get_my_role())', 'g');
      w := regexp_replace(w, '(?<!SELECT )get_my_empresa_id\(\)', '(select public.get_my_empresa_id())', 'g');
    end if;

    sentencia := format('alter policy %I on public.%I', p.policyname, p.tablename);
    if q is not null then sentencia := sentencia || ' using (' || q || ')'; end if;
    if w is not null then sentencia := sentencia || ' with check (' || w || ')'; end if;
    execute sentencia;
    n := n + 1;
  end loop;

  raise notice 'policies optimizadas: %', n;
end $$;


-- ---------------------------------------------------------------------------
-- 2.2 Índice de la FK que quedó sin cubrir
-- ---------------------------------------------------------------------------
-- notificaciones_empresa.autor_id (20260830000000 indexó ruta_id y bus_id pero
-- no esta): sin índice, borrar un perfil escanea la tabla entera para resolver
-- el `on delete set null`.
create index if not exists idx_notificaciones_empresa_autor_id
  on public.notificaciones_empresa(autor_id);
