-- ---------------------------------------------------------------------------
-- PERSONALIZACIÓN DEL BUS: MODELO, Y COLOR Y MODELO POR UNIDAD
-- ---------------------------------------------------------------------------
-- Segunda pieza de "Personalización" en el panel de empresa, al lado de
-- `empresas.color_bus` (20260919000000). Los dibujos de los modelos viven en
-- el cliente (core/utils/bus-modelos.ts); acá solo se guarda lo elegido.
--
--   empresas.modelo_bus  el modelo de toda la flota. null = urbano.
--   buses.modelo_bus     el modelo propio de una unidad ("urbano en la R1").
--   buses.color_bus      el color propio de una unidad.
--
-- En las unidades, null = "como la flota". El color que se ve es entonces:
-- buses.color_bus, si no empresas.color_bus, si no el de la ruta.
--
-- Todas NULLABLE, como `color_bus`: nada cambia de aspecto hasta que alguien
-- elija, y no hay que rellenar filas al migrar.
alter table public.empresas add column if not exists modelo_bus text;
alter table public.buses add column if not exists modelo_bus text;
alter table public.buses add column if not exists color_bus text;

-- Hex de 6 dígitos, igual que empresas.color_bus: el valor termina en un
-- canvas (ctx.fillStyle) y en un SVG.
do $$
begin
  alter table public.buses
    add constraint buses_color_bus_hex
    check (color_bus is null or color_bus ~ '^#[0-9A-Fa-f]{6}$');
exception
  when duplicate_object then null;
end
$$;

-- Solo los modelos que el cliente sabe dibujar. Si mañana se agrega uno, se
-- suma acá y en MODELOS_BUS a la vez (y se recrean estas dos constraints).
do $$
begin
  alter table public.empresas
    add constraint empresas_modelo_bus_valido
    check (modelo_bus is null or modelo_bus in (
      'urbano', 'buseta', 'interurbano', 'articulado', 'microbus', 'electrico',
      'dos_pisos', 'trompa', 'panoramico', 'piso_bajo', 'shuttle', 'descapotable'));
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  alter table public.buses
    add constraint buses_modelo_bus_valido
    check (modelo_bus is null or modelo_bus in (
      'urbano', 'buseta', 'interurbano', 'articulado', 'microbus', 'electrico',
      'dos_pisos', 'trompa', 'panoramico', 'piso_bajo', 'shuttle', 'descapotable'));
exception
  when duplicate_object then null;
end
$$;

-- Permisos: no hace falta tocar nada.
--   empresas: la escritura la cubre "Admin empresa actualiza su propia
--   empresa" (policy de fila entera) y la lectura "Public read empresas".
--   buses: la escritura la cubre "Admin empresa manage buses" (fila entera,
--   solo sus buses) y la lectura la de buses visibles de 20260930000000, que
--   es la que el mapa del pasajero va a usar para dibujar cada unidad.
