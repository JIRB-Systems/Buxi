-- Métricas del negocio para JIRB y precios reales de los planes.
--
-- Los planes tenían precio_mensual = 0 y el modelo de cobro real (documento
-- "Planes Buxci") es por bus al mes con un mínimo mensual. Se agregan esas dos
-- columnas y se cargan los valores vigentes (colones, sin IVA, oct. 2026).
alter table public.planes add column if not exists precio_por_bus numeric(10,2);
alter table public.planes add column if not exists minimo_mensual numeric(10,2);

update public.planes set precio_por_bus = 5000, minimo_mensual = 20000 where nombre = 'Básico';
update public.planes set precio_por_bus = 4500, minimo_mensual = 50000 where nombre = 'Pro';
update public.planes set precio_por_bus = 4000, minimo_mensual = 0     where nombre = 'Enterprise';

-- Motivo de rechazo de una solicitud de empresa (antes no había forma de
-- decirle a la empresa por qué).
alter table public.solicitudes_empresa add column if not exists motivo_rechazo text;

-- El ingreso estimado cuenta solo empresas activas: una empresa marcada
-- inactiva no paga aunque su suscripción siga figurando como activa.
--
-- Una sola llamada con todo lo que el panel de JIRB necesita, calculado en la
-- base: antes el panel bajaba tablas enteras solo para contar filas.
create or replace function public.metricas_negocio()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r jsonb;
begin
  if public.get_my_role() is distinct from 'admin_jirb' then
    raise exception 'Solo la administración de la plataforma puede ver estas métricas' using errcode = '42501';
  end if;

  with sub_actual as (
    select distinct on (s.empresa_id) s.empresa_id, s.estado, s.fecha_fin, p.nombre plan,
           coalesce(p.precio_por_bus, 0) precio_por_bus, coalesce(p.minimo_mensual, 0) minimo_mensual
    from public.suscripciones s join public.planes p on p.id = s.plan_id
    order by s.empresa_id, s.created_at desc
  ),
  por_empresa as (
    select e.id, e.estado, sa.estado sub_estado, sa.plan, sa.fecha_fin,
           (select count(*) from public.buses b where b.empresa_id = e.id) buses,
           greatest((select count(*) from public.buses b where b.empresa_id = e.id) * sa.precio_por_bus, sa.minimo_mensual) cobro
    from public.empresas e left join sub_actual sa on sa.empresa_id = e.id
  )
  select jsonb_build_object(
    'empresas_total',       (select count(*) from por_empresa),
    'empresas_activas',     (select count(*) from por_empresa where estado = 'activo'),
    'empresas_sin_plan',    (select count(*) from por_empresa where sub_estado is null),
    'suscripciones',        jsonb_build_object(
                              'activa',    (select count(*) from por_empresa where sub_estado = 'activa'),
                              'prueba',    (select count(*) from por_empresa where sub_estado = 'prueba'),
                              'vencida',   (select count(*) from por_empresa where sub_estado = 'vencida'),
                              'cancelada', (select count(*) from por_empresa where sub_estado = 'cancelada')),
    'empresas_que_pagan',   (select count(*) from por_empresa where sub_estado = 'activa' and estado = 'activo'),
    'mrr_estimado',         (select coalesce(sum(cobro), 0) from por_empresa where sub_estado = 'activa' and estado = 'activo'),
    'mrr_en_prueba',        (select coalesce(sum(cobro), 0) from por_empresa where sub_estado = 'prueba' and estado = 'activo'),
    'vencen_30d',           (select count(*) from por_empresa where sub_estado in ('activa','prueba')
                               and fecha_fin between current_date and current_date + 30),
    'bajas_30d',            (select count(*) from public.suscripciones
                               where estado in ('vencida','cancelada') and fecha_fin >= current_date - 30),
    'buses_total',          (select count(*) from public.buses),
    'buses_en_ruta',        (select count(*) from public.buses where estado = 'en_ruta'),
    'viajes_30d',           (select count(*) from public.viajes where inicio >= now() - interval '30 days'),
    'pasajeros',            (select count(*) from public.profiles where rol = 'pasajero'),
    'ingresos_por_mes',     coalesce((
                              select jsonb_agg(jsonb_build_object('mes', mes, 'monto', monto) order by mes)
                              from (
                                select to_char(date_trunc('month', fecha), 'YYYY-MM') mes, sum(monto) monto
                                from public.facturas
                                where fecha >= date_trunc('month', current_date) - interval '5 months'
                                group by 1
                              ) m), '[]'::jsonb)
  ) into r;
  return r;
end;
$$;

revoke execute on function public.metricas_negocio() from public, anon;
grant execute on function public.metricas_negocio() to authenticated;
