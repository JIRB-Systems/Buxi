-- ---------------------------------------------------------------------------
-- PERSONALIZACIÓN DEL BUS POR EMPRESA
-- ---------------------------------------------------------------------------
-- Hasta ahora el bus que se dibuja en el mapa se teñía con el color de la
-- RUTA. Eso distingue bien un recorrido de otro, pero no deja que una empresa
-- se vea como ella misma: sus unidades salían de un color distinto en cada
-- ruta, y ninguno era el suyo.
--
-- `color_bus` es la primera pieza de "Personalización" en el panel de empresa.
-- Después vienen el modelo y el diseño del bus, que van a ser columnas nuevas
-- acá al lado; por eso el nombre lleva el prefijo y no es un `color` a secas,
-- que se confundiría con el de las rutas.
--
-- Queda NULLABLE a propósito: null significa "seguí usando el color de la
-- ruta", que es el comportamiento de siempre. Así ninguna empresa cambia de
-- aspecto hasta que alguien elija, y no hace falta rellenar nada al migrar.
alter table public.empresas
  add column if not exists color_bus text;

-- Hex de 6 dígitos y nada más.
--
-- Esto no es cosmético: el valor viaja hasta un canvas y termina en
-- ctx.fillStyle, que acepta cualquier cosa que el navegador sepa interpretar y
-- no valida nada. El saneo del cliente (colorSeguro, de 3f35ff8) sigue siendo
-- la primera línea, pero es del cliente — la constraint es la que no se puede
-- saltar desde el navegador.
--
-- En DO/EXCEPTION porque ADD CONSTRAINT no tiene IF NOT EXISTS y la migración
-- tiene que poder correr dos veces sin romperse.
do $$
begin
  alter table public.empresas
    add constraint empresas_color_bus_hex
    check (color_bus is null or color_bus ~ '^#[0-9A-Fa-f]{6}$');
exception
  when duplicate_object then null;
end
$$;


-- ---- Permisos ----
-- No hace falta tocar RLS y conviene dejar dicho por qué, para que el próximo
-- que agregue una columna de personalización no salga a buscar:
--
--   ESCRITURA: ya existe "Admin empresa actualiza su propia empresa"
--   (20260819210000), que es una policy de fila entera sin lista de columnas.
--   Una columna nueva entra sola.
--
--   LECTURA: "Public read empresas" (20260629000000) es `using (true)` a
--   propósito — el pasajero necesita leer el color para pintar el bus en el
--   mapa, igual que ya lee el nombre y el logo.
--
-- Ojo para el futuro: que la policy sea de fila entera también significa que
-- un admin_empresa puede escribir CUALQUIER columna de su fila, `estado`
-- incluido. Es anterior a este cambio y no se toca acá, pero si algún día se
-- restringe por columnas, `color_bus` tiene que entrar en la lista o la
-- personalización deja de guardarse en silencio.
