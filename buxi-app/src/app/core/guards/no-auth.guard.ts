import { Injectable } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { SupabaseService } from '../services/supabase.service';

@Injectable({ providedIn: 'root' })
export class NoAuthGuard implements CanActivate {
  constructor(private supabase: SupabaseService, private router: Router) {}

  async canActivate(): Promise<boolean> {
    const session = await this.supabase.getSessionAsync();
    if (!session) return true;

    let target = ['/passenger/map'];
    try {
      const profile = await this.supabase.getProfile();
      if (profile) target = this.supabase.homeRouteForRole(profile.rol);
    } catch {}

    await this.router.navigate(target);
    return false;
  }
}
