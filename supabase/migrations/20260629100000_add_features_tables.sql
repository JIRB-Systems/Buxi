-- Rutas favoritas de cada pasajero
create table if not exists public.favoritos (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  ruta_id uuid not null references public.rutas(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(user_id, ruta_id)
);

alter table public.favoritos enable row level security;

create policy "Users manage own favorites" on public.favoritos for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Horarios de cada ruta
create table if not exists public.horarios (
  id uuid default gen_random_uuid() primary key,
  ruta_id uuid not null references public.rutas(id) on delete cascade,
  dia text not null check (dia in ('lunes_viernes', 'sabado', 'domingo')),
  primera_salida time not null,
  ultima_salida time not null,
  frecuencia_minutos integer not null default 15,
  notas text,
  created_at timestamptz not null default now()
);

alter table public.horarios enable row level security;
create policy "Public read horarios" on public.horarios for select using (true);
create policy "Admin empresa manage horarios" on public.horarios for all
  using (
    exists (
      select 1 from public.rutas
      join public.profiles on profiles.id = auth.uid()
      where rutas.id = horarios.ruta_id
        and profiles.rol = 'admin_empresa'
        and profiles.empresa_id = rutas.empresa_id
    )
  );

-- Calificaciones de servicio por ruta
create table if not exists public.calificaciones (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  ruta_id uuid not null references public.rutas(id) on delete cascade,
  bus_id uuid references public.buses(id) on delete set null,
  estrellas integer not null check (estrellas between 1 and 5),
  comentario text,
  created_at timestamptz not null default now()
);

alter table public.calificaciones enable row level security;
create policy "Users create own ratings" on public.calificaciones for insert
  with check (auth.uid() = user_id);
create policy "Public read ratings" on public.calificaciones for select using (true);
create policy "Users delete own ratings" on public.calificaciones for delete
  using (auth.uid() = user_id);

-- Preferencias de usuario (modo oscuro, etc.)
create table if not exists public.user_preferences (
  user_id uuid references public.profiles(id) on delete cascade primary key,
  dark_mode boolean not null default false,
  notifications_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.user_preferences enable row level security;
create policy "Users manage own preferences" on public.user_preferences for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Seed horarios para las rutas existentes
insert into public.horarios (ruta_id, dia, primera_salida, ultima_salida, frecuencia_minutos) values
  ('b1000000-0000-0000-0000-000000000001', 'lunes_viernes', '04:30', '22:00', 10),
  ('b1000000-0000-0000-0000-000000000001', 'sabado', '05:00', '21:00', 15),
  ('b1000000-0000-0000-0000-000000000001', 'domingo', '05:30', '20:00', 20),
  ('b1000000-0000-0000-0000-000000000003', 'lunes_viernes', '04:45', '22:30', 8),
  ('b1000000-0000-0000-0000-000000000003', 'sabado', '05:00', '21:30', 12),
  ('b1000000-0000-0000-0000-000000000003', 'domingo', '06:00', '20:00', 18),
  ('b1000000-0000-0000-0000-000000000004', 'lunes_viernes', '05:00', '23:00', 5),
  ('b1000000-0000-0000-0000-000000000004', 'sabado', '05:30', '22:00', 8),
  ('b1000000-0000-0000-0000-000000000004', 'domingo', '06:00', '20:00', 12),
  ('b1000000-0000-0000-0000-000000000005', 'lunes_viernes', '04:30', '22:00', 12),
  ('b1000000-0000-0000-0000-000000000005', 'sabado', '05:00', '21:00', 15),
  ('b1000000-0000-0000-0000-000000000005', 'domingo', '06:00', '19:00', 25)
on conflict do nothing;
