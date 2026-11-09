-- Lo que el pasajero le cuenta a Buxci o a una empresa, y sus calificaciones.
--
-- 1) Mensajes del pasajero (Ayuda y contacto).
--    Se reusa reportes_bugs, que ya tiene dónde leerse y responderse: el
--    panel JIRB lista todos y responde, y el panel de empresa lista los de su
--    empresa. Así:
--      - "Problema en la app" y "Sugerencia" van sin empresa: solo los ve JIRB.
--      - "Queja" y "Felicitación" van con la empresa: los ven ella y JIRB.
--    Para eso empresa_id deja de ser obligatorio y se marca el origen.
--    El pasajero solo puede usar estos cuatro títulos: el panel de empresa
--    trata como emergencia todo reporte titulado 'Emergencia', y un pasajero
--    no tiene que poder disparar una.
--
-- 2) Tope a las calificaciones: una por bus (o por ruta, si no hay bus) y por
--    día de Costa Rica. La app ya lo respeta; esto frena a quien la saltee.

-- ---- 1. Mensajes ----
alter table public.reportes_bugs alter column empresa_id drop not null;

alter table public.reportes_bugs
  add column if not exists origen text not null default 'equipo'
  check (origen in ('equipo', 'pasajero'));

create policy "Pasajero escribe a Buxci o a una empresa" on public.reportes_bugs
for insert to authenticated
with check (
  (select public.get_my_role()) = 'pasajero'
  and autor_id = (select auth.uid())
  and origen = 'pasajero'
  and estado = 'pendiente'
  and respuesta_jirb is null and respondido_por is null and respondido_at is null
  and titulo in ('Pasajero: problema en la app', 'Pasajero: sugerencia',
                 'Pasajero: queja', 'Pasajero: felicitación')
  and char_length(descripcion) between 10 and 1000
  and (titulo in ('Pasajero: queja', 'Pasajero: felicitación')) = (empresa_id is not null)
);

-- Para "Mis mensajes": cada autor ve los suyos y la respuesta.
create policy "Autor lee sus reportes" on public.reportes_bugs
for select to authenticated
using (autor_id = (select auth.uid()));

-- Cinco por hora por pasajero: suficiente para escribir, no para inundar.
create or replace function public.limitar_mensajes_pasajero()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.origen = 'pasajero' and (
    select count(*) from public.reportes_bugs r
    where r.autor_id = new.autor_id
      and r.origen = 'pasajero'
      and r.created_at > now() - interval '1 hour'
  ) >= 5 then
    raise exception 'Mandaste varios mensajes seguidos. Probá de nuevo en un rato.';
  end if;
  return new;
end;
$$;

revoke execute on function public.limitar_mensajes_pasajero() from public, anon, authenticated;

create trigger limitar_mensajes_pasajero
before insert on public.reportes_bugs
for each row execute function public.limitar_mensajes_pasajero();

-- ---- 2. Calificaciones ----
create or replace function public.limitar_calificaciones()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.calificaciones c
    where c.user_id = new.user_id
      and c.ruta_id = new.ruta_id
      and c.bus_id is not distinct from new.bus_id
      and (c.created_at at time zone 'America/Costa_Rica')::date
          = (now() at time zone 'America/Costa_Rica')::date
  ) then
    raise exception 'Ya dejaste una calificación para este bus hoy.';
  end if;
  return new;
end;
$$;

revoke execute on function public.limitar_calificaciones() from public, anon, authenticated;

create trigger limitar_calificaciones
before insert on public.calificaciones
for each row execute function public.limitar_calificaciones();

-- El comentario es opcional y corto (la app corta en 300).
alter table public.calificaciones
  add constraint calificaciones_comentario_largo
  check (comentario is null or char_length(comentario) <= 500) not valid;
