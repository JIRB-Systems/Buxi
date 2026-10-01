-- Los buses y su posición en vivo se ven solo si seguís a la empresa.
--
-- Hasta ahora `buses` y `bus_locations` tenían lectura pública ("Public read
-- ...", using (true) y sin rol, así que también para `anon`). El mapa del
-- pasajero dibujaba y contaba todos los buses del país, siguiera o no a sus
-- empresas, y cualquiera con la anon key podía pedir la posición de cualquier
-- bus. 20260823000000 las había dejado públicas a propósito ("información de
-- transporte público"); la regla de producto cambió: seguir una empresa es lo
-- que da acceso a sus buses, al conteo "N buses en vivo" y a sus avisos. Los
-- avisos ya se filtraban así en la base (20260830000000); esto aplica el mismo
-- criterio a los buses, y en la base, no en el cliente: si solo se escondieran
-- en el mapa, las posiciones seguirían a un GET de distancia.
--
-- Rutas, paradas y horarios siguen siendo públicos a propósito: sin ellos el
-- pasajero no tiene cómo descubrir qué empresa seguir.
--
-- Quién ve qué después de esto:
--   * pasajero                  -> buses y posiciones de las empresas que sigue
--   * chofer y admin de empresa -> los de su propia empresa (más los que siga)
--   * admin_jirb                -> todo, por "JIRB manage buses" y
--                                  "JIRB manage bus_locations", que no cambian
--   * anon                      -> nada
--
-- Realtime respeta RLS, así que el mismo filtro corta lo que llega en vivo: el
-- pasajero deja de recibir cada punto GPS del país, y el mapa en vivo del panel
-- de empresa deja de recibir (y de dibujar) los buses de las demás.
--
-- Se verificó que nada que siga funcionando depende de la lectura pública:
--   * el chofer lee su bus y su flota por empresa (ChoferService), que entra
--     por su propia empresa;
--   * los paneles de empresa y de JIRB ya tenían sus propias policies;
--   * flag_anomalous_location() lee el punto anterior del bus como SECURITY
--     DEFINER, así que no depende de estas policies.


-- ---------------------------------------------------------------------------
-- 1. Qué empresas y qué buses puede ver quien consulta
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER para que evaluar la policy de bus_locations no dispare a su
-- vez el RLS de profiles, favoritos_empresa y buses (y para que la de buses no
-- se consulte a sí misma). Usadas como `x in (select f())` son subconsultas sin
-- correlación: Postgres las resuelve una vez por consulta y cruza cada fila con
-- un hash, en vez de repetirlas por fila.
create or replace function public.mis_empresas_visibles()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.empresa_id
  from public.profiles p
  where p.id = auth.uid()
    and p.rol in ('chofer', 'admin_empresa')
    and p.empresa_id is not null
  union
  select f.empresa_id
  from public.favoritos_empresa f
  where f.user_id = auth.uid();
$$;

create or replace function public.mis_buses_visibles()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select b.id
  from public.buses b
  where b.empresa_id in (select public.mis_empresas_visibles());
$$;

-- Solo las usan policies de `authenticated`. Revocar a PUBLIC no alcanza:
-- Supabase le da EXECUTE a anon y authenticated por default privileges.
revoke execute on function public.mis_empresas_visibles() from public, anon;
revoke execute on function public.mis_buses_visibles()    from public, anon;
grant  execute on function public.mis_empresas_visibles() to authenticated;
grant  execute on function public.mis_buses_visibles()    to authenticated;


-- ---------------------------------------------------------------------------
-- 2. buses
-- ---------------------------------------------------------------------------
-- `buses` también se cierra, no solo las posiciones: buses.estado = 'en_ruta'
-- ya dice cuántos buses de cada empresa están circulando, que es justo lo que
-- no tiene que saber quien no la sigue.
drop policy if exists "Public read buses" on public.buses;

drop policy if exists "Ve los buses de sus empresas" on public.buses;
create policy "Ve los buses de sus empresas" on public.buses
  for select to authenticated
  using (empresa_id in (select public.mis_empresas_visibles()));


-- ---------------------------------------------------------------------------
-- 3. bus_locations
-- ---------------------------------------------------------------------------
-- latest_bus_locations() y latest_bus_locations_by_ruta() son SECURITY INVOKER
-- (20260809120000): heredan esta policy sin tocarlas.
drop policy if exists "Public read bus_locations" on public.bus_locations;

drop policy if exists "Ve la posición de los buses de sus empresas" on public.bus_locations;
create policy "Ve la posición de los buses de sus empresas" on public.bus_locations
  for select to authenticated
  using (bus_id in (select public.mis_buses_visibles()));


-- ---------------------------------------------------------------------------
-- 4. anon
-- ---------------------------------------------------------------------------
-- Sin policy para anon ya no lee ninguna fila; se le quita también el permiso
-- para que la intención quede escrita y un `select` sin sesión falle en vez de
-- volver vacío. Revocar el SELECT de la tabla revoca además los permisos por
-- columna que le dio 20260824000000 sobre buses.
revoke select on public.buses         from anon;
revoke select on public.bus_locations from anon;
