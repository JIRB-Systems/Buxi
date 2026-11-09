-- Paradas municipales y terminales que carga JIRB a mano.
--
-- El mapa del pasajero muestra las paradas oficiales y las terminales de
-- OpenStreetMap, pero allá faltan muchas (o están sin nombre). Desde el panel
-- JIRB se agregan las que faltan, con su nombre, y el mapa las dibuja igual
-- que las de OpenStreetMap: las paradas en ámbar y las terminales en azul.
--
-- También corrige las de OpenStreetMap: osm_id es el id de la parada en el
-- mapa base (el de MapTiler: id del nodo de OSM con un 0 al final). Con osm_id
-- el mapa esconde la original y dibuja esta, con el nombre que puso JIRB; con
-- oculta = true la esconde y no dibuja nada (una parada que no existe).
--
-- Las ve cualquiera (con o sin cuenta); solo admin_jirb las crea, cambia o
-- borra: nadie más puede ponerle o cambiarle el nombre a una parada.

create table if not exists public.paradas_municipales (
  id uuid default gen_random_uuid() primary key,
  nombre text not null default 'Parada de bus' check (char_length(btrim(nombre)) between 1 and 80),
  tipo text not null default 'parada' check (tipo in ('parada', 'terminal')),
  latitud double precision not null check (latitud between 5 and 12),
  longitud double precision not null check (longitud between -87 and -82),
  osm_id bigint unique,
  oculta boolean not null default false,
  creado_por uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.paradas_municipales enable row level security;

create policy "Cualquiera ve las paradas municipales" on public.paradas_municipales
for select to anon, authenticated using (true);

create policy "JIRB agrega paradas municipales" on public.paradas_municipales
for insert to authenticated with check ((select public.get_my_role()) = 'admin_jirb');

create policy "JIRB cambia paradas municipales" on public.paradas_municipales
for update to authenticated
using ((select public.get_my_role()) = 'admin_jirb')
with check ((select public.get_my_role()) = 'admin_jirb');

create policy "JIRB borra paradas municipales" on public.paradas_municipales
for delete to authenticated using ((select public.get_my_role()) = 'admin_jirb');

grant select on public.paradas_municipales to anon, authenticated;
grant insert, update, delete on public.paradas_municipales to authenticated;
