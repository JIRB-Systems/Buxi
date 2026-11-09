import { Injectable } from '@angular/core';
import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseClient } from '../supabase-client';

// Paradas municipales y terminales cargadas a mano por JIRB
// (20261109160000): las que le faltan a OpenStreetMap. Las lee cualquiera;
// las escribe solo admin_jirb.
export type TipoParadaMunicipal = 'parada' | 'terminal';

export interface ParadaMunicipal {
  id: string;
  nombre: string;
  tipo: TipoParadaMunicipal;
  latitud: number;
  longitud: number;
  // Corrección de una parada de OpenStreetMap: su id en el mapa base.
  osm_id: number | null;
  // Esconde la parada de OpenStreetMap sin dibujar otra (no existe).
  oculta: boolean;
  created_at?: string;
}

@Injectable({ providedIn: 'root' })
export class ParadasMunicipalesService {
  private supabase: SupabaseClient = supabaseClient();

  async listar(): Promise<ParadaMunicipal[]> {
    const { data, error } = await this.supabase
      .from('paradas_municipales')
      .select('id, nombre, tipo, latitud, longitud, osm_id, oculta, created_at')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []) as ParadaMunicipal[];
  }

  async crear(p: Omit<ParadaMunicipal, 'id' | 'created_at'>): Promise<ParadaMunicipal> {
    const { data, error } = await this.supabase
      .from('paradas_municipales')
      .insert(p)
      .select('id, nombre, tipo, latitud, longitud, osm_id, oculta, created_at')
      .single();
    if (error) throw error;
    return data as ParadaMunicipal;
  }

  // Con .select(): un UPDATE o DELETE que RLS bloquea no da error, solo
  // afecta 0 filas. Así se detecta y se avisa en vez de mostrar "guardado".
  async actualizar(id: string, cambios: Partial<Omit<ParadaMunicipal, 'id' | 'created_at'>>): Promise<void> {
    const { data, error } = await this.supabase
      .from('paradas_municipales')
      .update({ ...cambios, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('Sin permiso para cambiar esta parada');
  }

  async borrar(id: string): Promise<void> {
    const { data, error } = await this.supabase
      .from('paradas_municipales')
      .delete()
      .eq('id', id)
      .select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('Sin permiso para borrar esta parada');
  }
}
