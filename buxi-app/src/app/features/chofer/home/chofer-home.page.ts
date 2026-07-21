import { Component, OnInit, OnDestroy, AfterViewInit } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController, ToastController } from '@ionic/angular';
import * as maplibregl from 'maplibre-gl';
import { Geolocation } from '@capacitor/geolocation';
import { Capacitor } from '@capacitor/core';
import { SupabaseService } from '../../../core/services/supabase.service';
import { FeaturesService } from '../../../core/services/features.service';
import { UserProfile } from '../../../core/models/user-profile.model';
import { Bus, Parada } from '../../../core/models/transport.model';
import { ChoferService } from '../../../core/services/chofer.service';
import { createMap, htmlMarkerEl } from '../../../core/utils/maplibre';

@Component({
  selector: 'app-chofer-home',
  templateUrl: './chofer-home.page.html',
  styleUrls: ['./chofer-home.page.scss'],
  standalone: false,
})
export class ChoferHomePage implements OnInit, AfterViewInit, OnDestroy {
  profile: UserProfile | null = null;
  assignedBus: Bus | null = null;
  tracking = false;
  loading = true;

  private map!: maplibregl.Map;
  private destroyed = false;
  private userMarker: maplibregl.Marker | null = null;
  private watchId: string | null = null;
  private currentLat = 0;
  private currentLng = 0;
  private currentSpeedKmh = 0;
  private trackingInterval: any = null;
  private rutaParadas: Parada[] = [];
  private nextParadaIndex = 1;
  private segmentStartTime = 0;

  constructor(
    private supabase: SupabaseService,
    private choferService: ChoferService,
    private features: FeaturesService,
    private router: Router,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController,
  ) {}

  async ngOnInit() {
    try {
      this.profile = await this.supabase.getProfile();
      if (this.profile) {
        this.assignedBus = await this.choferService.getAssignedBus(this.profile.id);
      }
    } catch {
    } finally {
      this.loading = false;
    }
  }

  ngAfterViewInit() {
    setTimeout(() => this.initMap(), 100);
  }

  private async initMap() {
    this.map = await createMap({
      container: 'chofer-map',
      center: [-84.0907, 9.9281],
      zoom: 15,
    });
    if (this.destroyed) { try { this.map.remove(); } catch {} return; }

    await this.startWatchingPosition();
  }

  private async startWatchingPosition() {
    try {
      if (Capacitor.isNativePlatform()) {
        await Geolocation.requestPermissions();
      }
      const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true });
      this.updatePosition(pos.coords.latitude, pos.coords.longitude, pos.coords.speed);
      this.map.jumpTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 16 });

      this.watchId = await Geolocation.watchPosition(
        { enableHighAccuracy: true },
        (position) => {
          if (position) {
            this.updatePosition(position.coords.latitude, position.coords.longitude, position.coords.speed);
          }
        }
      ) as unknown as string;
    } catch {
    }
  }

  private updatePosition(lat: number, lng: number, speedMs?: number | null) {
    this.currentLat = lat;
    this.currentLng = lng;
    this.currentSpeedKmh = speedMs && speedMs > 0 ? speedMs * 3.6 : 0;

    if (this.userMarker) {
      this.userMarker.setLngLat([lng, lat]);
    } else {
      const el = htmlMarkerEl('chofer-marker', `<div class="chofer-marker-inner"><ion-icon name="bus"></ion-icon></div>`);
      this.userMarker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([lng, lat])
        .addTo(this.map);
    }
  }

  async toggleTracking() {
    if (!this.assignedBus) {
      const toast = await this.toastCtrl.create({
        message: 'No tienes un bus asignado. Contacta a tu empresa.',
        duration: 3000,
        color: 'warning',
        position: 'top',
      });
      await toast.present();
      return;
    }

    if (this.tracking) {
      await this.stopTracking();
    } else {
      await this.startTracking();
    }
  }

  private async startTracking() {
    this.tracking = true;

    await this.choferService.updateBusStatus(this.assignedBus!.id, 'en_ruta');

    if (this.profile && this.assignedBus!.ruta_id) {
      await this.choferService.startViaje(this.assignedBus!.id, this.profile.id, this.assignedBus!.ruta_id);
      try {
        this.rutaParadas = await this.choferService.getParadasOrdenadas(this.assignedBus!.ruta_id);
      } catch { this.rutaParadas = []; }
    }
    this.nextParadaIndex = 1;
    this.segmentStartTime = Date.now();

    await this.sendLocation();
    this.trackingInterval = setInterval(() => this.sendLocation(), 5000);

    const toast = await this.toastCtrl.create({
      message: 'Viaje iniciado — transmitiendo ubicación',
      duration: 2000,
      color: 'success',
      position: 'top',
    });
    await toast.present();
  }

  private async stopTracking() {
    this.tracking = false;

    if (this.trackingInterval) {
      clearInterval(this.trackingInterval);
      this.trackingInterval = null;
    }

    await this.choferService.updateBusStatus(this.assignedBus!.id, 'activo');
    await this.choferService.endViaje();
    this.rutaParadas = [];
    this.nextParadaIndex = 1;

    const toast = await this.toastCtrl.create({
      message: 'Viaje completado',
      duration: 2000,
      color: 'medium',
      position: 'top',
    });
    await toast.present();
  }

  private async sendLocation() {
    if (!this.assignedBus || this.currentLat === 0) return;

    try {
      await this.choferService.sendLocation(
        this.assignedBus.id,
        this.currentLat,
        this.currentLng,
        this.currentSpeedKmh,
      );
    } catch {
    }

    this.checkSegmentProgress();
  }

  private checkSegmentProgress() {
    if (this.rutaParadas.length < 2 || this.nextParadaIndex >= this.rutaParadas.length) return;

    const target = this.rutaParadas[this.nextParadaIndex];
    const distKm = this.features.distanceKm(this.currentLat, this.currentLng, target.latitud, target.longitud);
    if (distKm > 0.06) return;

    const origen = this.rutaParadas[this.nextParadaIndex - 1];
    const duracionSegundos = (Date.now() - this.segmentStartTime) / 1000;
    this.choferService
      .logTramo(this.assignedBus!.ruta_id!, this.assignedBus!.id, origen.id, target.id, duracionSegundos)
      .catch(() => {});

    this.segmentStartTime = Date.now();
    this.nextParadaIndex++;
  }

  centerOnMe() {
    if (this.currentLat && this.currentLng) {
      this.map.flyTo({ center: [this.currentLng, this.currentLat], zoom: 16 });
    }
  }

  async onLogout() {
    if (this.tracking) {
      await this.stopTracking();
    }

    const alert = await this.alertCtrl.create({
      header: 'Cerrar sesión',
      message: '¿Estás seguro?',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Cerrar sesión',
          role: 'confirm',
          handler: async () => {
            await this.supabase.signOut();
            this.router.navigate(['/auth/login'], { replaceUrl: true });
          },
        },
      ],
    });
    await alert.present();
  }

  ngOnDestroy() {
    this.destroyed = true;
    if (this.tracking) {
      clearInterval(this.trackingInterval);
    }
    if (this.watchId) {
      Geolocation.clearWatch({ id: this.watchId });
    }
    if (this.map) {
      try { this.map.remove(); } catch {}
    }
  }
}
