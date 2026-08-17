-- El formulario de empresa-request siempre manda logo_url (null si no hay
-- logo) y el dashboard admin lo lee al aprobar una solicitud, pero la
-- columna nunca se creo en la tabla: todo insert fallaba con PGRST204
-- "Could not find the 'logo_url' column of 'solicitudes_empresa' in the
-- schema cache", asi que ninguna solicitud se pudo enviar nunca.
alter table public.solicitudes_empresa
  add column if not exists logo_url text;
