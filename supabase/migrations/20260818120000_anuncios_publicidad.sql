-- Bucket para las imágenes/videos de los anuncios. Público: se sirven
-- directo por URL en la app de pasajero, sin pasar por RLS en cada carga.
insert into storage.buckets (id, name, public)
values ('anuncios', 'anuncios', true)
on conflict (id) do nothing;

-- storage.objects tiene RLS activado a nivel de todo el bucket sin ninguna
-- política propia todavía: sin esto, ni JIRB podría subir un archivo acá.
create policy "JIRB sube anuncios" on storage.objects for insert
  with check (bucket_id = 'anuncios' and get_my_role() = 'admin_jirb');

create policy "JIRB actualiza anuncios" on storage.objects for update
  using (bucket_id = 'anuncios' and get_my_role() = 'admin_jirb');

create policy "JIRB borra anuncios" on storage.objects for delete
  using (bucket_id = 'anuncios' and get_my_role() = 'admin_jirb');

create policy "Cualquiera lee anuncios" on storage.objects for select
  using (bucket_id = 'anuncios');

-- ---- ANUNCIOS ----
create table public.anuncios (
  id uuid default gen_random_uuid() primary key,
  autor_id uuid references public.profiles(id) on delete set null,
  titulo text not null,
  descripcion text,
  tipo_espacio text not null check (tipo_espacio in ('apertura', 'lista')),
  media_tipo text not null check (media_tipo in ('imagen', 'video')),
  media_url text not null,
  logo_url text,
  link_url text,
  animacion text not null default 'ninguna' check (animacion in ('ninguna', 'fade', 'slide', 'zoom', 'pulso')),
  fecha_inicio timestamptz not null default now(),
  fecha_fin timestamptz,
  activo boolean not null default true,
  orden int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.anuncios enable row level security;

create policy "JIRB gestiona anuncios" on public.anuncios for all
  using (get_my_role() = 'admin_jirb')
  with check (get_my_role() = 'admin_jirb');

-- Solo pasajeros ven anuncios, y solo los vigentes: nada de choferes o
-- paneles de empresa/JIRB mostrando publicidad por accidente.
create policy "Pasajeros ven anuncios vigentes" on public.anuncios for select
  using (
    get_my_role() = 'pasajero'
    and activo = true
    and fecha_inicio <= now()
    and (fecha_fin is null or fecha_fin >= now())
  );
