import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { SupabaseService } from '../../../core/services/supabase.service';

@Component({
  selector: 'app-splash',
  templateUrl: './splash.page.html',
  styleUrls: ['./splash.page.scss'],
  standalone: false,
})
export class SplashPage implements OnInit {
  constructor(private router: Router, private supabase: SupabaseService) {}

  ngOnInit() {
    setTimeout(async () => {
      const session = await this.supabase.getSessionAsync();
      if (session) {
        let target = ['/passenger/map'];
        try {
          const profile = await this.supabase.getProfile();
          if (profile) target = this.supabase.homeRouteForRole(profile.rol);
        } catch {}
        this.router.navigate(target, { replaceUrl: true });
      } else {
        this.router.navigate(['/auth/login'], { replaceUrl: true });
      }
    }, 2500);
  }
}
