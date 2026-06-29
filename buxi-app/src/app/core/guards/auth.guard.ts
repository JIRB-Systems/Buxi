import { Injectable } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { SupabaseService } from '../services/supabase.service';

@Injectable({ providedIn: 'root' })
export class AuthGuard implements CanActivate {
  constructor(private supabase: SupabaseService, private router: Router) {}

  async canActivate(): Promise<boolean> {
    const session = this.supabase.currentSession;
    if (session) return true;

    await this.router.navigate(['/auth/login']);
    return false;
  }
}
