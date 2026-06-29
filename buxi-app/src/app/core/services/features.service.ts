import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';
import { Favorito, Horario, Calificacion, UserPreferences } from '../models/features.model';
import { Parada } from '../models/transport.model';

@Injectable({ providedIn: 'root' })
export class FeaturesService {
  private supabase: SupabaseClient;

  constructor() {
    this.supabase = createClient(environment.supabaseUrl, environment.supabaseAnonKey);
  }

  // ---- FAVORITOS ----
  async getFavoritos(userId: string): Promise<Favorito[]> {
    const { data, error } = await this.supabase
      .from('favoritos')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data as Favorito[];
  }

  async addFavorito(userId: string, rutaId: string): Promise<void> {
    const { error } = await this.supabase
      .from('favoritos')
      .insert({ user_id: userId, ruta_id: rutaId });
    if (error) throw error;
  }

  async removeFavorito(userId: string, rutaId: string): Promise<void> {
    const { error } = await this.supabase
      .from('favoritos')
      .delete()
      .eq('user_id', userId)
      .eq('ruta_id', rutaId);
    if (error) throw error;
  }

  async isFavorito(userId: string, rutaId: string): Promise<boolean> {
    const { data } = await this.supabase
      .from('favoritos')
      .select('id')
      .eq('user_id', userId)
      .eq('ruta_id', rutaId)
      .maybeSingle();
    return !!data;
  }

  // ---- HORARIOS ----
  async getHorarios(rutaId: string): Promise<Horario[]> {
    const { data, error } = await this.supabase
      .from('horarios')
      .select('*')
      .eq('ruta_id', rutaId);
    if (error) throw error;
    return data as Horario[];
  }

  // ---- CALIFICACIONES ----
  async getCalificaciones(rutaId: string): Promise<Calificacion[]> {
    const { data, error } = await this.supabase
      .from('calificaciones')
      .select('*')
      .eq('ruta_id', rutaId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    return data as Calificacion[];
  }

  async getPromedioCalificacion(rutaId: string): Promise<{ promedio: number; total: number }> {
    const { data, error } = await this.supabase
      .from('calificaciones')
      .select('estrellas')
      .eq('ruta_id', rutaId);
    if (error) throw error;
    const ratings = data as { estrellas: number }[];
    if (ratings.length === 0) return { promedio: 0, total: 0 };
    const sum = ratings.reduce((acc, r) => acc + r.estrellas, 0);
    return { promedio: sum / ratings.length, total: ratings.length };
  }

  async addCalificacion(userId: string, rutaId: string, estrellas: number, comentario?: string, busId?: string): Promise<void> {
    const { error } = await this.supabase
      .from('calificaciones')
      .insert({ user_id: userId, ruta_id: rutaId, estrellas, comentario: comentario || null, bus_id: busId || null });
    if (error) throw error;
  }

  // ---- PREFERENCES ----
  async getPreferences(userId: string): Promise<UserPreferences | null> {
    const { data } = await this.supabase
      .from('user_preferences')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    return data as UserPreferences | null;
  }

  async savePreferences(userId: string, prefs: Partial<UserPreferences>): Promise<void> {
    const { error } = await this.supabase
      .from('user_preferences')
      .upsert({ user_id: userId, ...prefs, updated_at: new Date().toISOString() });
    if (error) throw error;
  }

  // ---- ETA & PARADA CERCANA ----
  findNearestStop(userLat: number, userLng: number, paradas: Parada[]): { parada: Parada; distanceKm: number } | null {
    if (paradas.length === 0) return null;
    let nearest: Parada = paradas[0];
    let minDist = Infinity;

    for (const p of paradas) {
      const d = this.haversine(userLat, userLng, p.latitud, p.longitud);
      if (d < minDist) {
        minDist = d;
        nearest = p;
      }
    }
    return { parada: nearest, distanceKm: minDist };
  }

  calculateETA(busLat: number, busLng: number, stopLat: number, stopLng: number, speedKmh: number): number | null {
    if (speedKmh <= 0) return null;
    const dist = this.haversine(busLat, busLng, stopLat, stopLng);
    return Math.round((dist / speedKmh) * 60);
  }

  private haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}
