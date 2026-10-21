-- Tarifas oficiales de ARESEP y código oficial de ruta.
--
-- ARESEP publica como datos abiertos todas las tarifas vigentes de bus, por
-- ruta, ramal y fraccionamiento (tramo), con la tarifa de adulto mayor. La
-- función sync-tarifas-aresep las copia acá una vez por semana.
--
-- Una ruta de Buxmap se enlaza a un tramo (`aresep_fraccionamiento`) y desde
-- ese momento su precio ES el de ARESEP: lo fija el trigger de abajo, no el
-- formulario, así no puede quedar un precio distinto del regulado. Las rutas
-- sin enlazar siguen con su precio manual, como hasta ahora.

create table public.tarifas_aresep (
  codigo_fraccionamiento text primary key,
  codigo_ruta text not null,
  nombre_ruta text not null,
  codigo_ramal text,
  nombre_ramal text,
  nombre_fraccionamiento text not null,
  km numeric(8, 2),
  tarifa_regular numeric(10, 2) not null check (tarifa_regular >= 0),
  tarifa_adulto_mayor numeric(10, 2) check (tarifa_adulto_mayor >= 0),
  resolucion text,
  fecha_vigencia date,
  operadores text,
  -- false si dejó de aparecer en los datos de ARESEP.
  vigente boolean not null default true,
  actualizado_at timestamptz not null default now()
);

create index tarifas_aresep_codigo_ruta_idx on public.tarifas_aresep (codigo_ruta);

alter table public.tarifas_aresep enable row level security;

-- Son datos públicos: los publica el propio regulador.
create policy "Cualquiera lee tarifas ARESEP"
on public.tarifas_aresep for select to anon, authenticated
using (true);

revoke insert, update, delete, truncate on public.tarifas_aresep from anon, authenticated;

-- Una sola fila con el estado de la última sincronización.
create table public.tarifas_aresep_sync (
  id smallint primary key default 1 check (id = 1),
  ultima_ok timestamptz,
  ultimo_intento timestamptz,
  filas integer,
  rutas_actualizadas integer,
  error text
);
insert into public.tarifas_aresep_sync (id) values (1);

alter table public.tarifas_aresep_sync enable row level security;

create policy "Cualquiera lee el estado de la sincronización"
on public.tarifas_aresep_sync for select to anon, authenticated
using (true);

revoke insert, update, delete, truncate on public.tarifas_aresep_sync from anon, authenticated;

-- Código oficial de la ruta (el del CTP y ARESEP, ej. "521") y el tramo de
-- ARESEP del que sale el precio.
alter table public.rutas
  add column codigo_ruta text check (char_length(codigo_ruta) <= 20),
  add column aresep_fraccionamiento text check (char_length(aresep_fraccionamiento) <= 20);

-- Con tramo enlazado, el precio y el código salen de ARESEP.
create or replace function public.rutas_precio_aresep()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  t record;
begin
  if new.aresep_fraccionamiento is null then
    return new;
  end if;
  select tarifa_regular, codigo_ruta into t
  from public.tarifas_aresep
  where codigo_fraccionamiento = new.aresep_fraccionamiento;
  if not found then
    raise exception 'El tramo de ARESEP % no existe', new.aresep_fraccionamiento
      using errcode = 'foreign_key_violation';
  end if;
  new.precio := t.tarifa_regular;
  new.codigo_ruta := t.codigo_ruta;
  return new;
end;
$$;

create trigger rutas_precio_aresep
before insert or update of aresep_fraccionamiento, precio, codigo_ruta on public.rutas
for each row execute function public.rutas_precio_aresep();

-- La llama la función de sincronización después de cargar las tarifas: el
-- trigger corre en cada UPDATE, así que alcanza con tocar las rutas enlazadas
-- cuyo precio quedó viejo.
create or replace function public.aplicar_tarifas_aresep()
returns integer
language sql
security definer
set search_path = ''
as $$
  with cambiadas as (
    update public.rutas r
    set precio = t.tarifa_regular
    from public.tarifas_aresep t
    where r.aresep_fraccionamiento = t.codigo_fraccionamiento
      and r.precio is distinct from t.tarifa_regular
    returning r.id
  )
  select count(*)::integer from cambiadas;
$$;

-- Ninguna de las dos se llama desde la app: el trigger corre solo y la otra
-- la usa la función con la clave de servicio.
revoke execute on function public.rutas_precio_aresep() from public, anon, authenticated;
revoke execute on function public.aplicar_tarifas_aresep() from public, anon, authenticated;
grant execute on function public.aplicar_tarifas_aresep() to service_role;
