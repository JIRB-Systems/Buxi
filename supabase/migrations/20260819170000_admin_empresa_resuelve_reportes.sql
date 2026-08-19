-- reportes_bugs solo dejaba resolver/responder a JIRB (su uso original:
-- empresa reporta un bug a JIRB). Ahora la misma tabla también recibe
-- reportes del chofer HACIA su empresa (incidentes, botón de pánico), y la
-- empresa necesita poder marcarlos como resueltos sin depender de JIRB.
create policy "Admin empresa resuelve reportes de su empresa" on public.reportes_bugs for update
  using (public.get_my_role() = 'admin_empresa' and empresa_id = public.get_my_empresa_id())
  with check (public.get_my_role() = 'admin_empresa' and empresa_id = public.get_my_empresa_id());
