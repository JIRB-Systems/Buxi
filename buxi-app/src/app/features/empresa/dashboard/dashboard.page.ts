import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController, LoadingController, ToastController } from '@ionic/angular';
import * as L from 'leaflet';
import { createClient, RealtimeChannel } from '@supabase/supabase-js';
import { environment } from '../../../../environments/environment';
import { SupabaseService } from '../../../core/services/supabase.service';
import { AdminEmpresaService } from '../../../core/services/admin-empresa.service';
import { UserProfile } from '../../../core/models/user-profile.model';
import { Bus, Ruta, BusLocation } from '../../../core/models/transport.model';

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
  private realtimeChannel: RealtimeChannel | null = null;

  constructor(
    private supabase: SupabaseService,
    private admin: AdminEmpresaService,
    private router: Router,
    private alertCtrl: AlertController,
    private loadingCtrl: LoadingController,
    private toastCtrl: ToastController,
  ) {}

  async ngOnInit() {
    try {
      this.profile = await this.supabase.getProfile();
      if (this.profile?.empresa_id) {
        await this.loadData();
      }
    } catch {} finally { this.loading = false; }
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

    L.tileLayer('https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(this.liveMap);

    this.liveMarkers.forEach(m => m.remove());
    this.liveMarkers.clear();

    const busesEnRuta = this.buses.filter(b => b.estado === 'en_ruta' || b.estado === 'activo');
    // Subscribe to realtime
    if (!this.realtimeChannel) {
      const sb = createClient(environment.supabaseUrl, environment.supabaseAnonKey);
      this.realtimeChannel = sb.channel('emp-live')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bus_locations' }, (payload) => {
          const loc = payload.new as BusLocation;
          this.updateMapMarker(loc.bus_id, loc.latitud, loc.longitud);
        })
        .subscribe();
    }

    setTimeout(() => this.liveMap?.invalidateSize(), 200);
  }

  private updateMapMarker(busId: string, lat: number, lng: number) {
    if (!this.liveMap) return;
    if (this.liveMarkers.has(busId)) {
      this.liveMarkers.get(busId)!.setLatLng([lat, lng]);
    } else {
      const icon = L.divIcon({
        className: 'emp-bus-marker',
        html: `<div style="width:26px;height:26px;background:#00c853;border-radius:50%;border:2px solid #fff;display:grid;place-items:center;box-shadow:0 2px 6px rgba(0,0,0,0.3)"><svg viewBox="0 0 24 24" fill="white" width="12" height="12"><path d="M4 16c0 .88.39 1.67 1 2.22V20c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h8v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1.78c.61-.55 1-1.34 1-2.22V6c0-3.5-3.58-4-8-4s-8 .5-8 4v10zm3.5 1c-.83 0-1.5-.67-1.5-1.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17zm9 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm1.5-6H6V6h12v5z"/></svg></div>`,
        iconSize: [26, 26], iconAnchor: [13, 13],
      });
      const m = L.marker([lat, lng], { icon }).addTo(this.liveMap);
      this.liveMarkers.set(busId, m);
    }
  }

  get activeBusCount(): number { return this.buses.filter(b => b.estado === 'en_ruta').length; }
  get activeRoutesCount(): number { return this.rutas.filter(r => r.estado === 'activa').length; }

  // ---- RUTAS ----
  async addRuta() {
    const alert = await this.alertCtrl.create({
      header: 'Nueva ruta',
      inputs: [
        { name: 'nombre', placeholder: 'Nombre de la ruta', type: 'text' },
        { name: 'origen', placeholder: 'Origen', type: 'text' },
        { name: 'destino', placeholder: 'Destino', type: 'text' },
        { name: 'color', placeholder: 'Color (#hex)', type: 'text', value: '#00c853' },
      ],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Crear', handler: async (d) => {
          if (!d.nombre || !d.origen || !d.destino) return false;
          try {
            await this.admin.createRuta({ empresa_id: this.profile!.empresa_id!, nombre: d.nombre, origen: d.origen, destino: d.destino, color: d.color || '#00c853', estado: 'activa' });
            await this.loadData(); this.showToast('Ruta creada');
          } catch { this.showToast('Error', 'danger'); }
          return true;
        }},
      ],
    });
    await alert.present();
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
    if (this.liveMap) this.liveMap.remove();
    if (this.realtimeChannel) {
      createClient(environment.supabaseUrl, environment.supabaseAnonKey).removeChannel(this.realtimeChannel);
    }
  }
}
