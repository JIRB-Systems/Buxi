-- Las cuentas de chofer/admin_empresa se crean con auth.signUp() en nombre
-- de otra persona (el admin las arma, no la persona que va a usarlas). El
-- proyecto no tiene auto-confirmación de email activada ni envío de correos
-- configurado, así que esas cuentas quedaban creadas pero sin poder
-- loguearse nunca: esperando una confirmación que nadie iba a mandar.
--
-- El flag `created_by_admin` en raw_user_meta_data (pasado por
-- admin-jirb.service.ts y admin-empresa.service.ts al hacer signUp) marca
-- justamente esas cuentas. El self-signup público de pasajeros
-- (supabase.service.ts) no manda ese flag, así que sigue pidiendo
-- confirmación real como corresponde.
create or replace function public.autoconfirm_admin_created_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.raw_user_meta_data ->> 'created_by_admin' = 'true' and new.email_confirmed_at is null then
    new.email_confirmed_at := now();
  end if;
  return new;
end;
$$;

create trigger trg_autoconfirm_admin_created_user
  before insert on auth.users
  for each row execute function public.autoconfirm_admin_created_user();

-- Cuentas de chofer/admin_empresa ya creadas antes de este fix y que
-- quedaron atascadas sin confirmar.
update auth.users
set email_confirmed_at = now()
where email_confirmed_at is null
  and id in (select id from public.profiles where rol in ('chofer', 'admin_empresa'));
