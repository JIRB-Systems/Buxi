import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

// Un único cliente de Supabase para toda la app.
//
// Antes cada servicio (y varias páginas) llamaba a createClient() por su
// cuenta. Todos comparten el mismo storageKey por defecto y cada uno levanta
// su propio GoTrueClient con auto-refresh, así que competían por el mismo
// lock de navigator.locks para leer/renovar la sesión. Cuando ese lock se
// traba, auth.getSession() nunca resuelve — y como RoleGuard lo espera antes
// de dejar entrar a una ruta, la navegación se queda colgada para siempre:
// el usuario toca un botón, no pasa nada, y sólo recargar la página lo
// destraba.
//
// Ojo: esto NO reemplaza a los clientes "aislados" de los servicios de admin
// (newIsolatedClient), que a propósito usan storageKey propio y
// persistSession:false para crear usuarios sin pisar la sesión del admin.
let client: SupabaseClient | null = null;

export function supabaseClient(): SupabaseClient {
  if (!client) {
    client = createClient(environment.supabaseUrl, environment.supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
      },
    });
  }
  return client;
}
