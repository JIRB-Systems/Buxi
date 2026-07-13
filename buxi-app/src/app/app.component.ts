import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
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
  constructor(
    private supabase: SupabaseService,
    private router: Router,
  ) {}

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
