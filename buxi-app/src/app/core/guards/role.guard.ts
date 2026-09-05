import { Injectable } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, Router } from '@angular/router';
import { SupabaseService } from '../services/supabase.service';
import { logError } from '../utils/log';

@Injectable({ providedIn: 'root' })
export class RoleGuard implements CanActivate {
  constructor(private supabase: SupabaseService, private router: Router) {}

  async canActivate(route: ActivatedRouteSnapshot): Promise<boolean> {
    const session = await this.supabase.getSessionAsync();
    if (!session) {
      this.router.navigate(['/auth/login']);
      return false;
    }

    const allowedRoles = route.data['roles'] as string[];
    if (!allowedRoles) return true;

    try {
      const profile = await this.supabase.getProfile();
      if (profile && allowedRoles.includes(profile.rol)) return true;
      if (profile) {
        this.router.navigate(this.supabase.homeRouteForRole(profile.rol));
        return false;
      }
    } catch (e) {
      // Cae al login de abajo, que es lo correcto. Se registra porque este es
      // justo el fallo que armaba el ciclo con NoAuthGuard, y en silencio era
      // indistinguible de un cierre de sesión normal.
      logError('RoleGuard: no se pudo leer el perfil', e);
    }

    this.router.navigate(['/auth/login']);
    return false;
  }
}
