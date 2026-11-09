-- Historial de viajes del pasajero ("Mis viajes").
--
-- Se anota un viaje cuando el pasajero elige cómo llegar a un destino, y se
-- marca completado cuando la app detecta que llegó a la parada donde baja.
-- Sirve para repetir un viaje de un toque. Cada pasajero ve solo los suyos.
--
-- ruta2_id: el segundo bus cuando el viaje tiene transbordo (null si es
-- directo). bajar_parada_id es siempre la parada final.

create table if not exists public.viajes_pasajero (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  ruta_id uuid references public.rutas(id) on delete set null,
  ruta2_id uuid references public.rutas(id) on delete set null,
  subir_parada_id uuid references public.paradas(id) on delete set null,
  bajar_parada_id uuid references public.paradas(id) on delete set null,
  destino_nombre text not null check (char_length(destino_nombre) between 1 and 200),
  destino_lat double precision not null,
  destino_lng double precision not null,
  completado boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_viajes_pasajero_user_fecha
  on public.viajes_pasajero (user_id, created_at desc);

alter table public.viajes_pasajero enable row level security;

create policy "Pasajero lee sus viajes" on public.viajes_pasajero
for select to authenticated using (user_id = (select auth.uid()));

create policy "Pasajero anota sus viajes" on public.viajes_pasajero
for insert to authenticated with check (user_id = (select auth.uid()) and completado = false);

create policy "Pasajero completa sus viajes" on public.viajes_pasajero
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "Pasajero borra sus viajes" on public.viajes_pasajero
for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.viajes_pasajero from anon;
