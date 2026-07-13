-- El INSERT publico de solicitudes_empresa tenia WITH CHECK (true): sin
-- limite de volumen ni validacion de formato. A diferencia de geocode, este
-- insert va directo del navegador (anon key) a PostgREST sin pasar por una
-- edge function, asi que no hay IP de cliente disponible para un rate-limit
-- por IP - se limita por volumen global reciente y por email repetido.

alter table public.solicitudes_empresa
  add constraint solicitudes_empresa_email_format check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');

create or replace function public.rate_limit_solicitud_empresa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (
    select count(*) from public.solicitudes_empresa
    where created_at > now() - interval '10 minutes'
  ) >= 20 then
    raise exception 'Demasiadas solicitudes recientes, intenta mas tarde';
  end if;

  if exists (
    select 1 from public.solicitudes_empresa
    where email = new.email and created_at > now() - interval '24 hours'
  ) then
    raise exception 'Ya enviaste una solicitud recientemente con este correo';
  end if;

  return new;
end;
$$;

create trigger trg_rate_limit_solicitud_empresa
  before insert on public.solicitudes_empresa
  for each row execute function public.rate_limit_solicitud_empresa();
