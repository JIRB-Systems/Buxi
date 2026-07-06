-- Función helper: empresa_id del usuario autenticado, sin pasar por RLS
create or replace function public.get_my_empresa_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select empresa_id from public.profiles where id = auth.uid()
$$;

-- admin_empresa puede asignar rol/empresa a perfiles nuevos (sin empresa aun)
-- o actualizar perfiles que ya pertenecen a su propia empresa (choferes, etc.)
create policy "Empresa admin manage own staff profiles" on public.profiles for update
  using (
    public.get_my_role() = 'admin_empresa'
    and (empresa_id is null or empresa_id = public.get_my_empresa_id())
  )
  with check (
    public.get_my_role() = 'admin_empresa'
    and empresa_id = public.get_my_empresa_id()
  );
