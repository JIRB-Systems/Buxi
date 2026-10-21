-- Reportes de pasajeros: "ya pasó", "va lleno", "no pasó", "viene atrasado".
--
-- Cubren lo que el GPS no ve: buses de empresas que todavía no transmiten,
-- o una unidad llena. Se reporta con cuenta (para poder limitar el abuso) y
-- se lee sin cuenta, pero solo el resumen: nadie ve quién reportó.

create table public.reportes_pasajero (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  ruta_id uuid not null references public.rutas(id) on delete cascade,
  parada_id uuid references public.paradas(id) on delete set null,
  tipo text not null check (tipo in ('ya_paso', 'lleno', 'no_paso', 'atrasado')),
  created_at timestamptz not null default now()
);

create index reportes_pasajero_ruta_fecha_idx on public.reportes_pasajero (ruta_id, created_at desc);
create index reportes_pasajero_user_fecha_idx on public.reportes_pasajero (user_id, created_at desc);

alter table public.reportes_pasajero enable row level security;

-- Solo pasajeros, y solo a su nombre. Sin política de SELECT: las filas no
-- se leen directo (llevan user_id); se leen resumidas por la función de abajo.
create policy "Pasajero reporta"
on public.reportes_pasajero for insert to authenticated
with check (
  user_id = (select auth.uid())
  and (select public.get_my_role()) = 'pasajero'
);

-- Patrón del proyecto: primero se le quita la tabla entera, después se dan
-- las columnas (un revoke de columnas contra un grant de tabla no hace nada).
revoke all on public.reportes_pasajero from anon, authenticated;
grant insert (ruta_id, parada_id, tipo) on public.reportes_pasajero to authenticated;

-- Límite: uno cada 2 minutos por ruta y 20 por hora por persona.
create or replace function public.limitar_reportes_pasajero()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.reportes_pasajero
    where user_id = new.user_id and ruta_id = new.ruta_id
      and created_at > now() - interval '2 minutes'
  ) then
    raise exception 'Ya reportaste esta ruta hace un momento. Probá de nuevo en un par de minutos.'
      using errcode = 'check_violation';
  end if;
  if (select count(*) from public.reportes_pasajero
      where user_id = new.user_id and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Llegaste al máximo de reportes por hora.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger limitar_reportes_pasajero
before insert on public.reportes_pasajero
for each row execute function public.limitar_reportes_pasajero();

revoke execute on function public.limitar_reportes_pasajero() from public, anon, authenticated;

-- Lo que ve cualquiera: por tipo y parada, cuántas personas lo reportaron y
-- cuándo fue el último, en los últimos 30 minutos.
create or replace function public.reportes_recientes(p_ruta_id uuid)
returns table (
  tipo text,
  parada_id uuid,
  parada_nombre text,
  cantidad integer,
  ultimo timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.tipo, r.parada_id, p.nombre, count(distinct r.user_id)::integer, max(r.created_at)
  from public.reportes_pasajero r
  left join public.paradas p on p.id = r.parada_id
  where r.ruta_id = p_ruta_id
    and r.created_at > now() - interval '30 minutes'
  group by r.tipo, r.parada_id, p.nombre
  order by max(r.created_at) desc
  limit 10;
$$;

revoke execute on function public.reportes_recientes(uuid) from public;
grant execute on function public.reportes_recientes(uuid) to anon, authenticated;
