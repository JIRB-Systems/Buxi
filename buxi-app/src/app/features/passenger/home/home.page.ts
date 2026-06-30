import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { ViewWillEnter } from '@ionic/angular';
import { SupabaseService } from '../../../core/services/supabase.service';
import { FeaturesService } from '../../../core/services/features.service';
import { BusTrackingService } from '../../../core/services/bus-tracking.service';
import { UserProfile } from '../../../core/models/user-profile.model';
import { Ruta } from '../../../core/models/transport.model';

@Component({
  selector: 'app-passenger-home',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  standalone: false,
})
export class PassengerHomePage implements OnInit, ViewWillEnter {
  profile: UserProfile | null = null;
  loading = true;
  favoriteRutas: Ruta[] = [];
  rutasCount = 0;
  greeting = '';

  constructor(
    private supabase: SupabaseService,
    private features: FeaturesService,
    private tracking: BusTrackingService,
    private router: Router,
  ) {}

  async ngOnInit() {
    this.greeting = this.getGreeting();
    try {
      this.profile = await this.supabase.getProfile();
      if (this.profile) await this.loadFavorites();
      const rutas = await this.tracking.getRutas();
      this.rutasCount = rutas.length;
    } catch {} finally {
      this.loading = false;
    }
  }

  private getGreeting(): string {
    const h = new Date().getHours();
    if (h < 12) return 'Buenos días';
    if (h < 19) return 'Buenas tardes';
    return 'Buenas noches';
  }

  ionViewWillEnter() {
    if (this.profile) this.loadFavorites();
  }

  private async loadFavorites() {
    if (!this.profile) return;
    try {
      const favs = await this.features.getFavoritos(this.profile.id);
      if (favs.length > 0) {
        const allRutas = await this.tracking.getRutas();
        const favIds = new Set(favs.map(f => f.ruta_id));
        this.favoriteRutas = allRutas.filter(r => favIds.has(r.id)).slice(0, 3);
      }
    } catch {}
  }

  openRoute(ruta: Ruta) {
    this.router.navigate(['/passenger/map'], { queryParams: { ruta: ruta.id } });
  }
}
