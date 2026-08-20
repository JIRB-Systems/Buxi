-- Hasta ahora admin_empresa solo podía LEER su propia fila en empresas
-- ("Admin empresa read own empresa"); no había forma de que la empresa
-- editara su propia info (teléfono, correo, cédula jurídica, logo) sin
-- pasar por JIRB. Confirmado con una prueba real: un UPDATE bajo esa
-- cuenta devuelve 204 pero no cambia ninguna fila (RLS lo bloquea en
-- silencio, sin error) hasta que exista esta policy.
create policy "Admin empresa actualiza su propia empresa" on public.empresas for update
  using (
    public.get_my_role() = 'admin_empresa'
    and id = (select empresa_id from public.profiles where id = auth.uid())
  )
  with check (
    public.get_my_role() = 'admin_empresa'
    and id = (select empresa_id from public.profiles where id = auth.uid())
  );
