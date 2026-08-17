-- ---- REPORTES DE BUGS (empresa -> JIRB) ----
create table public.reportes_bugs (
  id uuid default gen_random_uuid() primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  autor_id uuid references public.profiles(id) on delete set null,
  titulo text not null,
  descripcion text not null,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'en_revision', 'resuelto')),
  respuesta_jirb text,
  respondido_por uuid references public.profiles(id) on delete set null,
  respondido_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.reportes_bugs enable row level security;

create policy "Empresa admin crea reportes propios" on public.reportes_bugs for insert
  with check (
    get_my_role() = 'admin_empresa'
    and empresa_id = get_my_empresa_id()
    and autor_id = auth.uid()
  );

create policy "Empresa admin lee reportes propios" on public.reportes_bugs for select
  using (
    (get_my_role() = 'admin_empresa' and empresa_id = get_my_empresa_id())
    or get_my_role() = 'admin_jirb'
  );

-- Solo JIRB cambia estado/respuesta: el reporte de la empresa queda fijo
-- una vez enviado, como un ticket de soporte.
create policy "JIRB responde y gestiona reportes" on public.reportes_bugs for update
  using (get_my_role() = 'admin_jirb')
  with check (get_my_role() = 'admin_jirb');

-- ---- AVISOS DEL SISTEMA (JIRB -> todas las empresas) ----
create table public.avisos_sistema (
  id uuid default gen_random_uuid() primary key,
  autor_id uuid references public.profiles(id) on delete set null,
  titulo text not null,
  mensaje text not null,
  tipo text not null default 'info' check (tipo in ('info', 'advertencia', 'urgente')),
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.avisos_sistema enable row level security;

create policy "JIRB gestiona avisos" on public.avisos_sistema for all
  using (get_my_role() = 'admin_jirb')
  with check (get_my_role() = 'admin_jirb');

create policy "Empresa admin lee avisos activos" on public.avisos_sistema for select
  using (get_my_role() = 'admin_empresa' and activo = true);
