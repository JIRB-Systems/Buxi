-- Balde público `mapa` para archivos del mapa que arma Buxci.
--
-- Por ahora uno: comercios-cr.pmtiles, los comercios de Costa Rica que saca
-- cada mes el workflow "Comercios del mapa" desde Overture Maps. El mapa del
-- pasajero lo lee por partes (pedidos Range), solo la zona que mira.
--
-- Solo lo escribe ese workflow, con la clave de servicio (que salta RLS):
-- no hace falta ninguna política para subir. Leer es público.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mapa', 'mapa', true, 100 * 1024 * 1024, array['application/octet-stream'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
