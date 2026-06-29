import { Component, OnInit, OnDestroy, AfterViewInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import * as L from 'leaflet';
import { Subscription } from 'rxjs';
import { BusTrackingService } from '../../../core/services/bus-tracking.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { BusLocation, Ruta, Parada } from '../../../core/models/transport.model';
import { Geolocation } from '@capacitor/geolocation';
import { Platform } from '@ionic/angular';

@Component({
  selector: 'app-map',
  templateUrl: './map.page.html',
  styleUrls: ['./map.page.scss'],
  standalone: false,
})
export class MapPage implements OnInit, AfterViewInit, OnDestroy {
  private map!: L.Map;
  private busMarkers = new Map<string, L.Marker>();
  private userMarker: L.Marker | null = null;
  private routePolyline: L.Polyline | null = null;
  private stopMarkers: L.Marker[] = [];
  private locationSub: Subscription | null = null;
  private watchId: string | null = null;

  selectedBus: BusLocation | null = null;
  loading = true;
  userName = '';
  activeBusCount = 0;

  activeRuta: Ruta | null = null;
  activeParadas: Parada[] = [];
  private routeId: string | null = null;

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
    private platform: Platform,
  ) {}

  async ngOnInit() {
    this.route.queryParams.subscribe(params => {
      this.routeId = params['ruta'] || null;
    });

    try {
      const profile = await this.supabase.getProfile();
      if (profile) {
        this.userName = profile.nombre_completo.split(' ')[0];
      }
    } catch {}
  }

  ngAfterViewInit() {
    setTimeout(() => this.initMap(), 100);
  }

  private async initMap() {
    this.map = L.map('map', {
      center: [9.9281, -84.0907],
      zoom: 14,
      zoomControl: false,
      attributionControl: false,
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
    }).addTo(this.map);

    if (this.routeId) {
      await this.loadRoute(this.routeId);
    } else {
      await this.loadBusLocations();
    }

    this.startRealtimeTracking();
    this.startUserLocation();
    this.loading = false;
  }

  private async loadRoute(rutaId: string) {
    try {
      const [ruta, paradas] = await Promise.all([
        this.tracking.getRuta(rutaId),
        this.tracking.getParadas(rutaId),
      ]);

      if (!ruta || paradas.length === 0) return;

      this.activeRuta = ruta;
      this.activeParadas = paradas;

      this.drawRoute(paradas, ruta.color);

      const locations = await this.tracking.getLocationsByRuta(rutaId);
      const locMap = new Map<string, BusLocation>();
      for (const loc of locations) {
        locMap.set(loc.bus_id, loc);
        this.addOrUpdateBusMarker(loc);
      }
      this.activeBusCount = locMap.size;
      this.tracking['_busLocations'].next(locMap);
    } catch {}
  }

  private drawRoute(paradas: Parada[], color: string) {
    const coords: L.LatLngExpression[] = paradas.map(p => [p.latitud, p.longitud]);

    this.routePolyline = L.polyline(coords, {
      color: color || '#00c853',
      weight: 5,
      opacity: 0.7,
      lineCap: 'round',
      lineJoin: 'round',
      dashArray: '0',
    }).addTo(this.map);

    // Línea de fondo más gruesa para efecto de contorno
    L.polyline(coords, {
      color: color || '#00c853',
      weight: 10,
      opacity: 0.15,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(this.map);

    paradas.forEach((parada, i) => {
      const isTerminal = i === 0 || i === paradas.length - 1;

      const stopIcon = L.divIcon({
        className: 'stop-marker',
        html: isTerminal
          ? `<div class="stop-terminal" style="border-color:${color}"><div class="stop-inner" style="background:${color}"></div></div>`
          : `<div class="stop-dot" style="border-color:${color}"></div>`,
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

      this.stopMarkers.push(marker);
    });

    this.map.fitBounds(this.routePolyline.getBounds(), { padding: [60, 40] });
  }

  clearRoute() {
    this.activeRuta = null;
    this.activeParadas = [];
    this.routeId = null;

    if (this.routePolyline) {
      this.map.removeLayer(this.routePolyline);
      this.routePolyline = null;
    }

    this.stopMarkers.forEach(m => this.map.removeLayer(m));
    this.stopMarkers = [];

    this.busMarkers.forEach(m => this.map.removeLayer(m));
    this.busMarkers.clear();

    this.router.navigate(['/passenger/map'], { replaceUrl: true });

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
      if (!this.routeId) {
        this.map.setView([position.coords.latitude, position.coords.longitude], 15);
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
