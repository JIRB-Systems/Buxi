-- Límites de tamaño y de tipo en los baldes públicos de Storage.
--
-- `anuncios` no tenía ninguno: cualquier admin_jirb (o una sesión robada de
-- uno) podía subir un archivo de cualquier tamaño y tipo, y quedaba servido
-- públicamente. Ahora acepta lo mismo que el formulario de anuncios: imágenes
-- PNG/JPEG/WebP y videos MP4/WebM, hasta 25 MB (el formulario además limita
-- las imágenes a 5 MB).
--
-- `logos` aceptaba SVG. Un SVG puede llevar <script> y se sirve desde el
-- dominio de Supabase. Ningún camino de la app sube SVG (la función
-- solicitud-empresa ya los rechaza), así que se saca de la lista. El archivo
-- que hay hoy en el balde es un PNG.

update storage.buckets
set file_size_limit = 25 * 1024 * 1024,
    allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/webm']
where id = 'anuncios';

update storage.buckets
set allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp']
where id = 'logos';
