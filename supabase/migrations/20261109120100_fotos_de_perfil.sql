-- Foto de perfil: cada usuario sube la suya al balde `avatares`, solo dentro
-- de su carpeta <user_id>/.
--
-- profiles.foto_url existía desde el principio y la app ya la mostraba, pero
-- nada la escribía: no había dónde subir la foto.
--
-- El balde es público (la foto se ve con su URL, como los logos) y acepta solo
-- PNG, JPEG y WebP de hasta 2 MB. La app la achica a 256 px antes de subirla,
-- así que el tope solo frena a quien suba por fuera de la app.
-- Se puede leer y borrar lo propio: al cambiar la foto, la app borra la vieja
-- (Storage pide permiso de lectura además del de borrado para eso).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatares', 'avatares', true, 2 * 1024 * 1024, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "Usuario sube su foto"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'avatares'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Usuario lee su carpeta de fotos"
on storage.objects for select to authenticated
using (
  bucket_id = 'avatares'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Usuario borra su foto"
on storage.objects for delete to authenticated
using (
  bucket_id = 'avatares'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
