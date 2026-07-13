import { Injectable } from '@angular/core';
import { createClient, SupabaseClient, AuthChangeEvent, Session } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { environment } from '../../../environments/environment';
import { UserProfile } from '../models/user-profile.model';
import { BehaviorSubject } from 'rxjs';

const OAUTH_NATIVE_REDIRECT = 'cr.buxi.app://login-callback';

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  private supabase: SupabaseClient;
  private _session = new BehaviorSubject<Session | null>(null);

  session$ = this._session.asObservable();

  constructor() {
    this.supabase = createClient(environment.supabaseUrl, environment.supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
      },
    });

    this.supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
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

  homeRouteForRole(rol: string): string[] {
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
      },
    });
    if (error) throw error;
    return data;
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
      // (cr.buxi.app://login-callback), capturado en app.component.ts.
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

  async signInWithFacebook() {
    const { data, error } = await this.supabase.auth.signInWithOAuth({ provider: 'facebook' });
    if (error) throw error;
    return data;
  }

  async resetPassword(email: string) {
    const { data, error } = await this.supabase.auth.resetPasswordForEmail(email);
    if (error) throw error;
    return data;
  }

  async signOut() {
    const { error } = await this.supabase.auth.signOut();
    if (error) throw error;
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
