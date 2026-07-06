-- Primera capa anti-spoofing: marca (sin rechazar) ubicaciones que implican
-- una velocidad físicamente imposible respecto al punto anterior del mismo
-- bus. No se rechaza el insert para no romper el tracking en tiempo real
-- ante un hueco de red legítimo; solo queda marcado para auditoría/futuro uso.
alter table public.bus_locations add column if not exists anomalo boolean not null default false;

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
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_flag_anomalous_location on public.bus_locations;
create trigger trg_flag_anomalous_location
before insert on public.bus_locations
for each row execute function public.flag_anomalous_location();
