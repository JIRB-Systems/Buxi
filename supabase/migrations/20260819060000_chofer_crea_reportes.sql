-- El chofer también puede reportar incidentes (atraso, avería, accidente)
-- directo a su empresa, no solo admin_empresa. Misma tabla, misma forma de
-- reporte, solo se amplía quién puede insertar.
create policy "Chofer crea reportes de su empresa" on public.reportes_bugs for insert
  with check (
    public.get_my_role() = 'chofer'
    and empresa_id = public.get_my_empresa_id()
    and autor_id = auth.uid()
  );
