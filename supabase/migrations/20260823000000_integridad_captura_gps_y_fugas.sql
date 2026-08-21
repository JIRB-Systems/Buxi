-- Robustez de la captura de datos y cierre de filtraciones de lectura.
-- Revisión del 2026-08-21 sobre el camino de ingesta GPS y sobre qué puede
-- leer un visitante sin sesión.


-- ===========================================================================
-- PARTE 1 — INTEGRIDAD DE LA CAPTURA
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1.1 El chofer podía fabricar el `timestamp`, y con eso burlar el anti-spoofing
-- ---------------------------------------------------------------------------
-- `authenticated` tenía INSERT sobre las 8 columnas de bus_locations, incluidas
-- `timestamp`, `id` y `anomalo`. La policy "Chofer insert location" solo valida
-- de quién es el bus, no qué valores se mandan.
--
-- El agujero no es solo poder antedatar el historial (que ya de por sí rompe el
-- time-lapse y la estela del panel JIRB, y sirve para fabricar una coartada:
-- "mi bus estaba acá a las 3pm"). Es que **desactiva por completo la detección
-- de spoofing**. flag_anomalous_location() compara contra el punto más reciente
-- del mismo bus y hace:
--
--     horas := extract(epoch from (new.timestamp - prev.timestamp)) / 3600.0;
--     if horas > 0 then ... if velocidad_kmh > 200 then anomalo := true;
--
-- Si el timestamp que llega es anterior o igual al último guardado, `horas` da
-- <= 0 y el chequeo de velocidad **no se ejecuta nunca**. Un chofer que quiera
-- simular estar en otra provincia solo tiene que mandar cada punto con una
-- fecha que no avance: teletransporte sin una sola marca de anomalía.
--
-- Fix: que esas tres columnas las ponga la base, no el cliente. Al revocar el
-- INSERT de la columna, un INSERT que no la menciona sigue funcionando y toma
-- el default. Verificado que ChoferService.sendLocation() manda exactamente
-- bus_id, latitud, longitud, velocidad y heading — nada de esto se rompe.
revoke insert (id, "timestamp", anomalo) on public.bus_locations from anon, authenticated;


-- ---------------------------------------------------------------------------
-- 1.2 Ninguna restricción de rango: se aceptaba cualquier número
-- ---------------------------------------------------------------------------
-- bus_locations no tenía NI UNA check constraint. Se podía insertar latitud
-- 999, longitud -5000 o velocidad negativa, y el mapa del pasajero intentaba
-- dibujarlo igual (los cálculos de encuadre que tanto costó arreglar en el
-- panel de empresa se van al demonio con un solo punto fuera de rango).
--
-- La tabla está vacía, así que las constraints se validan al instante. Si en el
-- futuro se aplican con datos dentro, habría que limpiar antes.
--
-- La cota de velocidad es deliberadamente generosa (400 km/h): un GPS con mala
-- señal escupe picos absurdos y no se quiere **rechazar** un punto legítimo de
-- tracking por eso. Lo físicamente imposible lo marca el trigger de anomalías,
-- que es la herramienta correcta para "sospechoso pero se guarda igual".
alter table public.bus_locations
  add constraint bus_locations_latitud_valida  check (latitud  between -90  and 90),
  add constraint bus_locations_longitud_valida check (longitud between -180 and 180),
  add constraint bus_locations_velocidad_valida check (velocidad is null or (velocidad >= 0 and velocidad <= 400)),
  add constraint bus_locations_heading_valido   check (heading   is null or (heading >= 0 and heading <= 360));


-- ---------------------------------------------------------------------------
-- 1.3 Defensa en profundidad en el propio trigger
-- ---------------------------------------------------------------------------
-- Con 1.1 el timestamp ya lo pone la base, así que el caso `horas <= 0` deja de
-- ser explotable desde afuera. Pero sigue siendo alcanzable de forma legítima:
-- `now()` es la hora de la TRANSACCIÓN, así que dos inserts dentro de la misma
-- transacción reciben el mismo timestamp exacto y `horas` da 0 — el chequeo se
-- saltaba en silencio también ahí.
--
-- Ahora un salto grande sin avance de tiempo se marca como anomalía en vez de
-- ignorarse. 500 m es holgado: dos puntos legítimos del mismo instante están
-- separados por metros, no por medio kilómetro.
create or replace function public.flag_anomalous_location()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  prev record;
  dist_km double precision;
  horas double precision;
  velocidad_kmh double precision;
begin
  select latitud, longitud, "timestamp" into prev
  from public.bus_locations
  where bus_id = new.bus_id
  order by "timestamp" desc
  limit 1;

  if prev is not null then
    dist_km := 6371 * 2 * asin(sqrt(
      power(sin(radians(new.latitud - prev.latitud) / 2), 2) +
      cos(radians(prev.latitud)) * cos(radians(new.latitud)) *
      power(sin(radians(new.longitud - prev.longitud) / 2), 2)
    ));
    horas := extract(epoch from (new."timestamp" - prev."timestamp")) / 3600.0;

    if horas > 0 then
      velocidad_kmh := dist_km / horas;
      if velocidad_kmh > 200 then
        new.anomalo := true;
      end if;
    elsif dist_km > 0.5 then
      -- Mismo instante (o anterior) y medio kilómetro de diferencia: no hay
      -- velocidad que calcular, pero es físicamente imposible igual.
      new.anomalo := true;
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.flag_anomalous_location() from public;


-- ===========================================================================
-- PARTE 2 — FILTRACIONES DE LECTURA
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 2.1 El historial de turnos de los choferes era público
-- ---------------------------------------------------------------------------
-- "Public read viajes" es `using (true)`: cualquiera sin sesión podía listar
-- todos los viajes con su chofer_id, inicio y fin. Eso no es información de
-- transporte público, es el registro laboral de una persona.
--
-- Peor en combinación: `viajes` y `buses` exponen chofer_id, y bus_locations
-- expone el historial GPS completo, también público. Encadenando las tres, un
-- desconocido sin cuenta puede reconstruir dónde estuvo un chofer concreto,
-- minuto a minuto, desde siempre. El chofer_id es un UUID, pero deja de ser
-- anónimo apenas alguien se sube una vez a ese bus.
--
-- Los viajes solo los leen el panel de empresa, el de JIRB y el propio chofer
-- (verificado: admin-empresa.service, admin-jirb.service y chofer.service), y
-- todos están detrás de login. Ninguna pantalla los necesita sin sesión.
alter policy "Public read viajes" on public.viajes to authenticated;

-- ---------------------------------------------------------------------------
-- 2.2 Quitarle a `anon` las columnas que identifican personas
-- ---------------------------------------------------------------------------
-- El resto de las tablas sí son información de transporte público y se dejan
-- legibles sin sesión a propósito (rutas, paradas, horarios, posiciones). Lo
-- que se saca es solo la columna que ata una fila a una persona.
--
-- OJO: revocar el SELECT de una columna hace que un `select *` de `anon` sobre
-- esa tabla falle con "permission denied". Se verificó que ninguna pantalla
-- consulta estas tablas sin sesión — toda la app pasa por RoleGuard. Si algún
-- día se agrega una vista pública (landing con rutas en vivo, por ejemplo),
-- tiene que pedir columnas explícitas en vez de `*`.
revoke select (chofer_id)  on public.buses                  from anon;
revoke select (user_id)    on public.calificaciones         from anon;
revoke select (created_by) on public.lugares_personalizados from anon;


-- ===========================================================================
-- Lo que NO hace esta migración, y por qué
-- ===========================================================================
-- **No hay límite de frecuencia en bus_locations.** Un chofer autenticado puede
-- insertar tan rápido como quiera: la app manda un punto cada 5 s, pero nada en
-- la base lo obliga. Con la tabla creciendo sin TTL, eso es a la vez un vector
-- de costo y de degradación.
--
-- No se resuelve acá a propósito: un limitador en el camino caliente de
-- inserción (tabla de contadores + trigger, como geocode_rate_limit) le agrega
-- una escritura extra a CADA punto de CADA bus, y esa cuenta hay que hacerla
-- con números reales de flota, no a ciegas. Además necesita una decisión de
-- producto: cuál es el mínimo intervalo aceptable. Va junto con la política de
-- retención de bus_locations, que es la otra mitad del mismo problema.
