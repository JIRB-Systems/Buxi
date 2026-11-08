-- Cierra los tres huecos de la auditoría del 2026-11-07.
-- Las reglas van en triggers y no en las políticas: una política decide QUÉ
-- filas se tocan, no QUÉ columnas, y un permiso por columna se pierde con el
-- próximo GRANT general. El trigger mira la columna que cambia y quién la cambia.

-- 1) El estado de una empresa (activa, suspendida, pendiente) solo lo cambia
--    la plataforma. Antes el admin de una empresa suspendida se reactivaba solo
--    con un update a su propia fila. El resto de los datos (nombre, cédula,
--    contacto, logo, colores) los sigue editando la empresa desde su panel.
--    Las funciones del servidor (aprobar-solicitud) corren sin usuario y pasan.
create or replace function public.proteger_estado_empresa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.estado is distinct from old.estado
     and auth.uid() is not null
     and coalesce(public.get_my_role(), '') <> 'admin_jirb'
  then
    raise exception 'Solo la administración de Buxci puede cambiar el estado de una empresa'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.proteger_estado_empresa() from public, anon, authenticated;

drop trigger if exists trg_proteger_estado_empresa on public.empresas;
create trigger trg_proteger_estado_empresa
  before update on public.empresas
  for each row execute function public.proteger_estado_empresa();

-- 2) Un bus solo puede tener de chofer a un chofer de su misma empresa. Antes
--    una empresa podía poner en su bus al chofer de otra, que quedaba con dos
--    buses (su app no arrancaba) y transmitiendo para la empresa equivocada.
--    Y un chofer maneja un bus a la vez: asignarlo a uno lo saca del anterior,
--    que es lo que espera quien toca "Asignar" en el panel.
create or replace function public.validar_chofer_bus()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.chofer_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.chofer_id is not distinct from old.chofer_id
     and new.empresa_id is not distinct from old.empresa_id then
    return new;
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = new.chofer_id
      and p.rol = 'chofer'
      and p.empresa_id = new.empresa_id
  ) then
    raise exception 'Ese chofer no pertenece a esta empresa'
      using errcode = '42501';
  end if;

  update public.buses
     set chofer_id = null
   where chofer_id = new.chofer_id
     and id <> new.id;

  return new;
end;
$$;

revoke execute on function public.validar_chofer_bus() from public, anon, authenticated;

drop trigger if exists trg_validar_chofer_bus on public.buses;
create trigger trg_validar_chofer_bus
  before insert or update of chofer_id, empresa_id on public.buses
  for each row execute function public.validar_chofer_bus();

-- 3) Nadie se cambia a sí mismo el rol, la empresa, el estado, el correo ni la
--    empresa que lo creó. Antes solo se frenaban rol y empresa, así que un
--    usuario suspendido se ponía 'activo' él mismo. El correo se cambia por
--    Auth (que lo verifica), no escribiendo la tabla. La plataforma sí puede.
create or replace function public.prevent_self_role_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() = old.id
     and coalesce(public.get_my_role(), '') <> 'admin_jirb'
     and (new.rol is distinct from old.rol
          or new.empresa_id is distinct from old.empresa_id
          or new.estado is distinct from old.estado
          or new.correo is distinct from old.correo
          or new.created_by_empresa_id is distinct from old.created_by_empresa_id)
  then
    raise exception 'No autorizado: no podés cambiar tu propio rol, empresa, estado o correo'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
