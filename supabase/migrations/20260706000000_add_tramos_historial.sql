-- Histórico de tiempos reales de recorrido entre paradas consecutivas.
-- Base para calcular ETA predictivo por tramo/hora/día una vez haya suficiente volumen.
create table if not exists public.tramos_historial (
  id uuid default gen_random_uuid() primary key,
  ruta_id uuid not null references public.rutas(id) on delete cascade,
  bus_id uuid not null references public.buses(id) on delete cascade,
  parada_origen_id uuid not null references public.paradas(id) on delete cascade,
  parada_destino_id uuid not null references public.paradas(id) on delete cascade,
  duracion_segundos integer not null,
  hora_dia smallint not null check (hora_dia between 0 and 23),
  dia_semana smallint not null check (dia_semana between 0 and 6),
  created_at timestamptz not null default now()
);

create index if not exists idx_tramos_historial_ruta on public.tramos_historial(ruta_id);
create index if not exists idx_tramos_historial_tramo on public.tramos_historial(parada_origen_id, parada_destino_id);

alter table public.tramos_historial enable row level security;

-- El chofer solo puede registrar tramos de su propio bus
create policy "Chofer insert tramo" on public.tramos_historial for insert
  with check (
    exists (select 1 from public.buses where buses.id = bus_id and buses.chofer_id = auth.uid())
  );

-- La empresa dueña de la ruta y el admin JIRB pueden leer el histórico
create policy "Empresa/JIRB read tramos" on public.tramos_historial for select
  using (
    public.get_my_role() = 'admin_jirb'
    or exists (
      select 1 from public.rutas r where r.id = ruta_id and r.empresa_id = public.get_my_empresa_id()
    )
  );
