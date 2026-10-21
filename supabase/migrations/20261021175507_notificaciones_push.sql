-- Notificaciones push (Web Push) para el pasajero.
--
-- Dos usos:
--   1. Los avisos que publica una empresa (atraso, desvío, cancelación) le
--      llegan al teléfono a quien la sigue, aunque no tenga la app abierta.
--   2. "Avisame cuando falten 5 minutos": el pasajero lo pide para su parada
--      y una tarea que corre cada minuto revisa dónde están los buses.
--
-- Los envía la función `push`. Sus claves VAPID las genera ella misma la
-- primera vez y las guarda en push_config, que nadie más puede leer: la clave
-- privada nunca sale de la base ni pasa por el chat.

-- ---- Suscripciones del navegador ----
create table public.push_suscripciones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique check (endpoint like 'https://%' and char_length(endpoint) <= 1000),
  p256dh text not null check (char_length(p256dh) <= 200),
  auth text not null check (char_length(auth) <= 100),
  creada_at timestamptz not null default now()
);
create index push_suscripciones_user_idx on public.push_suscripciones (user_id);

alter table public.push_suscripciones enable row level security;
create policy "Ve sus suscripciones push" on public.push_suscripciones
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Borra sus suscripciones push" on public.push_suscripciones
  for delete to authenticated using (user_id = (select auth.uid()));
revoke all on public.push_suscripciones from anon, authenticated;
grant select, delete on public.push_suscripciones to authenticated;

-- Se registra por función y no con un insert: el mismo navegador (endpoint)
-- puede pasar a otra cuenta, y entonces la fila tiene que cambiar de dueño.
create or replace function public.registrar_push(p_endpoint text, p_p256dh text, p_auth text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.push_suscripciones (user_id, endpoint, p256dh, auth)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, creada_at = now();
$$;
revoke execute on function public.registrar_push(text, text, text) from public, anon;
grant execute on function public.registrar_push(text, text, text) to authenticated;

-- ---- "Avisame cuando falten N minutos" ----
create table public.alertas_llegada (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  ruta_id uuid not null references public.rutas(id) on delete cascade,
  parada_id uuid not null references public.paradas(id) on delete cascade,
  minutos integer not null default 5 check (minutos between 1 and 30),
  creada_at timestamptz not null default now(),
  -- Una alerta vale para el próximo bus, no para siempre.
  expira_at timestamptz not null default now() + interval '2 hours',
  avisada_at timestamptz
);
create index alertas_llegada_activas_idx on public.alertas_llegada (expira_at) where avisada_at is null;

alter table public.alertas_llegada enable row level security;
create policy "Maneja sus alertas de llegada" on public.alertas_llegada
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
revoke all on public.alertas_llegada from anon, authenticated;
grant select, delete on public.alertas_llegada to authenticated;
grant insert (ruta_id, parada_id, minutos) on public.alertas_llegada to authenticated;

-- ---- Estado interno de la función push ----
create table public.push_config (
  id smallint primary key default 1 check (id = 1),
  vapid jsonb not null
);
alter table public.push_config enable row level security;
revoke all on public.push_config from anon, authenticated;

-- Avisos de empresa ya enviados por push: cada aviso se manda una sola vez,
-- aunque alguien llame a la función mil veces con el mismo id.
create table public.push_avisos_enviados (
  notificacion_id uuid primary key references public.notificaciones_empresa(id) on delete cascade,
  enviado_at timestamptz not null default now(),
  destinatarios integer
);
alter table public.push_avisos_enviados enable row level security;
revoke all on public.push_avisos_enviados from anon, authenticated;

-- ---- Disparadores ----
-- Cada aviso nuevo de una empresa llama a la función. La clave es la
-- publicable (la misma que viaja en la app web): la función no confía en
-- quien llama, lee el aviso de la base y lo manda una sola vez.
create or replace function public.push_aviso_empresa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform net.http_post(
    url := 'https://gduxelmqqnqupimfcdeb.supabase.co/functions/v1/push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', 'sb_publishable_s8kfM1PQVM125VtKlCK2uA_ZwGgA-d8'),
    body := jsonb_build_object('tipo', 'aviso', 'id', new.id),
    timeout_milliseconds := 10000
  );
  return new;
end;
$$;
revoke execute on function public.push_aviso_empresa() from public, anon, authenticated;

create trigger push_aviso_empresa
after insert on public.notificaciones_empresa
for each row execute function public.push_aviso_empresa();

-- Las alertas de llegada se revisan cada minuto.
select cron.schedule(
  'push-alertas-llegada',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://gduxelmqqnqupimfcdeb.supabase.co/functions/v1/push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', 'sb_publishable_s8kfM1PQVM125VtKlCK2uA_ZwGgA-d8'),
    body := '{"tipo": "llegadas"}'::jsonb,
    timeout_milliseconds := 30000
  )
  where exists (select 1 from public.alertas_llegada where avisada_at is null and expira_at > now());
  $$
);
