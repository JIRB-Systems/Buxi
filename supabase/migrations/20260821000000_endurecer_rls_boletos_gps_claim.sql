-- Cierra cuatro agujeros de RLS encontrados en la revisión del 2026-08-20.
-- Los cuatro comparten la misma causa de fondo: una policy que define QUIÉN
-- puede tocar una fila, pero no QUÉ columnas puede cambiar ni con qué
-- valores. RLS filtra filas, no columnas — para lo segundo hacen falta
-- privilegios de columna o un with check explícito, y en un caso una función
-- SECURITY DEFINER.


-- ---------------------------------------------------------------------------
-- 1. BOLETOS: cualquiera podía auto-emitirse boletos gratis
-- ---------------------------------------------------------------------------
-- La policy de INSERT solo validaba el rol y que pasajero_id fuera el propio.
-- No miraba `precio`, `estado`, `expira_at` ni que `empresa_id` correspondiera
-- de verdad a la ruta, y `authenticated` tiene INSERT sobre todas esas
-- columnas: por la API REST se podía insertar un boleto con precio 0, estado
-- 'pagado' y la expiración que uno quisiera, para cualquier ruta.
--
-- Hoy es inocuo porque no hay pasarela de pago (comprarBoleto marca todo como
-- pagado a propósito), pero este es el agujero que hay que tener cerrado ANTES
-- de conectar pagos, no después.

-- El código, el estado y las fechas los pone la base con sus defaults; el
-- cliente no tiene por qué proponerlos. Al revocar el INSERT de la columna, un
-- INSERT que no la menciona sigue funcionando y toma el default.
revoke insert (codigo, estado, expira_at, usado_at, usado_por)
  on public.boletos from anon, authenticated;

drop policy if exists "Pasajero crea sus boletos" on public.boletos;

-- El precio y la empresa ya no los propone el cliente: tienen que coincidir
-- con los de la ruta que se está comprando. Una ruta sin precio (null) sigue
-- valiendo 0, que es el comportamiento actual y es deliberado.
create policy "Pasajero crea sus boletos" on public.boletos for insert
  with check (
    public.get_my_role() = 'pasajero'
    and pasajero_id = auth.uid()
    and exists (
      select 1 from public.rutas r
      where r.id = boletos.ruta_id
        and r.empresa_id = boletos.empresa_id
        and boletos.precio = coalesce(r.precio, 0)
    )
  );


-- ---------------------------------------------------------------------------
-- 2. BUS_LOCATIONS: una empresa podía reescribir el GPS de sus propios buses
-- ---------------------------------------------------------------------------
-- "Empresa admin dismiss own anomalies" se creó para descartar anomalías, pero
-- es un `for update` sin `with check` — cuando falta, Postgres usa el USING
-- también como check — y `authenticated` tenía UPDATE sobre todas las
-- columnas. Es decir: latitud, longitud, timestamp y velocidad eran editables.
-- Eso vaciaba de sentido el diseño anti-spoofing: JIRB vigila anomalías de GPS
-- pero el vigilado podía editar la evidencia.
--
-- Verificado antes de revocar: en toda la app el único UPDATE que se le hace a
-- bus_locations es `{ anomalo: false }` (admin-empresa.service.ts y
-- admin-jirb.service.ts). Nadie más escribe en esta tabla salvo el INSERT del
-- chofer, que no se toca acá.
revoke update on public.bus_locations from anon, authenticated;
grant  update (anomalo) on public.bus_locations to authenticated;

drop policy if exists "Empresa admin dismiss own anomalies" on public.bus_locations;

create policy "Empresa admin dismiss own anomalies" on public.bus_locations for update
  using (
    public.get_my_role() = 'admin_empresa'
    and exists (
      select 1 from public.buses b
      where b.id = bus_locations.bus_id and b.empresa_id = public.get_my_empresa_id()
    )
  )
  -- Explícito aunque el privilegio de columna ya lo garantice: la fila tiene
  -- que seguir siendo de un bus de la misma empresa después del UPDATE.
  with check (
    public.get_my_role() = 'admin_empresa'
    and exists (
      select 1 from public.buses b
      where b.id = bus_locations.bus_id and b.empresa_id = public.get_my_empresa_id()
    )
  );


-- ---------------------------------------------------------------------------
-- 3. PROFILES: la ventana de 5 minutos no evitaba secuestrar cuentas ajenas
-- ---------------------------------------------------------------------------
-- El flujo legítimo es: la empresa hace signUp de su chofer y enseguida le
-- asigna rol y empresa_id. Para que ese UPDATE encuentre la fila recién creada
-- (todavía con empresa_id null), 20260712220000 abrió una rama "empresa_id is
-- null and created_at > now() - 5 minutes", y 20260817180000 se la agregó
-- también al SELECT.
--
-- El problema es que esa condición no distingue "la cuenta que yo acabo de
-- crear" de "cualquier persona que se registró en la plataforma en los últimos
-- 5 minutos": todo pasajero nuevo tiene empresa_id null. Cualquier
-- admin_empresa podía leer los datos personales (nombre, correo, teléfono,
-- provincia) de todo registro nuevo y convertirlo en personal de su empresa.
-- 20260820000000 amplió el rol asignable a admin_empresa, así que el secuestro
-- pasó a poder darle a la víctima un rol de más peso.
--
-- El comentario de esa migración afirma que el guard de los 5 minutos "es lo
-- que realmente evita secuestrar cuentas ajenas". No es así: solo achica la
-- ventana de tiempo, no acota a quién. Se deja anotado acá para que no se
-- vuelva a dar por bueno.
--
-- Fix: en vez de adivinar por tiempo, se marca la pertenencia en el momento de
-- crear la cuenta. El plumbing ya existía para `created_by_admin`; se agrega el
-- id de la empresa que la crea y el claim se acota a eso.
alter table public.profiles
  add column if not exists created_by_empresa_id uuid references public.empresas(id) on delete set null;

create index if not exists profiles_created_by_empresa_idx
  on public.profiles(created_by_empresa_id) where created_by_empresa_id is not null;

-- Nota: raw_user_meta_data lo controla quien llama a signUp, así que alguien
-- podría auto-marcarse como creado por una empresa. Eso solo permitiría
-- ofrecerse a sí mismo para ser reclamado — no da acceso a cuentas ajenas, que
-- es lo que este fix cierra. El self-signup público (supabase.service.ts) no
-- manda este campo.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, nombre_completo, correo, telefono, provincia, rol, estado, created_by_empresa_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'nombre_completo', new.raw_user_meta_data ->> 'full_name', 'Usuario'),
    new.email,
    new.raw_user_meta_data ->> 'telefono',
    new.raw_user_meta_data ->> 'provincia',
    'pasajero',
    'activo',
    (new.raw_user_meta_data ->> 'created_by_empresa_id')::uuid
  );
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public;

drop policy if exists "Empresa admin read own staff profiles" on public.profiles;
drop policy if exists "Empresa admin manage own staff profiles" on public.profiles;

create policy "Empresa admin read own staff profiles" on public.profiles for select
  using (
    public.get_my_role() = 'admin_empresa'
    and (
      empresa_id = public.get_my_empresa_id()
      or (empresa_id is null and created_by_empresa_id = public.get_my_empresa_id())
    )
  );

create policy "Empresa admin manage own staff profiles" on public.profiles for update
  using (
    public.get_my_role() = 'admin_empresa'
    and (
      empresa_id = public.get_my_empresa_id()
      or (empresa_id is null and created_by_empresa_id = public.get_my_empresa_id())
    )
  )
  with check (
    public.get_my_role() = 'admin_empresa'
    and empresa_id = public.get_my_empresa_id()
    and rol in ('chofer', 'admin_empresa')
  );


-- ---------------------------------------------------------------------------
-- 4. BUSES: el chofer no podía cambiar el estado de su bus (falla silenciosa)
-- ---------------------------------------------------------------------------
-- ChoferService.updateBusStatus() hace `update buses set estado` al iniciar y
-- terminar un viaje, pero en buses solo hay policies para admin_empresa y
-- admin_jirb. El UPDATE no da error: RLS no encuentra la fila, afecta 0 filas,
-- y Supabase lo reporta como éxito — el mismo patrón de falla silenciosa que
-- ya mordió al equipo en resolverEmergencia, createEquipoMiembro y editar
-- empresa. Resultado: el bus nunca pasa a 'en_ruta' y los paneles de empresa y
-- JIRB nunca muestran ese estado con un chofer real.
--
-- Acá no sirven los privilegios de columna: admin_empresa y admin_jirb también
-- son `authenticated` y sí necesitan escribir el resto de las columnas de
-- buses. Se usa una función SECURITY DEFINER acotada a una sola columna, que
-- es la herramienta correcta para "este rol puede cambiar exactamente esto".
create or replace function public.chofer_set_bus_estado(p_bus_id uuid, p_estado text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_estado not in ('activo', 'en_ruta') then
    raise exception 'Estado no permitido para un chofer: %', p_estado;
  end if;

  update public.buses
  set estado = p_estado
  where id = p_bus_id
    and chofer_id = auth.uid();

  if not found then
    raise exception 'Ese bus no está asignado a tu cuenta';
  end if;
end;
$$;

revoke execute on function public.chofer_set_bus_estado(uuid, text) from public;
grant  execute on function public.chofer_set_bus_estado(uuid, text) to authenticated;
