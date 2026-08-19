-- Sistema de boletos con QR. Todavía no hay pasarela de pago real, así que
-- el "pago" se marca como aprobado al instante (ver comentario en
-- FeaturesService.comprarBoleto): cuando se conecte un método de pago real,
-- ese único punto debe cambiar para esperar la confirmación del proveedor
-- antes de fijar estado='pagado'. Todo lo demás (tabla, RLS, generación y
-- validación del QR) ya queda funcionando.

create table if not exists public.boletos (
  id uuid default gen_random_uuid() primary key,
  pasajero_id uuid not null references public.profiles(id) on delete cascade,
  ruta_id uuid not null references public.rutas(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  codigo text not null unique default encode(gen_random_bytes(16), 'hex'),
  precio numeric(10,2) not null default 0,
  estado text not null default 'pagado' check (estado in ('pagado', 'usado', 'expirado', 'cancelado')),
  creado_at timestamptz not null default now(),
  expira_at timestamptz not null default (now() + interval '4 hours'),
  usado_at timestamptz,
  usado_por uuid references public.profiles(id)
);

create index if not exists boletos_pasajero_idx on public.boletos(pasajero_id);
create index if not exists boletos_empresa_idx on public.boletos(empresa_id);

alter table public.boletos enable row level security;

create policy "Pasajero crea sus boletos" on public.boletos for insert
  with check (public.get_my_role() = 'pasajero' and pasajero_id = auth.uid());

create policy "Pasajero ve sus boletos" on public.boletos for select
  using (pasajero_id = auth.uid());

create policy "Chofer ve y valida boletos de su empresa" on public.boletos for select
  using (public.get_my_role() = 'chofer' and empresa_id = public.get_my_empresa_id());

-- El chofer solo puede pasar un boleto de 'pagado' a 'usado' (marcado por el
-- with check); no puede reescribir precio, código ni reabrir uno ya usado.
create policy "Chofer marca boletos como usados" on public.boletos for update
  using (public.get_my_role() = 'chofer' and empresa_id = public.get_my_empresa_id() and estado = 'pagado')
  with check (public.get_my_role() = 'chofer' and empresa_id = public.get_my_empresa_id() and estado = 'usado');
