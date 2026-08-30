-- Notificaciones de empresa hacia los pasajeros que la siguen.
--
-- Hasta ahora el interruptor "Notificaciones" del panel de perfil escribía
-- user_preferences.notifications_enabled y nadie lo leía, y el panel "Alertas"
-- era un vacío pintado a mano en el HTML. No había ningún canal: ni tabla, ni
-- plugin de push, ni service worker.
--
-- Esto arma el canal más chico que sirve de verdad, y todo en la base:
--   1. el pasajero marca una EMPRESA como favorita (antes solo podía rutas),
--   2. la empresa manda un aviso (atraso, desvío, cancelación, info),
--   3. le llega a todos sus seguidores, en vivo, al panel de Alertas.
--
-- Queda deliberadamente fuera el push del sistema operativo (FCM/APNs): eso
-- necesita plugin nativo, credenciales y configuración de la tienda. Esto es
-- in-app y por realtime, que es lo que hoy se puede entregar entero.


-- ---------------------------------------------------------------------------
-- 1. FAVORITOS DE EMPRESA
-- ---------------------------------------------------------------------------
-- Tabla aparte de `favoritos` en vez de agregarle una columna nullable: ahí
-- `ruta_id` es NOT NULL y forma la unique con user_id. Volverlo opcional para
-- que la misma fila sirva a dos cosas obliga a un check de "uno u otro" y a
-- una unique parcial por cada caso, y deja a todo el código existente teniendo
-- que preguntar de qué tipo es cada fila. Dos tablas simples se leen mejor.
create table if not exists public.favoritos_empresa (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, empresa_id)
);

alter table public.favoritos_empresa enable row level security;

-- Mismo criterio que "Users manage own favorites": cada quien administra los
-- suyos y no ve los de nadie más.
drop policy if exists "Usuario administra sus empresas favoritas" on public.favoritos_empresa;
create policy "Usuario administra sus empresas favoritas" on public.favoritos_empresa
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- La unique (user_id, empresa_id) ya indexa user_id por la izquierda; falta el
-- otro lado, que es por donde entra la policy de lectura de notificaciones y
-- el conteo de seguidores.
create index if not exists idx_favoritos_empresa_empresa_id
  on public.favoritos_empresa(empresa_id);


-- ---------------------------------------------------------------------------
-- 2. NOTIFICACIONES
-- ---------------------------------------------------------------------------
-- `ruta_id` y `bus_id` son opcionales y sirven para acotar el aviso: "atraso
-- en la ruta X" se entiende mucho mejor que "atraso". Van con `on delete set
-- null` y no `cascade` a propósito: si mañana se borra el bus, el aviso que
-- los pasajeros ya recibieron no tiene por qué desaparecer del historial.
create table if not exists public.notificaciones_empresa (
  id uuid default gen_random_uuid() primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  autor_id uuid references public.profiles(id) on delete set null,
  ruta_id uuid references public.rutas(id) on delete set null,
  bus_id uuid references public.buses(id) on delete set null,
  tipo text not null default 'info' check (tipo in ('atraso', 'desvio', 'cancelacion', 'info')),
  titulo text not null check (length(trim(titulo)) between 1 and 120),
  mensaje text not null check (length(trim(mensaje)) between 1 and 500),
  created_at timestamptz not null default now()
);

alter table public.notificaciones_empresa enable row level security;

-- Índice del camino caliente: "las notificaciones de estas empresas, las más
-- nuevas primero". Sin él, cada apertura del panel de Alertas es un scan.
create index if not exists idx_notificaciones_empresa_empresa_fecha
  on public.notificaciones_empresa(empresa_id, created_at desc);

-- Índices de las otras dos FK, por la misma razón que el barrido de
-- 20260822000000: sin ellos, borrar una ruta o un bus escanea esta tabla
-- entera para verificar el `on delete set null`.
create index if not exists idx_notificaciones_empresa_ruta_id on public.notificaciones_empresa(ruta_id);
create index if not exists idx_notificaciones_empresa_bus_id  on public.notificaciones_empresa(bus_id);


-- ---- Quién puede ESCRIBIR ----
-- El `titulo`, el `mensaje` y el `tipo` los propone el cliente; el `id` y el
-- `created_at` los pone la base. Se revoca a nivel de TABLA y recién después
-- se conceden las columnas concretas: al revés no funciona, porque Supabase le
-- da `grant all on all tables` a estos roles y un revoke de columna contra un
-- grant de tabla entera no hace nada. Es exactamente lo que documentó
-- 20260824000000 después de que tres revokes quedaran sin efecto.
revoke insert on public.notificaciones_empresa from anon, authenticated;
grant insert (empresa_id, autor_id, ruta_id, bus_id, tipo, titulo, mensaje)
  on public.notificaciones_empresa to authenticated;

-- La empresa solo puede escribir a nombre de SU empresa y firmando con su
-- propio id. `autor_id` se valida acá y no se deduce solo porque la columna es
-- nullable (queda null si después se borra la cuenta del autor).
drop policy if exists "Empresa admin manda notificaciones propias" on public.notificaciones_empresa;
create policy "Empresa admin manda notificaciones propias" on public.notificaciones_empresa
  for insert to authenticated
  with check (
    public.get_my_role() = 'admin_empresa'
    and empresa_id = public.get_my_empresa_id()
    and autor_id = auth.uid()
    -- La ruta y el bus, si vienen, tienen que ser de la misma empresa. Sin
    -- esto una empresa podría publicar "cancelada" colgado de la ruta de otra.
    and (
      notificaciones_empresa.ruta_id is null
      or exists (
        select 1 from public.rutas r
        where r.id = notificaciones_empresa.ruta_id
          and r.empresa_id = notificaciones_empresa.empresa_id
      )
    )
    and (
      notificaciones_empresa.bus_id is null
      or exists (
        select 1 from public.buses b
        where b.id = notificaciones_empresa.bus_id
          and b.empresa_id = notificaciones_empresa.empresa_id
      )
    )
  );

-- Borrar sí (una empresa se puede arrepentir de un aviso), editar no: un aviso
-- ya entregado que cambia de texto a espaldas del que lo leyó es peor que uno
-- borrado. Sin policy de UPDATE, no hay UPDATE.
drop policy if exists "Empresa admin borra notificaciones propias" on public.notificaciones_empresa;
create policy "Empresa admin borra notificaciones propias" on public.notificaciones_empresa
  for delete to authenticated
  using (
    public.get_my_role() = 'admin_empresa'
    and empresa_id = public.get_my_empresa_id()
  );


-- ---- Quién puede LEER ----
-- El pasajero ve las notificaciones de las empresas que marcó como favoritas,
-- y solo esas. Esto es lo que convierte "seguir una empresa" en una
-- suscripción de verdad: el filtro vive en la base, no en el cliente.
drop policy if exists "Pasajero lee notificaciones de sus empresas favoritas" on public.notificaciones_empresa;
create policy "Pasajero lee notificaciones de sus empresas favoritas" on public.notificaciones_empresa
  for select to authenticated
  using (
    exists (
      select 1 from public.favoritos_empresa f
      where f.empresa_id = notificaciones_empresa.empresa_id
        and f.user_id = auth.uid()
    )
  );

-- La empresa ve su propio historial (para saber qué mandó y poder borrarlo), y
-- JIRB ve todo, que es lo que ya puede hacer con avisos y reportes.
drop policy if exists "Empresa admin lee notificaciones propias" on public.notificaciones_empresa;
create policy "Empresa admin lee notificaciones propias" on public.notificaciones_empresa
  for select to authenticated
  using (
    public.get_my_role() = 'admin_empresa'
    and empresa_id = public.get_my_empresa_id()
  );

drop policy if exists "JIRB lee todas las notificaciones" on public.notificaciones_empresa;
create policy "JIRB lee todas las notificaciones" on public.notificaciones_empresa
  for select to authenticated
  using (public.get_my_role() = 'admin_jirb');


-- ---------------------------------------------------------------------------
-- 3. MARCA DE LEÍDO
-- ---------------------------------------------------------------------------
-- Una sola marca de tiempo por usuario en vez de una tabla de "leídas": para
-- lo único que hace falta —el globito con el número de no leídas— alcanza con
-- "cuántas hay más nuevas que la última vez que abrí el panel". Una tabla
-- N a N crecería con cada notificación por cada seguidor para responder la
-- misma pregunta.
--
-- Arranca en null y se trata como "nunca abrió el panel": en ese caso cuentan
-- todas las que estén dentro de la ventana que consulta el cliente.
alter table public.user_preferences
  add column if not exists notificaciones_vistas_at timestamptz;


-- ---------------------------------------------------------------------------
-- 4. CUÁNTA GENTE ME SIGUE
-- ---------------------------------------------------------------------------
-- La empresa necesita saber a cuántos les va a llegar antes de mandar. No se
-- resuelve con una policy de lectura sobre favoritos_empresa: eso le daría los
-- user_id de sus seguidores, que es justo lo que no tiene por qué ver. Una
-- función SECURITY DEFINER devuelve el número y nada más.
create or replace function public.contar_seguidores_empresa(p_empresa_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.favoritos_empresa f
  where f.empresa_id = p_empresa_id
    -- Solo la propia empresa o JIRB. Sin esto, cualquiera con sesión podría
    -- sondear el número de seguidores de cualquier empresa.
    and (
      (public.get_my_role() = 'admin_empresa' and p_empresa_id = public.get_my_empresa_id())
      or public.get_my_role() = 'admin_jirb'
    )
$$;

-- Mismo cuidado que con chofer_set_bus_estado en 20260824000000: revocar de
-- PUBLIC no alcanza, Supabase le concede EXECUTE a anon directamente.
revoke execute on function public.contar_seguidores_empresa(uuid) from public, anon;
grant  execute on function public.contar_seguidores_empresa(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 5. REALTIME
-- ---------------------------------------------------------------------------
-- Para que un atraso aparezca en el teléfono del pasajero mientras tiene la
-- app abierta, sin tener que cerrar y volver a abrir el panel. Realtime
-- respeta RLS, así que cada quien recibe únicamente los INSERT que su policy
-- de SELECT le deja ver — o sea, solo los de las empresas que sigue.
do $$
begin
  alter publication supabase_realtime add table public.notificaciones_empresa;
exception
  when duplicate_object then null;
end
$$;
