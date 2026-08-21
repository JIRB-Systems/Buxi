-- Higiene de RLS y de índices. No cambia QUÉ puede hacer nadie: es
-- rendimiento y ruido de linter. Sale de los 263 avisos del advisor de
-- Supabase (222 multiple_permissive_policies, 20 auth_rls_initplan,
-- 20+ unindexed_foreign_keys) revisados el 2026-08-20.
--
-- Se hace ahora, con la base casi vacía, justamente porque después no se va a
-- poder hacer sin cuidado: crear índices sobre bus_locations con millones de
-- filas es otra conversación.


-- ---------------------------------------------------------------------------
-- 1. Acotar a `authenticated` las policies que ya dependen de estar logueado
-- ---------------------------------------------------------------------------
-- Ninguna policy del proyecto declara `TO`, así que todas quedaron en `public`
-- y Postgres las evalúa también para `anon`. Para las 62 de acá abajo eso es
-- trabajo tirado: todas exigen get_my_role() o auth.uid(), que para un
-- visitante sin sesión son null, así que nunca pueden dar true.
--
-- Se usa ALTER POLICY ... TO en vez de DROP + CREATE a propósito: ALTER solo
-- toca el rol y deja las expresiones USING/WITH CHECK intactas. Reescribir 62
-- expresiones a mano para cambiar una sola palabra es justo el tipo de cambio
-- "mecánico" donde se cuela una regresión de seguridad por un paréntesis.
--
-- Las policies de lectura pública (`using (true)` en empresas, rutas, paradas,
-- buses, bus_locations, viajes, planes, horarios) NO se tocan: el acceso
-- anónimo ahí es deliberado, y los RPC latest_bus_locations* tienen GRANT a
-- anon por la misma razón. Tampoco se toca "Anyone can submit solicitud", que
-- es el formulario público de alta de empresas.

alter policy "JIRB read all logs" on public.activity_logs to authenticated;

alter policy "JIRB gestiona anuncios" on public.anuncios to authenticated;
alter policy "Pasajeros ven anuncios vigentes" on public.anuncios to authenticated;

alter policy "JIRB gestiona avisos" on public.avisos_sistema to authenticated;
alter policy "Empresa admin lee avisos activos" on public.avisos_sistema to authenticated;

alter policy "Pasajero crea sus boletos" on public.boletos to authenticated;
alter policy "Pasajero ve sus boletos" on public.boletos to authenticated;
alter policy "Chofer ve y valida boletos de su empresa" on public.boletos to authenticated;
alter policy "Chofer marca boletos como usados" on public.boletos to authenticated;

alter policy "JIRB manage bus_locations" on public.bus_locations to authenticated;
alter policy "Chofer insert location" on public.bus_locations to authenticated;
alter policy "Empresa admin dismiss own anomalies" on public.bus_locations to authenticated;

alter policy "Admin empresa manage buses" on public.buses to authenticated;
alter policy "JIRB manage buses" on public.buses to authenticated;

alter policy "JIRB manage calificaciones" on public.calificaciones to authenticated;
alter policy "Users create own ratings" on public.calificaciones to authenticated;
alter policy "Users delete own ratings" on public.calificaciones to authenticated;

alter policy "JIRB manage empresas" on public.empresas to authenticated;
alter policy "Admin empresa read own empresa" on public.empresas to authenticated;
alter policy "Admin empresa actualiza su propia empresa" on public.empresas to authenticated;

alter policy "JIRB gestiona facturas" on public.facturas to authenticated;
alter policy "Admin empresa lee sus facturas" on public.facturas to authenticated;

alter policy "Users manage own favorites" on public.favoritos to authenticated;
alter policy "JIRB read favoritos" on public.favoritos to authenticated;

alter policy "Admin empresa manage horario_salidas" on public.horario_salidas to authenticated;

alter policy "Admin empresa manage horarios" on public.horarios to authenticated;
alter policy "JIRB manage horarios" on public.horarios to authenticated;

alter policy "Empresa/JIRB admins add lugares" on public.lugares_personalizados to authenticated;

alter policy "Admin empresa envia mensajes a su chofer" on public.mensajes_chofer to authenticated;
alter policy "Admin empresa ve los mensajes que mando" on public.mensajes_chofer to authenticated;
alter policy "Chofer ve sus propios mensajes" on public.mensajes_chofer to authenticated;
alter policy "Chofer marca sus mensajes como leidos" on public.mensajes_chofer to authenticated;

alter policy "Admin empresa manage paradas" on public.paradas to authenticated;
alter policy "JIRB manage paradas" on public.paradas to authenticated;

alter policy "JIRB manage planes" on public.planes to authenticated;

alter policy "Profiles are created via trigger" on public.profiles to authenticated;
alter policy "Users can view their own profile" on public.profiles to authenticated;
alter policy "Users can update their own profile" on public.profiles to authenticated;
alter policy "JIRB read all profiles" on public.profiles to authenticated;
alter policy "JIRB update all profiles" on public.profiles to authenticated;
alter policy "Empresa admin read own staff profiles" on public.profiles to authenticated;
alter policy "Empresa admin manage own staff profiles" on public.profiles to authenticated;

alter policy "Chofer crea reportes de su empresa" on public.reportes_bugs to authenticated;
alter policy "Empresa admin crea reportes propios" on public.reportes_bugs to authenticated;
alter policy "Empresa admin lee reportes propios" on public.reportes_bugs to authenticated;
alter policy "Admin empresa resuelve reportes de su empresa" on public.reportes_bugs to authenticated;
alter policy "JIRB responde y gestiona reportes" on public.reportes_bugs to authenticated;

alter policy "Admin empresa manage rutas" on public.rutas to authenticated;
alter policy "JIRB manage rutas" on public.rutas to authenticated;

alter policy "JIRB manage solicitudes" on public.solicitudes_empresa to authenticated;

alter policy "JIRB gestiona solicitudes_plan" on public.solicitudes_plan to authenticated;
alter policy "Admin empresa crea sus solicitudes de plan" on public.solicitudes_plan to authenticated;
alter policy "Admin empresa lee sus solicitudes de plan" on public.solicitudes_plan to authenticated;

alter policy "JIRB manage suscripciones" on public.suscripciones to authenticated;
alter policy "Admin empresa read own sub" on public.suscripciones to authenticated;

alter policy "JIRB manage config" on public.system_config to authenticated;

alter policy "Chofer insert tramo" on public.tramos_historial to authenticated;
alter policy "Empresa/JIRB read tramos" on public.tramos_historial to authenticated;

alter policy "Users manage own preferences" on public.user_preferences to authenticated;
alter policy "JIRB read preferences" on public.user_preferences to authenticated;

alter policy "Chofer manage own viajes" on public.viajes to authenticated;
alter policy "JIRB manage viajes" on public.viajes to authenticated;
alter policy "Admin empresa read viajes" on public.viajes to authenticated;


-- ---------------------------------------------------------------------------
-- 2. Índices para las 28 claves foráneas que no tenían ninguno
-- ---------------------------------------------------------------------------
-- Sin índice en la FK, un DELETE en la tabla padre hace un scan completo de la
-- hija para verificar la restricción, y los joins del producto (rutas de una
-- empresa, paradas de una ruta, buses de una ruta) tampoco lo aprovechan.
--
-- Van sin CONCURRENTLY porque las migraciones corren dentro de una
-- transacción y CONCURRENTLY no lo permite. Con el tamaño actual de las tablas
-- es instantáneo; si alguna de estas creciera mucho antes de aplicarse, habría
-- que sacarla de acá y crearla aparte.

create index if not exists idx_activity_logs_user_id            on public.activity_logs(user_id);
create index if not exists idx_anuncios_autor_id                on public.anuncios(autor_id);
create index if not exists idx_avisos_sistema_autor_id          on public.avisos_sistema(autor_id);
create index if not exists idx_boletos_ruta_id                  on public.boletos(ruta_id);
create index if not exists idx_boletos_usado_por                on public.boletos(usado_por);
create index if not exists idx_buses_chofer_id                  on public.buses(chofer_id);
create index if not exists idx_buses_empresa_id                 on public.buses(empresa_id);
create index if not exists idx_buses_ruta_id                    on public.buses(ruta_id);
create index if not exists idx_calificaciones_bus_id            on public.calificaciones(bus_id);
create index if not exists idx_calificaciones_ruta_id           on public.calificaciones(ruta_id);
create index if not exists idx_calificaciones_user_id           on public.calificaciones(user_id);
create index if not exists idx_facturas_empresa_id              on public.facturas(empresa_id);
create index if not exists idx_facturas_plan_id                 on public.facturas(plan_id);
create index if not exists idx_favoritos_ruta_id                on public.favoritos(ruta_id);
create index if not exists idx_horarios_ruta_id                 on public.horarios(ruta_id);
create index if not exists idx_lugares_personalizados_created_by on public.lugares_personalizados(created_by);
create index if not exists idx_mensajes_chofer_autor_id         on public.mensajes_chofer(autor_id);
create index if not exists idx_mensajes_chofer_empresa_id       on public.mensajes_chofer(empresa_id);
create index if not exists idx_paradas_ruta_id                  on public.paradas(ruta_id);
create index if not exists idx_reportes_bugs_autor_id           on public.reportes_bugs(autor_id);
create index if not exists idx_reportes_bugs_empresa_id         on public.reportes_bugs(empresa_id);
create index if not exists idx_reportes_bugs_respondido_por     on public.reportes_bugs(respondido_por);
create index if not exists idx_rutas_empresa_id                 on public.rutas(empresa_id);
create index if not exists idx_solicitudes_plan_empresa_id      on public.solicitudes_plan(empresa_id);
create index if not exists idx_solicitudes_plan_plan_id         on public.solicitudes_plan(plan_id);
create index if not exists idx_suscripciones_plan_id            on public.suscripciones(plan_id);
create index if not exists idx_tramos_historial_bus_id          on public.tramos_historial(bus_id);
create index if not exists idx_tramos_historial_parada_destino  on public.tramos_historial(parada_destino_id);


-- ---------------------------------------------------------------------------
-- Lo que este barrido NO hace, y por qué
-- ---------------------------------------------------------------------------
-- 1. `auth_rls_initplan` (20 avisos): auth.uid() y get_my_role() se evalúan
--    por fila en vez de una sola vez; se arregla envolviéndolas en
--    (select ...). Queda pendiente a propósito: obliga a reescribir las 20
--    expresiones a mano (ALTER POLICY no puede hacerlo sin re-transcribirlas)
--    y hoy solo afecta a tablas de decenas de filas. Vale la pena cuando haya
--    volumen real, no antes.
--
-- 2. Los `multiple_permissive_policies` que quedan del lado de
--    `authenticated`: son inherentes al diseño (una lectura pública + una
--    policy de gestión por rol sobre la misma tabla). Unificarlas significa
--    fusionar policies con OR, que sí cambia la lógica de permisos. No es
--    higiene, es rediseño.
