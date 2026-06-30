import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { ViewWillEnter } from '@ionic/angular';
import { BusTrackingService, EmpresaListItem } from '../../../core/services/bus-tracking.service';

type FilterTab = 'todas' | 'usadas' | 'valoradas';

@Component({
  selector: 'app-empresas',
  templateUrl: './empresas.page.html',
  styleUrls: ['./empresas.page.scss'],
  standalone: false,
})
export class EmpresasPage implements OnInit, ViewWillEnter {
  empresas: EmpresaListItem[] = [];
  filteredEmpresas: EmpresaListItem[] = [];
  loading = true;
  searchText = '';
  activeFilter: FilterTab = 'todas';
  loaded = false;

  constructor(
    private tracking: BusTrackingService,
    private router: Router,
  ) {}

  async ngOnInit() {
    await this.loadData();
  }

  ionViewWillEnter() {
    if (this.loaded) this.loadData();
  }

  private async loadData() {
    this.loading = true;
    try {
      this.empresas = await this.tracking.getEmpresas();
      this.applyFilter();
    } catch {} finally {
      this.loading = false;
      this.loaded = true;
    }
  }

  onSearch(event: any) {
    this.searchText = (event.detail.value || '').toLowerCase();
    this.applyFilter();
  }

  setFilter(tab: FilterTab) {
    this.activeFilter = tab;
    this.applyFilter();
  }

  private applyFilter() {
    let list = this.empresas;
    if (this.searchText) {
      list = list.filter(e =>
        e.nombre.toLowerCase().includes(this.searchText) ||
        e.rutaResumen.toLowerCase().includes(this.searchText)
      );
    }
    if (this.activeFilter === 'usadas') {
      list = [...list].sort((a, b) => b.ratingCount - a.ratingCount);
    } else if (this.activeFilter === 'valoradas') {
      list = [...list].sort((a, b) => b.ratingAvg - a.ratingAvg);
    }
    this.filteredEmpresas = list;
  }

  async doRefresh(event: any) {
    await this.loadData();
    event.target.complete();
  }

  openEmpresa(empresa: EmpresaListItem) {
    this.router.navigate(['/passenger/routes'], { queryParams: { q: empresa.nombre } });
  }
}
