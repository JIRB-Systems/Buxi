import { Component, OnInit } from '@angular/core';
import { NavigationCancel, NavigationEnd, NavigationError, NavigationStart, Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { App, URLOpenListenerEvent } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { SupabaseService } from './core/services/supabase.service';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent implements OnInit {
  // Feedback visual mientras el router baja un chunk lazy (login → registro,
  // solicitud de empresa, etc.). Sin esto, una descarga lenta (típico en dev
  // mode sobre WiFi) se ve como pantalla congelada hasta que el usuario
  // recarga a mano.
  navigating = false;

  constructor(
    private supabase: SupabaseService,
    private router: Router,
  ) {
    this.router.events.subscribe(event => {
      if (event instanceof NavigationStart) {
        this.navigating = true;
      } else if (
        event instanceof NavigationEnd ||
        event instanceof NavigationCancel ||
        event instanceof NavigationError
      ) {
        this.navigating = false;
      }
    });
  }

  ngOnInit() {
    if (!Capacitor.isNativePlatform()) return;

    App.addListener('appUrlOpen', async (event: URLOpenListenerEvent) => {
      if (!event.url.startsWith('cr.buxi.app://login-callback')) return;

      try {
        const handled = await this.supabase.handleOAuthCallbackUrl(event.url);
        await Browser.close().catch(() => {});
        if (!handled) return;

        const profile = await this.supabase.getProfile();
        const target = profile ? this.supabase.homeRouteForRole(profile.rol) : ['/passenger/map'];
        this.router.navigate(target, { replaceUrl: true });
      } catch {
        await Browser.close().catch(() => {});
      }
    });
  }
}
