import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { ViewWillEnter, ModalController, ToastController } from '@ionic/angular';
import { BusTrackingService } from '../../../core/services/bus-tracking.service';
import { FeaturesService } from '../../../core/services/features.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { Ruta } from '../../../core/models/transport.model';
import { Horario } from '../../../core/models/features.model';

@Component({
  selector: 'app-routes',
  templateUrl: './routes.page.html',
  styleUrls: ['./routes.page.scss'],
  standalone: false,
})
export class RoutesPage implements OnInit, ViewWillEnter {
  rutas: Ruta[] = [];
  filteredRutas: Ruta[] = [];
  favoritoIds = new Set<string>();
  loading = true;
  searchText = '';
  userId = '';
  showFavoritesOnly = false;

  selectedRutaHorarios: Horario[] = [];
  selectedRutaName = '';
  showHorarios = false;
  selectedRutaRating = { promedio: 0, total: 0 };

  constructor(
    private tracking: BusTrackingService,
    private features: FeaturesService,
    private supabase: SupabaseService,
    private router: Router,
    private toastCtrl: ToastController,
  ) {}

  async ngOnInit() {
    try {
      const profile = await this.supabase.getProfile();
      if (profile) this.userId = profile.id;
      await this.loadData();
    } catch {} finally {
      this.loading = false;
    }
  }

  ionViewWillEnter() {
    if (this.userId) this.loadFavoritos();
  }

  private async loadData() {
    const [rutas] = await Promise.all([
      this.tracking.getRutas(),
      this.userId ? this.loadFavoritos() : Promise.resolve(),
    ]);
    this.rutas = rutas;
    this.applyFilter();
  }

  private async loadFavoritos() {
    if (!this.userId) return;
    const favs = await this.features.getFavoritos(this.userId);
    this.favoritoIds = new Set(favs.map(f => f.ruta_id));
  }

  onSearch(event: any) {
    this.searchText = (event.detail.value || '').toLowerCase();
    this.applyFilter();
  }

  toggleFavoritesFilter() {
    this.showFavoritesOnly = !this.showFavoritesOnly;
    this.applyFilter();
  }

  private applyFilter() {
    let list = this.rutas;
    if (this.showFavoritesOnly) {
      list = list.filter(r => this.favoritoIds.has(r.id));
    }
    if (this.searchText) {
      list = list.filter(r =>
        r.nombre.toLowerCase().includes(this.searchText) ||
        r.origen.toLowerCase().includes(this.searchText) ||
        r.destino.toLowerCase().includes(this.searchText)
      );
    }
    this.filteredRutas = list;
  }

  async toggleFavorito(event: Event, ruta: Ruta) {
    event.stopPropagation();
    if (!this.userId) return;

    if (this.favoritoIds.has(ruta.id)) {
      await this.features.removeFavorito(this.userId, ruta.id);
      this.favoritoIds.delete(ruta.id);
    } else {
      await this.features.addFavorito(this.userId, ruta.id);
      this.favoritoIds.add(ruta.id);
    }
  }

  isFav(rutaId: string): boolean {
    return this.favoritoIds.has(rutaId);
  }

  async showSchedule(event: Event, ruta: Ruta) {
    event.stopPropagation();
    this.selectedRutaName = ruta.nombre;
    try {
      const [horarios, rating] = await Promise.all([
        this.features.getHorarios(ruta.id),
        this.features.getPromedioCalificacion(ruta.id),
      ]);
      this.selectedRutaHorarios = horarios;
      this.selectedRutaRating = rating;
      this.showHorarios = true;
    } catch {}
  }

  closeHorarios() {
    this.showHorarios = false;
  }

  getDiaLabel(dia: string): string {
    const map: Record<string, string> = {
      lunes_viernes: 'Lun - Vie', sabado: 'Sábado', domingo: 'Domingo',
    };
    return map[dia] || dia;
  }

  async doRefresh(event: any) {
    await this.loadData();
    event.target.complete();
  }

  openRoute(ruta: Ruta) {
    this.router.navigate(['/passenger/map'], { queryParams: { ruta: ruta.id } });
  }
}
