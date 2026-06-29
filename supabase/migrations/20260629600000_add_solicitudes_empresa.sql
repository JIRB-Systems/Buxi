create table if not exists public.solicitudes_empresa (
  id uuid default gen_random_uuid() primary key,
  nombre_empresa text not null,
  cedula_juridica text,
  nombre_contacto text not null,
  email text not null,
  telefono text not null,
  mensaje text,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobada', 'rechazada')),
  created_at timestamptz not null default now()
);

alter table public.solicitudes_empresa enable row level security;

create policy "Anyone can submit solicitud" on public.solicitudes_empresa for insert
  with check (true);

create policy "JIRB manage solicitudes" on public.solicitudes_empresa for all
  using (public.get_my_role() = 'admin_jirb');
