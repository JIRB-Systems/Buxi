import { Component, OnInit, OnDestroy, AfterViewInit } from '@angular/core';
import { Router } from '@angular/router';
import * as L from 'leaflet';
import { Subscription } from 'rxjs';
import { BusTrackingService } from '../../../core/services/bus-tracking.service';
import { BusLocation } from '../../../core/models/transport.model';
import { Geolocation } from '@capacitor/geolocation';
import { AlertController, Platform } from '@ionic/angular';

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
  private locationSub: Subscription | null = null;
  private watchId: string | null = null;

  selectedBus: BusLocation | null = null;
  loading = true;

  get selectedBusPlaca(): string {
    return (this.selectedBus?.bus as any)?.placa || 'Bus';
  }

  get selectedBusRuta(): string {
    return (this.selectedBus?.bus as any)?.ruta?.nombre || 'Sin ruta asignada';
  }

  private busIcon = L.divIcon({
    className: 'bus-marker',
    html: `<div class="bus-marker-inner"><ion-icon name="bus"></ion-icon></div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });

  private userIcon = L.divIcon({
    className: 'user-marker',
    html: `<div class="user-marker-inner"></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });

  constructor(
    private tracking: BusTrackingService,
    private router: Router,
    private alertCtrl: AlertController,
    private platform: Platform,
  ) {}

  ngOnInit() {}

  ngAfterViewInit() {
    setTimeout(() => this.initMap(), 100);
  }

  private async initMap() {
    // Centro en San José, Costa Rica
    this.map = L.map('map', {
      center: [9.9281, -84.0907],
      zoom: 13,
      zoomControl: false,
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(this.map);

    L.control.zoom({ position: 'bottomright' }).addTo(this.map);

    await this.loadBusLocations();
    this.startRealtimeTracking();
    this.startUserLocation();

    this.loading = false;
  }

  private async loadBusLocations() {
    try {
      const locations = await this.tracking.getLatestLocations();
      const locMap = new Map<string, BusLocation>();
      for (const loc of locations) {
        locMap.set(loc.bus_id, loc);
        this.addOrUpdateBusMarker(loc);
      }
      this.tracking['_busLocations'].next(locMap);
    } catch {
      // No buses yet — that's ok
    }
  }

  private startRealtimeTracking() {
    this.locationSub = this.tracking.subscribeToLocations().subscribe((locations) => {
      locations.forEach((loc, busId) => {
        this.addOrUpdateBusMarker(loc);
      });
    });
  }

  private addOrUpdateBusMarker(location: BusLocation) {
    const latlng: L.LatLngExpression = [location.latitud, location.longitud];

    if (this.busMarkers.has(location.bus_id)) {
      this.busMarkers.get(location.bus_id)!.setLatLng(latlng);
    } else {
      const marker = L.marker(latlng, { icon: this.busIcon })
        .addTo(this.map)
        .on('click', () => {
          this.selectedBus = location;
        });
      this.busMarkers.set(location.bus_id, marker);
    }
  }

  private async startUserLocation() {
    try {
      const permission = await Geolocation.requestPermissions();
      if (permission.location === 'denied') return;

      const position = await Geolocation.getCurrentPosition({ enableHighAccuracy: true });
      this.updateUserPosition(position.coords.latitude, position.coords.longitude);
      this.map.setView([position.coords.latitude, position.coords.longitude], 15);

      this.watchId = await Geolocation.watchPosition(
        { enableHighAccuracy: true },
        (pos) => {
          if (pos) {
            this.updateUserPosition(pos.coords.latitude, pos.coords.longitude);
          }
        }
      ) as unknown as string;
    } catch {
      // Geolocation not available in browser — use default center
    }
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

  closeBusInfo() {
    this.selectedBus = null;
  }

  goHome() {
    this.router.navigate(['/passenger/home']);
  }

  ngOnDestroy() {
    this.tracking.unsubscribe();
    this.locationSub?.unsubscribe();
    if (this.watchId) {
      Geolocation.clearWatch({ id: this.watchId });
    }
    if (this.map) {
      this.map.remove();
    }
  }
}
