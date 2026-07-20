import { Component, OnInit, OnDestroy, AfterViewInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ViewWillEnter } from '@ionic/angular';
import * as L from 'leaflet';
import { Subscription } from 'rxjs';
import { BusTrackingService } from '../../../core/services/bus-tracking.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { BusLocation, Ruta, Parada } from '../../../core/models/transport.model';
import { FeaturesService } from '../../../core/services/features.service';
import { Geolocation } from '@capacitor/geolocation';
import { animateMarkerTo } from '../../../core/utils/leaflet-marker-animation';

@Component({
  selector: 'app-map',
  templateUrl: './map.page.html',
  styleUrls: ['./map.page.scss'],
  standalone: false,
})
export class MapPage implements OnInit, AfterViewInit, OnDestroy, ViewWillEnter {
  private map!: L.Map;
  private mapReady = false;
  private routeLayers: L.Layer[] = [];
  private busMarkers = new Map<string, L.Marker>();
  private busLastSeen = new Map<string, number>();
  private staleCheckInterval: any = null;
  private userMarker: L.Marker | null = null;
  private locationSub: Subscription | null = null;
  private watchId: string | null = null;

  private readonly STALE_MS = 45000;
  private readonly REMOVE_MS = 5 * 60 * 1000;

  selectedBus: BusLocation | null = null;
  loading = true;
  userName = '';
  activeBusCount = 0;

  activeRuta: Ruta | null = null;
  activeParadas: Parada[] = [];
  nearestStop: { parada: Parada; distanceKm: number } | null = null;
  etaMinutes: number | null = null;
  private userLat = 0;
  private userLng = 0;

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
    private featuresService: FeaturesService,
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

    this.clearRoute(false);

    if (rutaId) {
      this.loadRoute(rutaId);
    } else {
      this.loadBusLocations();
    }
  }

  private async initMap() {
    this.map = L.map('map', {
      center: [9.9281, -84.0907],
      zoom: 14,
      zoomControl: false,
      attributionControl: false,
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd',
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      maxZoom: 20,
    }).addTo(this.map);

    this.mapReady = true;

    const rutaId = this.route.snapshot.queryParams['ruta'] || null;
    if (rutaId) {
      await this.loadRoute(rutaId);
    } else {
      await this.loadBusLocations();
    }

    this.startRealtimeTracking();
    this.startUserLocation();
    this.startStaleBusWatcher();
    this.loading = false;
  }

  private startStaleBusWatcher() {
    this.staleCheckInterval = setInterval(() => {
      const now = Date.now();
      this.busLastSeen.forEach((lastSeen, busId) => {
        const marker = this.busMarkers.get(busId);
        if (!marker) return;
        const age = now - lastSeen;
        if (age > this.REMOVE_MS) {
          this.map.removeLayer(marker);
          this.busMarkers.delete(busId);
          this.busLastSeen.delete(busId);
          this.activeBusCount = this.busMarkers.size;
        } else if (age > this.STALE_MS) {
          marker.setOpacity(0.35);
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

  private async drawRoute(paradas: Parada[], color: string, geometria?: [number, number][] | null) {
    const c = color || '#00c853';
    const coords: L.LatLngExpression[] = geometria?.length
      ? geometria
      : await this.featuresService.fetchRoadRouteCoords(paradas);

    const bg = L.polyline(coords, {
      color: c, weight: 12, opacity: 0.12, lineCap: 'round', lineJoin: 'round',
    }).addTo(this.map);
    this.routeLayers.push(bg);

    const main = L.polyline(coords, {
      color: c, weight: 5, opacity: 0.9, lineCap: 'round', lineJoin: 'round',
    }).addTo(this.map);
    this.routeLayers.push(main);

    paradas.forEach((parada, i) => {
      const isTerminal = i === 0 || i === paradas.length - 1;
      const icon = L.divIcon({
        className: 'stop-marker',
        html: isTerminal
          ? `<div class="stop-terminal" style="border-color:${c}"><div class="stop-inner" style="background:${c}"></div></div>`
          : `<div class="stop-dot" style="border-color:${c}"></div>`,
        iconSize: isTerminal ? [18, 18] : [12, 12],
        iconAnchor: isTerminal ? [9, 9] : [6, 6],
      });

      const m = L.marker([parada.latitud, parada.longitud], { icon })
        .addTo(this.map)
        .bindTooltip(parada.nombre, {
          permanent: isTerminal,
          direction: 'top',
          offset: [0, -10],
          className: 'stop-tooltip',
        });
      this.routeLayers.push(m);
    });

    this.map.fitBounds(main.getBounds(), { padding: [60, 60] });
  }

  clearRoute(navigate = true) {
    this.routeLayers.forEach(l => this.map.removeLayer(l));
    this.routeLayers = [];

    this.busMarkers.forEach(m => this.map.removeLayer(m));
    this.busMarkers.clear();
    this.busLastSeen.clear();
    this.activeBusCount = 0;
    this.selectedBus = null;
    this.activeRuta = null;
    this.activeParadas = [];

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
    const latlng: L.LatLngExpression = [location.latitud, location.longitud];
    this.busLastSeen.set(location.bus_id, Date.parse(location.timestamp) || Date.now());

    if (this.busMarkers.has(location.bus_id)) {
      const marker = this.busMarkers.get(location.bus_id)!;
      animateMarkerTo(marker, latlng);
      marker.setOpacity(1);
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
        this.map.setView([position.coords.latitude, position.coords.longitude], 15);
      }
      this.watchId = await Geolocation.watchPosition(
        { enableHighAccuracy: true },
        (pos) => { if (pos) this.updateUserPosition(pos.coords.latitude, pos.coords.longitude); }
      ) as unknown as string;
    } catch {}
  }

  private updateUserPosition(lat: number, lng: number) {
    this.userLat = lat;
    this.userLng = lng;

    if (this.userMarker) {
      this.userMarker.setLatLng([lat, lng]);
    } else {
      this.userMarker = L.marker([lat, lng], { icon: this.userIcon }).addTo(this.map);
    }

    this.updateETA();
  }

  private updateETA() {
    if (this.activeParadas.length > 0 && this.userLat !== 0) {
      this.nearestStop = this.featuresService.findNearestStop(this.userLat, this.userLng, this.activeParadas);

      if (this.nearestStop && this.busMarkers.size > 0) {
        const firstBus = this.busMarkers.values().next().value;
        if (firstBus) {
          const busLatLng = firstBus.getLatLng();
          this.etaMinutes = this.featuresService.calculateETA(
            busLatLng.lat, busLatLng.lng,
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

  centerOnUser() {
    if (this.userMarker) {
      this.map.setView(this.userMarker.getLatLng(), 16, { animate: true });
    }
  }

  closeBusInfo() { this.selectedBus = null; }

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
    this.tracking.unsubscribe();
    this.locationSub?.unsubscribe();
    if (this.staleCheckInterval) clearInterval(this.staleCheckInterval);
    if (this.watchId) Geolocation.clearWatch({ id: this.watchId });
    if (this.map) this.map.remove();
  }
}
