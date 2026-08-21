-- Corrige tres revokes de la migración 20260823000000 que NO tuvieron efecto.
--
-- La causa es la misma que documentó 20260718051855 para las funciones, ahora
-- en su versión de columnas: `anon` y `authenticated` tienen el privilegio a
-- **nivel de tabla** (Supabase hace `grant all on all tables` a esos roles), y
-- un `revoke <priv> (columna) ... from <rol>` contra un rol que tiene el
-- permiso de la tabla entera **no hace nada**. Postgres no puede restarle una
-- columna a un grant de tabla completa.
--
-- Verificado en producción después de aplicar 20260823000000:
--   information_schema.column_privileges seguía mostrando las 8 columnas de
--   bus_locations con INSERT para `authenticated`, y
--   has_column_privilege('anon','public.buses','chofer_id','SELECT') = true.
--
-- El patrón correcto es el que sí funcionó para el UPDATE de bus_locations en
-- 20260821000000: **revocar primero a nivel de tabla, y recién después conceder
-- las columnas concretas.**


-- ---------------------------------------------------------------------------
-- 1. bus_locations: el chofer TODAVÍA puede fabricar el timestamp
-- ---------------------------------------------------------------------------
-- Éste es el que importa: el agujero que 20260823000000 decía cerrar sigue
-- abierto. Mandando cada punto con una fecha que no avanza, `horas` da <= 0 en
-- flag_anomalous_location() y la detección de spoofing no corre.
--
-- (El refuerzo del trigger de esa misma migración —marcar `horas <= 0` con
-- salto > 500 m— sí quedó aplicado, así que el caso más burdo ya se marca. Esto
-- cierra el resto.)
revoke insert on public.bus_locations from anon, authenticated;

-- anon no tiene por qué insertar ubicaciones: la policy "Chofer insert
-- location" exige auth.uid(), así que sin sesión nunca pasaría igual, pero se
-- quita el privilegio para que no dependa solo de la policy.
grant insert (bus_id, latitud, longitud, velocidad, heading)
  on public.bus_locations to authenticated;


-- ---------------------------------------------------------------------------
-- 2. Columnas que atan una fila a una persona, ocultas para `anon`
-- ---------------------------------------------------------------------------
-- Mismo error, mismo arreglo. Se listan las columnas explícitamente en vez de
-- usar `*` para que, si alguien agrega una columna nueva a estas tablas, `anon`
-- NO la reciba por defecto — que falle y obligue a decidir, en vez de filtrar
-- en silencio.
--
-- Recordatorio del efecto lateral (ya anotado en 20260823000000): con esto un
-- `select *` de `anon` sobre estas tablas falla, porque `*` expande a todas las
-- columnas incluida la que no tiene. Ninguna pantalla lo hace hoy — toda la app
-- pasa por RoleGuard. Una vista pública futura debe pedir columnas explícitas.

revoke select on public.buses from anon;
grant  select (id, empresa_id, ruta_id, placa, numero_unidad, capacidad, estado, created_at)
  on public.buses to anon;

revoke select on public.calificaciones from anon;
grant  select (id, ruta_id, bus_id, estrellas, comentario, created_at)
  on public.calificaciones to anon;

revoke select on public.lugares_personalizados from anon;
grant  select (id, nombre, latitud, longitud, created_at)
  on public.lugares_personalizados to anon;


-- ---------------------------------------------------------------------------
-- 3. EXECUTE de funciones: revocar del rol, no solo de PUBLIC
-- ---------------------------------------------------------------------------
-- `chofer_set_bus_estado` (creada en 20260821000000) revocaba EXECUTE de PUBLIC
-- y lo concedía a `authenticated`, pero el advisor la sigue reportando como
-- ejecutable por `anon`: Supabase tiene default privileges que le conceden
-- EXECUTE directamente a anon/authenticated, y ese grant directo no lo quita un
-- revoke a PUBLIC.
--
-- No era explotable — adentro filtra por `chofer_id = auth.uid()`, que para anon
-- es null y no matchea ninguna fila — pero una función SECURITY DEFINER no debe
-- quedar expuesta sin sesión.
revoke execute on function public.chofer_set_bus_estado(uuid, text) from anon;

-- Las otras dos son funciones de trigger que quedaron fuera del barrido de
-- 20260713100000 / 20260718051855. Tampoco son invocables directamente
-- (Postgres rehúsa llamar una función que retorna `trigger`), pero mantienen el
-- advisor en rojo y esconden las que sí importan.
revoke execute on function public.autoconfirm_admin_created_user() from public, anon, authenticated;
revoke execute on function public.rate_limit_solicitud_empresa()  from public, anon, authenticated;
