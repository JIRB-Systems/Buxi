import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';
import { Bus, Ruta, Parada } from '../models/transport.model';
import { Horario } from '../models/features.model';
import { UserProfile } from '../models/user-profile.model';

@Injectable({ providedIn: 'root' })
export class AdminEmpresaService {
  private supabase: SupabaseClient;

  constructor() {
    this.supabase = createClient(environment.supabaseUrl, environment.supabaseAnonKey);
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
    const { data, error } = await this.supabase.auth.signUp({
      email, password,
      options: { data: { nombre_completo: nombre } },
    });
    if (error) throw error;
    if (data.user) {
      await this.supabase.from('profiles').update({
        rol: 'chofer', empresa_id: empresaId,
      }).eq('id', data.user.id);
    }
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
}
