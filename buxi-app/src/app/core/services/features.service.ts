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

  // Nombres de terminales/estaciones municipales suelen no existir tal cual en el
  // mapa; esto deja solo el nombre del pueblo/ciudad real para reintentar la búsqueda.
  private cleanPlaceQuery(query: string): string {
    return query
      .replace(/\b(terminal|municipal|estaci[oó]n|autobuses|buses|de)\b/gi, ' ')
      .replace(/\s*,\s*/g, ', ')
      .replace(/\s+/g, ' ')
      .replace(/^[,\s]+/, '')
      .trim();
  }

  // ---- BÚSQUEDA DE LUGARES (autocompletado) ----
  async searchPlaces(query: string): Promise<{ label: string; lat: number; lng: number }[]> {
    const q = query.trim();
    if (q.length < 2) return [];

    // El sesgo hacia terminales siempre se arma sobre el nombre YA limpiado de
    // palabras genéricas, nunca sobre el texto crudo — si no, escribir el nombre
    // completo de una terminal ("Terminal de Buses Municipal de X") termina
    // buscando "terminal de buses Terminal de Buses Municipal de X", que no
    // encuentra nada. Nominatim tampoco prioriza la terminal si buscás solo
    // el nombre del pueblo o el de una empresa (ej. "Pulmitan"), así que se
    // consultan varias variantes en paralelo: "terminal de buses X" cubre
    // terminales municipales, "terminal X" cubre terminales con nombre de
    // empresa (ej. "Terminal Pulmitan").
    const cleaned = this.cleanPlaceQuery(q) || q;
    const variants = Array.from(new Set([q, cleaned, `terminal de buses ${cleaned}`, `terminal ${cleaned}`]));

    const [osmResults, custom] = await Promise.all([
      Promise.all(variants.map(v => this.searchPlacesRaw(v))),
      this.searchCustomPlaces(q),
    ]);

    const merged: { label: string; lat: number; lng: number }[] = [];
    const seen = new Set<string>();
    for (const list of [custom, ...osmResults]) {
      for (const item of list) {
        const key = `${item.lat.toFixed(4)},${item.lng.toFixed(4)}`;
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(item);
        }
      }
    }
    return merged.slice(0, 8);
  }

  // ---- LUGARES PERSONALIZADOS (lo que el mapa público no tiene mapeado) ----
  async searchCustomPlaces(query: string): Promise<{ label: string; lat: number; lng: number }[]> {
    const { data, error } = await this.supabase
      .from('lugares_personalizados')
      .select('nombre, latitud, longitud')
      .ilike('nombre', `%${query}%`)
      .limit(5);
    if (error || !data) return [];
    return data.map(d => ({ label: d.nombre, lat: d.latitud, lng: d.longitud }));
  }

  async addCustomPlace(nombre: string, lat: number, lng: number): Promise<void> {
    const { error } = await this.supabase.from('lugares_personalizados').insert({ nombre, latitud: lat, longitud: lng });
    if (error) throw error;
  }

  private async searchPlacesRaw(query: string): Promise<{ label: string; lat: number; lng: number }[]> {
    const url = `${environment.supabaseUrl}/functions/v1/geocode?q=${encodeURIComponent(query)}&limit=5`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      if (Array.isArray(data)) {
        return data.map((d: any) => ({ label: d.display_name, lat: parseFloat(d.lat), lng: parseFloat(d.lon) }));
      }
    } catch {}
    return [];
  }

  // ---- GEOCODIFICACIÓN (nombre de lugar -> coordenadas) ----
  async geocode(query: string): Promise<{ lat: number; lng: number } | null> {
    const direct = await this.geocodeRaw(query);
    if (direct) return direct;

    const cleaned = this.cleanPlaceQuery(query);
    if (cleaned && cleaned.toLowerCase() !== query.toLowerCase()) {
      return this.geocodeRaw(cleaned);
    }
    return null;
  }

  private async geocodeRaw(query: string): Promise<{ lat: number; lng: number } | null> {
    const url = `${environment.supabaseUrl}/functions/v1/geocode?q=${encodeURIComponent(query)}&limit=1`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
      }
    } catch {}
    return null;
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

  // ---- TRAZADO DE RUTA (siguiendo calles) ----
  async fetchRoadRouteCoords(paradas: Parada[]): Promise<[number, number][]> {
    const fallback: [number, number][] = paradas.map(p => [p.latitud, p.longitud]);
    if (paradas.length < 2) return fallback;

    const waypoints = paradas.map(p => `${p.longitud},${p.latitud}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${waypoints}?overview=full&geometries=geojson`;

    try {
      const res = await fetch(url);
      const data = await res.json();
      const geoCoords = data?.routes?.[0]?.geometry?.coordinates;
      if (data.code === 'Ok' && Array.isArray(geoCoords) && geoCoords.length > 1) {
        return geoCoords.map((c: number[]) => [c[1], c[0]] as [number, number]);
      }
    } catch {}

    return fallback;
  }

  distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    return this.haversine(lat1, lon1, lat2, lon2);
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
