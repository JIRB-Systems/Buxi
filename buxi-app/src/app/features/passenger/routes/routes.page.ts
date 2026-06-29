import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { BusTrackingService } from '../../../core/services/bus-tracking.service';
import { Ruta } from '../../../core/models/transport.model';

@Component({
  selector: 'app-routes',
  templateUrl: './routes.page.html',
  styleUrls: ['./routes.page.scss'],
  standalone: false,
})
export class RoutesPage implements OnInit {
  rutas: Ruta[] = [];
  filteredRutas: Ruta[] = [];
  loading = true;
  searchText = '';

  constructor(private tracking: BusTrackingService, private router: Router) {}

  async ngOnInit() {
    try {
      this.rutas = await this.tracking.getRutas();
      this.filteredRutas = this.rutas;
    } catch {
    } finally {
      this.loading = false;
    }
  }

  onSearch(event: any) {
    const query = (event.detail.value || '').toLowerCase();
    this.searchText = query;
    this.filteredRutas = this.rutas.filter(r =>
      r.nombre.toLowerCase().includes(query) ||
      r.origen.toLowerCase().includes(query) ||
      r.destino.toLowerCase().includes(query)
    );
  }

  openRoute(ruta: Ruta) {
    this.router.navigate(['/passenger/map'], { queryParams: { ruta: ruta.id } });
  }
}
