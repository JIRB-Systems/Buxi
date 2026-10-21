-- Las solicitudes de empresa entran SOLO por la función solicitud-empresa.
--
-- "Anyone can submit solicitud" dejaba a cualquiera, sin cuenta, insertar lo
-- que quisiera en la tabla: sin límite, sin validación y con cualquier estado
-- (también "aprobada"). La función guarda con la clave de servicio, que no
-- pasa por RLS, así que esta política ya no hace falta para nada.
--
-- JIRB sigue administrando las solicitudes con "JIRB manage solicitudes".

drop policy if exists "Anyone can submit solicitud" on public.solicitudes_empresa;

revoke insert on public.solicitudes_empresa from anon;
