import { Component, OnInit, OnDestroy } from '@angular/core';
import { supabaseClient } from '../../../core/supabase-client';
import { Router } from '@angular/router';
import * as maplibregl from 'maplibre-gl';
import { Geolocation } from '@capacitor/geolocation';
import { Capacitor } from '@capacitor/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { environment } from '../../../../environments/environment';
import { AlertController, LoadingController, ToastController, ModalController } from '@ionic/angular';
import { SupabaseService } from '../../../core/services/supabase.service';
import { AdminJirbService } from '../../../core/services/admin-jirb.service';
import { UserProfile } from '../../../core/models/user-profile.model';
import { Empresa, Bus, Ruta } from '../../../core/models/transport.model';
import { Calificacion, Viaje, ActivityLog, SystemConfig, Plan, Suscripcion, ReporteBug, AvisoSistema } from '../../../core/models/features.model';
import { BusLocation } from '../../../core/models/transport.model';
import { createMap, htmlMarkerEl, circlePolygon, distanceToPolylineMeters } from '../../../core/utils/maplibre';
import type { Feature, LineString } from 'geojson';
import { AvisoFormComponent } from './aviso-form.component';
import { ResponderReporteComponent } from './responder-reporte.component';

@Component({
  selector: 'app-admin-dashboard',
  templateUrl: './admin-dashboard.page.html',
  styleUrls: ['./admin-dashboard.page.scss'],
  standalone: false,
})
export class AdminDashboardPage implements OnInit, OnDestroy {
  private adminMap: maplibregl.Map | null = null;
  private adminBusMarkers = new Map<string, maplibregl.Marker>();
  private adminUserMarker: maplibregl.Marker | null = null;
  private adminAccuracyDrawn = false;
  private adminUserWatchId: string | null = null;
  private realtimeChannel: RealtimeChannel | null = null;
  profile: UserProfile | null = null;
  activeTab = 'overview';
  loading = true;

  // ---- Buscador de bus ----
  busSearchQuery = '';

  // ---- Capa de calor de anomalías ----
  showAnomalyHeatmap = false;

  // ---- Estela de recorrido ----
  trailBusPlaca: string | null = null;
  private trailLoading = false;

  // ---- Desvío de ruta ----
  private readonly ROUTE_DEVIATION_METERS = 300;

  // ---- Clustering ----
  private adminClusterMarkers: maplibregl.Marker[] = [];
  private readonly CLUSTER_PIXEL_RADIUS = 46;
  private clusterMoveHandler: (() => void) | null = null;
  private clusterDebounce: any = null;

  // ---- Time-lapse histórico ----
  historicalMode = false;
  historicalDate = new Date().toISOString().slice(0, 10);
  readonly todayStr = new Date().toISOString().slice(0, 10);
  historicalMinute = 480;
  isPlaying = false;
  historicalLoading = false;
  private historicalByBus = new Map<string, { lat: number; lng: number; t: number; placa: string; color: string }[]>();
  private historicalMarkers = new Map<string, maplibregl.Marker>();
  private playbackInterval: any = null;
  sidebarOpen = true;

  topNavItems = [
    { id: 'overview', icon: 'grid-outline', label: 'Dashboard' },
    { id: 'mapa', icon: 'map-outline', label: 'Mapa en vivo' },
  ];

  navGroups = [
    {
      label: 'OPERACIÓN',
      items: [
        { id: 'empresas', icon: 'business-outline', label: 'Empresas' },
        { id: 'rutas', icon: 'git-branch-outline', label: 'Rutas' },
        { id: 'buses', icon: 'bus-outline', label: 'Buses' },
        { id: 'usuarios', icon: 'people-outline', label: 'Usuarios' },
      ],
    },
    {
      label: 'CONTROL',
      items: [
        { id: 'viajes', icon: 'swap-horizontal-outline', label: 'Viajes' },
        { id: 'alertas', icon: 'warning-outline', label: 'Alertas GPS' },
        { id: 'calificaciones', icon: 'star-outline', label: 'Reseñas' },
        { id: 'reportes', icon: 'bug-outline', label: 'Reportes' },
      ],
    },
    {
      label: 'ADMINISTRACIÓN',
      items: [
        { id: 'planes', icon: 'card-outline', label: 'Planes' },
        { id: 'solicitudes', icon: 'mail-outline', label: 'Solicitudes' },
        { id: 'avisos', icon: 'megaphone-outline', label: 'Avisos' },
        { id: 'logs', icon: 'document-text-outline', label: 'Actividad' },
        { id: 'config', icon: 'settings-outline', label: 'Configuración' },
      ],
    },
  ];

  stats = {
    totalEmpresas: 0, totalRutas: 0, totalBuses: 0, totalChoferes: 0,
    totalPasajeros: 0, busesEnRuta: 0, totalCalificaciones: 0, promedioGeneral: 0,
  };

  empresas: Empresa[] = [];
  rutas: Ruta[] = [];
  buses: Bus[] = [];
  users: UserProfile[] = [];
  calificaciones: Calificacion[] = [];

  viajes: Viaje[] = [];
  logs: ActivityLog[] = [];
  configItems: SystemConfig[] = [];
  liveLocations: BusLocation[] = [];
  anomalias: BusLocation[] = [];
  planes: Plan[] = [];
  suscripciones: Suscripcion[] = [];
  suscripcionMap = new Map<string, Suscripcion>();
  solicitudes: any[] = [];
  reportes: ReporteBug[] = [];
  avisos: AvisoSistema[] = [];

  filteredUsers: UserProfile[] = [];
  userRoleFilter = 'todos';
  userSearch = '';

  constructor(
    private supabase: SupabaseService,
    private admin: AdminJirbService,
    private router: Router,
    private alertCtrl: AlertController,
    private loadingCtrl: LoadingController,
    private toastCtrl: ToastController,
    private modalCtrl: ModalController,
  ) {}

  async ngOnInit() {
    try {
      this.profile = await this.supabase.getProfile();
      await this.loadData();
    } catch {} finally {
      this.loading = false;
      if (this.activeTab === 'overview') {
        setTimeout(() => this.initAdminMap('admin-map-overview'), 150);
      }
    }
  }

  async loadData() {
    const [stats, empresas, rutas, buses, users, calificaciones, viajes, logs, config, liveLocations, anomalias, planes, suscripciones, solicitudes, reportes, avisos] = await Promise.all([
      this.admin.getGlobalStats(),
      this.admin.getEmpresas(),
      this.admin.getAllRutas(),
      this.admin.getAllBuses(),
      this.admin.getAllUsers(),
      this.admin.getAllCalificaciones(),
      this.admin.getViajes(),
      this.admin.getLogs(),
      this.admin.getConfig(),
      this.admin.getAllLiveLocations(),
      this.admin.getAnomalousLocations(),
      this.admin.getPlanes(),
      this.admin.getSuscripciones(),
      this.admin.getSolicitudes(),
      this.admin.getReportes(),
      this.admin.getAvisos(),
    ]);
    this.stats = stats;
    this.empresas = empresas;
    this.rutas = rutas;
    this.buses = buses;
    this.users = users;
    this.calificaciones = calificaciones;
    this.viajes = viajes;
    this.logs = logs;
    this.configItems = config;
    this.liveLocations = liveLocations;
    this.anomalias = anomalias;
    this.planes = planes;
    this.suscripciones = suscripciones;
    this.solicitudes = solicitudes;
    this.reportes = reportes;
    this.avisos = avisos;
    this.suscripcionMap.clear();
    for (const s of suscripciones) {
      this.suscripcionMap.set(s.empresa_id, s);
    }
    this.applyUserFilter();
  }

  switchTab(tab: string) {
    this.activeTab = tab;
    if (tab === 'mapa') {
      setTimeout(() => this.initAdminMap('admin-map'), 150);
    }
    if (tab === 'overview') {
      setTimeout(() => this.initAdminMap('admin-map-overview'), 150);
    }
  }

  toggleSidebar() { this.sidebarOpen = !this.sidebarOpen; }

  // ---- OVERVIEW WIDGETS (computed from already-loaded data) ----

  get busEstadoBreakdown(): { estado: string; label: string; color: string; count: number; pct: number; dash: string; offset: number }[] {
    const total = this.buses.length;
    const order = ['activo', 'en_ruta', 'inactivo', 'mantenimiento'];
    const circumference = 2 * Math.PI * 48;
    let offsetAcc = 0;
    const rows: { estado: string; label: string; color: string; count: number; pct: number; dash: string; offset: number }[] = [];
    for (const estado of order) {
      const count = this.buses.filter(b => b.estado === estado).length;
      if (count === 0) continue;
      const pct = total > 0 ? Math.round((count / total) * 100) : 0;
      const segLength = total > 0 ? (count / total) * circumference : 0;
      rows.push({
        estado,
        label: this.getBusStatusLabel(estado),
        color: this.getBusStatusColor(estado),
        count, pct,
        dash: `${segLength} ${circumference - segLength}`,
        offset: -offsetAcc,
      });
      offsetAcc += segLength;
    }
    return rows;
  }

  get empresaPlanBreakdown(): { plan: string; label: string; color: string; count: number; pct: number }[] {
    const total = this.empresas.length;
    if (total === 0) return [];
    const byPlan = new Map<string, number>();
    for (const e of this.empresas) {
      const plan = this.getEmpresaPlan(e.id);
      byPlan.set(plan, (byPlan.get(plan) || 0) + 1);
    }
    return Array.from(byPlan.entries()).map(([plan, count]) => ({
      plan, label: plan,
      color: this.getPlanColorByName(plan),
      count, pct: Math.round((count / total) * 100),
    }));
  }

  private getPlanColorByName(name: string): string {
    if (name === 'Enterprise') return '#ff5722';
    if (name === 'Pro') return '#9c27b0';
    if (name === 'Básico') return '#2196f3';
    return '#9aa5b4';
  }

  get viajesPorDia(): { label: string; count: number; x: number; y: number }[] {
    const days: { label: string; count: number }[] = [];
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const count = this.viajes.filter(v => {
        const vd = new Date(v.inicio);
        return vd.toDateString() === d.toDateString();
      }).length;
      days.push({ label: d.toLocaleDateString('es-CR', { day: '2-digit', month: 'short' }), count });
    }
    const max = Math.max(1, ...days.map(d => d.count));
    const chartW = 320, chartH = 140, padX = 10, padY = 14;
    return days.map((d, i) => ({
      ...d,
      x: padX + (i * (chartW - padX * 2)) / (days.length - 1),
      y: chartH - padY - (d.count / max) * (chartH - padY * 2),
    }));
  }

  get viajesChartPoints(): string {
    return this.viajesPorDia.map(p => `${p.x},${p.y}`).join(' ');
  }

  get viajesChartFillPoints(): string {
    const pts = this.viajesPorDia;
    if (pts.length === 0) return '';
    const first = pts[0], last = pts[pts.length - 1];
    return `${first.x},140 ${this.viajesChartPoints} ${last.x},140`;
  }

  getLogIcon(accion: string): string {
    const a = (accion || '').toLowerCase();
    if (a.includes('eliminar') || a.includes('rechazar')) return 'trash-outline';
    if (a.includes('crear') || a.includes('aprobar')) return 'add-circle-outline';
    if (a.includes('cambiar') || a.includes('actualizar') || a.includes('asignar')) return 'sync-outline';
    return 'information-circle-outline';
  }

  getLogColor(accion: string): string {
    const a = (accion || '').toLowerCase();
    if (a.includes('eliminar') || a.includes('rechazar')) return '#f44336';
    if (a.includes('crear') || a.includes('aprobar')) return '#00c853';
    if (a.includes('cambiar') || a.includes('actualizar') || a.includes('asignar')) return '#2196f3';
    return '#9aa5b4';
  }

  private async initAdminMap(elementId: string) {
    if (this.adminMap) { this.adminMap.remove(); this.adminMap = null; }
    // El mapa se reconstruye al cambiar de pestaña: soltar el watch anterior,
    // si no queda uno colgado por cada visita alimentando un mapa muerto.
    this.stopWatchingUserLocation();
    this.adminUserMarker = null;
    this.adminAccuracyDrawn = false;
    this.trailBusPlaca = null;
    this.exitHistoricalMode(false);
    this.adminClusterMarkers.forEach(m => m.remove());
    this.adminClusterMarkers = [];
    this.clusterMoveHandler = null;

    const el = document.getElementById(elementId);
    if (!el) return;

    // Mismo estilo "rico" (edificios 3D, relieve, cielo, POIs) que el mapa
    // de pasajero y el dashboard de empresa, en vez del dataviz-dark plano.
    const map = await createMap({
      container: elementId,
      center: [-84.0907, 9.9281],
      zoom: 10,
      style: 'streets-v2-dark',
      threeD: true,
      pitch: 50,
      // El mapa vive dentro de una página con scroll: sin gestos
      // cooperativos la rueda hace zoom en vez de bajar la página.
      cooperativeGestures: true,
    });
    if (this.adminMap !== null) { try { map.remove(); } catch {} return; }
    this.adminMap = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    // El contenedor de la pestaña "Mapa en vivo" recién aparece por el
    // *ngIf al cambiar de tab: MapLibre mide su tamaño en el momento de
    // crearse, y si el layout todavía no asentó, se queda con una
    // proyección calculada sobre un tamaño chico o transitorio. El canvas
    // se estira por CSS igual, pero centro/zoom quedan mal — por eso el
    // mapa terminaba mostrando una región random en vez de Costa Rica.
    setTimeout(() => this.adminMap?.resize(), 100);
    setTimeout(() => this.adminMap?.resize(), 400);

    this.adminBusMarkers.forEach(m => m.remove());
    this.adminBusMarkers.clear();

    for (const loc of this.liveLocations) {
      this.addAdminBusMarker(loc);
    }

    if (this.liveLocations.length > 0) {
      const bounds = this.liveLocations.reduce(
        (b, l) => b.extend([l.longitud, l.latitud]),
        new maplibregl.LngLatBounds([this.liveLocations[0].longitud, this.liveLocations[0].latitud], [this.liveLocations[0].longitud, this.liveLocations[0].latitud]),
      );
      this.adminMap.fitBounds(bounds, { padding: 40, duration: 0 });
    }

    if (this.showAnomalyHeatmap) this.renderAnomalyHeatmap();

    // Re-agrupar buses cercanos en un solo marker con contador cada vez que
    // cambia el zoom: a nivel país, varios buses de una misma terminal caen
    // literalmente unos sobre otros y se hacen imposibles de tocar.
    this.clusterMoveHandler = () => {
      clearTimeout(this.clusterDebounce);
      this.clusterDebounce = setTimeout(() => this.recomputeClusters(), 120);
    };
    this.adminMap.on('zoomend', this.clusterMoveHandler);
    this.adminMap.on('moveend', this.clusterMoveHandler);
    setTimeout(() => this.recomputeClusters(), 500);

    // El mapa se reconstruye al cambiar de pestaña; sin soltar el canal
    // anterior, sb.channel('admin-live-map') devuelve el mismo canal ya
    // suscripto y el nuevo .on() tira "cannot add callbacks after
    // subscribe()" — las actualizaciones en vivo dejaban de llegar desde la
    // segunda vez que se visitaba una pestaña con mapa.
    if (this.realtimeChannel) {
      supabaseClient().removeChannel(this.realtimeChannel);
      this.realtimeChannel = null;
    }
    this.startMapRealtime();
    this.centerOnUserLocation();
  }

  private async centerOnUserLocation() {
    try {
      // requestPermissions() sólo existe en nativo; en web el permiso se pide
      // directamente al llamar getCurrentPosition() (mismo patrón que el mapa
      // de pasajero).
      if (Capacitor.isNativePlatform()) {
        const permission = await Geolocation.requestPermissions();
        if (permission.location === 'denied') return;
      }
      const position = await Geolocation.getCurrentPosition({ enableHighAccuracy: true });
      if (!this.adminMap) return;

      const { latitude, longitude, accuracy } = position.coords;
      this.renderUserPosition(latitude, longitude, accuracy);

      // A propósito NO se recentra el mapa acá. Este dashboard es para
      // vigilar la flota de todo el país, no la posición del admin que lo
      // mira: saltar a su ubicación (a menudo por WiFi/IP, fácil que erre
      // varios km o directo el país) dejaba el mapa mostrando una región
      // random en vez de la vista general de Costa Rica.

      // La primera lectura suele venir de WiFi/IP y puede errar kilómetros; el
      // navegador la refina en los segundos siguientes. Sin este watch el mapa
      // se quedaba clavado en esa primera lectura mala, que es justo la razón
      // por la que acá la ubicación no coincidía con la del mapa de pasajero.
      this.adminUserWatchId = await Geolocation.watchPosition(
        { enableHighAccuracy: true },
        (pos) => {
          if (!pos || !this.adminMap) return;
          // Sin recentrar: mover la vista mientras el admin navega el mapa
          // sería peor que el error de precisión.
          this.renderUserPosition(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
        },
      ) as unknown as string;
    } catch {}
  }

  // Dibuja (o mueve) el punto del usuario junto a un círculo del radio de
  // precisión que reporta el navegador, para que un dato de ±3 km no se vea
  // igual de confiable que uno de ±10 m.
  private renderUserPosition(lat: number, lng: number, accuracy?: number | null) {
    if (!this.adminMap) return;
    const lngLat: [number, number] = [lng, lat];

    const precision = accuracy && accuracy > 0
      ? (accuracy >= 1000 ? `± ${(accuracy / 1000).toFixed(1)} km` : `± ${Math.round(accuracy)} m`)
      : 'precisión desconocida';

    if (this.adminUserMarker) {
      this.adminUserMarker.setLngLat(lngLat);
      this.adminUserMarker.getPopup()?.setHTML(`Tu ubicación<br><small>${precision}</small>`);
    } else {
      const el = htmlMarkerEl('admin-user-marker', `<div class="admin-user-dot"></div><div class="admin-user-pulse"></div>`);
      const popup = new maplibregl.Popup({ offset: 12, closeButton: false })
        .setHTML(`Tu ubicación<br><small>${precision}</small>`);
      this.adminUserMarker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat(lngLat)
        .setPopup(popup)
        .addTo(this.adminMap);
    }

    if (accuracy && accuracy > 0) {
      try {
        const data = circlePolygon(lng, lat, accuracy);
        const existing = this.adminMap.getSource('admin-accuracy') as maplibregl.GeoJSONSource | undefined;
        if (existing) {
          existing.setData(data);
        } else if (!this.adminAccuracyDrawn) {
          this.adminAccuracyDrawn = true;
          this.adminMap.addSource('admin-accuracy', { type: 'geojson', data });
          this.adminMap.addLayer({
            id: 'admin-accuracy-fill', type: 'fill', source: 'admin-accuracy',
            paint: { 'fill-color': '#4285f4', 'fill-opacity': 0.1 },
          });
          this.adminMap.addLayer({
            id: 'admin-accuracy-line', type: 'line', source: 'admin-accuracy',
            paint: { 'line-color': '#4285f4', 'line-width': 1, 'line-opacity': 0.4 },
          });
        }
      } catch { /* estilo sin cargar todavia: el punto de usuario sigue visible sin el circulo */ }
    }
  }

  private stopWatchingUserLocation() {
    if (this.adminUserWatchId) {
      Geolocation.clearWatch({ id: this.adminUserWatchId });
      this.adminUserWatchId = null;
    }
  }

  private addAdminBusMarker(loc: BusLocation) {
    if (!this.adminMap) return;
    const busInfo = loc.bus as any;
    const color = busInfo?.ruta?.color || '#00c853';
    const deviated = this.isBusDeviated(loc);

    if (this.adminBusMarkers.has(loc.bus_id)) {
      const marker = this.adminBusMarkers.get(loc.bus_id)!;
      marker.setLngLat([loc.longitud, loc.latitud]);
      marker.getElement().classList.toggle('deviated', deviated);
      marker.getPopup()?.setHTML(this.busPopupHtml(busInfo, loc, deviated));
      return;
    }

    const el = htmlMarkerEl('admin-bus-marker', `<div class="admin-bus-icon" style="background:${color}"><svg viewBox="0 0 24 24" fill="white" width="12" height="12"><path d="M4 16c0 .88.39 1.67 1 2.22V20c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h8v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1.78c.61-.55 1-1.34 1-2.22V6c0-3.5-3.58-4-8-4s-8 .5-8 4v10zm3.5 1c-.83 0-1.5-.67-1.5-1.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17zm9 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm1.5-6H6V6h12v5z"/></svg></div>`);
    if (deviated) el.classList.add('deviated');
    // Clic en el bus dibuja su estela de las últimas horas — independiente
    // del popup, que Marker.setPopup ya engancha a este mismo click.
    el.addEventListener('click', () => this.showBusTrail(loc.bus_id, busInfo?.placa || 'Bus'));

    const popup = new maplibregl.Popup({ offset: 16, closeButton: false })
      .setHTML(this.busPopupHtml(busInfo, loc, deviated));
    const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat([loc.longitud, loc.latitud])
      .setPopup(popup)
      .addTo(this.adminMap);

    this.adminBusMarkers.set(loc.bus_id, marker);
  }

  private busPopupHtml(busInfo: any, loc: BusLocation, deviated: boolean): string {
    const warn = deviated ? `<br><span style="color:#f44336;font-weight:700">⚠ Fuera de ruta trazada</span>` : '';
    return `<b>${busInfo?.placa || 'Bus'}</b><br>${busInfo?.ruta?.nombre || 'Sin ruta'}<br>${loc.velocidad} km/h${warn}`;
  }

  // `ruta.geometria` se guarda en formato Leaflet [lat, lng]; la función de
  // distancia trabaja en [lng, lat] como el resto de MapLibre.
  private isBusDeviated(loc: BusLocation): boolean {
    const geometria = (loc.bus as any)?.ruta?.geometria as [number, number][] | null;
    if (!geometria || geometria.length < 2) return false;
    const routeLngLat = geometria.map(([la, ln]) => [ln, la] as [number, number]);
    return distanceToPolylineMeters(loc.longitud, loc.latitud, routeLngLat) > this.ROUTE_DEVIATION_METERS;
  }

  private startMapRealtime() {
    const sb = supabaseClient();
    this.realtimeChannel = sb.channel('admin-live-map')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bus_locations' }, (payload) => {
        // En modo histórico los markers en pantalla son de otro día; una
        // llegada en vivo no debe pisarlos.
        if (this.historicalMode) return;
        const loc = payload.new as BusLocation;
        this.addAdminBusMarker(loc);
      })
      .subscribe();
  }

  // ---- BUSCADOR DE BUS POR PLACA ----
  searchBus() {
    const q = this.busSearchQuery.trim().toLowerCase();
    if (!q || !this.adminMap) return;
    const match = this.liveLocations.find(l => ((l.bus as any)?.placa || '').toLowerCase().includes(q));
    if (!match) {
      this.showToast('Ningún bus con esa placa está transmitiendo ahora', 'warning');
      return;
    }
    this.adminMap.flyTo({ center: [match.longitud, match.latitud], zoom: 15, duration: 1200 });
    setTimeout(() => this.adminBusMarkers.get(match.bus_id)?.togglePopup(), 1300);
  }

  clearBusSearch() { this.busSearchQuery = ''; }

  // ---- CAPA DE CALOR DE ANOMALÍAS ----
  toggleAnomalyHeatmap() {
    this.showAnomalyHeatmap = !this.showAnomalyHeatmap;
    if (this.showAnomalyHeatmap) this.renderAnomalyHeatmap();
    else this.removeAnomalyHeatmap();
  }

  private renderAnomalyHeatmap() {
    if (!this.adminMap || !this.adminMap.isStyleLoaded() || this.anomalias.length === 0) return;
    const data = {
      type: 'FeatureCollection' as const,
      features: this.anomalias.map(a => ({
        type: 'Feature' as const, properties: {},
        geometry: { type: 'Point' as const, coordinates: [a.longitud, a.latitud] },
      })),
    };
    try {
      const source = this.adminMap.getSource('anomaly-heat') as maplibregl.GeoJSONSource | undefined;
      if (source) {
        source.setData(data as any);
        return;
      }
      this.adminMap.addSource('anomaly-heat', { type: 'geojson', data: data as any });
      this.adminMap.addLayer({
        id: 'anomaly-heat-layer', type: 'heatmap', source: 'anomaly-heat',
        paint: {
          'heatmap-weight': 1,
          'heatmap-intensity': 1.2,
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(0,0,0,0)',
            0.2, 'rgba(33,150,243,0.5)',
            0.4, 'rgba(0,200,83,0.6)',
            0.6, 'rgba(255,193,7,0.7)',
            1, 'rgba(244,67,54,0.9)',
          ],
          'heatmap-radius': 35,
          'heatmap-opacity': 0.75,
        },
      });
    } catch { /* estilo sin cargar todavía: se reintenta en el próximo initAdminMap */ }
  }

  private removeAnomalyHeatmap() {
    if (!this.adminMap) return;
    try {
      if (this.adminMap.getLayer('anomaly-heat-layer')) this.adminMap.removeLayer('anomaly-heat-layer');
      if (this.adminMap.getSource('anomaly-heat')) this.adminMap.removeSource('anomaly-heat');
    } catch {}
  }

  // ---- ESTELA DE RECORRIDO ----
  async showBusTrail(busId: string, placa: string) {
    if (!this.adminMap || this.trailLoading || this.historicalMode) return;
    this.trailLoading = true;
    try {
      const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const points = await this.admin.getBusTrail(busId, since);
      if (points.length < 2) {
        this.showToast(`${placa} no tiene suficiente recorrido reciente para trazar`, 'warning');
        return;
      }
      const coords = points.map(p => [p.longitud, p.latitud]);
      const data: Feature<LineString> = {
        type: 'Feature', properties: {},
        geometry: { type: 'LineString', coordinates: coords },
      };
      if (this.adminMap.getSource('bus-trail')) {
        (this.adminMap.getSource('bus-trail') as maplibregl.GeoJSONSource).setData(data as any);
      } else if (this.adminMap.isStyleLoaded()) {
        this.adminMap.addSource('bus-trail', { type: 'geojson', data: data as any });
        this.adminMap.addLayer({
          id: 'bus-trail-glow', type: 'line', source: 'bus-trail',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#00e5ff', 'line-width': 10, 'line-opacity': 0.15 },
        });
        this.adminMap.addLayer({
          id: 'bus-trail-line', type: 'line', source: 'bus-trail',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#00e5ff', 'line-width': 3, 'line-opacity': 0.9 },
        });
      }
      this.trailBusPlaca = placa;
    } catch {
      this.showToast('No se pudo cargar el recorrido', 'danger');
    } finally {
      this.trailLoading = false;
    }
  }

  clearTrail() {
    if (this.adminMap) {
      try {
        if (this.adminMap.getLayer('bus-trail-glow')) this.adminMap.removeLayer('bus-trail-glow');
        if (this.adminMap.getLayer('bus-trail-line')) this.adminMap.removeLayer('bus-trail-line');
        if (this.adminMap.getSource('bus-trail')) this.adminMap.removeSource('bus-trail');
      } catch {}
    }
    this.trailBusPlaca = null;
  }

  // ---- CLUSTERING ----
  // Agrupamiento manual en espacio de pantalla: los markers de bus son HTML
  // custom (para el ícono/color/popup), no una capa de datos de MapLibre, así
  // que el clustering nativo (`cluster: true` en una fuente GeoJSON) no
  // aplica sin perder ese estilo. En su lugar, cada vez que cambia el
  // encuadre se proyectan los markers a píxeles y se agrupan a mano los que
  // caen a menos de CLUSTER_PIXEL_RADIUS entre sí.
  private recomputeClusters() {
    if (!this.adminMap) return;
    const map = this.adminMap;

    this.adminClusterMarkers.forEach(m => m.remove());
    this.adminClusterMarkers = [];

    const entries = Array.from(this.adminBusMarkers.entries());
    const points = entries.map(([busId, marker]) => ({
      busId, marker, px: map.project(marker.getLngLat()),
    }));

    const used = new Set<string>();
    const groups: { busId: string; marker: maplibregl.Marker; px: maplibregl.Point }[][] = [];

    for (const p of points) {
      if (used.has(p.busId)) continue;
      const group = [p];
      used.add(p.busId);
      for (const q of points) {
        if (used.has(q.busId)) continue;
        if (Math.hypot(p.px.x - q.px.x, p.px.y - q.px.y) <= this.CLUSTER_PIXEL_RADIUS) {
          group.push(q);
          used.add(q.busId);
        }
      }
      groups.push(group);
    }

    for (const group of groups) {
      if (group.length === 1) {
        group[0].marker.getElement().style.display = '';
        continue;
      }
      group.forEach(g => { g.marker.getElement().style.display = 'none'; });

      const avgLng = group.reduce((s, g) => s + g.marker.getLngLat().lng, 0) / group.length;
      const avgLat = group.reduce((s, g) => s + g.marker.getLngLat().lat, 0) / group.length;

      const el = htmlMarkerEl('admin-cluster-marker', `<div class="admin-cluster-badge">${group.length}</div>`);
      el.addEventListener('click', () => {
        map.easeTo({ center: [avgLng, avgLat], zoom: Math.min(map.getZoom() + 2.5, 18), duration: 500 });
      });
      const clusterMarker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([avgLng, avgLat])
        .addTo(map);
      this.adminClusterMarkers.push(clusterMarker);
    }
  }

  // ---- TIME-LAPSE HISTÓRICO ----
  toggleHistoricalMode() {
    if (this.historicalMode) {
      this.exitHistoricalMode(true);
    } else {
      this.historicalMode = true;
      this.clearTrail();
      this.loadHistoricalDay();
    }
  }

  exitHistoricalMode(rebuildLive: boolean) {
    this.stopPlayback();
    this.historicalMode = false;
    this.historicalByBus.clear();
    this.historicalMarkers.forEach(m => m.remove());
    this.historicalMarkers.clear();
    if (rebuildLive && this.adminMap) {
      this.adminBusMarkers.forEach(m => { m.getElement().style.display = ''; });
      this.recomputeClusters();
    }
  }

  async loadHistoricalDay() {
    if (!this.adminMap) return;
    this.historicalLoading = true;
    this.stopPlayback();
    this.historicalByBus.clear();
    this.historicalMarkers.forEach(m => m.remove());
    this.historicalMarkers.clear();
    this.adminBusMarkers.forEach(m => { m.getElement().style.display = 'none'; });
    this.adminClusterMarkers.forEach(m => m.remove());
    this.adminClusterMarkers = [];

    try {
      const dayStart = new Date(`${this.historicalDate}T00:00:00`);
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      const rows = await this.admin.getBusLocationsForDay(dayStart.toISOString(), dayEnd.toISOString());

      for (const row of rows) {
        const busInfo = row.bus as any;
        const list = this.historicalByBus.get(row.bus_id) || [];
        list.push({
          lat: row.latitud, lng: row.longitud,
          t: new Date(row.timestamp).getTime(),
          placa: busInfo?.placa || 'Bus',
          color: busInfo?.ruta?.color || '#9c27b0',
        });
        this.historicalByBus.set(row.bus_id, list);
      }

      if (this.historicalByBus.size === 0) {
        this.showToast('Ese día no tiene datos de GPS registrados', 'warning');
      }

      this.historicalMinute = 480;
      this.renderHistoricalAtMinute();
    } catch {
      this.showToast('No se pudo cargar el histórico de ese día', 'danger');
    } finally {
      this.historicalLoading = false;
    }
  }

  onScrub() {
    this.renderHistoricalAtMinute();
  }

  togglePlayback() {
    if (this.isPlaying) { this.stopPlayback(); return; }
    this.isPlaying = true;
    this.playbackInterval = setInterval(() => {
      this.historicalMinute += 1;
      if (this.historicalMinute > 1439) { this.historicalMinute = 1439; this.stopPlayback(); }
      this.renderHistoricalAtMinute();
    }, 120);
  }

  private stopPlayback() {
    this.isPlaying = false;
    if (this.playbackInterval) { clearInterval(this.playbackInterval); this.playbackInterval = null; }
  }

  private renderHistoricalAtMinute() {
    if (!this.adminMap) return;
    const targetT = new Date(`${this.historicalDate}T00:00:00`).getTime() + this.historicalMinute * 60000;
    const seenBusIds = new Set<string>();

    this.historicalByBus.forEach((points, busId) => {
      // Último punto conocido en o antes del instante elegido.
      let latest: typeof points[number] | null = null;
      for (const p of points) {
        if (p.t <= targetT) latest = p;
        else break;
      }
      if (!latest) return;
      seenBusIds.add(busId);

      const existing = this.historicalMarkers.get(busId);
      if (existing) {
        existing.setLngLat([latest.lng, latest.lat]);
      } else {
        const el = htmlMarkerEl('admin-bus-marker', `<div class="admin-bus-icon" style="background:${latest.color}"><svg viewBox="0 0 24 24" fill="white" width="12" height="12"><path d="M4 16c0 .88.39 1.67 1 2.22V20c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h8v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1.78c.61-.55 1-1.34 1-2.22V6c0-3.5-3.58-4-8-4s-8 .5-8 4v10zm3.5 1c-.83 0-1.5-.67-1.5-1.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17zm9 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm1.5-6H6V6h12v5z"/></svg></div>`);
        const popup = new maplibregl.Popup({ offset: 16, closeButton: false }).setHTML(`<b>${latest.placa}</b>`);
        const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat([latest.lng, latest.lat])
          .setPopup(popup)
          .addTo(this.adminMap!);
        this.historicalMarkers.set(busId, marker);
      }
    });

    // Buses que todavía no tenían señal a esta hora del día: sacarlos.
    this.historicalMarkers.forEach((marker, busId) => {
      if (!seenBusIds.has(busId)) { marker.remove(); this.historicalMarkers.delete(busId); }
    });
  }

  formatHistoricalTime(minute: number): string {
    const h = Math.floor(minute / 60).toString().padStart(2, '0');
    const m = (minute % 60).toString().padStart(2, '0');
    return `${h}:${m}`;
  }

  ngOnDestroy() {
    this.stopWatchingUserLocation();
    this.stopPlayback();
    if (this.adminMap) this.adminMap.remove();
    if (this.realtimeChannel) {
      const sb = supabaseClient();
      sb.removeChannel(this.realtimeChannel);
    }
  }

  // ---- EMPRESAS ----
  async addEmpresa() {
    const alert = await this.alertCtrl.create({ cssClass: 'buxi-alert',
      header: 'Nueva empresa',
      inputs: [
        { name: 'nombre', placeholder: 'Nombre de la empresa', type: 'text' },
        { name: 'cedula_juridica', placeholder: 'Cédula jurídica', type: 'text' },
        { name: 'telefono', placeholder: 'Teléfono', type: 'tel' },
        { name: 'email', placeholder: 'Correo', type: 'email' },
      ],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Crear', handler: async (d) => {
          if (!d.nombre) return false;
          try {
            const emp = await this.admin.createEmpresa({
              nombre: d.nombre, cedula_juridica: d.cedula_juridica || null,
              telefono: d.telefono || null, email: d.email || null, estado: 'activo',
            });
            await this.logAction('Crear empresa', d.nombre, 'empresa', emp.id);
            await this.loadData(); this.showToast('Empresa creada');
          } catch { this.showToast('Error', 'danger'); }
          return true;
        }},
      ],
    });
    await alert.present();
  }

  async toggleEmpresaStatus(empresa: Empresa) {
    const newStatus = empresa.estado === 'activo' ? 'inactivo' : 'activo';
    await this.admin.updateEmpresa(empresa.id, { estado: newStatus });
    await this.loadData();
    this.showToast(`Empresa ${newStatus === 'activo' ? 'activada' : 'desactivada'}`);
  }

  async deleteEmpresa(empresa: Empresa) {
    const alert = await this.alertCtrl.create({ cssClass: 'buxi-alert',
      header: 'Eliminar empresa',
      message: `¿Eliminar "${empresa.nombre}"? Se borrarán todas sus rutas, buses y datos asociados.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Eliminar', role: 'destructive', handler: async () => {
          try { await this.admin.deleteEmpresa(empresa.id); await this.logAction('Eliminar empresa', empresa.nombre, 'empresa', empresa.id); await this.loadData(); this.showToast('Empresa eliminada'); }
          catch { this.showToast('Error', 'danger'); }
        }},
      ],
    });
    await alert.present();
  }

  // ---- RUTAS ----
  async addRuta() {
    const empresaInputs = this.empresas.map(e => ({
      type: 'radio' as const, label: e.nombre, value: e.id,
    }));

    const step1 = await this.alertCtrl.create({ cssClass: 'buxi-alert',
      header: 'Seleccionar empresa',
      inputs: empresaInputs,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Siguiente', handler: (empresaId) => {
          if (!empresaId) return false;
          this.addRutaStep2(empresaId);
          return true;
        }},
      ],
    });
    await step1.present();
  }

  private async addRutaStep2(empresaId: string) {
    const alert = await this.alertCtrl.create({ cssClass: 'buxi-alert',
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
            await this.admin.createRuta({
              empresa_id: empresaId, nombre: d.nombre, origen: d.origen,
              destino: d.destino, color: d.color || '#00c853', estado: 'activa',
            });
            await this.loadData(); this.showToast('Ruta creada');
          } catch { this.showToast('Error', 'danger'); }
          return true;
        }},
      ],
    });
    await alert.present();
  }

  async toggleRutaStatus(ruta: Ruta) {
    const newStatus = ruta.estado === 'activa' ? 'inactiva' : 'activa';
    await this.admin.updateRuta(ruta.id, { estado: newStatus });
    await this.loadData();
  }

  async deleteRuta(ruta: Ruta) {
    const alert = await this.alertCtrl.create({ cssClass: 'buxi-alert',
      header: 'Eliminar ruta',
      message: `¿Eliminar "${ruta.nombre}"?`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Eliminar', role: 'destructive', handler: async () => {
          try { await this.admin.deleteRuta(ruta.id); await this.logAction('Eliminar ruta', ruta.nombre, 'ruta', ruta.id); await this.loadData(); this.showToast('Ruta eliminada'); }
          catch { this.showToast('Error', 'danger'); }
        }},
      ],
    });
    await alert.present();
  }

  // ---- BUSES ----
  async deleteBus(bus: Bus) {
    const alert = await this.alertCtrl.create({ cssClass: 'buxi-alert',
      header: 'Eliminar bus', message: `¿Eliminar ${bus.placa}?`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Eliminar', role: 'destructive', handler: async () => {
          try { await this.admin.deleteBus(bus.id); await this.logAction('Eliminar bus', bus.placa, 'bus', bus.id); await this.loadData(); this.showToast('Bus eliminado'); }
          catch { this.showToast('Error', 'danger'); }
        }},
      ],
    });
    await alert.present();
  }

  getBusStatusLabel(estado: string): string {
    return { activo: 'Activo', inactivo: 'Inactivo', en_ruta: 'En ruta', mantenimiento: 'Mant.' }[estado] || estado;
  }

  getBusStatusColor(estado: string): string {
    return { activo: '#00c853', inactivo: '#9aa5b4', en_ruta: '#2196f3', mantenimiento: '#ff9800' }[estado] || '#9aa5b4';
  }

  // ---- USUARIOS ----
  onUserSearch(event: any) {
    this.userSearch = (event.detail.value || '').toLowerCase();
    this.applyUserFilter();
  }

  filterByRole(role: string) {
    this.userRoleFilter = role;
    this.applyUserFilter();
  }

  private applyUserFilter() {
    let list = this.users;
    if (this.userRoleFilter !== 'todos') {
      list = list.filter(u => u.rol === this.userRoleFilter);
    }
    if (this.userSearch) {
      list = list.filter(u =>
        u.nombre_completo.toLowerCase().includes(this.userSearch) ||
        u.correo.toLowerCase().includes(this.userSearch)
      );
    }
    this.filteredUsers = list;
  }

  async changeUserRole(user: UserProfile) {
    const inputs = [
      { type: 'radio' as const, label: 'Pasajero', value: 'pasajero', checked: user.rol === 'pasajero' },
      { type: 'radio' as const, label: 'Chofer', value: 'chofer', checked: user.rol === 'chofer' },
      { type: 'radio' as const, label: 'Admin Empresa', value: 'admin_empresa', checked: user.rol === 'admin_empresa' },
      { type: 'radio' as const, label: 'Admin JIRB', value: 'admin_jirb', checked: user.rol === 'admin_jirb' },
    ];

    const alert = await this.alertCtrl.create({ cssClass: 'buxi-alert',
      header: `Rol de ${user.nombre_completo}`,
      inputs,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Guardar', handler: async (rol) => {
          if (rol === 'chofer' || rol === 'admin_empresa') {
            this.assignUserToEmpresa(user.id, rol);
          } else {
            await this.admin.updateUserRole(user.id, rol, null);
            await this.loadData(); this.showToast('Rol actualizado');
          }
        }},
      ],
    });
    await alert.present();
  }

  private async assignUserToEmpresa(userId: string, rol: string) {
    const inputs = this.empresas.map(e => ({
      type: 'radio' as const, label: e.nombre, value: e.id,
    }));

    const alert = await this.alertCtrl.create({ cssClass: 'buxi-alert',
      header: 'Asignar a empresa',
      inputs,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Asignar', handler: async (empresaId) => {
          if (!empresaId) return false;
          await this.admin.updateUserRole(userId, rol, empresaId);
          await this.logAction('Cambiar rol', `${rol} en empresa`, 'usuario', userId);
          await this.loadData(); this.showToast('Usuario asignado');
          return true;
        }},
      ],
    });
    await alert.present();
  }

  async toggleUserStatus(user: UserProfile) {
    const newStatus = user.estado === 'activo' ? 'suspendido' : 'activo';
    await this.admin.updateUserStatus(user.id, newStatus);
    await this.loadData();
    this.showToast(`Usuario ${newStatus === 'activo' ? 'activado' : 'suspendido'}`);
  }

  getRoleLabel(rol: string): string {
    return { pasajero: 'Pasajero', chofer: 'Chofer', admin_empresa: 'Admin Empresa', admin_jirb: 'Admin JIRB' }[rol] || rol;
  }

  getRoleColor(rol: string): string {
    return { pasajero: '#00c853', chofer: '#2196f3', admin_empresa: '#9c27b0', admin_jirb: '#ff5722' }[rol] || '#9aa5b4';
  }

  // ---- ALERTAS GPS ----
  async dismissAnomalia(loc: BusLocation) {
    try {
      await this.admin.dismissAnomaly(loc.id);
      this.anomalias = this.anomalias.filter(a => a.id !== loc.id);
      this.showToast('Alerta descartada');
    } catch { this.showToast('Error', 'danger'); }
  }

  // ---- CALIFICACIONES ----
  async deleteCalificacion(cal: Calificacion) {
    await this.admin.deleteCalificacion(cal.id);
    await this.loadData();
    this.showToast('Calificación eliminada');
  }

  getStars(n: number): number[] {
    return Array.from({ length: 5 }, (_, i) => i < n ? 1 : 0);
  }

  get pendingSolicitudes(): number {
    return this.solicitudes.filter(s => s.estado === 'pendiente').length;
  }

  async approveSolicitud(sol: any) {
    const alert = await this.alertCtrl.create({ cssClass: 'buxi-alert',
      header: 'Aprobar solicitud',
      message: `Se creará la empresa "${sol.nombre_empresa}" y una cuenta admin_empresa para ${sol.email}`,
      inputs: [
        { name: 'password', placeholder: 'Contraseña temporal para el admin', type: 'password', value: 'Buxi2024!' },
      ],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Aprobar y crear', handler: async (data) => {
          const loading = await this.loadingCtrl.create({ message: 'Creando empresa y cuenta...' });
          await loading.present();
          try {
            const empresa = await this.admin.createEmpresa({
              nombre: sol.nombre_empresa,
              cedula_juridica: sol.cedula_juridica || null,
              telefono: sol.telefono || null,
              email: sol.email || null,
              logo_url: sol.logo_url || null,
              estado: 'activo',
            });

            await this.admin.createAdminEmpresa(
              sol.email, data.password || 'Buxi2024!',
              sol.nombre_contacto, empresa.id
            );

            await this.admin.updateSolicitud(sol.id, 'aprobada');
            await this.logAction('Aprobar solicitud', `${sol.nombre_empresa} + cuenta ${sol.email}`, 'solicitud', sol.id);
            await this.loadData();
            this.showToast(`Empresa y cuenta admin creadas. Credenciales: ${sol.email}`);
          } catch (e: any) {
            this.showToast(e?.message || 'Error al aprobar', 'danger');
          }
          await loading.dismiss();
          return true;
        }},
      ],
    });
    await alert.present();
  }

  async rejectSolicitud(sol: any) {
    await this.admin.updateSolicitud(sol.id, 'rechazada');
    await this.logAction('Rechazar solicitud', sol.nombre_empresa, 'solicitud', sol.id);
    await this.loadData();
    this.showToast('Solicitud rechazada');
  }

  // ---- REPORTES DE BUGS ----
  get pendingReportes(): number {
    return this.reportes.filter(r => r.estado === 'pendiente').length;
  }

  async responderReporte(r: ReporteBug) {
    const modal = await this.modalCtrl.create({ component: ResponderReporteComponent, componentProps: { reporte: r } });
    await modal.present();
    const { data, role } = await modal.onDidDismiss();
    if (role !== 'confirm' || !data) return;

    try {
      await this.admin.responderReporte(r.id, data.estado, data.respuesta, this.profile!.id);
      await this.logAction('Responder reporte', r.titulo, 'reporte_bug', r.id);
      await this.loadData();
      this.showToast('Respuesta guardada');
    } catch (e: any) { this.showToast(e?.message || 'Error', 'danger'); }
  }

  getReporteEstadoLabel(e: string) { return { pendiente: 'Pendiente', en_revision: 'En revisión', resuelto: 'Resuelto' }[e] || e; }
  getReporteEstadoColor(e: string) { return { pendiente: '#ff9800', en_revision: '#2196f3', resuelto: '#00c853' }[e] || '#9aa5b4'; }

  // ---- AVISOS DEL SISTEMA ----
  async addAviso() {
    const modal = await this.modalCtrl.create({ component: AvisoFormComponent });
    await modal.present();
    const { data, role } = await modal.onDidDismiss();
    if (role !== 'confirm' || !data) return;

    try {
      await this.admin.createAviso(this.profile!.id, data.titulo, data.mensaje, data.tipo);
      await this.logAction('Crear aviso', data.titulo, 'aviso_sistema');
      await this.loadData();
      this.showToast('Aviso publicado');
    } catch (e: any) { this.showToast(e?.message || 'Error', 'danger'); }
  }

  async toggleAviso(a: AvisoSistema) {
    try {
      await this.admin.toggleAviso(a.id, !a.activo);
      await this.loadData();
      this.showToast(a.activo ? 'Aviso desactivado' : 'Aviso activado');
    } catch (e: any) { this.showToast(e?.message || 'Error', 'danger'); }
  }

  async deleteAviso(a: AvisoSistema) {
    const alert = await this.alertCtrl.create({ cssClass: 'buxi-alert',
      header: 'Eliminar aviso', message: `¿Eliminar "${a.titulo}"?`,
      buttons: [{ text: 'Cancelar', role: 'cancel' }, { text: 'Eliminar', role: 'destructive', handler: async () => {
        await this.admin.deleteAviso(a.id); await this.loadData(); this.showToast('Aviso eliminado');
      }}],
    });
    await alert.present();
  }

  getAvisoColor(t: string) { return { info: '#2196f3', advertencia: '#ff9800', urgente: '#f44336' }[t] || '#2196f3'; }
  getAvisoIcon(t: string) { return { info: 'information-circle-outline', advertencia: 'warning-outline', urgente: 'alert-circle-outline' }[t] || 'information-circle-outline'; }

  getEmpresaPlan(empresaId: string): string {
    const sub = this.suscripcionMap.get(empresaId);
    return (sub?.plan as any)?.nombre || 'Sin plan';
  }

  getEmpresaPlanColor(empresaId: string): string {
    const name = this.getEmpresaPlan(empresaId);
    if (name === 'Enterprise') return '#ff5722';
    if (name === 'Pro') return '#9c27b0';
    if (name === 'Básico') return '#2196f3';
    return '#b0b8c4';
  }

  async changePlan(empresa: Empresa) {
    const inputs = this.planes.map(p => ({
      type: 'radio' as const,
      label: `${p.nombre} (${p.max_buses} buses, ${p.max_rutas === 9999 ? '∞' : p.max_rutas} rutas)`,
      value: p.id,
      checked: this.getEmpresaPlan(empresa.id) === p.nombre,
    }));

    const alert = await this.alertCtrl.create({ cssClass: 'buxi-alert',
      header: `Plan de ${empresa.nombre}`,
      inputs,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Asignar', handler: async (planId) => {
          if (!planId) return false;
          await this.admin.assignPlan(empresa.id, planId);
          await this.logAction('Cambiar plan', `${empresa.nombre}`, 'empresa', empresa.id);
          await this.loadData();
          this.showToast('Plan actualizado');
          return true;
        }},
      ],
    });
    await alert.present();
  }

  async updatePlanPrice(plan: Plan, newPrice: string) {
    const price = parseFloat(newPrice);
    if (isNaN(price)) return;
    await this.admin.updatePlan(plan.id, { precio_mensual: price });
    plan.precio_mensual = price;
    this.showToast('Precio actualizado');
  }

  getTabTitle(): string {
    const titles: Record<string, string> = {
      overview: 'Resumen general', mapa: 'Mapa en tiempo real',
      empresas: 'Gestión de empresas', rutas: 'Gestión de rutas',
      buses: 'Gestión de buses', usuarios: 'Gestión de usuarios',
      viajes: 'Historial de viajes', calificaciones: 'Reseñas y calificaciones',
      alertas: 'Alertas de GPS sospechoso', reportes: 'Reportes de empresas',
      solicitudes: 'Solicitudes de empresas', avisos: 'Avisos del sistema',
      logs: 'Registro de actividad', planes: 'Planes y suscripciones',
      config: 'Configuración del sistema',
    };
    return titles[this.activeTab] || '';
  }

  async updateConfigValue(item: SystemConfig, newValue: string) {
    try {
      await this.admin.updateConfig(item.key, newValue);
      item.value = newValue;
      this.showToast('Configuración actualizada');
    } catch { this.showToast('Error', 'danger'); }
  }

  getConfigLabel(key: string): string {
    const labels: Record<string, string> = {
      gps_refresh_seconds: 'Refresco GPS (segundos)',
      max_speed_kmh: 'Velocidad máxima (km/h)',
      operating_hours_start: 'Hora inicio operaciones',
      operating_hours_end: 'Hora fin operaciones',
      eta_enabled: 'ETA habilitado',
      maintenance_alert_km: 'Alerta mantenimiento (km)',
    };
    return labels[key] || key;
  }

  async onLogout() {
    await this.supabase.signOut();
    this.router.navigate(['/auth/login'], { replaceUrl: true });
  }

  async refreshData() {
    const loading = await this.loadingCtrl.create({ message: 'Actualizando...' });
    await loading.present();
    await this.loadData();
    await loading.dismiss();
  }

  private async logAction(accion: string, detalle?: string, entidad?: string, entidadId?: string) {
    try {
      await this.admin.addLog(this.profile?.id || null, accion, detalle, entidad, entidadId);
    } catch {}
  }

  private async showToast(msg: string, color = 'success') {
    const t = await this.toastCtrl.create({ message: msg, duration: 2000, color, position: 'top' });
    await t.present();
  }
}
