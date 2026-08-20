import { Injectable } from '@angular/core';
import { supabaseClient } from '../supabase-client';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';
import { Bus, Ruta, Parada, BusLocation, Empresa } from '../models/transport.model';
import { Horario, HorarioSalida, ReporteBug, AvisoSistema, Plan, Suscripcion, SolicitudPlan, Factura, Viaje } from '../models/features.model';
import { UserProfile } from '../models/user-profile.model';

@Injectable({ providedIn: 'root' })
export class AdminEmpresaService {
  private supabase: SupabaseClient;

  constructor() {
    this.supabase = supabaseClient();
  }

  private newIsolatedClient(): SupabaseClient {
    return createClient(environment.supabaseUrl, environment.supabaseAnonKey, {
      auth: { persistSession: false, storageKey: `sb-temp-${crypto.randomUUID()}` },
    });
  }

  // ---- RUTAS ----
  async getRutas(empresaId: string): Promise<Ruta[]> {
    const { data, error } = await this.supabase
      .from('rutas')
      .select('*')
      .eq('empresa_id', empresaId)
      .order('nombre');
    if (error) throw error;
    return data as Ruta[];
  }

  async createRuta(ruta: Partial<Ruta>): Promise<Ruta> {
    const { data, error } = await this.supabase.from('rutas').insert(ruta).select().single();
    if (error) throw error;
    return data as Ruta;
  }

  async updateRuta(id: string, updates: Partial<Ruta>): Promise<Ruta> {
    const { data, error } = await this.supabase.from('rutas').update(updates).eq('id', id).select().single();
    if (error) throw error;
    return data as Ruta;
  }

  async deleteRuta(id: string): Promise<void> {
    const { error } = await this.supabase.from('rutas').delete().eq('id', id);
    if (error) throw error;
  }

  // ---- PARADAS ----
  async getParadas(rutaId: string): Promise<Parada[]> {
    const { data, error } = await this.supabase.from('paradas').select('*').eq('ruta_id', rutaId).order('orden');
    if (error) throw error;
    return data as Parada[];
  }

  async createParada(parada: Partial<Parada>): Promise<Parada> {
    const { data, error } = await this.supabase.from('paradas').insert(parada).select().single();
    if (error) throw error;
    return data as Parada;
  }

  async deleteParada(id: string): Promise<void> {
    const { error } = await this.supabase.from('paradas').delete().eq('id', id);
    if (error) throw error;
  }

  // ---- BUSES ----
  async getBuses(empresaId: string): Promise<Bus[]> {
    const { data, error } = await this.supabase
      .from('buses')
      .select('*, ruta:rutas(nombre, color), chofer:profiles(nombre_completo)')
      .eq('empresa_id', empresaId)
      .order('placa');
    if (error) throw error;
    return data as Bus[];
  }

  async createBus(bus: Partial<Bus>): Promise<Bus> {
    const { data, error } = await this.supabase.from('buses').insert(bus).select().single();
    if (error) throw error;
    return data as Bus;
  }

  async updateBus(id: string, updates: Partial<Bus>): Promise<Bus> {
    const { data, error } = await this.supabase.from('buses').update(updates).eq('id', id).select().single();
    if (error) throw error;
    return data as Bus;
  }

  async deleteBus(id: string): Promise<void> {
    const { error } = await this.supabase.from('buses').delete().eq('id', id);
    if (error) throw error;
  }

  // ---- CHOFERES ----
  async getChoferes(empresaId: string): Promise<UserProfile[]> {
    const { data, error } = await this.supabase
      .from('profiles')
      .select('*')
      .eq('empresa_id', empresaId)
      .eq('rol', 'chofer')
      .order('nombre_completo');
    if (error) throw error;
    return data as UserProfile[];
  }

  async createChofer(email: string, password: string, nombre: string, empresaId: string): Promise<void> {
    const isolated = this.newIsolatedClient();
    const { data, error } = await isolated.auth.signUp({
      email, password,
      // `created_by_admin` le dice a un trigger en auth.users que confirme el
      // email solo: esta cuenta la crea la empresa para su chofer, no es un
      // self-signup público, así que no tiene sentido bloquearla esperando
      // que alguien confirme un correo que nadie va a mandar.
      options: { data: { nombre_completo: nombre, created_by_admin: true } },
    });
    if (error) throw error;

    // Si el correo ya existía, Supabase devuelve un "éxito" con el usuario
    // existente en vez de un error (protección anti-enumeración) — pero
    // `identities` viene vacío y la contraseña nueva NUNCA se aplica. Sin
    // este chequeo, el chofer quedaba vinculado a la empresa igual (por
    // eso aparecía en la lista) pero no podía entrar con la contraseña que
    // la empresa acababa de escribir, y no había ningún aviso de por qué.
    if (data.user && data.user.identities?.length === 0) {
      throw new Error('Ya existe una cuenta con ese correo (con otra contraseña) — usá un correo distinto');
    }

    if (data.user) {
      await this.supabase.from('profiles').update({
        rol: 'chofer', empresa_id: empresaId,
      }).eq('id', data.user.id);
    }
  }

  async updateChofer(id: string, updates: Partial<UserProfile>): Promise<void> {
    const { error } = await this.supabase.from('profiles').update(updates).eq('id', id);
    if (error) throw error;
  }

  // El borrado real y el reseteo de contraseña tocan auth.users, que
  // requiere la service_role key — no puede hacerse desde el navegador con
  // la anon key, por eso pasa por la edge function manage-chofer.
  async deleteChofer(id: string): Promise<void> {
    const { data, error } = await this.supabase.functions.invoke('manage-chofer', {
      body: { choferId: id, action: 'delete' },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
  }

  async resetChoferPassword(id: string, newPassword: string): Promise<void> {
    const { data, error } = await this.supabase.functions.invoke('manage-chofer', {
      body: { choferId: id, action: 'reset_password', newPassword },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
  }

  // ---- ALERTAS GPS ----
  async getAnomalousLocations(empresaId: string): Promise<BusLocation[]> {
    const { data, error } = await this.supabase
      .from('bus_locations')
      .select('*, bus:buses!inner(placa, numero_unidad, ruta:rutas(nombre, color), empresa_id)')
      .eq('anomalo', true)
      .eq('bus.empresa_id', empresaId)
      .order('timestamp', { ascending: false })
      .limit(50);
    if (error) throw error;
    return data as BusLocation[];
  }

  async dismissAnomaly(id: string): Promise<void> {
    const { error } = await this.supabase.from('bus_locations').update({ anomalo: false }).eq('id', id);
    if (error) throw error;
  }

  // ---- REPORTES DE BUGS ----
  async getReportes(empresaId: string): Promise<ReporteBug[]> {
    const { data, error } = await this.supabase
      .from('reportes_bugs')
      .select('*')
      .eq('empresa_id', empresaId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data as ReporteBug[];
  }

  async createReporte(empresaId: string, autorId: string, titulo: string, descripcion: string): Promise<void> {
    const { error } = await this.supabase.from('reportes_bugs').insert({
      empresa_id: empresaId, autor_id: autorId, titulo, descripcion,
    });
    if (error) throw error;
  }

  // ---- EMERGENCIAS (botón de pánico del chofer) ----
  // Mismo tipo de fila que un reporte normal (titulo='Emergencia'), pero
  // separado en su propia sección: se pierde entre los "Atraso"/"Bus
  // averiado" de la lista general y necesita verse de inmediato.
  async getEmergencias(empresaId: string): Promise<ReporteBug[]> {
    // reportes_bugs tiene dos FK hacia profiles (autor_id y respondido_por),
    // así que "profiles" solo no alcanza -- PostgREST no puede adivinar cuál
    // de las dos usar y devuelve error (PGRST201) en vez de datos. Hay que
    // nombrar la FK explícita. Esto tumbaba TODO el panel de empresa: esta
    // consulta va en el mismo Promise.all que choferes/buses/rutas.
    const { data, error } = await this.supabase
      .from('reportes_bugs')
      .select('*, autor:profiles!reportes_bugs_autor_id_fkey(nombre_completo)')
      .eq('empresa_id', empresaId)
      .eq('titulo', 'Emergencia')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data as ReporteBug[];
  }

  async resolverEmergencia(id: string): Promise<void> {
    // Sin .select() acá, un UPDATE bloqueado por RLS no da error: Postgres
    // simplemente actualiza 0 filas y Supabase lo reporta como éxito. Con
    // .select() se puede detectar ese caso (data vacío) y avisar de verdad
    // en vez de mostrar "resuelta" cuando en la base sigue pendiente.
    const { data, error } = await this.supabase
      .from('reportes_bugs')
      .update({ estado: 'resuelto' })
      .eq('id', id)
      .select('id');
    if (error) throw error;
    if (!data || data.length === 0) throw new Error('Sin permiso para resolver este reporte');
  }

  // ---- FACTURAS ----
  // Devuelve [] en vez de lanzar si la tabla todavía no existe (migración
  // pendiente de aplicar): esta consulta va adentro de un Promise.all en
  // loadData() del panel de empresa, así que si tira error acá se cae TODO
  // el resto del panel (choferes, buses, rutas...) aunque esos datos estén
  // perfectamente bien -- eso fue lo que hizo parecer que un chofer había
  // desaparecido cuando en realidad nunca se tocó.
  async getFacturas(empresaId: string): Promise<Factura[]> {
    const { data, error } = await this.supabase
      .from('facturas')
      .select('*, plan:planes(nombre), empresa:empresas(nombre, cedula_juridica)')
      .eq('empresa_id', empresaId)
      .order('fecha', { ascending: false });
    if (error) return [];
    return data as Factura[];
  }

  // ---- AVISOS DEL SISTEMA ----
  async getAvisosActivos(): Promise<AvisoSistema[]> {
    const { data, error } = await this.supabase
      .from('avisos_sistema')
      .select('*')
      .eq('activo', true)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data as AvisoSistema[];
  }

  // ---- HORARIOS ----
  async getHorarios(rutaId: string): Promise<Horario[]> {
    const { data, error } = await this.supabase.from('horarios').select('*').eq('ruta_id', rutaId);
    if (error) throw error;
    return data as Horario[];
  }

  async saveHorario(horario: Partial<Horario>): Promise<void> {
    const { error } = await this.supabase.from('horarios').upsert(horario);
    if (error) throw error;
  }

  async deleteHorario(id: string): Promise<void> {
    const { error } = await this.supabase.from('horarios').delete().eq('id', id);
    if (error) throw error;
  }

  // ---- HORARIO_SALIDAS (reemplaza a HORARIOS: horas exactas, no rango) ----
  async getHorarioSalidas(rutaId: string): Promise<HorarioSalida[]> {
    const { data, error } = await this.supabase.from('horario_salidas').select('*').eq('ruta_id', rutaId).order('hora');
    if (error) throw error;
    return data as HorarioSalida[];
  }

  async addHorarioSalida(rutaId: string, dia: string, hora: string): Promise<HorarioSalida> {
    const { data, error } = await this.supabase.from('horario_salidas').insert({ ruta_id: rutaId, dia, hora }).select().single();
    if (error) throw error;
    return data as HorarioSalida;
  }

  async deleteHorarioSalida(id: string): Promise<void> {
    const { error } = await this.supabase.from('horario_salidas').delete().eq('id', id);
    if (error) throw error;
  }

  // ---- PLANES ----
  // No hay pasarela de pago real: "comprar" un plan crea una solicitud
  // pendiente que JIRB confirma manualmente (misma pantalla que ya usa para
  // asignar planes hoy).
  async getPlanes(): Promise<Plan[]> {
    const { data, error } = await this.supabase.from('planes').select('*').eq('activo', true).order('precio_mensual');
    if (error) throw error;
    return data as Plan[];
  }

  async getMiSuscripcion(empresaId: string): Promise<Suscripcion | null> {
    const { data, error } = await this.supabase
      .from('suscripciones')
      .select('*, plan:planes(*)')
      .eq('empresa_id', empresaId)
      .maybeSingle();
    if (error) throw error;
    return data as Suscripcion | null;
  }

  async getSolicitudPlanPendiente(empresaId: string): Promise<SolicitudPlan | null> {
    const { data, error } = await this.supabase
      .from('solicitudes_plan')
      .select('*, plan:planes(nombre)')
      .eq('empresa_id', empresaId)
      .eq('estado', 'pendiente')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data as SolicitudPlan | null;
  }

  async solicitarPlan(empresaId: string, planId: string): Promise<void> {
    const { error } = await this.supabase.from('solicitudes_plan').insert({ empresa_id: empresaId, plan_id: planId });
    if (error) throw error;
  }

  // ---- STATS ----
  async getStats(empresaId: string): Promise<{ buses: number; rutas: number; choferes: number; busesEnRuta: number }> {
    const [buses, rutas, choferes] = await Promise.all([
      this.supabase.from('buses').select('id, estado').eq('empresa_id', empresaId),
      this.supabase.from('rutas').select('id').eq('empresa_id', empresaId),
      this.supabase.from('profiles').select('id').eq('empresa_id', empresaId).eq('rol', 'chofer'),
    ]);

    const busData = (buses.data || []) as { id: string; estado: string }[];
    return {
      buses: busData.length,
      rutas: (rutas.data || []).length,
      choferes: (choferes.data || []).length,
      busesEnRuta: busData.filter(b => b.estado === 'en_ruta').length,
    };
  }

  // ---- PERFIL DE LA EMPRESA ----
  async getEmpresa(id: string): Promise<Empresa> {
    const { data, error } = await this.supabase.from('empresas').select('*').eq('id', id).single();
    if (error) throw error;
    return data as Empresa;
  }

  // Requiere la policy de UPDATE para admin_empresa en la tabla empresas
  // (migración pendiente de aplicar) -- sin ella, RLS bloquea el UPDATE en
  // silencio (204 sin cambiar nada), por eso se pide .select() para
  // detectar ese caso igual que en resolverEmergencia().
  async updateEmpresa(id: string, updates: Partial<Empresa>): Promise<void> {
    const { data, error } = await this.supabase.from('empresas').update(updates).eq('id', id).select('id');
    if (error) throw error;
    if (!data || data.length === 0) throw new Error('Sin permiso para actualizar los datos de la empresa');
  }

  // ---- VIAJES RECIENTES (para el gráfico de Inicio) ----
  async getViajesRecientes(empresaId: string, dias = 7): Promise<Viaje[]> {
    const desde = new Date();
    desde.setDate(desde.getDate() - (dias - 1));
    desde.setHours(0, 0, 0, 0);
    const { data, error } = await this.supabase
      .from('viajes')
      .select('id, inicio, fin, estado, distancia_km')
      .gte('inicio', desde.toISOString())
      .order('inicio', { ascending: true });
    if (error) return [];
    return data as Viaje[];
  }
}
