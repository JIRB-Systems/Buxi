import { Injectable } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { SupabaseService } from '../services/supabase.service';
import { logError } from '../utils/log';

@Injectable({ providedIn: 'root' })
export class NoAuthGuard implements CanActivate {
  constructor(private supabase: SupabaseService, private router: Router) {}

  async canActivate(): Promise<boolean> {
    const session = await this.supabase.getSessionAsync();
    if (!session) return true;

    // Hay sesión, así que esta pantalla no corresponde: se manda al usuario a
    // su casa según el rol.
    try {
      const profile = await this.supabase.getProfile();
      if (profile) {
        await this.router.navigate(this.supabase.homeRouteForRole(profile.rol));
        return false;
      }
      logError('NoAuthGuard: hay sesión pero el perfil vino vacío', null);
    } catch (e) {
      logError('NoAuthGuard: hay sesión pero el perfil no se pudo leer', e);
    }

    // Sin perfil no hay forma de elegir a dónde mandarlo. Antes se caía a
    // /passenger/map por defecto, y ahí el RoleGuard —que tampoco podía leer el
    // perfil— rebotaba de vuelta acá: un ciclo infinito del que no se salía ni
    // yendo al login, porque este mismo guard lo sacaba de nuevo. Pasa de
    // verdad, y sin nada raro: abrir la app sin conexión con la sesión guardada
    // todavía vigente alcanza, porque getSession() lee de disco y no de la red,
    // pero getProfile() sí necesita red y lanza.
    //
    // Dejarlo entrar al login es la única salida que no depende del perfil: ve
    // una pantalla de verdad y puede reintentar o cerrar sesión.
    return true;
  }
}
