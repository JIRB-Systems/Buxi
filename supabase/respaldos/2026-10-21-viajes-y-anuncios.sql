-- Respaldo antes de la limpieza del 2026-10-21.
--
-- 1) Cuatro viajes que quedaron "en_curso" desde agosto (la app se cerró a
--    mitad de camino). Se pasaron a 'cancelado' con fin = inicio.
-- 2) Los dos anuncios de prueba (SVG de relleno, uno enlazaba a example.com y
--    el otro a un login ajeno en railway.app). Se desactivaron, no se borraron.
--
-- Para volver todo atrás:

update public.viajes set estado = 'en_curso', fin = null
where id in (
  '95f4b549-5d7c-4a1d-9ed8-a9ae4153f967',
  '4407db13-55ec-4b32-9aed-137816b66c90',
  '0976f694-fc60-472c-8939-c1910416b01c',
  '39262a04-26ca-4644-99c7-75531a237395'
);

update public.anuncios set activo = true
where id in (
  '19c4da51-5fb7-4b1c-bb55-43cc65425250',
  'bb1e73fb-5d14-4ee3-87c8-13f460bb2c99'
);
