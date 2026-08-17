-- Hasta ahora solo admin_jirb podia leer/descartar anomalias de GPS
-- (bus_locations.anomalo). La lectura ya es publica (bus_locations no
-- filtra SELECT), asi que empresa solo necesitaba poder descartarlas: un
-- UPDATE acotado a anomalias de sus propios buses.
create policy "Empresa admin dismiss own anomalies" on public.bus_locations for update
  using (
    get_my_role() = 'admin_empresa'
    and exists (
      select 1 from public.buses b
      where b.id = bus_locations.bus_id and b.empresa_id = get_my_empresa_id()
    )
  );
