-- No hay pasarela de pago real (ver 20260819050000_solicitudes_plan.sql):
-- "comprar" un plan sigue siendo JIRB confirmando manualmente. Esta tabla
-- es el comprobante que queda de esa confirmación — no es una factura
-- electrónica válida ante Hacienda (eso exige inscripción, firma digital y
-- XML timbrado), es un recibo descargable en PDF para la empresa.
create sequence if not exists public.facturas_numero_seq;

create table if not exists public.facturas (
  id uuid default gen_random_uuid() primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  plan_id uuid not null references public.planes(id),
  numero text not null unique default (
    'FAC-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.facturas_numero_seq')::text, 5, '0')
  ),
  monto numeric(10,2) not null,
  fecha date not null default current_date,
  created_at timestamptz not null default now()
);

alter table public.facturas enable row level security;

create policy "JIRB gestiona facturas" on public.facturas for all
  using (public.get_my_role() = 'admin_jirb')
  with check (public.get_my_role() = 'admin_jirb');

create policy "Admin empresa lee sus facturas" on public.facturas for select
  using (empresa_id = public.get_my_empresa_id());
