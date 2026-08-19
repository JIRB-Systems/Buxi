-- La empresa no puede escribir directo en `suscripciones` (solo JIRB, a
-- propósito: no hay pasarela de pago real, así que "comprar" un plan es en
-- realidad "pedirlo" y que JIRB lo confirme). Esta tabla es esa solicitud.
create table if not exists public.solicitudes_plan (
  id uuid default gen_random_uuid() primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  plan_id uuid not null references public.planes(id),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'resuelta')),
  created_at timestamptz not null default now()
);

alter table public.solicitudes_plan enable row level security;

create policy "Admin empresa crea sus solicitudes de plan" on public.solicitudes_plan for insert
  with check (empresa_id = (select empresa_id from public.profiles where id = auth.uid()));

create policy "Admin empresa lee sus solicitudes de plan" on public.solicitudes_plan for select
  using (empresa_id = (select empresa_id from public.profiles where id = auth.uid()));

create policy "JIRB gestiona solicitudes_plan" on public.solicitudes_plan for all
  using (public.get_my_role() = 'admin_jirb');
