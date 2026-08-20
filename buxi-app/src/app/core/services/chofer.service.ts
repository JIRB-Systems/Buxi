import { Injectable } from '@angular/core';
import { supabaseClient } from '../supabase-client';
import { SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';
import { Bus, Parada } from '../models/transport.model';
import { Viaje, ReporteBug, Calificacion, Boleto, MensajeChofer } from '../models/features.model';

@Injectable({ providedIn: 'root' })
export class ChoferService {
  private supabase: SupabaseClient;
  private currentViajeId: string | null = null;

  constructor() {
    this.supabase = supabaseClient();
  }

  async getAssignedBus(choferId: string): Promise<Bus | null> {
    const { data, error } = await this.supabase
      .from('buses')
      .select('*, ruta:rutas(nombre, origen, destino, color, geometria), empresa:empresas(nombre)')
      .eq('chofer_id', choferId)
      .maybeSingle();
    if (error) throw error;
    return data as Bus | null;
  }

  async sendLocation(busId: string, lat: number, lng: number, speed: number = 0, heading: number = 0) {
    const { error } = await this.supabase
      .from('bus_locations')
      .insert({ bus_id: busId, latitud: lat, longitud: lng, velocidad: speed, heading });
    if (error) throw error;
  }

  // No se puede hacer `update buses set estado` directo: en buses solo hay
  // policies para admin_empresa y admin_jirb, así que para un chofer el UPDATE
  // no fallaba — RLS no encontraba la fila, afectaba 0 filas y Supabase lo
  // reportaba como éxito. El bus nunca pasaba a 'en_ruta'. La RPC (SECURITY
  // DEFINER, acotada a la columna estado y a buses propios) sí devuelve error
  // cuando el bus no es de este chofer. Ver 20260821000000.
  async updateBusStatus(busId: string, estado: string) {
    const { error } = await this.supabase.rpc('chofer_set_bus_estado', {
      p_bus_id: busId,
      p_estado: estado,
    });
    if (error) throw error;
  }

  async startViaje(busId: string, choferId: string, rutaId: string): Promise<string> {
    const { data, error } = await this.supabase.from('viajes').insert({
      bus_id: busId, chofer_id: choferId, ruta_id: rutaId,
      inicio: new Date().toISOString(), estado: 'en_curso',
    }).select('id').single();
    if (error) throw error;
    this.currentViajeId = data.id;
    return data.id;
  }

  async endViaje(distanciaKm: number = 0): Promise<void> {
    if (!this.currentViajeId) return;
    const { error } = await this.supabase.from('viajes').update({
      fin: new Date().toISOString(), estado: 'completado', distancia_km: distanciaKm,
    }).eq('id', this.currentViajeId);
    if (error) throw error;
    this.currentViajeId = null;
  }

  async getParadasOrdenadas(rutaId: string): Promise<Parada[]> {
    const { data, error } = await this.supabase
      .from('paradas')
      .select('*')
      .eq('ruta_id', rutaId)
      .order('orden');
    if (error) throw error;
    return data as Parada[];
  }

  async logTramo(rutaId: string, busId: string, paradaOrigenId: string, paradaDestinoId: string, duracionSegundos: number): Promise<void> {
    const now = new Date();
    const { error } = await this.supabase.from('tramos_historial').insert({
      ruta_id: rutaId, bus_id: busId,
      parada_origen_id: paradaOrigenId, parada_destino_id: paradaDestinoId,
      duracion_segundos: Math.round(duracionSegundos),
      hora_dia: now.getHours(), dia_semana: now.getDay(),
    });
    if (error) throw error;
  }

  async getMyViajes(choferId: string): Promise<Viaje[]> {
    const { data, error } = await this.supabase
      .from('viajes')
      .select('*, bus:buses(placa), ruta:rutas(nombre)')
      .eq('chofer_id', choferId)
      .order('inicio', { ascending: false })
      .limit(20);
    if (error) throw error;
    return data as Viaje[];
  }

  // ---- REPORTAR INCIDENTE ----
  async createReporte(empresaId: string, autorId: string, titulo: string, descripcion: string): Promise<void> {
    const { error } = await this.supabase.from('reportes_bugs').insert({
      empresa_id: empresaId, autor_id: autorId, titulo, descripcion,
    });
    if (error) throw error;
  }

  // ---- LÍMITE DE VELOCIDAD ----
  async getMaxSpeedKmh(): Promise<number> {
    const { data, error } = await this.supabase
      .from('system_config')
      .select('value')
      .eq('key', 'max_speed_kmh')
      .maybeSingle();
    if (error || !data) return 80;
    const n = parseFloat(data.value);
    return isNaN(n) ? 80 : n;
  }

  // ---- MIS CALIFICACIONES ----
  // "calificaciones" ya tiene lectura pública (RLS), así que el chofer puede
  // ver directo cómo lo califican en el bus que tiene asignado ahora.
  async getCalificacionesDelBus(busId: string): Promise<Calificacion[]> {
    const { data, error } = await this.supabase
      .from('calificaciones')
      .select('*')
      .eq('bus_id', busId)
      .order('created_at', { ascending: false })
      .limit(30);
    if (error) throw error;
    return data as Calificacion[];
  }

  // ---- VALIDAR BOLETO (QR) ----
  // El RLS ya limita lo que este chofer puede ver/actualizar a boletos de su
  // propia empresa (ver 20260819190000_boletos_qr.sql), así que un código de
  // otra empresa simplemente no aparece — no hace falta chequearlo acá.
  async validarBoleto(codigo: string, choferId: string, rutaIdEsperada?: string | null): Promise<{ ok: boolean; motivo?: string; boleto?: Boleto }> {
    const { data: boleto, error } = await this.supabase
      .from('boletos')
      .select('*, pasajero:profiles!boletos_pasajero_id_fkey(nombre_completo), ruta:rutas(nombre,origen,destino)')
      .eq('codigo', codigo)
      .maybeSingle();
    if (error || !boleto) return { ok: false, motivo: 'Código no encontrado' };
    if (boleto.estado === 'usado') return { ok: false, motivo: 'Este boleto ya fue usado', boleto: boleto as Boleto };
    if (boleto.estado !== 'pagado') return { ok: false, motivo: 'Este boleto no es válido', boleto: boleto as Boleto };
    if (new Date(boleto.expira_at) < new Date()) return { ok: false, motivo: 'Este boleto expiró', boleto: boleto as Boleto };
    if (rutaIdEsperada && boleto.ruta_id !== rutaIdEsperada) return { ok: false, motivo: 'Este boleto es de otra ruta', boleto: boleto as Boleto };

    const { error: updError } = await this.supabase
      .from('boletos')
      .update({ estado: 'usado', usado_at: new Date().toISOString(), usado_por: choferId })
      .eq('id', boleto.id)
      .eq('estado', 'pagado');
    if (updError) return { ok: false, motivo: 'No se pudo validar el boleto' };

    return { ok: true, boleto: boleto as Boleto };
  }

  // ---- MENSAJES DE LA EMPRESA ----
  async getMisMensajes(choferId: string): Promise<MensajeChofer[]> {
    const { data, error } = await this.supabase
      .from('mensajes_chofer')
      .select('*, autor:profiles!mensajes_chofer_autor_id_fkey(nombre_completo)')
      .eq('chofer_id', choferId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) return [];
    return data as MensajeChofer[];
  }

  async marcarMensajeLeido(mensajeId: string): Promise<void> {
    const { error } = await this.supabase
      .from('mensajes_chofer')
      .update({ leido: true })
      .eq('id', mensajeId);
    if (error) throw error;
  }
}
