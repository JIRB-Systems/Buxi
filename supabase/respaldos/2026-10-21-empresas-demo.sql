-- Respaldo antes de desactivar las empresas de demo con nombres de
-- operadores reales (2026-10-21). Todas estaban en estado 'activo'.
-- Rutas, paradas, horarios y buses no se tocaron.
--
-- Para volver atrás:

update public.empresas set estado = 'activo'
where id in (
  'a1000000-0000-0000-0000-000000000001', -- TUASA
  'a1000000-0000-0000-0000-000000000002', -- Lumaca
  'a1000000-0000-0000-0000-000000000003', -- Transportes San José - San Pedro
  'a1000000-0000-0000-0000-000000000004', -- MUSOC
  'a1000000-0000-0000-0000-000000000005', -- Transportes Heredianos
  '3751a65b-e924-4e93-9e50-16f3189bef9c'  -- La Pampa
);
