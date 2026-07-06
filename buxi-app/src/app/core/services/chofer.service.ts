import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';
import { Bus, Parada } from '../models/transport.model';
import { Viaje } from '../models/features.model';

@Injectable({ providedIn: 'root' })
export class ChoferService {
  private supabase: SupabaseClient;
  private currentViajeId: string | null = null;

  constructor() {
    this.supabase = createClient(environment.supabaseUrl, environment.supabaseAnonKey);
  }

  async getAssignedBus(choferId: string): Promise<Bus | null> {
    const { data, error } = await this.supabase
      .from('buses')
      .select('*, ruta:rutas(nombre, origen, destino, color), empresa:empresas(nombre)')
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

  async updateBusStatus(busId: string, estado: string) {
    const { error } = await this.supabase.from('buses').update({ estado }).eq('id', busId);
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
}
