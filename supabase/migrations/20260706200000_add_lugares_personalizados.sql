-- Lugares que el mapa público (OpenStreetMap) no tiene mapeados con su nombre
-- real (ej. terminales municipales pequeñas). Una vez que un admin_empresa o
-- admin_jirb lo agrega, queda disponible en el autocompletado para cualquier
-- empresa que cree rutas después.
create table if not exists public.lugares_personalizados (
  id uuid default gen_random_uuid() primary key,
  nombre text not null,
  latitud double precision not null,
  longitud double precision not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.lugares_personalizados enable row level security;

create policy "Public read lugares personalizados" on public.lugares_personalizados for select using (true);

create policy "Empresa/JIRB admins add lugares" on public.lugares_personalizados for insert
  with check (public.get_my_role() in ('admin_empresa', 'admin_jirb'));
