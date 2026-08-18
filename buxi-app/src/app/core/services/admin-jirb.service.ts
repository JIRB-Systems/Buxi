import { Injectable } from '@angular/core';
import { supabaseClient } from '../supabase-client';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';
import { Empresa, Bus, Ruta, Parada } from '../models/transport.model';
import { UserProfile } from '../models/user-profile.model';
import { Calificacion, Horario, Viaje, ActivityLog, SystemConfig, Plan, Suscripcion, ReporteBug, AvisoSistema, Anuncio } from '../models/features.model';
import { BusLocation } from '../models/transport.model';

@Injectable({ providedIn: 'root' })
export class AdminJirbService {
  private supabase: SupabaseClient;

  constructor() {
    this.supabase = supabaseClient();
  }

  private newIsolatedClient(): SupabaseClient {
    return createClient(environment.supabaseUrl, environment.supabaseAnonKey, {
      auth: { persistSession: false, storageKey: `sb-temp-${crypto.randomUUID()}` },
    });
  }

  // ---- STATS GLOBALES ----
  async getGlobalStats(): Promise<{
    totalEmpresas: number; totalRutas: number; totalBuses: number;
    totalChoferes: number; totalPasajeros: number; busesEnRuta: number;
    totalCalificaciones: number; promedioGeneral: number;
  }> {
    const [empresas, rutas, buses, choferes, pasajeros, calificaciones] = await Promise.all([
      this.supabase.from('empresas').select('id'),
      this.supabase.from('rutas').select('id'),
      this.supabase.from('buses').select('id, estado'),
      this.supabase.from('profiles').select('id').eq('rol', 'chofer'),
      this.supabase.from('profiles').select('id').eq('rol', 'pasajero'),
      this.supabase.from('calificaciones').select('estrellas'),
    ]);

    const busData = (buses.data || []) as { id: string; estado: string }[];
    const calData = (calificaciones.data || []) as { estrellas: number }[];
    const avgRating = calData.length > 0
      ? calData.reduce((s, c) => s + c.estrellas, 0) / calData.length
      : 0;

    return {
      totalEmpresas: (empresas.data || []).length,
      totalRutas: (rutas.data || []).length,
      totalBuses: busData.length,
      totalChoferes: (choferes.data || []).length,
      totalPasajeros: (pasajeros.data || []).length,
      busesEnRuta: busData.filter(b => b.estado === 'en_ruta').length,
      totalCalificaciones: calData.length,
      promedioGeneral: Math.round(avgRating * 10) / 10,
    };
  }

  // ---- EMPRESAS ----
  async getEmpresas(): Promise<Empresa[]> {
    const { data, error } = await this.supabase.from('empresas').select('*').order('nombre');
    if (error) throw error;
    return data as Empresa[];
  }

  async createEmpresa(empresa: Partial<Empresa>): Promise<Empresa> {
    const { data, error } = await this.supabase.from('empresas').insert(empresa).select().single();
    if (error) throw error;
    return data as Empresa;
  }

  async updateEmpresa(id: string, updates: Partial<Empresa>): Promise<Empresa> {
    const { data, error } = await this.supabase.from('empresas').update(updates).eq('id', id).select().single();
    if (error) throw error;
    return data as Empresa;
  }

  async deleteEmpresa(id: string): Promise<void> {
    const { error } = await this.supabase.from('empresas').delete().eq('id', id);
    if (error) throw error;
  }

  // ---- RUTAS (todas) ----
  async getAllRutas(): Promise<Ruta[]> {
    const { data, error } = await this.supabase
      .from('rutas')
      .select('*, empresa:empresas(nombre)')
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

  // ---- BUSES (todos) ----
  async getAllBuses(): Promise<Bus[]> {
    const { data, error } = await this.supabase
      .from('buses')
      .select('*, ruta:rutas(nombre, color), empresa:empresas(nombre), chofer:profiles(nombre_completo)')
      .order('placa');
    if (error) throw error;
    return data as Bus[];
  }

  async updateBus(id: string, updates: Partial<Bus>): Promise<void> {
    const { error } = await this.supabase.from('buses').update(updates).eq('id', id);
    if (error) throw error;
  }

  async deleteBus(id: string): Promise<void> {
    const { error } = await this.supabase.from('buses').delete().eq('id', id);
    if (error) throw error;
  }

  // ---- USUARIOS (todos) ----
  async getAllUsers(): Promise<UserProfile[]> {
    const { data, error } = await this.supabase.from('profiles').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return data as UserProfile[];
  }

  async updateUserRole(userId: string, rol: string, empresaId?: string | null): Promise<void> {
    const updates: any = { rol };
    if (empresaId !== undefined) updates.empresa_id = empresaId;
    const { error } = await this.supabase.from('profiles').update(updates).eq('id', userId);
    if (error) throw error;
  }

  async updateUserStatus(userId: string, estado: string): Promise<void> {
    const { error } = await this.supabase.from('profiles').update({ estado }).eq('id', userId);
    if (error) throw error;
  }

  // ---- CALIFICACIONES ----
  async getAllCalificaciones(): Promise<Calificacion[]> {
    const { data, error } = await this.supabase
      .from('calificaciones')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    return data as Calificacion[];
  }

  async deleteCalificacion(id: string): Promise<void> {
    const { error } = await this.supabase.from('calificaciones').delete().eq('id', id);
    if (error) throw error;
  }

  // ---- HORARIOS ----
  async getAllHorarios(): Promise<Horario[]> {
    const { data, error } = await this.supabase.from('horarios').select('*');
    if (error) throw error;
    return data as Horario[];
  }

  // ---- PARADAS ----
  async getParadas(rutaId: string): Promise<Parada[]> {
    const { data, error } = await this.supabase.from('paradas').select('*').eq('ruta_id', rutaId).order('orden');
    if (error) throw error;
    return data as Parada[];
  }

  async createParada(parada: Partial<Parada>): Promise<void> {
    const { error } = await this.supabase.from('paradas').insert(parada);
    if (error) throw error;
  }

  async deleteParada(id: string): Promise<void> {
    const { error } = await this.supabase.from('paradas').delete().eq('id', id);
    if (error) throw error;
  }

  // ---- VIAJES ----
  async getViajes(limit = 50): Promise<Viaje[]> {
    const { data, error } = await this.supabase
      .from('viajes')
      .select('*, bus:buses(placa), chofer:profiles(nombre_completo), ruta:rutas(nombre)')
      .order('inicio', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data as Viaje[];
  }

  // ---- ACTIVITY LOGS ----
  async getLogs(limit = 100): Promise<ActivityLog[]> {
    const { data, error } = await this.supabase
      .from('activity_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data as ActivityLog[];
  }

  async addLog(userId: string | null, accion: string, detalle?: string, entidad?: string, entidadId?: string): Promise<void> {
    const { error } = await this.supabase.from('activity_logs').insert({
      user_id: userId, accion, detalle: detalle || null,
      entidad: entidad || null, entidad_id: entidadId || null,
    });
    if (error) throw error;
  }

  // ---- SYSTEM CONFIG ----
  async getConfig(): Promise<SystemConfig[]> {
    const { data, error } = await this.supabase.from('system_config').select('*').order('key');
    if (error) throw error;
    return data as SystemConfig[];
  }

  async updateConfig(key: string, value: string): Promise<void> {
    const { error } = await this.supabase.from('system_config')
      .update({ value, updated_at: new Date().toISOString() }).eq('key', key);
    if (error) throw error;
  }

  // ---- LIVE BUS LOCATIONS ----
  async getAllLiveLocations(): Promise<BusLocation[]> {
    const { data, error } = await this.supabase
      .from('bus_locations')
      .select('*, bus:buses(placa, numero_unidad, ruta:rutas(nombre, color, geometria), empresa:empresas(nombre))')
      .order('timestamp', { ascending: false });
    if (error) throw error;

    const latest = new Map<string, BusLocation>();
    for (const loc of (data as BusLocation[])) {
      if (!latest.has(loc.bus_id)) latest.set(loc.bus_id, loc);
    }
    return Array.from(latest.values());
  }

  // ---- ESTELA DE RECORRIDO ----
  async getBusTrail(busId: string, sinceISO: string): Promise<{ latitud: number; longitud: number; timestamp: string }[]> {
    const { data, error } = await this.supabase
      .from('bus_locations')
      .select('latitud, longitud, timestamp')
      .eq('bus_id', busId)
      .gte('timestamp', sinceISO)
      .order('timestamp', { ascending: true });
    if (error) throw error;
    return data;
  }

  // ---- TIME-LAPSE HISTÓRICO ----
  // Sin límite de fila explícito más allá del propio de PostgREST: para un
  // día con mucho tráfico esto puede ser una consulta pesada, pero a la
  // escala actual de la flota es perfectamente manejable.
  async getBusLocationsForDay(dayStartISO: string, dayEndISO: string): Promise<BusLocation[]> {
    const { data, error } = await this.supabase
      .from('bus_locations')
      .select('bus_id, latitud, longitud, timestamp, bus:buses(placa, ruta:rutas(color))')
      .gte('timestamp', dayStartISO)
      .lt('timestamp', dayEndISO)
      .order('timestamp', { ascending: true })
      .limit(20000);
    if (error) throw error;
    return data as unknown as BusLocation[];
  }

  // ---- ALERTAS DE GPS SOSPECHOSO ----
  async getAnomalousLocations(): Promise<BusLocation[]> {
    const { data, error } = await this.supabase
      .from('bus_locations')
      .select('*, bus:buses(placa, numero_unidad, ruta:rutas(nombre, color), empresa:empresas(nombre))')
      .eq('anomalo', true)
      .order('timestamp', { ascending: false })
      .limit(100);
    if (error) throw error;
    return data as BusLocation[];
  }

  async dismissAnomaly(id: string): Promise<void> {
    const { error } = await this.supabase.from('bus_locations').update({ anomalo: false }).eq('id', id);
    if (error) throw error;
  }

  // ---- PLANES ----
  async getPlanes(): Promise<Plan[]> {
    const { data, error } = await this.supabase.from('planes').select('*').order('precio_mensual');
    if (error) throw error;
    return data as Plan[];
  }

  async updatePlan(id: string, updates: Partial<Plan>): Promise<void> {
    const { error } = await this.supabase.from('planes').update(updates).eq('id', id);
    if (error) throw error;
  }

  // ---- SUSCRIPCIONES ----
  async getSuscripciones(): Promise<Suscripcion[]> {
    const { data, error } = await this.supabase
      .from('suscripciones')
      .select('*, plan:planes(nombre, max_buses, max_rutas, precio_mensual)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data as Suscripcion[];
  }

  async getSuscripcionByEmpresa(empresaId: string): Promise<Suscripcion | null> {
    const { data } = await this.supabase
      .from('suscripciones')
      .select('*, plan:planes(nombre, max_buses, max_rutas, precio_mensual)')
      .eq('empresa_id', empresaId)
      .maybeSingle();
    return data as Suscripcion | null;
  }

  async assignPlan(empresaId: string, planId: string, fechaFin?: string): Promise<void> {
    const { error } = await this.supabase.from('suscripciones').upsert({
      empresa_id: empresaId, plan_id: planId, estado: 'activa',
      fecha_inicio: new Date().toISOString().split('T')[0],
      fecha_fin: fechaFin || null, auto_renovar: true,
    }, { onConflict: 'empresa_id' });
    if (error) throw error;
  }

  // ---- CREAR ADMIN EMPRESA ----
  async createAdminEmpresa(email: string, password: string, nombre: string, empresaId: string): Promise<void> {
    const isolated = this.newIsolatedClient();
    const { data, error } = await isolated.auth.signUp({
      email, password,
      // `created_by_admin` le dice a un trigger en auth.users que confirme el
      // email solo: esta cuenta la crea un admin en nombre de otra persona,
      // no un self-signup público, así que no tiene sentido bloquearla
      // esperando que alguien confirme un correo que nadie va a mandar.
      options: { data: { nombre_completo: nombre, created_by_admin: true } },
    });
    if (error) throw error;
    if (data.user) {
      await this.supabase.from('profiles').update({
        rol: 'admin_empresa', empresa_id: empresaId,
      }).eq('id', data.user.id);
    }
  }

  // ---- REPORTES DE BUGS ----
  async getReportes(): Promise<ReporteBug[]> {
    const { data, error } = await this.supabase
      .from('reportes_bugs')
      .select('*, empresa:empresas(nombre)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data as ReporteBug[];
  }

  async responderReporte(id: string, estado: string, respuesta: string, respondidoPor: string): Promise<void> {
    const { error } = await this.supabase.from('reportes_bugs').update({
      estado, respuesta_jirb: respuesta, respondido_por: respondidoPor, respondido_at: new Date().toISOString(),
    }).eq('id', id);
    if (error) throw error;
  }

  async updateReporteEstado(id: string, estado: string): Promise<void> {
    const { error } = await this.supabase.from('reportes_bugs').update({ estado }).eq('id', id);
    if (error) throw error;
  }

  // ---- AVISOS DEL SISTEMA ----
  async getAvisos(): Promise<AvisoSistema[]> {
    const { data, error } = await this.supabase.from('avisos_sistema').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return data as AvisoSistema[];
  }

  async createAviso(autorId: string, titulo: string, mensaje: string, tipo: string): Promise<void> {
    const { error } = await this.supabase.from('avisos_sistema').insert({ autor_id: autorId, titulo, mensaje, tipo });
    if (error) throw error;
  }

  async toggleAviso(id: string, activo: boolean): Promise<void> {
    const { error } = await this.supabase.from('avisos_sistema').update({ activo }).eq('id', id);
    if (error) throw error;
  }

  async deleteAviso(id: string): Promise<void> {
    const { error } = await this.supabase.from('avisos_sistema').delete().eq('id', id);
    if (error) throw error;
  }

  // ---- PUBLICIDAD ----
  async getAnuncios(): Promise<Anuncio[]> {
    const { data, error } = await this.supabase.from('anuncios').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return data as Anuncio[];
  }

  async uploadAnuncioMedia(file: File): Promise<string> {
    const ext = file.name.split('.').pop();
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await this.supabase.storage.from('anuncios').upload(fileName, file, { contentType: file.type });
    if (error) throw error;
    const { data } = this.supabase.storage.from('anuncios').getPublicUrl(fileName);
    return data.publicUrl;
  }

  async createAnuncio(anuncio: Partial<Anuncio>): Promise<void> {
    const { error } = await this.supabase.from('anuncios').insert(anuncio);
    if (error) throw error;
  }

  async updateAnuncio(id: string, updates: Partial<Anuncio>): Promise<void> {
    const { error } = await this.supabase.from('anuncios').update(updates).eq('id', id);
    if (error) throw error;
  }

  async deleteAnuncio(id: string): Promise<void> {
    const { error } = await this.supabase.from('anuncios').delete().eq('id', id);
    if (error) throw error;
  }

  // ---- SOLICITUDES ----
  async getSolicitudes(): Promise<any[]> {
    const { data, error } = await this.supabase.from('solicitudes_empresa').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  }

  async updateSolicitud(id: string, estado: string): Promise<void> {
    const { error } = await this.supabase.from('solicitudes_empresa').update({ estado }).eq('id', id);
    if (error) throw error;
  }

  // ---- EMPRESA REPORTS ----
  async getEmpresaReport(empresaId: string): Promise<{
    totalBuses: number; busesActivos: number; totalRutas: number;
    totalViajes: number; totalChoferes: number;
  }> {
    const [buses, rutas, viajes, choferes] = await Promise.all([
      this.supabase.from('buses').select('id, estado').eq('empresa_id', empresaId),
      this.supabase.from('rutas').select('id').eq('empresa_id', empresaId),
      this.supabase.from('viajes').select('id').eq('ruta_id', empresaId),
      this.supabase.from('profiles').select('id').eq('empresa_id', empresaId).eq('rol', 'chofer'),
    ]);

    const busData = (buses.data || []) as any[];
    return {
      totalBuses: busData.length,
      busesActivos: busData.filter(b => b.estado === 'en_ruta' || b.estado === 'activo').length,
      totalRutas: (rutas.data || []).length,
      totalViajes: (viajes.data || []).length,
      totalChoferes: (choferes.data || []).length,
    };
  }
}
