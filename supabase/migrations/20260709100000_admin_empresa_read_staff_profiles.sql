-- Faltaba la policy de SELECT: admin_empresa podía crear/actualizar el
-- perfil de un chofer (migración 20260629700000, solo FOR UPDATE), pero
-- nunca pudo LEERLO de vuelta. El chofer quedaba bien guardado en la base
-- de datos, pero la lista de "Choferes" del dashboard siempre volvía vacía
-- porque RLS bloqueaba el SELECT en silencio.
create policy "Empresa admin read own staff profiles" on public.profiles for select
  using (
    public.get_my_role() = 'admin_empresa'
    and empresa_id = public.get_my_empresa_id()
  );
