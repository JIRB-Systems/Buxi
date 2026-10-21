-- Límite de envíos por IP para el formulario público de solicitud de empresa
-- (función solicitud-empresa). Misma idea que geocode_rate_limit.
--
-- RLS activo y sin políticas: solo la función, con la clave de servicio, la
-- lee y la escribe. Desde el navegador no se puede ni consultar.

create table if not exists public.solicitud_rate_limit (
  ip text primary key,
  window_start timestamptz not null default now(),
  count integer not null default 0
);

alter table public.solicitud_rate_limit enable row level security;

revoke all on public.solicitud_rate_limit from anon, authenticated;
