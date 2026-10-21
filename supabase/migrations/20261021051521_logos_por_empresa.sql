-- Una empresa puede subir su logo al balde `logos`, solo dentro de su carpeta
-- empresas/<empresa_id>/.
--
-- Antes el panel pedía el logo como URL. Una imagen de otro dominio la bloquea
-- la CSP (img-src solo admite el host de Supabase y los mapas), así que ningún
-- logo cargado así se veía: hoy ninguna empresa tiene logo.
--
-- No hace falta política de lectura (el balde es público) ni de borrado: un
-- logo reemplazado queda huérfano, pesa poco y no se lista en ningún lado.
-- El tamaño y los tipos ya los limita el balde (20261021044746).

create policy "Empresa sube su logo"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'logos'
  and (storage.foldername(name))[1] = 'empresas'
  and (storage.foldername(name))[2] = (select public.get_my_empresa_id())::text
  and (select public.get_my_role()) = 'admin_empresa'
);
