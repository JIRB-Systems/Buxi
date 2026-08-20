-- La policy "Empresa admin manage own staff profiles" (endurecida en
-- 20260712220000_restrict_admin_empresa_staff_claim.sql) fuerza rol =
-- 'chofer' como único resultado permitido, para que un admin_empresa no
-- pudiera secuestrar la cuenta de un pasajero cualquiera y asignarle
-- cualquier rol. Esa protección sigue siendo válida (el guard de
-- "empresa_id null y creado hace <5 min" es lo que realmente evita
-- secuestrar cuentas ajenas), pero ahora bloquea también el flujo legítimo
-- de invitar a otro admin_empresa a "mi equipo" (mismo mecanismo que crear
-- un chofer: signUp + update inmediato). Se amplía el rol permitido sin
-- tocar el guard de los 5 minutos.
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
    and rol in ('chofer', 'admin_empresa')
  );
