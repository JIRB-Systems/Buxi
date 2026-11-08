import { Injectable } from '@angular/core';
import { SupabaseClient, AuthChangeEvent, Session } from '@supabase/supabase-js';
import { LLEGO_POR_RECUPERACION, supabaseClient } from '../supabase-client';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { environment } from '../../../environments/environment';
import { UserProfile } from '../models/user-profile.model';
import { BehaviorSubject } from 'rxjs';
import { DOMINIO_APP } from '../utils/dominio';

const OAUTH_NATIVE_REDIRECT = 'cr.buxci.app://login-callback';

// A dónde manda el correo de "olvidé mi contraseña". En la app nativa el
// origen es https://localhost, que no le sirve a nadie desde el correo: el
// enlace se abre en el navegador, así que va siempre a la web.
const NUEVA_CLAVE_WEB = 'https://app.buxci.com/auth/nueva-clave';

// El enlace del correo inicia sesión. Mientras esta marca exista, la persona
// todavía no eligió su contraseña nueva y cualquier camino a su pantalla de
// inicio la manda primero a elegirla (ver homeRouteForRole y RoleGuard). Vive
// en sessionStorage para sobrevivir a una recarga de la pestaña.
const MARCA_NUEVA_CLAVE = 'buxi.nuevaClave';

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  private supabase: SupabaseClient;
  private _session = new BehaviorSubject<Session | null>(null);
  // Por si sessionStorage no está disponible (modo privado, bloqueado).
  private nuevaClavePendiente = false;

  session$ = this._session.asObservable();

  constructor() {
    this.supabase = supabaseClient();
    if (LLEGO_POR_RECUPERACION) this.marcarNuevaClave(true);

    this.supabase.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
      if (event === 'PASSWORD_RECOVERY') this.marcarNuevaClave(true);
      if (event === 'SIGNED_OUT') this.marcarNuevaClave(false);
      this._session.next(session);
    });

    this.supabase.auth.getSession().then(({ data }) => {
      this._session.next(data.session);
    });
  }

  get currentSession(): Session | null {
    return this._session.value;
  }

  async getSessionAsync(): Promise<Session | null> {
    const { data } = await this.supabase.auth.getSession();
    this._session.next(data.session);
    return data.session;
  }

  get debeCrearClave(): boolean {
    try {
      return this.nuevaClavePendiente || sessionStorage.getItem(MARCA_NUEVA_CLAVE) === '1';
    } catch {
      return this.nuevaClavePendiente;
    }
  }

  private marcarNuevaClave(pendiente: boolean) {
    this.nuevaClavePendiente = pendiente;
    try {
      if (pendiente) sessionStorage.setItem(MARCA_NUEVA_CLAVE, '1');
      else sessionStorage.removeItem(MARCA_NUEVA_CLAVE);
    } catch {
      // Sin sessionStorage alcanza con la marca en memoria.
    }
  }

  homeRouteForRole(rol: string): string[] {
    if (this.debeCrearClave) return ['/auth/nueva-clave'];
    switch (rol) {
      case 'admin_jirb': return ['/admin/dashboard'];
      case 'admin_empresa': return ['/empresa/dashboard'];
      case 'chofer': return ['/chofer/home'];
      default: return ['/passenger/map'];
    }
  }

  async signUp(email: string, password: string, metadata: { nombre_completo: string; telefono?: string; provincia?: string }) {
    const { data, error } = await this.supabase.auth.signUp({
      email,
      password,
      options: {
        data: metadata,
        emailRedirectTo: this.vueltaConfirmacion(),
      },
    });
    if (error) throw error;
    return data;
  }

  // El enlace de "confirmá tu correo" inicia sesión y vuelve a la raíz de la
  // app, que manda a cada uno a su pantalla. En la app nativa el origen es
  // https://localhost, que desde el correo no abre nada: va siempre a la web.
  private vueltaConfirmacion(): string {
    return Capacitor.isNativePlatform() ? `${DOMINIO_APP}/` : `${window.location.origin}/`;
  }

  async reenviarConfirmacion(email: string) {
    const { error } = await this.supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: this.vueltaConfirmacion() },
    });
    if (error) throw error;
  }

  async signIn(email: string, password: string) {
    const { data, error } = await this.supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    this._session.next(data.session);
    return data;
  }

  async signInWithGoogle() {
    if (Capacitor.isNativePlatform()) {
      // En la app nativa no hay una URL de navegador que redirija sola: pedimos
      // la URL de Google sin que Supabase intente redirigir, y la abrimos
      // nosotros en el navegador in-app. El regreso llega por deep link
      // (cr.buxci.app://login-callback), capturado en app.component.ts.
      const { data, error } = await this.supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: OAUTH_NATIVE_REDIRECT, skipBrowserRedirect: true },
      });
      if (error) throw error;
      if (data.url) await Browser.open({ url: data.url });
      return data;
    }

    const { data, error } = await this.supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/login` },
    });
    if (error) throw error;
    return data;
  }

  // Se llama desde app.component.ts cuando el deep link de vuelta del login
  // nativo abre la app. La URL trae los tokens en el fragmento (#access_token=...),
  // igual que hace el navegador en el flujo web, pero acá nadie los parsea solo.
  async handleOAuthCallbackUrl(url: string): Promise<boolean> {
    const hashIndex = url.indexOf('#');
    if (hashIndex === -1) return false;

    const params = new URLSearchParams(url.substring(hashIndex + 1));
    const access_token = params.get('access_token');
    const refresh_token = params.get('refresh_token');
    if (!access_token || !refresh_token) return false;

    const { error } = await this.supabase.auth.setSession({ access_token, refresh_token });
    if (error) throw error;
    return true;
  }

  // Sin redirectTo, el correo volvía a la portada: la persona quedaba adentro
  // con la sesión del enlace y nunca se le pedía la contraseña nueva.
  async resetPassword(email: string) {
    const redirectTo = Capacitor.isNativePlatform()
      ? NUEVA_CLAVE_WEB
      : `${window.location.origin}/auth/nueva-clave`;
    const { data, error } = await this.supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw error;
    return data;
  }

  async actualizarClave(password: string) {
    const { error } = await this.supabase.auth.updateUser({ password });
    if (error) throw error;
    this.marcarNuevaClave(false);
  }

  async signOut() {
    const { error } = await this.supabase.auth.signOut();
    if (error) throw error;
  }

  // Si la persona puede operar: su perfil y su empresa activos. La base ya le
  // niega todo si no; esto es para poder decirle por qué (función mi_acceso).
  async miAcceso(): Promise<{ perfil_activo: boolean; empresa_activa: boolean; empresa: string | null } | null> {
    const { data, error } = await this.supabase.rpc('mi_acceso');
    if (error) throw error;
    return data ?? null;
  }

  async deleteAccount(): Promise<void> {
    const { data, error } = await this.supabase.functions.invoke('delete-account', { method: 'POST' });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    await this.signOut();
  }

  async getProfile(): Promise<UserProfile | null> {
    const session = await this.getSessionAsync();
    if (!session) return null;

    const { data, error } = await this.supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .single();

    if (error) throw error;
    return data as UserProfile;
  }

  async updateProfile(updates: Partial<UserProfile>) {
    const session = this.currentSession;
    if (!session) throw new Error('No hay sesión activa');

    const { data, error } = await this.supabase
      .from('profiles')
      .update(updates)
      .eq('id', session.user.id)
      .select()
      .single();

    if (error) throw error;
    return data as UserProfile;
  }
}
