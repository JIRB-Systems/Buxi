-- ============================================================
-- POLÍTICAS ADMIN JIRB: acceso total al sistema
-- admin_jirb puede leer y escribir TODAS las tablas
-- admin_empresa solo puede gestionar los datos de SU empresa
-- ============================================================

-- PROFILES: admin_jirb puede ver y editar todos los perfiles
create policy "JIRB read all profiles" on public.profiles for select
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.rol = 'admin_jirb')
  );

create policy "JIRB update all profiles" on public.profiles for update
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.rol = 'admin_jirb')
  );

-- EMPRESAS: admin_jirb puede todo
create policy "JIRB manage empresas" on public.empresas for all
  using (
    exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.rol = 'admin_jirb')
  );

-- admin_empresa solo puede ver SU empresa
create policy "Admin empresa read own empresa" on public.empresas for select
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.rol = 'admin_empresa'
        and profiles.empresa_id = empresas.id
    )
  );

-- RUTAS: admin_jirb puede todo
create policy "JIRB manage rutas" on public.rutas for all
  using (
    exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.rol = 'admin_jirb')
  );

-- PARADAS: admin_jirb puede todo
create policy "JIRB manage paradas" on public.paradas for all
  using (
    exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.rol = 'admin_jirb')
  );

-- BUSES: admin_jirb puede todo
create policy "JIRB manage buses" on public.buses for all
  using (
    exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.rol = 'admin_jirb')
  );

-- BUS_LOCATIONS: admin_jirb puede todo
create policy "JIRB manage bus_locations" on public.bus_locations for all
  using (
    exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.rol = 'admin_jirb')
  );

-- HORARIOS: admin_jirb puede todo
create policy "JIRB manage horarios" on public.horarios for all
  using (
    exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.rol = 'admin_jirb')
  );

-- CALIFICACIONES: admin_jirb puede todo (moderar)
create policy "JIRB manage calificaciones" on public.calificaciones for all
  using (
    exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.rol = 'admin_jirb')
  );

-- FAVORITOS: admin_jirb puede ver todos
create policy "JIRB read favoritos" on public.favoritos for select
  using (
    exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.rol = 'admin_jirb')
  );

-- USER_PREFERENCES: admin_jirb puede ver todas
create policy "JIRB read preferences" on public.user_preferences for select
  using (
    exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.rol = 'admin_jirb')
  );
