-- Empresas de demo con nombres de operadores reales (2026-10-21). Todas
-- estaban en estado 'activo'. Rutas, paradas, horarios y buses no se tocan:
-- con la empresa inactiva dejan de verse en el mapa público.

-- 1) Desactivar:
update public.empresas set estado = 'inactivo'
where id in (
  'a1000000-0000-0000-0000-000000000001', -- TUASA
  'a1000000-0000-0000-0000-000000000002', -- Lumaca
  'a1000000-0000-0000-0000-000000000003', -- Transportes San José - San Pedro
  'a1000000-0000-0000-0000-000000000004', -- MUSOC
  'a1000000-0000-0000-0000-000000000005', -- Transportes Heredianos
  '3751a65b-e924-4e93-9e50-16f3189bef9c'  -- La Pampa
);

-- 2) Para volver atrás (dejar comentado; correrlo solo si hace falta):
-- update public.empresas set estado = 'activo'
-- where id in (
--   'a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002',
--   'a1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000004',
--   'a1000000-0000-0000-0000-000000000005', '3751a65b-e924-4e93-9e50-16f3189bef9c'
-- );
