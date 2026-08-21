-- Comunicación empresa -> chofer, en el sentido que faltaba: el chofer ya
-- podía reportarle cosas a la empresa (incidente, pánico), pero la empresa
-- no tenía forma de mandarle un mensaje puntual a UN chofer específico.
create table if not exists public.mensajes_chofer (
  id uuid default gen_random_uuid() primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  chofer_id uuid not null references public.profiles(id) on delete cascade,
  autor_id uuid references public.profiles(id) on delete set null,
  mensaje text not null,
  leido boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists mensajes_chofer_chofer_idx on public.mensajes_chofer(chofer_id);

alter table public.mensajes_chofer enable row level security;

create policy "Admin empresa envia mensajes a su chofer" on public.mensajes_chofer for insert
  with check (
    public.get_my_role() = 'admin_empresa'
    and empresa_id = public.get_my_empresa_id()
    and autor_id = auth.uid()
    and exists (
      select 1 from public.profiles
      where id = chofer_id and rol = 'chofer' and empresa_id = public.get_my_empresa_id()
    )
  );

create policy "Admin empresa ve los mensajes que mando" on public.mensajes_chofer for select
  using (public.get_my_role() = 'admin_empresa' and empresa_id = public.get_my_empresa_id());

create policy "Chofer ve sus propios mensajes" on public.mensajes_chofer for select
  using (chofer_id = auth.uid());

create policy "Chofer marca sus mensajes como leidos" on public.mensajes_chofer for update
  using (chofer_id = auth.uid())
  with check (chofer_id = auth.uid());
