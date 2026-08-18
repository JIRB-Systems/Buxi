-- Precio del pasaje por ruta. Los horarios ya existían (tabla `horarios`,
-- creada en 20260629100000) con RLS que ya deja a admin_empresa
-- gestionar los de sus propias rutas y a cualquiera leerlos — lo único
-- que faltaba para esa parte era la UI, no la base de datos.
alter table public.rutas add column if not exists precio numeric(10,2);
