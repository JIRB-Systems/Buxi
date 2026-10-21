-- Las solicitudes de empresa entran SOLO por la función solicitud-empresa.
--
-- "Anyone can submit solicitud" dejaba a cualquiera, sin cuenta, insertar lo
-- que quisiera en la tabla: sin límite, sin validación y con cualquier estado
-- (también "aprobada"). La función guarda con la clave de servicio, que no
-- pasa por RLS, así que esta política ya no hace falta para nada.
--
-- JIRB sigue administrando las solicitudes con "JIRB manage solicitudes".
--
-- Se corrió a mano en el editor SQL el 2026-10-20, así que no quedó en el
-- historial de migraciones. Lleva un número posterior a la última registrada
-- para que la integración de GitHub no la rechace; si la vuelve a correr no
-- cambia nada (la política ya no existe y anon ya no tiene INSERT).

drop policy if exists "Anyone can submit solicitud" on public.solicitudes_empresa;

revoke insert on public.solicitudes_empresa from anon;
