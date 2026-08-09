import { Component, OnInit, OnDestroy, AfterViewInit, NgZone, ViewChild, ElementRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ViewWillEnter, AlertController, ToastController } from '@ionic/angular';
import * as maplibregl from 'maplibre-gl';
import { Subscription } from 'rxjs';
import { BusTrackingService, EmpresaListItem } from '../../../core/services/bus-tracking.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { BusLocation, Ruta, Parada } from '../../../core/models/transport.model';
import { UserProfile } from '../../../core/models/user-profile.model';
import { FeaturesService } from '../../../core/services/features.service';
import { Geolocation } from '@capacitor/geolocation';
import { Capacitor } from '@capacitor/core';
import { createMap, animateMarkerTo, htmlMarkerEl, set3DEnabled, circlePolygon } from '../../../core/utils/maplibre';

// Centro aproximado de cada provincia, para abrir el mapa ya en la zona del
// usuario mientras la geolocalización (que tarda) todavía no respondió. Evita
// el salto feo de arrancar en San José y after moverse a Guanacaste.
const PROVINCIA_CENTERS: Record<string, [number, number]> = {
  'san josé': [-84.0907, 9.9281],
  'san jose': [-84.0907, 9.9281],
  alajuela: [-84.2117, 10.0162],
  cartago: [-83.9194, 9.8644],
  heredia: [-84.1165, 9.9986],
  guanacaste: [-85.4377, 10.6339],
  puntarenas: [-84.8386, 9.9763],
  limón: [-83.0333, 9.9907],
  limon: [-83.0333, 9.9907],
};

@Component({
  selector: 'app-map',
  templateUrl: './map.page.html',
  // El layout de escritorio vive aparte: junto con el móvil, la hoja superaba
  // el presupuesto de estilos por componente.
  styleUrls: ['./map.page.scss', './map.panels.scss', './map.desktop.scss'],
  standalone: false,
})
export class MapPage implements OnInit, AfterViewInit, OnDestroy, ViewWillEnter {
  private map!: maplibregl.Map;
  private mapReady = false;
  private destroyed = false;
  // Rutas dibujadas como capas GeoJSON + paradas como markers HTML.
  private routeLayerIds: string[] = [];
  private routeMarkers: maplibregl.Marker[] = [];
  private busMarkers = new Map<string, maplibregl.Marker>();
  private busLocationsMap = new Map<string, BusLocation>();
  private busLastSeen = new Map<string, number>();
  private staleCheckInterval: any = null;
  private userMarker: maplibregl.Marker | null = null;
  private userConeMarker: maplibregl.Marker | null = null;
  private gpsHeading: number | null = null;
  private compassHeading: number | null = null;
  private compassHandler?: (e: DeviceOrientationEvent) => void;
  locating = false;
  locationError: string | null = null;
  private locationSub: Subscription | null = null;
  private watchId: string | null = null;

  private readonly STALE_MS = 45000;
  private readonly REMOVE_MS = 5 * 60 * 1000;

  selectedBus: BusLocation | null = null;
  loading = true;
  userName = '';
  activeBusCount = 0;

  // ---- Chrome flotante ----
  @ViewChild('compassNeedle') compassNeedle?: ElementRef<HTMLElement>;
  navVisible = true;
  profilePanelOpen = false;
  is3D = true;
  profile: UserProfile | null = null;
  private navIdleTimer: any = null;
  private initialCenter: [number, number] = [-84.0907, 9.9281];

  // ---- Modo seguimiento ----
  followBusId: string | null = null;
  nowTs = Date.now();
  private clockInterval: any = null;

  // ---- Paneles flotantes (Rutas / Favoritos / Alertas) ----
  // Son hojas sobre el mapa en vez de pantallas aparte: el mapa nunca se
  // pierde de vista y, de paso, no hay chunk lazy que pueda fallar al navegar.
  activePanel: 'rutas' | 'favoritos' | 'alertas' | null = null;
  panelSearch = '';
  favoritoRutaIds = new Set<string>();
  favoritosLoading = false;

  get panelTitle(): string {
    switch (this.activePanel) {
      case 'rutas': return 'Rutas y empresas';
      case 'favoritos': return 'Tus favoritos';
      case 'alertas': return 'Alertas';
      default: return '';
    }
  }

  // Rutas filtradas por el buscador del panel (nombre, origen, destino o empresa).
  get panelRutas(): Ruta[] {
    const q = this.panelSearch.trim().toLowerCase();
    const base = this.activePanel === 'favoritos'
      ? this.allRutas.filter(r => this.favoritoRutaIds.has(r.id))
      : this.allRutas;
    if (!q) return base;
    return base.filter(r =>
      `${r.nombre} ${r.origen} ${r.destino} ${r.empresa?.nombre || ''}`.toLowerCase().includes(q),
    );
  }

  empresaNombre(ruta: Ruta): string {
    return ruta.empresa?.nombre || '';
  }

  // El buscador de la barra superior abre el panel de rutas con el cursor ya
  // puesto, en vez de navegar a otra pantalla. Antes mandaba a la página vieja
  // de rutas, que arrastraba consigo la barra inferior y el diseño anteriores.
  @ViewChild('panelSearchInput') panelSearchInput?: ElementRef<HTMLInputElement>;

  async openSearch(prefill = '') {
    await this.openPanel('rutas');
    this.activePanel = 'rutas';
    this.panelSearch = prefill;
    // El input recién existe tras el ciclo de render que abre el panel.
    setTimeout(() => this.panelSearchInput?.nativeElement.focus(), 120);
  }

  async openPanel(panel: 'rutas' | 'favoritos' | 'alertas') {
    this.activePanel = this.activePanel === panel ? null : panel;
    this.panelSearch = '';
    if (this.activePanel) {
      // Un solo panel a la vez: perfil y listas comparten la pantalla.
      this.profilePanelOpen = false;
      this.navVisible = true;
    }
    if (this.activePanel === 'favoritos') await this.loadFavoritos();
  }

  // "Mapa" devuelve al mapa limpio, venga de donde venga.
  showMap() {
    this.activePanel = null;
    this.profilePanelOpen = false;
    this.panelSearch = '';
  }

  closePanel() {
    this.activePanel = null;
    this.panelSearch = '';
  }

  onPanelSearch(ev: any) {
    this.panelSearch = ev?.detail?.value ?? '';
  }

  private async loadFavoritos() {
    if (!this.profile) return;
    this.favoritosLoading = true;
    try {
      const favoritos = await this.featuresService.getFavoritos(this.profile.id);
      this.favoritoRutaIds = new Set(favoritos.map(f => f.ruta_id));
    } catch {}
    this.favoritosLoading = false;
  }

  isFavorito(rutaId: string): boolean {
    return this.favoritoRutaIds.has(rutaId);
  }

  async toggleFavorito(ruta: Ruta, ev: Event) {
    // Sin esto, marcar favorito además abriría la ruta en el mapa.
    ev.stopPropagation();
    if (!this.profile) return;

    const wasFav = this.favoritoRutaIds.has(ruta.id);
    // Optimista: la estrella responde al toque sin esperar al servidor.
    if (wasFav) this.favoritoRutaIds.delete(ruta.id);
    else this.favoritoRutaIds.add(ruta.id);

    try {
      if (wasFav) await this.featuresService.removeFavorito(this.profile.id, ruta.id);
      else await this.featuresService.addFavorito(this.profile.id, ruta.id);
    } catch {
      // Revertir si el servidor rechazó, para no mentirle al usuario.
      if (wasFav) this.favoritoRutaIds.add(ruta.id);
      else this.favoritoRutaIds.delete(ruta.id);
    }
  }

  // Dibuja la ruta elegida y cierra el panel: la acción termina en el mapa,
  // no en otra lista.
  async selectRutaFromPanel(ruta: Ruta) {
    this.closePanel();
    if (!this.mapReady) return;

    this.loading = true;
    this.clearRoute(false);
    try {
      const paradas = await this.tracking.getParadas(ruta.id);
      if (paradas.length >= 2) {
        this.activeRuta = ruta;
        this.activeParadas = paradas;
        await this.drawRoute(paradas, ruta.color, ruta.geometria);
      }
      const locations = await this.tracking.getLocationsByRuta(ruta.id);
      this.activeBusCount = locations.length;
      for (const loc of locations) this.addOrUpdateBusMarker(loc);
    } catch {}
    this.loading = false;
  }

  activeRuta: Ruta | null = null;
  activeParadas: Parada[] = [];
  nearestStop: { parada: Parada; distanceKm: number } | null = null;
  etaMinutes: number | null = null;
  private userLat = 0;
  private userLng = 0;

  empresas: EmpresaListItem[] = [];
  private allRutas: Ruta[] = [];
  selectedEmpresaId: string | null = null;

  get nearbyBuses(): { placa: string; etaMinutes: number | null; distanceKm: number }[] {
    if (!this.nearestStop) return [];
    const stop = this.nearestStop.parada;
    const rows = Array.from(this.busLocationsMap.values()).map(loc => {
      const distanceKm = this.featuresService.distanceKm(loc.latitud, loc.longitud, stop.latitud, stop.longitud);
      const etaMinutes = this.featuresService.calculateETA(loc.latitud, loc.longitud, stop.latitud, stop.longitud, 20);
      return { placa: (loc.bus as any)?.placa || 'Bus', etaMinutes, distanceKm };
    });
    rows.sort((a, b) => (a.etaMinutes ?? 999) - (b.etaMinutes ?? 999));
    return rows.slice(0, 3);
  }

  // ---- Ficha del bus ----
  get selectedBusEmpresa(): string {
    return (this.selectedBus?.bus as any)?.empresa?.nombre || 'Sin empresa';
  }

  get selectedBusEstado(): string {
    const estado = (this.selectedBus?.bus as any)?.estado;
    if (estado === 'en_ruta') return 'En recorrido';
    if (estado === 'activo') return 'Activo';
    return 'Detenido';
  }

  // Distancia del bus al usuario, no a la parada: es la que el pasajero mira
  // para saber si le da tiempo de llegar.
  get selectedBusDistanceKm(): number | null {
    if (!this.selectedBus || this.userLat === 0) return null;
    return this.featuresService.distanceKm(
      this.selectedBus.latitud, this.selectedBus.longitud, this.userLat, this.userLng,
    );
  }

  get selectedBusEtaMinutes(): number | null {
    if (!this.selectedBus || this.userLat === 0) return null;
    // Si el bus va detenido, su velocidad instantánea daría ETA infinito;
    // se usa 20 km/h como promedio urbano razonable.
    const speed = this.selectedBus.velocidad > 5 ? this.selectedBus.velocidad : 20;
    return this.featuresService.calculateETA(
      this.selectedBus.latitud, this.selectedBus.longitud, this.userLat, this.userLng, speed,
    );
  }

  get selectedBusAgeText(): string {
    if (!this.selectedBus) return '';
    const seconds = Math.max(0, Math.floor((this.nowTs - Date.parse(this.selectedBus.timestamp)) / 1000));
    if (seconds < 60) return `Hace ${seconds} segundo${seconds === 1 ? '' : 's'}`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `Hace ${minutes} minuto${minutes === 1 ? '' : 's'}`;
    return `Hace ${Math.floor(minutes / 60)} h`;
  }

  get followingBus(): boolean {
    return this.followBusId !== null;
  }

  get avatarUrl(): string | null { return this.profile?.foto_url || null; }
  get displayName(): string { return this.profile?.nombre_completo || 'Invitado'; }
  get displayEmail(): string { return this.profile?.correo || ''; }

  get selectedBusPlaca(): string {
    return (this.selectedBus?.bus as any)?.placa || 'Bus';
  }

  get selectedBusSignalText(): string | null {
    if (!this.selectedBus) return null;
    const lastSeen = this.busLastSeen.get(this.selectedBus.bus_id);
    if (!lastSeen) return null;
    const minutes = Math.floor((Date.now() - lastSeen) / 60000);
    if (minutes < 1) return null;
    return `Sin señal hace ${minutes} min`;
  }

  get selectedBusRuta(): string {
    return (this.selectedBus?.bus as any)?.ruta?.nombre || 'Sin ruta asignada';
  }

  // Bus visto desde arriba, apuntando al norte (0°). El marcador se acuesta
  // sobre el plano del mapa (pitchAlignment) y gira con él (rotationAlignment),
  // así que con la cámara inclinada se lee como un vehículo sobre la calle —
  // el mismo efecto que los aviones de FlightRadar24.
  private busMarkerHtml(color: string): string {
    return `
      <div class="bus-3d">
        <svg viewBox="0 0 26 40" width="26" height="40">
          <ellipse cx="13" cy="35" rx="9" ry="3" fill="rgba(0,0,0,0.35)"/>
          <rect x="3" y="2" width="20" height="32" rx="7"
                fill="${color}" stroke="rgba(255,255,255,0.92)" stroke-width="2"/>
          <path d="M6 9 Q13 5 20 9 L20 13 Q13 10 6 13 Z" fill="rgba(255,255,255,0.85)"/>
          <rect x="6.5" y="17" width="13" height="2.6" rx="1.3" fill="rgba(255,255,255,0.35)"/>
          <rect x="6.5" y="22" width="13" height="2.6" rx="1.3" fill="rgba(255,255,255,0.35)"/>
          <rect x="9" y="29" width="8" height="2.4" rx="1.2" fill="rgba(0,0,0,0.28)"/>
        </svg>
      </div>`;
  }

  private busColor(loc: BusLocation): string {
    return (loc.bus as any)?.ruta?.color || '#00c853';
  }

  constructor(
    private tracking: BusTrackingService,
    private supabase: SupabaseService,
    private featuresService: FeaturesService,
    private router: Router,
    private route: ActivatedRoute,
    private zone: NgZone,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController,
  ) {}

  async ngOnInit() {
    try {
      const profile = await this.supabase.getProfile();
      if (profile) {
        this.profile = profile;
        this.userName = profile.nombre_completo.split(' ')[0];
        const center = PROVINCIA_CENTERS[(profile.provincia || '').trim().toLowerCase()];
        if (center) this.initialCenter = center;
      }
    } catch {}

    try {
      const [empresas, rutas] = await Promise.all([
        this.tracking.getEmpresas(),
        this.tracking.getRutas(),
      ]);
      this.empresas = empresas;
      this.allRutas = rutas;
    } catch {}
  }

  async showEmpresaRoutes(empresa: EmpresaListItem) {
    if (!this.mapReady) return;

    // Tocar la misma empresa otra vez quita sus rutas del mapa.
    if (this.selectedEmpresaId === empresa.id) {
      this.clearEmpresaRoutes();
      return;
    }

    const rutas = this.allRutas.filter(r => r.empresa_id === empresa.id);
    if (rutas.length === 0) {
      // Sin geometría que dibujar: mandamos al buscador filtrado por empresa.
      await this.openSearch(empresa.nombre);
      return;
    }

    this.loading = true;
    this.clearRoute(false);
    this.selectedEmpresaId = empresa.id;

    try {
      const allCoords: [number, number][] = [];
      for (const ruta of rutas) {
        const paradas = await this.tracking.getParadas(ruta.id);
        if (paradas.length < 2) continue;
        const coords = await this.drawRouteLayer(paradas, ruta.color, ruta.geometria);
        allCoords.push(...coords);

        const locations = await this.tracking.getLocationsByRuta(ruta.id);
        for (const loc of locations) this.addOrUpdateBusMarker(loc);
      }
      this.activeBusCount = this.busMarkers.size;

      if (allCoords.length > 0) {
        const bounds = allCoords.reduce(
          (b, coord) => b.extend(coord),
          new maplibregl.LngLatBounds(allCoords[0], allCoords[0]),
        );
        this.map.fitBounds(bounds, { padding: 60, duration: 300 });
      }
    } catch {}
    this.loading = false;
  }

  ngAfterViewInit() {
    setTimeout(() => this.initMap(), 150);
  }

  ionViewWillEnter() {
    if (!this.mapReady) return;
    const rutaId = this.route.snapshot.queryParams['ruta'] || null;

    this.clearRoute(false);

    if (rutaId) {
      this.loadRoute(rutaId);
    } else {
      this.loadBusLocations();
    }
  }

  private async initMap() {
    // MapLibre usa [lng, lat]. Arranca en la provincia del perfil; la
    // geolocalización lo afina después.
    this.map = await createMap({
      container: 'map',
      center: this.initialCenter,
      zoom: 13,
      pitch: 50,
      threeD: true,
    });
    // Si el usuario navegó fuera mientras el estilo cargaba, no operar sobre
    // un mapa huérfano (evita errores async que rompen la navegación).
    if (this.destroyed) { try { this.map.remove(); } catch {} return; }

    this.mapReady = true;

    const rutaId = this.route.snapshot.queryParams['ruta'] || null;
    if (rutaId) {
      await this.loadRoute(rutaId);
    } else {
      await this.loadBusLocations();
    }

    this.setupMapChrome();
    this.startClock();
    this.startRealtimeTracking();
    this.startUserLocation();
    this.startCompass();
    this.startStaleBusWatcher();
    this.loading = false;
  }

  // La barra inferior se esconde mientras el usuario manipula el mapa y vuelve
  // ~2s después de que suelta. Los listeners viven FUERA de la zona de Angular:
  // 'move' y 'rotate' disparan en cada frame y meterlos en la zona provocaría
  // un ciclo de detección de cambios por frame.
  private setupMapChrome() {
    this.zone.runOutsideAngular(() => {
      const hide = () => this.setNavVisible(false);
      const scheduleShow = () => {
        clearTimeout(this.navIdleTimer);
        this.navIdleTimer = setTimeout(() => this.setNavVisible(true), 2000);
      };

      for (const ev of ['movestart', 'zoomstart', 'rotatestart', 'pitchstart']) {
        this.map.on(ev as any, hide);
      }
      for (const ev of ['moveend', 'zoomend', 'rotateend', 'pitchend']) {
        this.map.on(ev as any, scheduleShow);
      }

      // La aguja de la brújula se escribe directo en el DOM por el mismo
      // motivo: gira en cada frame.
      this.map.on('rotate', () => {
        const el = this.compassNeedle?.nativeElement;
        if (el) el.style.transform = `rotate(${-this.map.getBearing()}deg)`;
      });
    });
  }

  // "Hace 3 segundos" tiene que contar de verdad. Sólo corre mientras hay una
  // ficha abierta: un tick por segundo sin nadie mirándolo es CD desperdiciada.
  private startClock() {
    this.zone.runOutsideAngular(() => {
      this.clockInterval = setInterval(() => {
        if (!this.selectedBus) return;
        this.zone.run(() => { this.nowTs = Date.now(); });
      }, 1000);
    });
  }

  private setNavVisible(visible: boolean) {
    // Con un panel abierto la barra se queda: el usuario no está explorando el
    // mapa, está navegando la app.
    if (!visible && this.profilePanelOpen) return;
    if (this.navVisible === visible) return;
    this.zone.run(() => { this.navVisible = visible; });
  }

  // ---- PANEL DE PERFIL ----
  // Todo se resuelve acá adentro: editar, preferencias, salir y borrar cuenta.
  // Antes cada ítem navegaba a la página vieja de perfil y se perdía el mapa.
  editingProfile = false;
  savingProfile = false;
  editName = '';
  editPhone = '';
  editProvincia = '';
  notificationsEnabled = true;
  darkMode = false;
  readonly provincias = [
    'San José', 'Alajuela', 'Cartago', 'Heredia', 'Guanacaste', 'Puntarenas', 'Limón',
  ];

  async toggleProfilePanel() {
    this.profilePanelOpen = !this.profilePanelOpen;
    if (this.profilePanelOpen) {
      this.activePanel = null;
      this.navVisible = true;
      this.resetProfileForm();
      await this.loadPreferences();
    } else {
      this.editingProfile = false;
    }
  }

  private resetProfileForm() {
    this.editName = this.profile?.nombre_completo || '';
    this.editPhone = this.profile?.telefono || '';
    this.editProvincia = this.profile?.provincia || '';
  }

  private async loadPreferences() {
    if (!this.profile) return;
    try {
      const prefs = await this.featuresService.getPreferences(this.profile.id);
      if (prefs) {
        this.notificationsEnabled = prefs.notifications_enabled;
        this.darkMode = prefs.dark_mode;
      }
    } catch {}
  }

  startEditProfile() {
    this.resetProfileForm();
    this.editingProfile = true;
  }

  cancelEditProfile() {
    this.editingProfile = false;
    this.resetProfileForm();
  }

  async saveProfile() {
    const nombre = this.editName.trim();
    if (nombre.length < 3) {
      await this.toast('El nombre debe tener al menos 3 caracteres', 'warning');
      return;
    }

    this.savingProfile = true;
    try {
      this.profile = await this.supabase.updateProfile({
        nombre_completo: nombre,
        telefono: this.editPhone.trim() || null,
        provincia: this.editProvincia || null,
      });
      this.userName = this.profile.nombre_completo.split(' ')[0];
      this.editingProfile = false;
      await this.toast('Perfil actualizado');
    } catch {
      await this.toast('No se pudo guardar', 'danger');
    }
    this.savingProfile = false;
  }

  async toggleNotifications() {
    this.notificationsEnabled = !this.notificationsEnabled;
    if (!this.profile) return;
    try {
      await this.featuresService.savePreferences(this.profile.id, {
        notifications_enabled: this.notificationsEnabled,
      });
    } catch {
      this.notificationsEnabled = !this.notificationsEnabled;
      await this.toast('No se pudo guardar la preferencia', 'danger');
    }
  }

  // El mapa 3D y todo el chrome ya son oscuros; este interruptor controla el
  // tema del resto de la app (páginas de auth, legales, etc.).
  async toggleDarkMode() {
    this.darkMode = !this.darkMode;
    document.body.classList.toggle('dark', this.darkMode);
    if (!this.profile) return;
    try {
      await this.featuresService.savePreferences(this.profile.id, { dark_mode: this.darkMode });
    } catch {}
  }

  openFavoritosFromProfile() {
    this.profilePanelOpen = false;
    this.openPanel('favoritos');
  }

  async confirmLogout() {
    const alert = await this.alertCtrl.create({
      cssClass: 'buxi-alert',
      header: 'Cerrar sesión',
      message: '¿Seguro que querés salir?',
      buttons: [
        { text: 'Cancelar', role: 'cancel', cssClass: 'ba-cancel' },
        {
          text: 'Cerrar sesión',
          role: 'confirm',
          cssClass: 'ba-confirm',
          handler: async () => {
            await this.supabase.signOut();
            this.router.navigate(['/auth/login'], { replaceUrl: true });
          },
        },
      ],
    });
    await alert.present();
  }

  async confirmDeleteAccount() {
    const alert = await this.alertCtrl.create({
      cssClass: 'buxi-alert',
      header: 'Eliminar cuenta',
      message: 'Esto borra tu cuenta, favoritos, calificaciones y preferencias de forma permanente. No se puede deshacer.',
      buttons: [
        { text: 'Cancelar', role: 'cancel', cssClass: 'ba-cancel' },
        {
          text: 'Eliminar',
          role: 'destructive',
          cssClass: 'ba-danger',
          handler: async () => {
            try {
              await this.supabase.deleteAccount();
              this.router.navigate(['/auth/login'], { replaceUrl: true });
            } catch (e: any) {
              await this.toast(e?.message || 'No se pudo eliminar la cuenta', 'danger');
            }
          },
        },
      ],
    });
    await alert.present();
  }

  private async toast(message: string, color = 'success') {
    const t = await this.toastCtrl.create({ message, duration: 2200, color, position: 'top' });
    await t.present();
  }

  toggle3D() {
    this.is3D = !this.is3D;
    set3DEnabled(this.map, this.is3D);
  }

  resetNorth() {
    this.map.easeTo({ bearing: 0, pitch: this.is3D ? 50 : 0, duration: 500 });
  }

  async onLogout() {
    await this.supabase.signOut();
    this.router.navigate(['/auth/login'], { replaceUrl: true });
  }

  private startStaleBusWatcher() {
    this.staleCheckInterval = setInterval(() => {
      const now = Date.now();
      this.busLastSeen.forEach((lastSeen, busId) => {
        const marker = this.busMarkers.get(busId);
        if (!marker) return;
        const age = now - lastSeen;
        if (age > this.REMOVE_MS) {
          marker.remove();
          this.busMarkers.delete(busId);
          this.busLocationsMap.delete(busId);
          this.busLastSeen.delete(busId);
          this.activeBusCount = this.busMarkers.size;
        } else if (age > this.STALE_MS) {
          marker.getElement().style.opacity = '0.35';
        }
      });
    }, 10000);
  }

  private async loadRoute(rutaId: string) {
    this.loading = true;
    try {
      const [ruta, paradas] = await Promise.all([
        this.tracking.getRuta(rutaId),
        this.tracking.getParadas(rutaId),
      ]);

      if (!ruta || paradas.length < 2) {
        this.loading = false;
        return;
      }

      this.activeRuta = ruta;
      this.activeParadas = paradas;
      await this.drawRoute(paradas, ruta.color, ruta.geometria);

      const locations = await this.tracking.getLocationsByRuta(rutaId);
      this.activeBusCount = locations.length;
      for (const loc of locations) {
        this.addOrUpdateBusMarker(loc);
      }
    } catch {}
    this.loading = false;
  }

  clearEmpresaRoutes() {
    this.clearRoute(false);
    this.loadBusLocations();
  }

  private async drawRoute(paradas: Parada[], color: string, geometria?: [number, number][] | null) {
    const coords = await this.drawRouteLayer(paradas, color, geometria);
    // Encuadrar la ruta.
    const bounds = coords.reduce(
      (b, coord) => b.extend(coord),
      new maplibregl.LngLatBounds(coords[0], coords[0]),
    );
    this.map.fitBounds(bounds, { padding: 60, duration: 0 });
  }

  // Dibuja una ruta (línea + paradas) sin encuadrar el mapa, para poder
  // dibujar varias rutas seguidas y encuadrar todas juntas al final.
  private async drawRouteLayer(paradas: Parada[], color: string, geometria?: [number, number][] | null): Promise<[number, number][]> {
    const c = color || '#00c853';
    // Coords guardadas en formato Leaflet [lat, lng]; MapLibre las quiere [lng, lat].
    const latlng: [number, number][] = geometria?.length
      ? geometria
      : await this.featuresService.fetchRoadRouteCoords(paradas);
    const coords: [number, number][] = latlng.map(([lat, lng]) => [lng, lat]);

    const srcId = `route-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this.map.addSource(srcId, {
      type: 'geojson',
      data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } },
    });
    // Halo grueso translúcido + línea principal encima.
    const bgId = `${srcId}-bg`;
    const mainId = `${srcId}-main`;
    this.map.addLayer({
      id: bgId, type: 'line', source: srcId,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': c, 'line-width': 12, 'line-opacity': 0.12 },
    });
    this.map.addLayer({
      id: mainId, type: 'line', source: srcId,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': c, 'line-width': 5, 'line-opacity': 0.9 },
    });
    this.routeLayerIds.push(bgId, mainId);

    paradas.forEach((parada, i) => {
      const isTerminal = i === 0 || i === paradas.length - 1;
      const html = isTerminal
        ? `<div class="stop-terminal" style="border-color:${c}"><div class="stop-inner" style="background:${c}"></div></div><div class="stop-label">${parada.nombre}</div>`
        : `<div class="stop-dot" style="border-color:${c}"></div>`;
      const el = htmlMarkerEl('stop-marker', html);
      const m = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([parada.longitud, parada.latitud])
        .addTo(this.map);
      this.routeMarkers.push(m);
    });

    return coords;
  }

  clearRoute(navigate = true) {
    this.routeLayerIds.forEach(id => {
      if (this.map.getLayer(id)) this.map.removeLayer(id);
    });
    // Cada par de layers comparte un source (route-<ts>); quitarlos.
    const srcIds = new Set(this.routeLayerIds.map(id => id.replace(/-bg$|-main$/, '')));
    srcIds.forEach(sid => { if (this.map.getSource(sid)) this.map.removeSource(sid); });
    this.routeLayerIds = [];

    this.routeMarkers.forEach(m => m.remove());
    this.routeMarkers = [];

    this.busMarkers.forEach(m => m.remove());
    this.busMarkers.clear();
    this.busLocationsMap.clear();
    this.busLastSeen.clear();
    this.activeBusCount = 0;
    this.selectedBus = null;
    this.followBusId = null;
    this.activeRuta = null;
    this.activeParadas = [];
    this.selectedEmpresaId = null;

    if (navigate) {
      this.router.navigate(['/passenger/map'], { replaceUrl: true, queryParams: {} });
      this.loadBusLocations();
    }
  }

  private async loadBusLocations() {
    try {
      const locations = await this.tracking.getLatestLocations();
      this.activeBusCount = locations.length;
      for (const loc of locations) {
        this.addOrUpdateBusMarker(loc);
      }
    } catch {}
  }

  private startRealtimeTracking() {
    this.locationSub = this.tracking.subscribeToLocations().subscribe((locations) => {
      this.activeBusCount = locations.size;
      locations.forEach((loc) => this.addOrUpdateBusMarker(loc));
    });
  }

  private addOrUpdateBusMarker(location: BusLocation) {
    const lngLat: [number, number] = [location.longitud, location.latitud];
    const heading = location.heading || 0;
    this.busLastSeen.set(location.bus_id, Date.parse(location.timestamp) || Date.now());
    this.busLocationsMap.set(location.bus_id, location);

    if (this.busMarkers.has(location.bus_id)) {
      const marker = this.busMarkers.get(location.bus_id)!;
      animateMarkerTo(marker, lngLat, 1000, heading);
      marker.getElement().style.opacity = '1';
    } else {
      const el = htmlMarkerEl('bus-marker', this.busMarkerHtml(this.busColor(location)));
      el.addEventListener('click', () => {
        this.zone.run(() => { this.selectedBus = this.busLocationsMap.get(location.bus_id) || location; });
      });
      const marker = new maplibregl.Marker({
        element: el,
        anchor: 'center',
        rotation: heading,
        rotationAlignment: 'map',
        pitchAlignment: 'map',
      })
        .setLngLat(lngLat)
        .addTo(this.map);
      this.busMarkers.set(location.bus_id, marker);
    }

    // La ficha abierta y el modo seguimiento tienen que reflejar el punto nuevo,
    // no el que había cuando se tocó el bus.
    if (this.selectedBus?.bus_id === location.bus_id) {
      this.selectedBus = location;
    }
    if (this.followBusId === location.bus_id) {
      this.map.easeTo({
        center: lngLat,
        bearing: heading,
        duration: 1000,
        easing: (t) => t,
      });
    }
  }

  private async startUserLocation() {
    try {
      // requestPermissions() sólo existe en nativo; en web lanza "Not
      // implemented on web" y frenaba toda la geolocalización. En el navegador
      // el permiso se pide solo al llamar getCurrentPosition().
      if (Capacitor.isNativePlatform()) {
        const permission = await Geolocation.requestPermissions();
        if (permission.location === 'denied') return;
      }
      const c = await this.acquirePosition();
      this.updateUserPosition(c.latitude, c.longitude, c.accuracy, c.heading);
      if (!this.activeRuta) {
        this.map.jumpTo({ center: [c.longitude, c.latitude], zoom: 15 });
      }
      await this.startWatching();
    } catch (e) {
      // Antes esto era un `catch {}` mudo: si la ubicación fallaba al abrir, no
      // aparecía el punto azul y nadie se enteraba de por qué. No se muestra un
      // aviso automático para no recibir al usuario con un error; queda marcado
      // el botón, y tocarlo reintenta y explica lo que pasó.
      this.locationError = this.geolocationError(e);
    }
  }

  // Son DOS marcadores en la misma coordenada, a propósito:
  //
  //  · el cono se acuesta sobre el suelo y gira con el mapa, porque ilumina una
  //    dirección del terreno;
  //  · la chapa con la persona queda siempre derecha de cara a la cámara,
  //    porque una figura humana acostada y girada no se lee a 30 px.
  //
  // Un solo marcador no puede hacer las dos cosas: la alineación es por marcador.
  private updateUserPosition(lat: number, lng: number, accuracy?: number | null, heading?: number | null) {
    this.userLat = lat;
    this.userLng = lng;

    const gpsHeading = heading !== null && heading !== undefined && !isNaN(heading)
      ? (heading as number)
      : null;
    if (gpsHeading !== null) this.gpsHeading = gpsHeading;

    if (this.userConeMarker && this.userMarker) {
      this.userConeMarker.setLngLat([lng, lat]);
      this.userMarker.setLngLat([lng, lat]);
    } else {
      const coneEl = htmlMarkerEl('user-cone-marker', `<div class="user-cone"></div>`);
      this.userConeMarker = new maplibregl.Marker({
        element: coneEl,
        anchor: 'center',
        rotationAlignment: 'map',
        pitchAlignment: 'map',
      }).setLngLat([lng, lat]).addTo(this.map);

      const el = htmlMarkerEl('user-marker', `<div class="user-pulse"></div>${this.userPuckHtml()}`);
      this.userMarker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([lng, lat])
        .addTo(this.map);
    }

    // Una lectura gruesa no debe verse tan rotunda como una de GPS: la chapa
    // se atenúa para que el punto no aparente una certeza que no tiene.
    this.userMarker.getElement().classList.toggle('coarse', !!accuracy && accuracy > 5000);

    this.applyUserHeading();
    this.updateAccuracyCircle(lng, lat, accuracy);
    this.updateETA();
  }

  // La persona va SIEMPRE dibujada como base, y la foto de perfil (si hay) se
  // superpone encima. Así, si la foto no carga —bloqueada por CSP, caída, o el
  // enlace vencido— queda el dibujo debajo en vez de una chapa vacía, que es
  // justo lo que pasaba antes.
  private userPuckHtml(): string {
    const photo = this.profile?.foto_url
      ? `<img class="up-photo" src="${this.profile.foto_url}" alt="" />`
      : '';
    return `
      <div class="user-puck">
        <svg class="up-person" viewBox="0 0 24 24" width="20" height="20" fill="none"
             stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="5" r="2.9" fill="#fff" stroke="none"/>
          <path d="M11 8.4v6"/>
          <path d="M11 14.4 8.4 20.6"/>
          <path d="M11 14.4 13.4 20.6"/>
          <path d="M11 10.4 7.4 12.8"/>
          <path d="M11 10.2 15.6 6.2"/>
        </svg>
        ${photo}
      </div>`;
  }

  // El cono apunta a donde MIRA el teléfono cuando hay brújula. Si no la hay,
  // cae al rumbo del GPS, que es la dirección en que te MOVÉS — parecido pero
  // no igual. Sin ninguno de los dos el cono no se dibuja: apuntarlo al norte
  // por defecto sería inventar información.
  private applyUserHeading() {
    const heading = this.compassHeading ?? this.gpsHeading;
    const el = this.userConeMarker?.getElement();
    if (!el) return;

    el.classList.toggle('has-heading', heading !== null);
    if (heading !== null) this.userConeMarker!.setRotation(heading);
  }

  // La brújula emite decenas de veces por segundo: se escucha fuera de la zona
  // de Angular y se escribe directo en el marcador, sin detección de cambios.
  private startCompass() {
    this.zone.runOutsideAngular(() => {
      this.compassHandler = (e: any) => {
        // iOS expone webkitCompassHeading ya referido al norte magnético.
        // En el resto, alpha es la rotación antihoraria desde el norte.
        const raw = typeof e.webkitCompassHeading === 'number'
          ? e.webkitCompassHeading
          : (e.absolute === true && typeof e.alpha === 'number' ? 360 - e.alpha : null);
        if (raw === null || isNaN(raw)) return;
        this.compassHeading = (raw + 360) % 360;
        this.applyUserHeading();
      };
      window.addEventListener('deviceorientationabsolute', this.compassHandler!, true);
      window.addEventListener('deviceorientation', this.compassHandler!, true);
    });
  }

  // iOS exige que el permiso de brújula se pida desde un gesto del usuario, así
  // que va colgado del botón "mi ubicación" en vez de dispararse solo al abrir.
  private async requestCompassPermission() {
    const anyOrientation = (window as any).DeviceOrientationEvent;
    if (anyOrientation && typeof anyOrientation.requestPermission === 'function') {
      try { await anyOrientation.requestPermission(); } catch {}
    }
  }

  // Radio de precisión como capa GeoJSON en metros reales: si el navegador
  // ubica por WiFi y erra kilómetros, el círculo lo muestra grande y honesto
  // en vez de fingir un punto exacto.
  private updateAccuracyCircle(lng: number, lat: number, accuracy?: number | null) {
    if (!this.mapReady || !accuracy || accuracy <= 0) return;

    const data = circlePolygon(lng, lat, accuracy);
    const existing = this.map.getSource('user-accuracy') as maplibregl.GeoJSONSource | undefined;

    if (existing) {
      existing.setData(data);
      return;
    }

    this.map.addSource('user-accuracy', { type: 'geojson', data });
    this.map.addLayer({
      id: 'user-accuracy-fill',
      type: 'fill',
      source: 'user-accuracy',
      paint: { 'fill-color': '#4285f4', 'fill-opacity': 0.12 },
    });
    this.map.addLayer({
      id: 'user-accuracy-line',
      type: 'line',
      source: 'user-accuracy',
      paint: { 'line-color': '#4285f4', 'line-width': 1, 'line-opacity': 0.35 },
    });
  }

  private updateETA() {
    if (this.activeParadas.length > 0 && this.userLat !== 0) {
      this.nearestStop = this.featuresService.findNearestStop(this.userLat, this.userLng, this.activeParadas);

      if (this.nearestStop && this.busMarkers.size > 0) {
        const firstBus = this.busMarkers.values().next().value;
        if (firstBus) {
          const busLngLat = firstBus.getLngLat();
          this.etaMinutes = this.featuresService.calculateETA(
            busLngLat.lat, busLngLat.lng,
            this.nearestStop.parada.latitud, this.nearestStop.parada.longitud,
            20
          );
        }
      } else {
        this.etaMinutes = null;
      }
    } else {
      this.nearestStop = null;
      this.etaMinutes = null;
    }
  }

  async centerOnUser() {
    // Aprovecha el gesto para pedir el permiso de brújula que iOS sólo concede
    // dentro de una interacción del usuario.
    await this.requestCompassPermission();

    if (this.userMarker) {
      this.map.flyTo({ center: this.userMarker.getLngLat(), zoom: 16 });
      return;
    }

    // Antes esto terminaba acá con un `if` sin `else`: si la ubicación nunca
    // había llegado, el botón no hacía NADA y no decía por qué. Ahora vuelve a
    // intentarlo y, si falla, explica el motivo.
    this.locating = true;
    try {
      const coords = await this.acquirePosition();
      this.locationError = null;
      this.updateUserPosition(coords.latitude, coords.longitude, coords.accuracy, coords.heading);
      this.map.flyTo({
        center: [coords.longitude, coords.latitude],
        zoom: this.zoomForAccuracy(coords.accuracy),
      });
      await this.warnIfCoarse(coords.accuracy);
      // Si al abrir no había señal, el seguimiento continuo tampoco arrancó.
      if (!this.watchId) this.startWatching();
    } catch (e) {
      this.locationError = this.geolocationError(e);
      await this.toast(this.locationError, 'warning');
    }
    this.locating = false;
  }

  // Acercarse a zoom 16 sobre una lectura con cientos de kilómetros de error
  // es una mentira visual: el mapa afirma una precisión de calle que no existe.
  // El zoom se elige para que el círculo de precisión ENTRE en pantalla, así
  // el encuadre mismo comunica cuánto se sabe realmente.
  private zoomForAccuracy(accuracy?: number | null): number {
    if (!accuracy || accuracy <= 0) return 16;
    if (accuracy < 50) return 16.5;
    if (accuracy < 200) return 15.5;
    if (accuracy < 1000) return 13.5;
    if (accuracy < 5000) return 11.5;
    if (accuracy < 25000) return 9;
    return 6.5;
  }

  // Umbral: por encima de 5 km la ubicación ya no sirve para saber qué bus
  // tomar, así que conviene decirlo en vez de dejar el punto donde caiga.
  private async warnIfCoarse(accuracy?: number | null) {
    if (!accuracy || accuracy <= 5000) return;
    const km = Math.round(accuracy / 1000);
    await this.toast(
      `Ubicación aproximada (± ${km} km). Sin GPS el navegador ubica por red y puede errar mucho.`,
      'warning',
    );
  }

  // Seguimiento continuo. Vive aparte porque también hay que poder arrancarlo
  // desde el botón, cuando al abrir la app no había señal todavía.
  private async startWatching() {
    if (this.watchId) return;
    this.watchId = await Geolocation.watchPosition(
      { enableHighAccuracy: true },
      (pos) => {
        if (!pos) return;
        const p = pos.coords;
        this.updateUserPosition(p.latitude, p.longitude, p.accuracy, p.heading);
      },
    ) as unknown as string;
  }

  // Dos intentos: alta precisión primero (GPS), y si expira, una lectura
  // aproximada. En escritorio no hay GPS y la alta precisión suele vencer sin
  // devolver nada, aunque la ubicación por red sí esté disponible.
  private async acquirePosition() {
    try {
      const pos = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 8000,
      });
      return pos.coords;
    } catch (highAccuracyError) {
      try {
        const pos = await Geolocation.getCurrentPosition({
          enableHighAccuracy: false,
          timeout: 12000,
          maximumAge: 60000,
        });
        return pos.coords;
      } catch {
        throw highAccuracyError;
      }
    }
  }

  private geolocationError(e: any): string {
    // isSecureContext cubre el caso de probar por IP de red local sin HTTPS,
    // donde el navegador bloquea la geolocalización sin siquiera preguntar.
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      return 'La ubicación necesita HTTPS. Abrí la app en localhost o en buxi.vercel.app.';
    }
    const code = e?.code;
    const msg = String(e?.message || '').toLowerCase();

    if (code === 1 || msg.includes('denied') || msg.includes('permission')) {
      return 'Bloqueaste la ubicación para este sitio. Habilitala en el candado de la barra de direcciones.';
    }
    if (code === 3 || msg.includes('timeout')) {
      return 'La ubicación tardó demasiado. Revisá que el GPS esté encendido y probá de nuevo.';
    }
    if (code === 2 || msg.includes('unavailable')) {
      return 'No se pudo determinar tu ubicación en este momento.';
    }
    return 'No se pudo obtener tu ubicación.';
  }

  closeBusInfo() {
    this.stopFollowing();
    this.selectedBus = null;
  }

  // ---- MODO SEGUIMIENTO ----
  // Centra el bus, lo persigue, inclina y rota la cámara hacia su rumbo, y
  // dibuja su ruta con las paradas. El seguimiento se corta solo si el usuario
  // arrastra el mapa: pelearle la cámara al dedo del usuario es lo peor que
  // puede hacer un mapa.
  async toggleFollow() {
    if (this.followBusId) { this.stopFollowing(); return; }
    if (!this.selectedBus) return;

    const bus = this.selectedBus;
    this.followBusId = bus.bus_id;

    const rutaId = (bus.bus as any)?.ruta_id || this.activeRuta?.id;
    if (rutaId && !this.activeRuta) {
      try {
        const [ruta, paradas] = await Promise.all([
          this.tracking.getRuta(rutaId),
          this.tracking.getParadas(rutaId),
        ]);
        if (ruta && paradas.length >= 2) {
          this.activeRuta = ruta;
          this.activeParadas = paradas;
          await this.drawRouteLayer(paradas, ruta.color, ruta.geometria);
        }
      } catch {}
    }

    this.map.flyTo({
      center: [bus.longitud, bus.latitud],
      zoom: 16.5,
      pitch: 60,
      bearing: bus.heading || 0,
      duration: 1200,
    });

    this.map.once('dragstart', () => this.zone.run(() => this.stopFollowing()));
  }

  stopFollowing() {
    if (!this.followBusId) return;
    this.followBusId = null;
    this.map.easeTo({ pitch: this.is3D ? 50 : 0, duration: 600 });
  }

  shareBusLocation() {
    if (!this.selectedBus) return;
    const lat = this.selectedBus.latitud;
    const lng = this.selectedBus.longitud;
    const placa = this.selectedBusPlaca;
    const ruta = this.selectedBusRuta;
    const mapUrl = `https://www.google.com/maps?q=${lat},${lng}`;
    const text = `🚌 Mi bus ${placa} (${ruta}) está aquí: ${mapUrl}`;
    const waUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(waUrl, '_blank');
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.tracking.unsubscribe();
    this.locationSub?.unsubscribe();
    if (this.navIdleTimer) clearTimeout(this.navIdleTimer);
    if (this.clockInterval) clearInterval(this.clockInterval);
    if (this.staleCheckInterval) clearInterval(this.staleCheckInterval);
    if (this.watchId) Geolocation.clearWatch({ id: this.watchId });
    if (this.compassHandler) {
      window.removeEventListener('deviceorientationabsolute', this.compassHandler, true);
      window.removeEventListener('deviceorientation', this.compassHandler, true);
    }
    if (this.map) { try { this.map.remove(); } catch {} }
  }
}
