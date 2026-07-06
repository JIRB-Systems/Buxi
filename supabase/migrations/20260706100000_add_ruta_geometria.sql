-- Guarda el recorrido real (punto a punto, siguiendo calles) de cada ruta,
-- generado automáticamente en vez de recalcularse en cada carga del mapa.
alter table public.rutas add column if not exists geometria jsonb;
