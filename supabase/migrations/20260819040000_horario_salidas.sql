-- Reemplaza el modelo de "primera salida + última salida + frecuencia" (tabla
-- `horarios`) por una lista de horas de salida exactas: los buses reales no
-- salen a intervalos parejos (ver cartel de Liberia-Puntarenas: 5:00, 7:45,
-- 8:30, 9:30... huecos irregulares). La tabla vieja queda intacta —no hay
-- datos reales todavía que migrar— pero la UI de acá en adelante usa esta.
create table if not exists public.horario_salidas (
  id uuid default gen_random_uuid() primary key,
  ruta_id uuid not null references public.rutas(id) on delete cascade,
  dia text not null check (dia in ('lunes_viernes', 'sabado', 'domingo')),
  hora time not null,
  created_at timestamptz not null default now()
);
create index if not exists horario_salidas_ruta_id_idx on public.horario_salidas(ruta_id);

alter table public.horario_salidas enable row level security;

create policy "Public read horario_salidas" on public.horario_salidas for select
  using (true);

create policy "Admin empresa manage horario_salidas" on public.horario_salidas for all
  using (
    exists (
      select 1 from public.rutas
      join public.profiles on profiles.id = auth.uid()
      where rutas.id = horario_salidas.ruta_id
        and profiles.rol = 'admin_empresa'
        and profiles.empresa_id = rutas.empresa_id
    )
  );
