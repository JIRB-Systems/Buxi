import { Injectable } from '@angular/core';
import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseClient } from '../supabase-client';

export type ResultadoPush = 'ok' | 'denegado' | 'no-soportado' | 'ios-instalar' | 'error';

export interface AlertaLlegada {
  id: string;
  ruta_id: string;
  parada_id: string;
  minutos: number;
  expira_at: string;
}

// Notificaciones push del pasajero (ver supabase/functions/push y la
// migración notificaciones_push). El service worker es /sw-push.js y solo
// muestra notificaciones: no cachea nada.
@Injectable({ providedIn: 'root' })
export class PushService {
  private supabase: SupabaseClient = supabaseClient();

  get soportado(): boolean {
    return typeof window !== 'undefined'
      && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }

  // En iPhone, Web Push solo funciona con la app agregada a la pantalla de
  // inicio (iOS 16.4+). En Safari suelto, PushManager directamente no existe.
  get esIosSinInstalar(): boolean {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const instalada = (navigator as any).standalone === true || window.matchMedia('(display-mode: standalone)').matches;
    return ios && !instalada;
  }

  private async registro(): Promise<ServiceWorkerRegistration> {
    const reg = await navigator.serviceWorker.register('/sw-push.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    return reg;
  }

  async activo(): Promise<boolean> {
    if (!this.soportado || Notification.permission !== 'granted') return false;
    const reg = await navigator.serviceWorker.getRegistration('/');
    return !!(await reg?.pushManager.getSubscription());
  }

  async activar(): Promise<ResultadoPush> {
    if (this.esIosSinInstalar) return 'ios-instalar';
    if (!this.soportado) return 'no-soportado';
    const permiso = await Notification.requestPermission();
    if (permiso !== 'granted') return 'denegado';
    try {
      const reg = await this.registro();
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        const { data, error } = await this.supabase.functions.invoke('push', { body: { tipo: 'clave' } });
        if (error || !data?.clave) throw error || new Error('Sin clave');
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlABytes(data.clave),
        });
      }
      const j = sub.toJSON();
      const { error } = await this.supabase.rpc('registrar_push', {
        p_endpoint: j.endpoint, p_p256dh: j.keys?.['p256dh'], p_auth: j.keys?.['auth'],
      });
      if (error) throw error;
      // Una notificación de prueba al momento: así se ve que funciona en ESTE
      // teléfono. Si falla no cambia nada: la suscripción ya quedó guardada.
      this.supabase.functions.invoke('push', { body: { tipo: 'prueba' } }).catch(() => {});
      return 'ok';
    } catch (e) {
      console.error('activar push', e);
      return 'error';
    }
  }

  async desactivar(): Promise<void> {
    if (!this.soportado) return;
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    await this.supabase.from('push_suscripciones').delete().eq('endpoint', sub.endpoint);
    await sub.unsubscribe();
  }

  // Una notificación que arma el propio teléfono ("Bajate en la próxima"):
  // no pasa por el servidor, solo necesita el permiso.
  async notificarLocal(titulo: string, cuerpo: string, tag: string): Promise<void> {
    navigator.vibrate?.([200, 100, 200]);
    if (!this.soportado || Notification.permission !== 'granted') return;
    const reg = await this.registro();
    await reg.showNotification(titulo, {
      body: cuerpo, tag, icon: '/assets/icon/buxci-icon-192.png', badge: '/assets/icon/buxci-icon-192.png',
    });
  }

  // ---- "Avisame cuando falten N minutos" ----
  async alertaActiva(rutaId: string, paradaId: string): Promise<AlertaLlegada | null> {
    const { data, error } = await this.supabase.from('alertas_llegada')
      .select('id, ruta_id, parada_id, minutos, expira_at')
      .eq('ruta_id', rutaId).eq('parada_id', paradaId)
      .is('avisada_at', null).gt('expira_at', new Date().toISOString())
      .order('creada_at', { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    return data as AlertaLlegada | null;
  }

  async crearAlerta(rutaId: string, paradaId: string, minutos = 5): Promise<void> {
    const { error } = await this.supabase.from('alertas_llegada').insert({ ruta_id: rutaId, parada_id: paradaId, minutos });
    if (error) throw error;
  }

  async cancelarAlerta(id: string): Promise<void> {
    const { error } = await this.supabase.from('alertas_llegada').delete().eq('id', id);
    if (error) throw error;
  }
}

// La clave VAPID viaja en base64url; pushManager.subscribe la quiere en bytes.
function base64UrlABytes(b64url: string): ArrayBuffer {
  const relleno = '='.repeat((4 - (b64url.length % 4)) % 4);
  const b64 = (b64url + relleno).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const buffer = new ArrayBuffer(bin.length);
  const out = new Uint8Array(buffer);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return buffer;
}
