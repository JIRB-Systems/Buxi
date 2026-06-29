import { Component, OnInit, OnDestroy, AfterViewInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ViewWillEnter } from '@ionic/angular';
import * as L from 'leaflet';
import { Subscription } from 'rxjs';
import { BusTrackingService } from '../../../core/services/bus-tracking.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { BusLocation, Ruta, Parada } from '../../../core/models/transport.model';
import { Geolocation } from '@capacitor/geolocation';

interface RouteLayer {
  rutaId: string;
  layers: L.Layer[];
}

@Component({
  selector: 'app-map',
  templateUrl: './map.page.html',
  styleUrls: ['./map.page.scss'],
  standalone: false,
})
export class MapPage implements OnInit, AfterViewInit, OnDestroy, ViewWillEnter {
  private map!: L.Map;
  private mapReady = false;
  private allRouteLayers: RouteLayer[] = [];
  private highlightLayers: L.Layer[] = [];
  private busMarkers = new Map<string, L.Marker>();
  private userMarker: L.Marker | null = null;
  private locationSub: Subscription | null = null;
  private watchId: string | null = null;

  private allRutas: Ruta[] = [];
  private paradasByRuta = new Map<string, Parada[]>();

  selectedBus: BusLocation | null = null;
  loading = true;
  userName = '';
  activeBusCount = 0;
  totalRoutes = 0;

  activeRuta: Ruta | null = null;
  activeParadas: Parada[] = [];

  get selectedBusPlaca(): string {
    return (this.selectedBus?.bus as any)?.placa || 'Bus';
  }

  get selectedBusRuta(): string {
    return (this.selectedBus?.bus as any)?.ruta?.nombre || 'Sin ruta asignada';
  }

  get selectedBusColor(): string {
    return (this.selectedBus?.bus as any)?.ruta?.color || '#00c853';
  }

  private busIcon = L.divIcon({
    className: 'bus-marker',
    html: `<div class="bus-dot"><svg viewBox="0 0 24 24" fill="white" width="14" height="14"><path d="M4 16c0 .88.39 1.67 1 2.22V20c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h8v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1.78c.61-.55 1-1.34 1-2.22V6c0-3.5-3.58-4-8-4s-8 .5-8 4v10zm3.5 1c-.83 0-1.5-.67-1.5-1.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17zm9 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm1.5-6H6V6h12v5z"/></svg></div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });

  private userIcon = L.divIcon({
    className: 'user-marker',
    html: `<div class="user-dot"></div><div class="user-pulse"></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });

  constructor(
    private tracking: BusTrackingService,
    private supabase: SupabaseService,
    private router: Router,
    private route: ActivatedRoute,
  ) {}

  async ngOnInit() {
    try {
      const profile = await this.supabase.getProfile();
      if (profile) {
        this.userName = profile.nombre_completo.split(' ')[0];
      }
    } catch {}
  }

  ngAfterViewInit() {
    setTimeout(() => this.initMap(), 150);
  }

  ionViewWillEnter() {
    if (!this.mapReady) return;

    const rutaId = this.route.snapshot.queryParams['ruta'] || null;
    if (rutaId) {
      this.focusRoute(rutaId);
    } else if (this.activeRuta) {
      this.unfocusRoute();
    }
  }

  private async initMap() {
    this.map = L.map('map', {
      center: [9.9281, -84.0907],
      zoom: 13,
      zoomControl: false,
      attributionControl: false,
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
    }).addTo(this.map);

    this.mapReady = true;

    await this.loadAllRoutes();
    await this.loadBusLocations();

    const rutaId = this.route.snapshot.queryParams['ruta'] || null;
    if (rutaId) {
      this.focusRoute(rutaId);
    }

    this.startRealtimeTracking();
    this.startUserLocation();
    this.loading = false;
  }

  private async loadAllRoutes() {
    try {
      const [rutas, allParadas] = await Promise.all([
        this.tracking.getRutas(),
        this.tracking.getAllParadas(),
      ]);

      this.allRutas = rutas;
      this.totalRoutes = rutas.length;

      for (const p of allParadas) {
        if (!this.paradasByRuta.has(p.ruta_id)) {
          this.paradasByRuta.set(p.ruta_id, []);
        }
        this.paradasByRuta.get(p.ruta_id)!.push(p);
      }

      for (const ruta of rutas) {
        const paradas = this.paradasByRuta.get(ruta.id) || [];
        if (paradas.length < 2) continue;
        this.drawRouteBase(ruta, paradas);
      }
    } catch {}
  }

  private drawRouteBase(ruta: Ruta, paradas: Parada[]) {
    const c = ruta.color || '#00c853';
    const coords: L.LatLngExpression[] = paradas.map(p => [p.latitud, p.longitud]);
    const layers: L.Layer[] = [];

    const line = L.polyline(coords, {
      color: c, weight: 4, opacity: 0.5, lineCap: 'round', lineJoin: 'round',
    }).addTo(this.map);
    layers.push(line);

    const firstStop = paradas[0];
    const lastStop = paradas[paradas.length - 1];

    for (const stop of [firstStop, lastStop]) {
      const icon = L.divIcon({
        className: 'stop-marker',
        html: `<div class="stop-small" style="background:${c}"></div>`,
        iconSize: [8, 8],
        iconAnchor: [4, 4],
      });
      const m = L.marker([stop.latitud, stop.longitud], { icon }).addTo(this.map);
      layers.push(m);
    }

    line.on('click', () => {
      this.router.navigate(['/passenger/map'], { queryParams: { ruta: ruta.id } });
      this.focusRoute(ruta.id);
    });

    this.allRouteLayers.push({ rutaId: ruta.id, layers });
  }

  private focusRoute(rutaId: string) {
    const ruta = this.allRutas.find(r => r.id === rutaId);
    const paradas = this.paradasByRuta.get(rutaId);
    if (!ruta || !paradas || paradas.length < 2) return;

    this.activeRuta = ruta;
    this.activeParadas = paradas;

    // Atenuar todas las rutas
    this.allRouteLayers.forEach(rl => {
      rl.layers.forEach(layer => {
        if (layer instanceof L.Polyline) {
          layer.setStyle({ opacity: rl.rutaId === rutaId ? 0 : 0.15, weight: 3 });
        }
        if (layer instanceof L.Marker) {
          const el = (layer as any)._icon;
          if (el) el.style.opacity = rl.rutaId === rutaId ? '0' : '0.3';
        }
      });
    });

    this.clearHighlightLayers();
    this.drawRouteHighlight(paradas, ruta.color);

    // Cargar buses de esta ruta
    this.busMarkers.forEach(m => this.map.removeLayer(m));
    this.busMarkers.clear();
    this.tracking.getLocationsByRuta(rutaId).then(locations => {
      this.activeBusCount = locations.length;
      for (const loc of locations) {
        this.addOrUpdateBusMarker(loc);
      }
    });
  }

  private drawRouteHighlight(paradas: Parada[], color: string) {
    const c = color || '#00c853';
    const coords: L.LatLngExpression[] = paradas.map(p => [p.latitud, p.longitud]);

    const bgLine = L.polyline(coords, {
      color: c, weight: 12, opacity: 0.15, lineCap: 'round', lineJoin: 'round',
    }).addTo(this.map);
    this.highlightLayers.push(bgLine);

    const mainLine = L.polyline(coords, {
      color: c, weight: 5, opacity: 0.9, lineCap: 'round', lineJoin: 'round',
    }).addTo(this.map);
    this.highlightLayers.push(mainLine);

    paradas.forEach((parada, i) => {
      const isTerminal = i === 0 || i === paradas.length - 1;

      const stopIcon = L.divIcon({
        className: 'stop-marker',
        html: isTerminal
          ? `<div class="stop-terminal" style="border-color:${c}"><div class="stop-inner" style="background:${c}"></div></div>`
          : `<div class="stop-dot" style="border-color:${c}"></div>`,
        iconSize: isTerminal ? [18, 18] : [12, 12],
        iconAnchor: isTerminal ? [9, 9] : [6, 6],
      });

      const marker = L.marker([parada.latitud, parada.longitud], { icon: stopIcon })
        .addTo(this.map)
        .bindTooltip(parada.nombre, {
          permanent: isTerminal,
          direction: 'top',
          offset: [0, -10],
          className: 'stop-tooltip',
        });

      this.highlightLayers.push(marker);
    });

    this.map.fitBounds(mainLine.getBounds(), { padding: [60, 60] });
  }

  private clearHighlightLayers() {
    this.highlightLayers.forEach(l => this.map.removeLayer(l));
    this.highlightLayers = [];
  }

  unfocusRoute() {
    this.activeRuta = null;
    this.activeParadas = [];
    this.clearHighlightLayers();

    this.allRouteLayers.forEach(rl => {
      rl.layers.forEach(layer => {
        if (layer instanceof L.Polyline) {
          layer.setStyle({ opacity: 0.5, weight: 4 });
        }
        if (layer instanceof L.Marker) {
          const el = (layer as any)._icon;
          if (el) el.style.opacity = '1';
        }
      });
    });

    this.busMarkers.forEach(m => this.map.removeLayer(m));
    this.busMarkers.clear();

    this.router.navigate(['/passenger/map'], { replaceUrl: true, queryParams: {} });
    this.loadBusLocations();
  }

  private async loadBusLocations() {
    try {
      const locations = await this.tracking.getLatestLocations();
      const locMap = new Map<string, BusLocation>();
      for (const loc of locations) {
        locMap.set(loc.bus_id, loc);
        this.addOrUpdateBusMarker(loc);
      }
      this.activeBusCount = locMap.size;
      this.tracking['_busLocations'].next(locMap);
    } catch {}
  }

  private startRealtimeTracking() {
    this.locationSub = this.tracking.subscribeToLocations().subscribe((locations) => {
      this.activeBusCount = locations.size;
      locations.forEach((loc) => this.addOrUpdateBusMarker(loc));
    });
  }

  private addOrUpdateBusMarker(location: BusLocation) {
    const latlng: L.LatLngExpression = [location.latitud, location.longitud];
    if (this.busMarkers.has(location.bus_id)) {
      this.busMarkers.get(location.bus_id)!.setLatLng(latlng);
    } else {
      const marker = L.marker(latlng, { icon: this.busIcon })
        .addTo(this.map)
        .on('click', () => { this.selectedBus = location; });
      this.busMarkers.set(location.bus_id, marker);
    }
  }

  private async startUserLocation() {
    try {
      const permission = await Geolocation.requestPermissions();
      if (permission.location === 'denied') return;
      const position = await Geolocation.getCurrentPosition({ enableHighAccuracy: true });
      this.updateUserPosition(position.coords.latitude, position.coords.longitude);
      if (!this.activeRuta) {
        this.map.setView([position.coords.latitude, position.coords.longitude], 14);
      }
      this.watchId = await Geolocation.watchPosition(
        { enableHighAccuracy: true },
        (pos) => { if (pos) this.updateUserPosition(pos.coords.latitude, pos.coords.longitude); }
      ) as unknown as string;
    } catch {}
  }

  private updateUserPosition(lat: number, lng: number) {
    if (this.userMarker) {
      this.userMarker.setLatLng([lat, lng]);
    } else {
      this.userMarker = L.marker([lat, lng], { icon: this.userIcon }).addTo(this.map);
    }
  }

  centerOnUser() {
    if (this.userMarker) {
      this.map.setView(this.userMarker.getLatLng(), 16, { animate: true });
    }
  }

  closeBusInfo() { this.selectedBus = null; }

  ngOnDestroy() {
    this.tracking.unsubscribe();
    this.locationSub?.unsubscribe();
    if (this.watchId) Geolocation.clearWatch({ id: this.watchId });
    if (this.map) this.map.remove();
  }
}
