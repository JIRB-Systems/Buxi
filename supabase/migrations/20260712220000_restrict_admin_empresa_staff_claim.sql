-- La policy de UPDATE dejaba pasar empresa_id IS NULL en el USING para que
-- admin_empresa pudiera "reclamar" el perfil recien creado por su propio
-- flujo de alta de chofer (signUp + update inmediato, ver createChofer() en
-- admin-empresa.service.ts). Pero esa condicion no distingue "el perfil que
-- yo acabo de crear" de "cualquier pasajero existente" (todos tienen
-- empresa_id null) - cualquier admin_empresa podia secuestrar la cuenta de
-- cualquier pasajero real y convertirla en chofer de su empresa. El
-- WITH CHECK tampoco restringia a que rol podia asignarse.
--
-- Fix: solo se puede reclamar un perfil con empresa_id null si fue creado
-- en los ultimos 5 minutos (cubre con margen el signUp+update inmediato del
-- flujo real, sin dejar tocar pasajeros ya existentes) y el WITH CHECK
-- ahora fuerza rol = 'chofer' como resultado.
drop policy "Empresa admin manage own staff profiles" on public.profiles;

create policy "Empresa admin manage own staff profiles" on public.profiles for update
  using (
    public.get_my_role() = 'admin_empresa'
    and (
      empresa_id = public.get_my_empresa_id()
      or (empresa_id is null and created_at > now() - interval '5 minutes')
    )
  )
  with check (
    public.get_my_role() = 'admin_empresa'
    and empresa_id = public.get_my_empresa_id()
    and rol = 'chofer'
  );
