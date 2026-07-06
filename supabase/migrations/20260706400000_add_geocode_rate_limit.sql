-- Tabla de soporte para el rate-limit de la función geocode. Solo la toca
-- el edge function con la service role key (bypassa RLS); no se expone
-- ninguna policy de lectura/escritura pública a propósito.
create table if not exists public.geocode_rate_limit (
  ip text primary key,
  window_start timestamptz not null default now(),
  count integer not null default 1
);

alter table public.geocode_rate_limit enable row level security;
