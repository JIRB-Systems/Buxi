-- Contador de los correos que manda Supabase Auth (confirmación de cuenta,
-- contraseña nueva, cambio de correo) para avisar en el panel de JIRB antes
-- de llegar al tope diario de Resend (100 por día en el plan gratis).
--
-- Supabase no guarda el historial de envíos en la base (auth.audit_log_entries
-- está vacía), pero cada envío actualiza una fecha en auth.users: un reenvío
-- vuelve a pisar confirmation_sent_at. El trigger cuenta cada cambio de esas
-- fechas, reenvíos incluidos. Solo se guarda el tipo y la hora: nada de la
-- persona.
--
-- Se puede correr más de una vez sin romper nada.

create table if not exists public.correos_auth_enviados (
  id bigint generated always as identity primary key,
  tipo text not null check (tipo in ('confirmacion', 'recuperacion', 'cambio_correo')),
  enviado_at timestamptz not null default now()
);
create index if not exists correos_auth_enviados_enviado_at on public.correos_auth_enviados (enviado_at);
alter table public.correos_auth_enviados enable row level security;
revoke all on table public.correos_auth_enviados from anon, authenticated;

create or replace function public.contar_correo_auth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Un error acá no puede frenar un registro ni un "olvidé mi contraseña":
  -- el conteo es un aviso, no algo de lo que dependa el login.
  begin
    if new.confirmation_sent_at is not null
       and new.confirmation_sent_at is distinct from (case when tg_op = 'UPDATE' then old.confirmation_sent_at end) then
      insert into public.correos_auth_enviados (tipo) values ('confirmacion');
    end if;
    if new.recovery_sent_at is not null
       and new.recovery_sent_at is distinct from (case when tg_op = 'UPDATE' then old.recovery_sent_at end) then
      insert into public.correos_auth_enviados (tipo) values ('recuperacion');
    end if;
    if new.email_change_sent_at is not null
       and new.email_change_sent_at is distinct from (case when tg_op = 'UPDATE' then old.email_change_sent_at end) then
      insert into public.correos_auth_enviados (tipo) values ('cambio_correo');
    end if;
    delete from public.correos_auth_enviados where enviado_at < now() - interval '30 days';
  exception when others then
    null;
  end;
  return new;
end;
$$;

revoke execute on function public.contar_correo_auth() from public, anon, authenticated;

drop trigger if exists trg_contar_correo_auth on auth.users;
create trigger trg_contar_correo_auth
  after insert or update of confirmation_sent_at, recovery_sent_at, email_change_sent_at on auth.users
  for each row execute function public.contar_correo_auth();

-- Para el panel de JIRB: cuántos salieron en las últimas 24 horas (ventana
-- móvil) y el tope del plan.
create or replace function public.correos_auth_24h()
returns table (total int, confirmaciones int, recuperaciones int, limite int)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.get_my_role() is distinct from 'admin_jirb' then
    raise exception 'solo admin_jirb' using errcode = '42501';
  end if;
  return query
    select count(*)::int,
           (count(*) filter (where c.tipo = 'confirmacion'))::int,
           (count(*) filter (where c.tipo = 'recuperacion'))::int,
           100
    from public.correos_auth_enviados c
    where c.enviado_at > now() - interval '24 hours';
end;
$$;

revoke execute on function public.correos_auth_24h() from public, anon;
grant execute on function public.correos_auth_24h() to authenticated;
