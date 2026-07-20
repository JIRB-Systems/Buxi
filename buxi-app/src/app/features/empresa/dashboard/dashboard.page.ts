import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController, LoadingController, ModalController, ToastController } from '@ionic/angular';
import * as L from 'leaflet';
import { createClient, RealtimeChannel } from '@supabase/supabase-js';
import { environment } from '../../../../environments/environment';
import { SupabaseService } from '../../../core/services/supabase.service';
import { AdminEmpresaService } from '../../../core/services/admin-empresa.service';
import { FeaturesService } from '../../../core/services/features.service';
import { UserProfile } from '../../../core/models/user-profile.model';
import { Bus, Ruta, Parada, BusLocation } from '../../../core/models/transport.model';
import { RutaFormComponent } from './ruta-form.component';
import { animateMarkerTo } from '../../../core/utils/leaflet-marker-animation';

@Component({
  selector: 'app-empresa-dashboard',
  templateUrl: './dashboard.page.html',
  styleUrls: ['./dashboard.page.scss'],
  standalone: false,
})
export class EmpresaDashboardPage implements OnInit, OnDestroy {
  profile: UserProfile | null = null;
  activeTab = 'inicio';
  loading = true;
  sidebarOpen = true;
  empresaNombre = '';

  menuItems = [
    { id: 'inicio', icon: 'home-outline', label: 'Inicio' },
    { id: 'rutas', icon: 'git-branch-outline', label: 'Mis rutas' },
    { id: 'buses', icon: 'bus-outline', label: 'Buses' },
    { id: 'choferes', icon: 'people-outline', label: 'Choferes' },
    { id: 'mapa', icon: 'location-outline', label: 'Seguimiento en vivo' },
  ];

  stats = { buses: 0, rutas: 0, choferes: 0, busesEnRuta: 0 };
  rutas: Ruta[] = [];
  buses: Bus[] = [];
  choferes: UserProfile[] = [];

  private liveMap: L.Map | null = null;
  private liveMarkers = new Map<string, L.Marker>();
  private liveMarkersLastSeen = new Map<string, number>();
  private staleCheckInterval: any = null;
  private realtimeChannel: RealtimeChannel | null = null;
  private rutaPathLayers: L.Layer[] = [];
  private mapClickHandler: ((e: L.LeafletMouseEvent) => void) | null = null;

  private readonly STALE_MS = 45000;
  private readonly REMOVE_MS = 5 * 60 * 1000;

  editingRuta: Ruta | null = null;
  editingParadas: Parada[] = [];

  constructor(
    private supabase: SupabaseService,
    private admin: AdminEmpresaService,
    private features: FeaturesService,
    private router: Router,
    private alertCtrl: AlertController,
    private loadingCtrl: LoadingController,
    private toastCtrl: ToastController,
    private modalCtrl: ModalController,
  ) {}

  async ngOnInit() {
    try {
      this.profile = await this.supabase.getProfile();
      if (this.profile?.empresa_id) {
        await this.loadData();
      }
    } catch {} finally {
      this.loading = false;
      setTimeout(() => this.initLiveMap(), 150);
    }
  }

  async loadData() {
    if (!this.profile?.empresa_id) return;
    const eid = this.profile.empresa_id;
    const [stats, rutas, buses, choferes] = await Promise.all([
      this.admin.getStats(eid),
      this.admin.getRutas(eid),
      this.admin.getBuses(eid),
      this.admin.getChoferes(eid),
    ]);
    this.stats = stats;
    this.rutas = rutas;
    this.buses = buses;
    this.choferes = choferes;
  }

  switchTab(tab: string) {
    if (this.editingRuta && tab !== 'mapa') {
      this.exitEditMode();
    }
    this.activeTab = tab;
    if (tab === 'mapa' || tab === 'inicio') {
      setTimeout(() => this.initLiveMap(), 150);
    }
  }

  toggleSidebar() { this.sidebarOpen = !this.sidebarOpen; }

  // ---- LIVE MAP ----
  private initLiveMap() {
    const elId = this.activeTab === 'mapa' ? 'emp-map-full' : 'emp-map-mini';
    const el = document.getElementById(elId);
    if (!el) return;
    if (this.liveMap) { this.liveMap.remove(); this.liveMap = null; }

    this.liveMap = L.map(elId, {
      center: [9.9281, -84.0907], zoom: 11,
      zoomControl: this.activeTab === 'mapa', attributionControl: false,
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { subdomains: 'abcd', attribution: '&copy; OpenStreetMap &copy; CARTO', maxZoom: 20 }).addTo(this.liveMap);

    this.liveMarkers.forEach(m => m.remove());
    this.liveMarkers.clear();
    this.liveMarkersLastSeen.clear();
    this.rutaPathLayers = [];

    // Subscribe to realtime
    if (!this.realtimeChannel) {
      const sb = createClient(environment.supabaseUrl, environment.supabaseAnonKey);
      this.realtimeChannel = sb.channel('emp-live')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bus_locations' }, (payload) => {
          const loc = payload.new as BusLocation;
          this.updateMapMarker(loc.bus_id, loc.latitud, loc.longitud, loc.timestamp);
        })
        .subscribe();
    }

    if (!this.staleCheckInterval) this.startStaleBusWatcher();

    if (this.editingRuta) {
      this.mapClickHandler = (e) => this.onMapClickAddParada(e);
      this.liveMap.on('click', this.mapClickHandler);
      this.drawEditingRutaPath();
    } else {
      this.drawAllRutaPaths();
    }

    setTimeout(() => this.liveMap?.invalidateSize(), 200);
  }

  // ---- TRAZADO DE RUTAS ----
  private async drawAllRutaPaths() {
    const activas = this.rutas.filter(r => r.estado === 'activa');
    const results = await Promise.all(activas.map(async r => {
      const paradas = await this.admin.getParadas(r.id);
      return { ruta: r, paradas };
    }));

    if (!this.liveMap) return;
    for (const { ruta, paradas } of results) {
      if (paradas.length === 0) continue;
      const color = ruta.color || '#00c853';

      if (paradas.length >= 2) {
        let coords: [number, number][] = ruta.geometria as [number, number][] | null || [];
        if (coords.length === 0) {
          coords = await this.features.fetchRoadRouteCoords(paradas);
          this.admin.updateRuta(ruta.id, { geometria: coords }).catch(() => {});
        }
        const bg = L.polyline(coords, { color, weight: 8, opacity: 0.15, lineCap: 'round', lineJoin: 'round' }).addTo(this.liveMap);
        const main = L.polyline(coords, { color, weight: 4, opacity: 0.85, lineCap: 'round', lineJoin: 'round' }).addTo(this.liveMap);
        this.rutaPathLayers.push(bg, main);
      }

      paradas.forEach((p, i) => {
        const isTerminal = i === 0 || i === paradas.length - 1;
        const icon = L.divIcon({
          className: 'ruta-stop-marker',
          html: isTerminal
            ? `<div style="width:16px;height:16px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.4)"></div>`
            : `<div style="width:9px;height:9px;border-radius:50%;background:${color};border:1.5px solid #fff"></div>`,
          iconSize: isTerminal ? [16, 16] : [9, 9],
          iconAnchor: isTerminal ? [8, 8] : [4, 4],
        });
        const m = L.marker([p.latitud, p.longitud], { icon })
          .addTo(this.liveMap!)
          .bindTooltip(p.nombre, { permanent: isTerminal, direction: 'top', offset: [0, -8], className: 'ruta-stop-tooltip' });
        this.rutaPathLayers.push(m);
      });
    }
  }

  async startEditRuta(r: Ruta) {
    this.editingRuta = r;
    this.editingParadas = await this.admin.getParadas(r.id);
    this.activeTab = 'mapa';
    setTimeout(() => this.initLiveMap(), 150);
  }

  private exitEditMode() {
    if (this.mapClickHandler && this.liveMap) {
      this.liveMap.off('click', this.mapClickHandler);
      this.mapClickHandler = null;
    }
    this.editingRuta = null;
    this.editingParadas = [];
  }

  stopEditRuta() {
    this.exitEditMode();
    setTimeout(() => this.initLiveMap(), 150);
  }

  private async onMapClickAddParada(e: L.LeafletMouseEvent) {
    if (!this.editingRuta) return;
    const orden = this.editingParadas.length;
    const optimistic: Parada = {
      id: `temp-${Date.now()}`,
      ruta_id: this.editingRuta.id,
      nombre: `Parada ${orden + 1}`,
      latitud: e.latlng.lat,
      longitud: e.latlng.lng,
      orden,
    };

    // Se dibuja de inmediato para que el click siempre dé feedback visual,
    // aunque el guardado en el servidor falle (RLS, red, etc.).
    this.editingParadas.push(optimistic);
    this.drawEditingRutaPath();

    try {
      const saved = await this.admin.createParada({
        ruta_id: optimistic.ruta_id,
        nombre: optimistic.nombre,
        latitud: optimistic.latitud,
        longitud: optimistic.longitud,
        orden: optimistic.orden,
      });
      const idx = this.editingParadas.findIndex(p => p.id === optimistic.id);
      if (idx >= 0) this.editingParadas[idx] = saved;
    } catch (err: any) {
      this.editingParadas = this.editingParadas.filter(p => p.id !== optimistic.id);
      this.drawEditingRutaPath();
      this.showToast(err?.message || 'No se pudo guardar la parada', 'danger');
    }
  }

  async undoLastParada() {
    const last = this.editingParadas[this.editingParadas.length - 1];
    if (!last) return;

    if (!last.id.startsWith('temp-')) {
      const alert = await this.alertCtrl.create({
        header: 'Quitar parada',
        message: `¿Eliminar "${last.nombre}" del trazado? Esto la borra permanentemente.`,
        buttons: [
          { text: 'Cancelar', role: 'cancel' },
          { text: 'Eliminar', role: 'destructive', handler: async () => {
            this.editingParadas.pop();
            try { await this.admin.deleteParada(last.id); } catch {}
            await this.drawEditingRutaPath();
          }},
        ],
      });
      await alert.present();
    } else {
      this.editingParadas.pop();
      await this.drawEditingRutaPath();
    }
  }

  private async drawEditingRutaPath() {
    if (!this.liveMap) return;
    this.rutaPathLayers.forEach(l => this.liveMap!.removeLayer(l));
    this.rutaPathLayers = [];

    const color = this.editingRuta?.color || '#00c853';
    this.editingParadas.forEach((p, i) => {
      const icon = L.divIcon({
        className: 'ruta-point-marker',
        html: `<div style="width:22px;height:22px;background:${color};border-radius:50%;border:2px solid #fff;display:grid;place-items:center;color:#fff;font-size:11px;font-weight:bold;box-shadow:0 2px 6px rgba(0,0,0,0.35)">${i + 1}</div>`,
        iconSize: [22, 22], iconAnchor: [11, 11],
      });
      const m = L.marker([p.latitud, p.longitud], { icon })
        .addTo(this.liveMap!)
        .bindTooltip(p.nombre, { direction: 'top', offset: [0, -12], className: 'ruta-stop-tooltip' });
      this.rutaPathLayers.push(m);
    });

    if (this.editingParadas.length >= 2) {
      const coords = await this.features.fetchRoadRouteCoords(this.editingParadas);
      const line = L.polyline(coords, { color, weight: 5, opacity: 0.9 }).addTo(this.liveMap);
      this.rutaPathLayers.push(line);

      if (this.editingRuta) {
        this.editingRuta.geometria = coords;
        this.admin.updateRuta(this.editingRuta.id, { geometria: coords }).catch(() => {});
      }
    } else if (this.editingRuta && this.editingRuta.geometria) {
      // Ya no hay suficientes paradas para formar un camino: no dejar un trazado viejo huérfano.
      this.editingRuta.geometria = null;
      this.admin.updateRuta(this.editingRuta.id, { geometria: null }).catch(() => {});
    }
  }

  private updateMapMarker(busId: string, lat: number, lng: number, timestamp?: string) {
    if (!this.liveMap) return;
    this.liveMarkersLastSeen.set(busId, timestamp ? (Date.parse(timestamp) || Date.now()) : Date.now());

    if (this.liveMarkers.has(busId)) {
      const marker = this.liveMarkers.get(busId)!;
      animateMarkerTo(marker, [lat, lng]);
      marker.setOpacity(1);
      this.refreshMarkerTooltip(busId, marker, false);
    } else {
      const icon = L.divIcon({
        className: 'emp-bus-marker',
        html: `<div style="width:26px;height:26px;background:#00c853;border-radius:50%;border:2px solid #fff;display:grid;place-items:center;box-shadow:0 2px 6px rgba(0,0,0,0.3)"><svg viewBox="0 0 24 24" fill="white" width="12" height="12"><path d="M4 16c0 .88.39 1.67 1 2.22V20c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h8v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1.78c.61-.55 1-1.34 1-2.22V6c0-3.5-3.58-4-8-4s-8 .5-8 4v10zm3.5 1c-.83 0-1.5-.67-1.5-1.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17zm9 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm1.5-6H6V6h12v5z"/></svg></div>`,
        iconSize: [26, 26], iconAnchor: [13, 13],
      });
      const m = L.marker([lat, lng], { icon }).addTo(this.liveMap);
      this.liveMarkers.set(busId, m);
      this.refreshMarkerTooltip(busId, m, false);
    }
  }

  private refreshMarkerTooltip(busId: string, marker: L.Marker, stale: boolean) {
    const placa = this.buses.find(b => b.id === busId)?.placa || 'Bus';
    marker.unbindTooltip();
    marker.bindTooltip(stale ? `${placa} · sin señal` : placa, {
      direction: 'top', offset: [0, -14],
      className: stale ? 'bus-tooltip-stale' : 'bus-tooltip',
    });
  }

  private startStaleBusWatcher() {
    this.staleCheckInterval = setInterval(() => {
      if (!this.liveMap) return;
      const now = Date.now();
      this.liveMarkersLastSeen.forEach((lastSeen, busId) => {
        const marker = this.liveMarkers.get(busId);
        if (!marker) return;
        const age = now - lastSeen;
        if (age > this.REMOVE_MS) {
          this.liveMap!.removeLayer(marker);
          this.liveMarkers.delete(busId);
          this.liveMarkersLastSeen.delete(busId);
        } else if (age > this.STALE_MS) {
          marker.setOpacity(0.35);
          this.refreshMarkerTooltip(busId, marker, true);
        }
      });
    }, 10000);
  }

  get activeBusCount(): number { return this.buses.filter(b => b.estado === 'en_ruta').length; }
  get activeRoutesCount(): number { return this.rutas.filter(r => r.estado === 'activa').length; }

  // ---- RUTAS ----
  async addRuta() {
    const modal = await this.modalCtrl.create({ component: RutaFormComponent });
    await modal.present();
    const { data, role } = await modal.onDidDismiss();
    if (role !== 'confirm' || !data) return;

    try {
      const nueva = await this.admin.createRuta({
        empresa_id: this.profile!.empresa_id!,
        nombre: data.nombre,
        origen: data.origen.label,
        destino: data.destino.label,
        color: data.color || '#00c853',
        estado: 'activa',
      });

      const origenParada = await this.admin.createParada({ ruta_id: nueva.id, nombre: data.origen.label, latitud: data.origen.lat, longitud: data.origen.lng, orden: 0 });
      const destinoParada = await this.admin.createParada({ ruta_id: nueva.id, nombre: data.destino.label, latitud: data.destino.lat, longitud: data.destino.lng, orden: 1 });

      const geometria = await this.features.fetchRoadRouteCoords([origenParada, destinoParada]);
      await this.admin.updateRuta(nueva.id, { geometria });

      await this.loadData();
      if (this.activeTab === 'mapa' || this.activeTab === 'inicio') setTimeout(() => this.initLiveMap(), 150);
      this.showToast('Ruta creada con recorrido automático');
    } catch {
      this.showToast('Error creando la ruta', 'danger');
    }
  }

  async deleteRuta(r: Ruta) {
    const alert = await this.alertCtrl.create({
      header: 'Eliminar ruta', message: `¿Eliminar "${r.nombre}"?`,
      buttons: [{ text: 'Cancelar', role: 'cancel' }, { text: 'Eliminar', role: 'destructive', handler: async () => {
        await this.admin.deleteRuta(r.id); await this.loadData(); this.showToast('Eliminada');
      }}],
    });
    await alert.present();
  }

  // ---- BUSES ----
  async addBus() {
    const alert = await this.alertCtrl.create({
      header: 'Nuevo bus',
      inputs: [
        { name: 'placa', placeholder: 'Placa', type: 'text' },
        { name: 'numero_unidad', placeholder: 'Número de unidad', type: 'text' },
        { name: 'capacidad', placeholder: 'Capacidad', type: 'number', value: '40' },
      ],
      buttons: [{ text: 'Cancelar', role: 'cancel' }, { text: 'Crear', handler: async (d) => {
        if (!d.placa) return false;
        await this.admin.createBus({ empresa_id: this.profile!.empresa_id!, placa: d.placa, numero_unidad: d.numero_unidad || null, capacidad: parseInt(d.capacidad) || 40, estado: 'inactivo' });
        await this.loadData(); this.showToast('Bus creado');
        return true;
      }}],
    });
    await alert.present();
  }

  async assignBusRoute(bus: Bus) {
    const inputs = this.rutas.map(r => ({ type: 'radio' as const, label: r.nombre, value: r.id, checked: bus.ruta_id === r.id }));
    inputs.unshift({ type: 'radio' as const, label: 'Sin ruta', value: '', checked: !bus.ruta_id });
    const alert = await this.alertCtrl.create({ header: `Ruta de ${bus.placa}`, inputs, buttons: [{ text: 'Cancelar', role: 'cancel' }, { text: 'Asignar', handler: async (v) => { await this.admin.updateBus(bus.id, { ruta_id: v || null }); await this.loadData(); } }] });
    await alert.present();
  }

  async assignBusChofer(bus: Bus) {
    const inputs = this.choferes.map(c => ({ type: 'radio' as const, label: c.nombre_completo, value: c.id, checked: bus.chofer_id === c.id }));
    inputs.unshift({ type: 'radio' as const, label: 'Sin chofer', value: '', checked: !bus.chofer_id });
    const alert = await this.alertCtrl.create({ header: `Chofer de ${bus.placa}`, inputs, buttons: [{ text: 'Cancelar', role: 'cancel' }, { text: 'Asignar', handler: async (v) => { await this.admin.updateBus(bus.id, { chofer_id: v || null }); await this.loadData(); } }] });
    await alert.present();
  }

  async deleteBus(bus: Bus) {
    const alert = await this.alertCtrl.create({ header: 'Eliminar bus', message: `¿Eliminar ${bus.placa}?`, buttons: [{ text: 'Cancelar', role: 'cancel' }, { text: 'Eliminar', role: 'destructive', handler: async () => { await this.admin.deleteBus(bus.id); await this.loadData(); } }] });
    await alert.present();
  }

  // ---- CHOFERES ----
  async addChofer() {
    const alert = await this.alertCtrl.create({
      header: 'Nuevo chofer',
      inputs: [
        { name: 'nombre', placeholder: 'Nombre completo', type: 'text' },
        { name: 'email', placeholder: 'Correo', type: 'email' },
        { name: 'password', placeholder: 'Contraseña temporal', type: 'password' },
      ],
      buttons: [{ text: 'Cancelar', role: 'cancel' }, { text: 'Crear', handler: async (d) => {
        if (!d.nombre || !d.email || !d.password) return false;
        try { await this.admin.createChofer(d.email, d.password, d.nombre, this.profile!.empresa_id!); await this.loadData(); this.showToast('Chofer creado'); }
        catch (e: any) { this.showToast(e?.message || 'Error', 'danger'); }
        return true;
      }}],
    });
    await alert.present();
  }

  getBusStatus(e: string) { return { activo: 'Activo', inactivo: 'Inactivo', en_ruta: 'En ruta', mantenimiento: 'Mant.' }[e] || e; }
  getBusColor(e: string) { return { activo: '#00c853', inactivo: '#9aa5b4', en_ruta: '#2196f3', mantenimiento: '#ff9800' }[e] || '#9aa5b4'; }

  async onLogout() { await this.supabase.signOut(); this.router.navigate(['/auth/login'], { replaceUrl: true }); }
  private async showToast(m: string, c = 'success') { const t = await this.toastCtrl.create({ message: m, duration: 2000, color: c, position: 'top' }); await t.present(); }

  ngOnDestroy() {
    if (this.staleCheckInterval) clearInterval(this.staleCheckInterval);
    if (this.liveMap) this.liveMap.remove();
    if (this.realtimeChannel) {
      createClient(environment.supabaseUrl, environment.supabaseAnonKey).removeChannel(this.realtimeChannel);
    }
  }
}
