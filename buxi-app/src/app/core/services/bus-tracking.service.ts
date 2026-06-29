import { Injectable, OnDestroy } from '@angular/core';
import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import { BehaviorSubject, Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { BusLocation, Ruta, Parada, Bus } from '../models/transport.model';

@Injectable({ providedIn: 'root' })
export class BusTrackingService implements OnDestroy {
  private supabase: SupabaseClient;
  private channel: RealtimeChannel | null = null;

  private _busLocations = new BehaviorSubject<Map<string, BusLocation>>(new Map());
  busLocations$ = this._busLocations.asObservable();

  constructor() {
    this.supabase = createClient(environment.supabaseUrl, environment.supabaseAnonKey);
  }

  async getRutas(): Promise<Ruta[]> {
    const { data, error } = await this.supabase
      .from('rutas')
      .select('*, empresa:empresas(nombre, logo_url)')
      .eq('estado', 'activa');
    if (error) throw error;
    return data as Ruta[];
  }

  async getParadas(rutaId: string): Promise<Parada[]> {
    const { data, error } = await this.supabase
      .from('paradas')
      .select('*')
      .eq('ruta_id', rutaId)
      .order('orden');
    if (error) throw error;
    return data as Parada[];
  }

  async getActiveBuses(): Promise<Bus[]> {
    const { data, error } = await this.supabase
      .from('buses')
      .select('*, ruta:rutas(nombre, origen, destino, color)')
      .in('estado', ['activo', 'en_ruta']);
    if (error) throw error;
    return data as Bus[];
  }

  async getRuta(rutaId: string): Promise<Ruta | null> {
    const { data, error } = await this.supabase
      .from('rutas')
      .select('*, empresa:empresas(nombre)')
      .eq('id', rutaId)
      .maybeSingle();
    if (error) throw error;
    return data as Ruta | null;
  }

  async getBusesByRuta(rutaId: string): Promise<Bus[]> {
    const { data, error } = await this.supabase
      .from('buses')
      .select('*, ruta:rutas(nombre, origen, destino, color)')
      .eq('ruta_id', rutaId)
      .in('estado', ['activo', 'en_ruta']);
    if (error) throw error;
    return data as Bus[];
  }

  async getLocationsByRuta(rutaId: string): Promise<BusLocation[]> {
    const buses = await this.getBusesByRuta(rutaId);
    const busIds = buses.map(b => b.id);
    if (busIds.length === 0) return [];

    const { data, error } = await this.supabase
      .from('bus_locations')
      .select('*, bus:buses(placa, numero_unidad, ruta:rutas(nombre, color))')
      .in('bus_id', busIds)
      .order('timestamp', { ascending: false });
    if (error) throw error;

    const latest = new Map<string, BusLocation>();
    for (const loc of (data as BusLocation[])) {
      if (!latest.has(loc.bus_id)) {
        latest.set(loc.bus_id, loc);
      }
    }
    return Array.from(latest.values());
  }

  async getAllParadas(): Promise<Parada[]> {
    const { data, error } = await this.supabase
      .from('paradas')
      .select('*')
      .order('ruta_id')
      .order('orden');
    if (error) throw error;
    return data as Parada[];
  }

  async getLatestLocations(): Promise<BusLocation[]> {
    const { data, error } = await this.supabase
      .from('bus_locations')
      .select('*, bus:buses(placa, numero_unidad, ruta:rutas(nombre, color))')
      .order('timestamp', { ascending: false });
    if (error) throw error;

    const latest = new Map<string, BusLocation>();
    for (const loc of (data as BusLocation[])) {
      if (!latest.has(loc.bus_id)) {
        latest.set(loc.bus_id, loc);
      }
    }
    return Array.from(latest.values());
  }

  subscribeToLocations(): Observable<Map<string, BusLocation>> {
    this.channel = this.supabase
      .channel('bus-locations-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'bus_locations' },
        (payload) => {
          const location = payload.new as BusLocation;
          const current = this._busLocations.value;
          current.set(location.bus_id, location);
          this._busLocations.next(new Map(current));
        }
      )
      .subscribe();

    return this.busLocations$;
  }

  unsubscribe() {
    if (this.channel) {
      this.supabase.removeChannel(this.channel);
      this.channel = null;
    }
  }

  ngOnDestroy() {
    this.unsubscribe();
  }
}
