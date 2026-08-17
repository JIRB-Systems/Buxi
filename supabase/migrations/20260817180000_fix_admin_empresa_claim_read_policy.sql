-- La migracion 20260712220000_restrict_admin_empresa_staff_claim.sql le
-- agrego a la politica de UPDATE de admin_empresa una rama para "reclamar"
-- un chofer recien creado (empresa_id IS NULL AND created_at reciente), pero
-- nunca le agrego la misma rama a la politica de SELECT.
--
-- Postgres solo deja que un UPDATE encuentre una fila si esa fila tambien es
-- visible via alguna politica de SELECT aplicable: la rama nueva de UPDATE
-- nunca era alcanzable, porque la fila del chofer recien creado (con
-- empresa_id todavia null) jamas pasaba la politica de lectura. Resultado:
-- el UPDATE de createChofer()/createAdminEmpresa() que asigna
-- rol='chofer'/'admin_empresa' + empresa_id siempre afectaba 0 filas, en
-- silencio (sin error), dejando la cuenta nueva atascada como
-- rol='pasajero', empresa_id=null para siempre.
drop policy if exists "Empresa admin read own staff profiles" on public.profiles;

create policy "Empresa admin read own staff profiles" on public.profiles for select
  using (
    get_my_role() = 'admin_empresa'
    and (
      empresa_id = get_my_empresa_id()
      or (empresa_id is null and created_at > now() - interval '5 minutes')
    )
  );
