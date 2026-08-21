import { Component, ElementRef, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController, ToastController } from '@ionic/angular';
import * as maplibregl from 'maplibre-gl';
import { Geolocation } from '@capacitor/geolocation';
import { Capacitor } from '@capacitor/core';
import { SupabaseService } from '../../../core/services/supabase.service';
import { FeaturesService } from '../../../core/services/features.service';
import { UserProfile } from '../../../core/models/user-profile.model';
import { Bus, Parada } from '../../../core/models/transport.model';
import { Viaje, Calificacion, MensajeChofer } from '../../../core/models/features.model';
import { ChoferService } from '../../../core/services/chofer.service';
import { createMap, set3DEnabled, distanceToPolylineMeters } from '../../../core/utils/maplibre';

@Component({
  selector: 'app-chofer-home',
  templateUrl: './chofer-home.page.html',
  styleUrls: ['./chofer-home.page.scss'],
  standalone: false,
})
export class ChoferHomePage implements OnInit, OnDestroy {
  profile: UserProfile | null = null;
  assignedBus: Bus | null = null;
  // Lo que se muestra donde iria la placa cuando no hay bus. Es un campo y no
  // un texto fijo porque "sin bus" y "fallo la carga" se veian identicos.
  sinBusTexto = 'Sin bus asignado';
  tracking = false;
  loading = true;

  is3D = true;
  profilePanelOpen = false;
  editingProfile = false;
  editName = '';
  editPhone = '';
  savingProfile = false;

  // ---- Próxima parada, pausa, alerta de velocidad ----
  nextParada: Parada | null = null;
  nextParadaDistanceKm: number | null = null;
  paused = false;
  speedWarning = false;
  private maxSpeedKmh = 80;
  private displayParadaIndex = 1;

  // ---- Historial de viajes ----
  historialOpen = false;
  loadingHistorial = false;
  viajesHistorial: Viaje[] = [];

  // ---- Desvío de ruta ----
  offRoute = false;
  private routeCoords: [number, number][] = [];

  // ---- Botón de pánico ----
  sendingPanic = false;

  // ---- Resumen de viaje ----
  private tripStartTime = 0;
  private tripDistanceKm = 0;
  private lastTripLat = 0;
  private lastTripLng = 0;

  // ---- Mis calificaciones ----
  calificacionesOpen = false;
  loadingCalificaciones = false;
  misCalificaciones: Calificacion[] = [];
  calificacionPromedio: number | null = null;

  // ---- Escáner de boletos (QR) ----
  scannerOpen = false;
  scanResult: { ok: boolean; motivo?: string; nombre?: string; ruta?: string } | null = null;
  validandoBoleto = false;
  boletosEscaneados = 0;
  private qrScanner: any = null;

  // ---- Mensajes de la empresa ----
  mensajesOpen = false;
  loadingMensajes = false;
  misMensajes: MensajeChofer[] = [];
  mensajesNoLeidos = 0;

  private map!: maplibregl.Map;
  private mapStarted = false;
  private destroyed = false;
  // Posición propia y paradas dibujadas como capas nativas (circle/symbol),
  // no maplibregl.Marker: con terreno 3D activo (pitch:50), Marker consulta
  // la elevación del terreno para ubicarse y esa consulta de MapLibre trae un
  // bug conocido (github.com/maplibre/maplibre-gl-js/issues/6701) que devuelve
  // valores erróneos — el ícono aparecía centenares de píxeles fuera de su
  // posición real, típicamente lejos de la terminal. Mismo fix ya aplicado a
  // las paradas y emergencias del mapa de empresa.
  private readonly USER_SRC = 'chofer-self';
  private readonly USER_LAYER = 'chofer-self-icon';
  private readonly PARADAS_SRC = 'chofer-paradas';
  private readonly PARADAS_CIRCLE_LAYER = 'chofer-paradas-circle';
  private readonly PARADAS_LABEL_LAYER = 'chofer-paradas-label';
  private busIconReady = false;
  private watchId: string | null = null;
  private currentLat = 0;
  private currentLng = 0;
  private currentSpeedKmh = 0;
  private currentHeading = 0;
  private lastLat = 0;
  private lastLng = 0;
  private trackingInterval: any = null;
  private rutaParadas: Parada[] = [];
  private paradasReady: Promise<void> = Promise.resolve();
  private nextParadaIndex = 1;
  private segmentStartTime = 0;

  constructor(
    private supabase: SupabaseService,
    private choferService: ChoferService,
    private features: FeaturesService,
    private router: Router,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController,
    private elRef: ElementRef<HTMLElement>,
  ) {}

  async ngOnInit() {
    try {
      this.profile = await this.supabase.getProfile();
      if (this.profile) {
        this.assignedBus = await this.choferService.getAssignedBus(this.profile.id);
        if (this.assignedBus?.ruta_id) {
          this.paradasReady = this.loadRutaParadas(this.assignedBus.ruta_id);
        }
        await this.checkAssignmentChanged();
        this.refreshMensajesNoLeidos();
      }
      this.choferService.getMaxSpeedKmh().then(v => this.maxSpeedKmh = v).catch(() => {});
    } catch (e: any) {
      // Este catch estaba vacio, asi que cualquier fallo -- red caida, RLS, o
      // el error de PostgREST cuando un chofer quedo asignado a dos buses
      // (getAssignedBus usa maybeSingle, que falla con mas de una fila y nada
      // en el esquema impide la doble asignacion) -- terminaba en la misma
      // pantalla de "Sin bus asignado". El chofer no podia salir de ahi ni
      // saber por que.
      this.sinBusTexto = 'Error al cargar';
      const toast = await this.toastCtrl.create({
        message: `No se pudo cargar tu asignacion: ${e?.message || 'error desconocido'}`,
        duration: 6000,
        color: 'danger',
        position: 'top',
      });
      await toast.present();
    } finally {
      this.loading = false;
    }
  }

  // No es una notificación push real (eso necesita un backend disparando a
  // dispositivos, fuera de alcance acá) — es un aviso al abrir la app si el
  // bus/ruta asignado cambió desde la última vez que la abrió este chofer.
  private async checkAssignmentChanged() {
    if (!this.profile) return;
    const key = `buxi-chofer-last-bus-${this.profile.id}`;
    const firma = this.assignedBus ? `${this.assignedBus.id}:${this.assignedBus.ruta_id || ''}` : '';
    const anterior = localStorage.getItem(key);

    if (anterior !== null && anterior !== firma && this.assignedBus) {
      const toast = await this.toastCtrl.create({
        message: `Te asignaron: ${this.assignedBus.placa} · ${this.assignedBus.ruta?.nombre || 'Sin ruta'}`,
        duration: 4500,
        color: 'success',
        position: 'top',
      });
      await toast.present();
    }
    localStorage.setItem(key, firma);
  }

  // Cargar las paradas apenas se conoce la ruta asignada, no solo al arrancar
  // a transmitir: así "próxima parada" y el trazado en el mapa funcionan
  // incluso antes de que el chofer toque "Iniciar ruta".
  private async loadRutaParadas(rutaId: string) {
    try {
      this.rutaParadas = await this.choferService.getParadasOrdenadas(rutaId);
      this.displayParadaIndex = 1;
    } catch {
      this.rutaParadas = [];
    }
  }

  // El mapa se crea cuando Ionic confirma que la pagina TERMINO de entrar, no
  // a los 100 ms a ojo desde ngAfterViewInit. Creandolo a mitad de la
  // transicion, el canvas WebGL nacia mientras la pagina todavia se movia y el
  // topbar quedaba en el DOM, con tamano correcto, pero sin pintar -- hasta
  // que algo forzara un repintado (recargar la pagina, o abrir DevTools).
  // Se veia sobre todo al entrar desde el login, que es cuando hay transicion.
  // El mapa del pasajero no lo sufre por casualidad: su initMap() espera a
  // profileReady, asi que su canvas nace despues de que la transicion termino.
  ionViewDidEnter() {
    this.fixContentOffset();
    if (this.mapStarted) {
      // Al volver a la pantalla el contenedor pudo cambiar de tamano.
      this.map?.resize();
      return;
    }
    this.mapStarted = true;
    this.initMap().catch(() => {});
  }

  // Ionic calcula --offset-top a partir de un ion-header que esta pagina
  // nunca tiene, pero tras la transicion de pagina desde /auth/login esa
  // cuenta queda pegada en la altura completa del viewport (bug propio de
  // Ionic, no de esta app) -- duplicando el alto real de .inner-scroll y
  // corriendo todo el contenido, mapa incluido, una pantalla entera hacia
  // arriba. Ionic lo fija via inline style (mayor especificidad que
  // cualquier regla nuestra en el SCSS del componente), asi que hay que
  // pisarlo igual, por JS, despues de que el.
  private fixContentOffset() {
    const ic = this.elRef.nativeElement.querySelector('ion-content') as HTMLElement | null;
    if (!ic) return;
    ic.style.setProperty('--offset-top', '0px');
    ic.style.setProperty('--offset-bottom', '0px');
  }

  private async initMap() {
    this.map = await createMap({
      container: 'chofer-map',
      center: [-84.0907, 9.9281],
      zoom: 15,
      pitch: 50,
      threeD: true,
      style: 'streets-v2-dark',
    });
    if (this.destroyed) { try { this.map.remove(); } catch {} return; }

    this.ensureBusIcon();
    await this.startWatchingPosition();

    await this.paradasReady;
    if (!this.destroyed && this.rutaParadas.length >= 2) {
      this.drawAssignedRoute();
    }
  }

  // Traza la ruta asignada (línea + paradas) apenas se conoce, igual que ve
  // el pasajero — antes el chofer solo veía su propio punto sin contexto de
  // por dónde va el recorrido.
  private drawAssignedRoute() {
    const color = this.assignedBus?.ruta?.color || '#00c853';
    const geometria = this.assignedBus?.ruta?.geometria as [number, number][] | null | undefined;
    const coords: [number, number][] = geometria?.length
      ? geometria.map(([lat, lng]) => [lng, lat] as [number, number])
      : this.rutaParadas.map(p => [p.longitud, p.latitud] as [number, number]);
    this.routeCoords = coords;

    this.map.addSource('chofer-route', {
      type: 'geojson',
      data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } },
    });
    this.map.addLayer({
      id: 'chofer-route-bg', type: 'line', source: 'chofer-route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': color, 'line-width': 12, 'line-opacity': 0.12 },
    });
    this.map.addLayer({
      id: 'chofer-route-main', type: 'line', source: 'chofer-route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': color, 'line-width': 5, 'line-opacity': 0.9 },
    });

    const features = this.rutaParadas.map((parada, i) => ({
      type: 'Feature' as const,
      properties: { color, isTerminal: i === 0 || i === this.rutaParadas.length - 1, nombre: parada.nombre },
      geometry: { type: 'Point' as const, coordinates: [parada.longitud, parada.latitud] },
    }));
    this.map.addSource(this.PARADAS_SRC, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features },
    });
    this.map.addLayer({
      id: this.PARADAS_CIRCLE_LAYER, type: 'circle', source: this.PARADAS_SRC,
      paint: {
        'circle-radius': ['case', ['get', 'isTerminal'], 8, 4.5],
        'circle-color': ['get', 'color'],
        'circle-stroke-width': ['case', ['get', 'isTerminal'], 2, 1.5],
        'circle-stroke-color': '#ffffff',
        'circle-pitch-alignment': 'viewport',
      },
    });
    this.map.addLayer({
      id: this.PARADAS_LABEL_LAYER, type: 'symbol', source: this.PARADAS_SRC,
      filter: ['==', ['get', 'isTerminal'], true],
      layout: {
        'text-field': ['get', 'nombre'],
        'text-size': 11,
        'text-offset': [0, 1.6],
        'text-anchor': 'top',
        'text-allow-overlap': false,
        'text-pitch-alignment': 'viewport',
      },
      paint: {
        'text-color': '#ffffff',
        'text-halo-color': 'rgba(10, 22, 40, 0.95)',
        'text-halo-width': 1.5,
      },
    });

    // Las paradas se dibujan después de que el ícono propio ya pudo existir
    // (llega con el primer fix de GPS, que corre antes de esperar las
    // paradas). Sin este reorden, la parada terminal tapaba el bus cuando
    // coinciden en el mismo punto -- típicamente arrancando el viaje.
    if (this.map.getLayer(this.USER_LAYER)) {
      this.map.moveLayer(this.USER_LAYER);
    }
  }

  // Ícono del propio bus dibujado sobre un canvas y cargado como imagen del
  // mapa, para poder usarlo en una capa `symbol` nativa (ver comentario en
  // USER_SRC más arriba). Se genera una sola vez por instancia de mapa.
  private ensureBusIcon() {
    if (this.busIconReady || this.map.hasImage('chofer-bus-icon')) { this.busIconReady = true; return; }
    const size = 96;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 6, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(10, 22, 40, 0.95)';
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#00c853';
    ctx.stroke();
    ctx.fillStyle = '#00e676';
    ctx.font = `${Math.round(size * 0.5)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🚌', size / 2, size / 2 + 2);
    this.map.addImage('chofer-bus-icon', ctx.getImageData(0, 0, size, size), { pixelRatio: 2 });
    this.busIconReady = true;
  }

  private updateUserMarkerLayer(lng: number, lat: number) {
    const geojson = { type: 'Feature' as const, properties: {}, geometry: { type: 'Point' as const, coordinates: [lng, lat] } };
    const src = this.map.getSource(this.USER_SRC) as maplibregl.GeoJSONSource | undefined;
    if (src) {
      src.setData(geojson as any);
      return;
    }
    this.map.addSource(this.USER_SRC, { type: 'geojson', data: geojson as any });
    this.map.addLayer({
      id: this.USER_LAYER, type: 'symbol', source: this.USER_SRC,
      layout: {
        'icon-image': 'chofer-bus-icon',
        'icon-size': 0.5,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-pitch-alignment': 'viewport',
        'icon-rotation-alignment': 'viewport',
      },
    });
  }

  private async startWatchingPosition() {
    try {
      if (Capacitor.isNativePlatform()) {
        await Geolocation.requestPermissions();
      }
      const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true });
      this.updatePosition(pos.coords.latitude, pos.coords.longitude, pos.coords.speed, pos.coords.heading);
      this.map.jumpTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 16 });

      this.watchId = await Geolocation.watchPosition(
        { enableHighAccuracy: true },
        (position) => {
          if (position) {
            this.updatePosition(
              position.coords.latitude,
              position.coords.longitude,
              position.coords.speed,
              position.coords.heading,
            );
          }
        }
      ) as unknown as string;
    } catch {
    }
  }

  private updatePosition(lat: number, lng: number, speedMs?: number | null, headingDeg?: number | null) {
    // El rumbo del bus es lo que orienta su ícono en el mapa del pasajero.
    // `coords.heading` sólo llega en dispositivos con brújula y en movimiento;
    // cuando falta, se deduce del desplazamiento desde el punto anterior. Sin
    // esto todos los buses apuntarían al norte para siempre.
    if (headingDeg !== null && headingDeg !== undefined && !isNaN(headingDeg)) {
      this.currentHeading = headingDeg;
    } else if (this.lastLat !== 0 || this.lastLng !== 0) {
      // Menos de ~5 m es ruido de GPS estando quieto: el rumbo calculado sería
      // aleatorio y haría girar el bus sobre sí mismo. Se conserva el último.
      if (this.features.distanceKm(this.lastLat, this.lastLng, lat, lng) > 0.005) {
        this.currentHeading = this.features.bearingDeg(this.lastLat, this.lastLng, lat, lng);
      }
    }
    this.lastLat = lat;
    this.lastLng = lng;

    this.currentLat = lat;
    this.currentLng = lng;
    this.currentSpeedKmh = speedMs && speedMs > 0 ? speedMs * 3.6 : 0;
    // Solo molesta mientras el chofer está de verdad en ruta y no en pausa
    // — de otro modo alertaría yendo a arrancar el turno o en un semáforo.
    this.speedWarning = this.tracking && !this.paused && this.currentSpeedKmh > this.maxSpeedKmh;

    // Desvío de ruta: misma distancia punto-a-polilínea que usa el mapa de
    // JIRB para marcar buses fuera de su trazado, pero mostrada acá para que
    // el propio chofer se entere en el momento, no solo JIRB después.
    if (this.tracking && !this.paused && this.routeCoords.length >= 2) {
      const metros = distanceToPolylineMeters(lng, lat, this.routeCoords);
      this.offRoute = metros > 150;
    } else {
      this.offRoute = false;
    }

    // Distancia recorrida del viaje activo, para el resumen al terminar.
    if (this.tracking && !this.paused) {
      if (this.lastTripLat !== 0 || this.lastTripLng !== 0) {
        this.tripDistanceKm += this.features.distanceKm(this.lastTripLat, this.lastTripLng, lat, lng);
      }
      this.lastTripLat = lat;
      this.lastTripLng = lng;
    }

    this.updateUserMarkerLayer(lng, lat);

    this.updateNextParadaProgress();
  }

  // "Próxima parada" siempre activo (no solo mientras transmite): recorre
  // las paradas en orden y avanza el índice cuando ya se pasó por la
  // siguiente, igual idea que checkSegmentProgress pero para mostrar en
  // pantalla en vez de para el historial de tramos.
  private updateNextParadaProgress() {
    if (this.rutaParadas.length < 2 || this.displayParadaIndex >= this.rutaParadas.length) {
      this.nextParada = null;
      this.nextParadaDistanceKm = null;
      return;
    }
    const target = this.rutaParadas[this.displayParadaIndex];
    const distKm = this.features.distanceKm(this.currentLat, this.currentLng, target.latitud, target.longitud);
    this.nextParada = target;
    this.nextParadaDistanceKm = distKm;
    if (distKm < 0.06) this.displayParadaIndex++;
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
      await this.showChecklistThenStart();
    }
  }

  // Checklist rápido antes de salir. Ionic sí soporta varios checkbox en un
  // mismo alert (el bug de labels invisibles es específico de mezclar radio
  // con texto, no de checkbox), así que esto no necesita encadenar alerts.
  private async showChecklistThenStart() {
    const alert = await this.alertCtrl.create({
      cssClass: 'buxi-alert',
      header: 'Antes de salir',
      message: 'Confirmá que revisaste el bus.',
      inputs: [
        { name: 'items', type: 'checkbox', label: 'Frenos', value: 'frenos' },
        { name: 'items', type: 'checkbox', label: 'Luces', value: 'luces' },
        { name: 'items', type: 'checkbox', label: 'Espejos', value: 'espejos' },
        { name: 'items', type: 'checkbox', label: 'Combustible', value: 'combustible' },
      ],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Iniciar ruta', handler: async (seleccionados: string[]) => {
          if (!seleccionados || seleccionados.length < 4) {
            const toast = await this.toastCtrl.create({ message: 'Marcá los 4 ítems antes de salir', duration: 2200, color: 'warning', position: 'top' });
            await toast.present();
            return false;
          }
          await this.startTracking();
          return true;
        }},
      ],
    });
    await alert.present();
  }

  private async startTracking() {
    this.tracking = true;
    this.paused = false;
    this.tripDistanceKm = 0;
    this.boletosEscaneados = 0;
    this.tripStartTime = Date.now();
    this.lastTripLat = this.currentLat;
    this.lastTripLng = this.currentLng;

    await this.choferService.updateBusStatus(this.assignedBus!.id, 'en_ruta');

    if (this.profile && this.assignedBus!.ruta_id) {
      await this.choferService.startViaje(this.assignedBus!.id, this.profile.id, this.assignedBus!.ruta_id);
      // Las paradas ya se cargaron en ngOnInit para el trazado y "próxima
      // parada"; si por lo que sea no llegaron a tiempo, se reintenta acá.
      if (this.rutaParadas.length === 0) {
        try { this.rutaParadas = await this.choferService.getParadasOrdenadas(this.assignedBus!.ruta_id); } catch {}
      }
    }
    this.nextParadaIndex = 1;
    // Tambien el indice de pantalla: solo se reiniciaba en loadRutaParadas(),
    // que corre una vez en ngOnInit. Terminado el primer recorrido quedaba al
    // final del arreglo y "proxima parada" no volvia a aparecer en todo el
    // dia, hasta recargar la app.
    this.displayParadaIndex = 1;
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
    this.paused = false;
    this.speedWarning = false;
    this.offRoute = false;

    if (this.trackingInterval) {
      clearInterval(this.trackingInterval);
      this.trackingInterval = null;
    }

    await this.choferService.updateBusStatus(this.assignedBus!.id, 'activo');
    // Antes siempre mandaba 0 acá — la distancia real ya se venía sumando en
    // updatePosition() pero nunca se usaba al cerrar el viaje.
    await this.choferService.endViaje(this.tripDistanceKm);

    const paradasCumplidas = this.nextParadaIndex - 1;
    const duracionMin = this.tripStartTime ? Math.round((Date.now() - this.tripStartTime) / 60000) : 0;
    this.nextParadaIndex = 1;

    await this.showTripSummary(duracionMin, paradasCumplidas);
  }

  private async showTripSummary(duracionMin: number, paradasCumplidas: number) {
    const horas = Math.floor(duracionMin / 60);
    const mins = duracionMin % 60;
    const duracionTexto = horas > 0 ? `${horas}h ${mins}min` : `${mins} min`;

    const alert = await this.alertCtrl.create({
      cssClass: 'buxi-alert',
      header: 'Viaje completado',
      message: `Duración: ${duracionTexto}<br>Distancia: ${this.tripDistanceKm.toFixed(1)} km<br>Paradas cumplidas: ${paradasCumplidas}`,
      buttons: ['Listo'],
    });
    await alert.present();
    // Esperar a que lo cierren, no solo a presentarlo: onLogout() llama a
    // stopTracking() y despues monta su propio confirm. Sin esto los dos
    // dialogos quedaban encima, y al confirmar la salida el resumen se
    // quedaba huerfano sobre la pantalla de login.
    await alert.onDidDismiss();
  }

  // Pausa sin terminar el viaje (almuerzo, descanso corto): deja de mandar
  // ubicación pero no cierra el viaje ni cambia el estado del bus, así el
  // historial de tramos y el viaje activo siguen intactos al retomar.
  togglePause() {
    if (!this.tracking) return;
    this.paused = !this.paused;

    if (this.paused) {
      if (this.trackingInterval) {
        clearInterval(this.trackingInterval);
        this.trackingInterval = null;
      }
      this.speedWarning = false;
      this.offRoute = false;
    } else {
      this.sendLocation();
      this.trackingInterval = setInterval(() => this.sendLocation(), 5000);
    }
  }

  private async sendLocation() {
    if (!this.assignedBus || this.currentLat === 0) return;

    try {
      await this.choferService.sendLocation(
        this.assignedBus.id,
        this.currentLat,
        this.currentLng,
        this.currentSpeedKmh,
        this.currentHeading,
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

  toggle3D() {
    this.is3D = !this.is3D;
    set3DEnabled(this.map, this.is3D, true);
  }

  // ---- REPORTAR INCIDENTE ----
  // Dos alertas encadenadas, no una sola con radio + texto mezclados: Ionic
  // no le pone label al radio cuando conviven con un input de texto en el
  // mismo alert (bug ya visto en otras partes de esta app).
  async reportarIncidente() {
    if (!this.profile?.empresa_id) return;

    const tipoAlert = await this.alertCtrl.create({
      cssClass: 'buxi-alert',
      header: 'Reportar incidente',
      inputs: [
        { name: 'tipo', type: 'radio', label: 'Atraso', value: 'Atraso', checked: true },
        { name: 'tipo', type: 'radio', label: 'Bus averiado', value: 'Bus averiado' },
        { name: 'tipo', type: 'radio', label: 'Accidente', value: 'Accidente' },
        { name: 'tipo', type: 'radio', label: 'Otro', value: 'Otro' },
      ],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Siguiente', role: 'confirm' },
      ],
    });
    await tipoAlert.present();
    const { data, role } = await tipoAlert.onDidDismiss();
    if (role !== 'confirm') return;
    const tipo = data?.values as string;

    const detalleAlert = await this.alertCtrl.create({
      cssClass: 'buxi-alert',
      header: tipo,
      message: 'Contale a tu empresa qué está pasando.',
      inputs: [{ name: 'descripcion', type: 'textarea', placeholder: 'Detalles...' }],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Enviar', handler: async (d) => {
          if (!d.descripcion?.trim()) return false;
          try {
            await this.choferService.createReporte(this.profile!.empresa_id!, this.profile!.id, tipo, d.descripcion.trim());
            const toast = await this.toastCtrl.create({ message: 'Reporte enviado a tu empresa', duration: 2500, color: 'success', position: 'top' });
            await toast.present();
          } catch {
            const toast = await this.toastCtrl.create({ message: 'No se pudo enviar el reporte', duration: 2500, color: 'danger', position: 'top' });
            await toast.present();
          }
          return true;
        }},
      ],
    });
    await detalleAlert.present();
  }

  // ---- BOTÓN DE PÁNICO ----
  // Distinto de "reportar incidente": esto es para una emergencia real, un
  // solo paso de confirmación y manda la ubicación actual, no un formulario.
  async panicButton() {
    if (!this.profile?.empresa_id || this.sendingPanic) return;

    const alert = await this.alertCtrl.create({
      cssClass: 'buxi-alert',
      header: '¿Enviar alerta de emergencia?',
      message: 'Se le avisa de inmediato a tu empresa con tu ubicación actual.',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Enviar ahora', cssClass: 'ba-confirm', handler: async () => {
          this.sendingPanic = true;
          try {
            const ubicacion = this.currentLat && this.currentLng
              ? `https://maps.google.com/?q=${this.currentLat},${this.currentLng}`
              : 'ubicación no disponible';
            await this.choferService.createReporte(
              this.profile!.empresa_id!,
              this.profile!.id,
              'Emergencia',
              `Botón de pánico activado. Ubicación: ${ubicacion}`,
            );
            const toast = await this.toastCtrl.create({ message: 'Alerta enviada a tu empresa', duration: 3000, color: 'danger', position: 'top' });
            await toast.present();
          } catch {
            const toast = await this.toastCtrl.create({ message: 'No se pudo enviar la alerta', duration: 3000, color: 'danger', position: 'top' });
            await toast.present();
          } finally {
            this.sendingPanic = false;
          }
          return true;
        }},
      ],
    });
    await alert.present();
  }

  // ---- MIS CALIFICACIONES ----
  async openCalificaciones() {
    if (!this.assignedBus) {
      // Antes era un return a secas: se tocaba el boton y no pasaba nada.
      const toast = await this.toastCtrl.create({
        message: 'Las calificaciones son del bus que tengas asignado, y todavia no tenes uno.',
        duration: 3500,
        color: 'warning',
        position: 'top',
      });
      await toast.present();
      return;
    }
    this.calificacionesOpen = true;
    this.loadingCalificaciones = true;
    try {
      this.misCalificaciones = await this.choferService.getCalificacionesDelBus(this.assignedBus.id);
      this.calificacionPromedio = this.misCalificaciones.length
        ? this.misCalificaciones.reduce((s, c) => s + c.estrellas, 0) / this.misCalificaciones.length
        : null;
    } catch {
      this.misCalificaciones = [];
      this.calificacionPromedio = null;
    } finally {
      this.loadingCalificaciones = false;
    }
  }

  closeCalificaciones() {
    this.calificacionesOpen = false;
  }

  // ---- ESCÁNER DE BOLETOS (QR) ----
  async openScanner() {
    this.scanResult = null;
    this.scannerOpen = true;
    // El <div id="qr-reader"> recién existe después de este render.
    setTimeout(() => this.startScanner(), 60);
  }

  private async startScanner() {
    try {
      const { Html5Qrcode } = await import('html5-qrcode');
      this.qrScanner = new Html5Qrcode('qr-reader');
      await this.qrScanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: 240 },
        (decodedText: string) => this.onScanSuccess(decodedText),
        () => {},
      );
    } catch {
      const toast = await this.toastCtrl.create({ message: 'No se pudo acceder a la cámara', duration: 2500, color: 'danger', position: 'top' });
      await toast.present();
      this.scannerOpen = false;
    }
  }

  private async onScanSuccess(codigo: string) {
    if (this.validandoBoleto || !this.profile) return;
    this.validandoBoleto = true;
    await this.stopScanner();
    try {
      const rutaId = this.assignedBus?.ruta_id || null;
      const res = await this.choferService.validarBoleto(codigo, this.profile.id, rutaId);
      this.scanResult = {
        ok: res.ok,
        motivo: res.motivo,
        nombre: (res.boleto as any)?.pasajero?.nombre_completo,
        ruta: (res.boleto as any)?.ruta?.nombre,
      };
      if (res.ok) this.boletosEscaneados++;
    } catch {
      this.scanResult = { ok: false, motivo: 'Error al validar el boleto' };
    } finally {
      this.validandoBoleto = false;
    }
  }

  escanearOtro() {
    this.scanResult = null;
    // El <div id="qr-reader"> vive dentro de un *ngIf="!scanResult": recien
    // vuelve a existir despues de este render. Sin esperarlo, Html5Qrcode no
    // encuentra el contenedor, tira, y el catch cerraba el escaner con
    // "No se pudo acceder a la camara" -- un solo boleto por apertura.
    setTimeout(() => this.startScanner(), 60);
  }

  async closeScanner() {
    this.scannerOpen = false;
    this.scanResult = null;
    await this.stopScanner();
  }

  private async stopScanner() {
    if (this.qrScanner) {
      try { await this.qrScanner.stop(); this.qrScanner.clear(); } catch {}
      this.qrScanner = null;
    }
  }

  // ---- HISTORIAL DE VIAJES ----
  async openHistorial() {
    if (!this.profile) return;
    this.historialOpen = true;
    this.loadingHistorial = true;
    try {
      this.viajesHistorial = await this.choferService.getMyViajes(this.profile.id);
    } catch {
      this.viajesHistorial = [];
    } finally {
      this.loadingHistorial = false;
    }
  }

  closeHistorial() {
    this.historialOpen = false;
  }

  // ---- MENSAJES DE LA EMPRESA ----
  private async refreshMensajesNoLeidos() {
    if (!this.profile) return;
    try {
      const mensajes = await this.choferService.getMisMensajes(this.profile.id);
      this.mensajesNoLeidos = mensajes.filter(m => !m.leido).length;
    } catch {
    }
  }

  async openMensajes() {
    if (!this.profile) return;
    this.mensajesOpen = true;
    this.loadingMensajes = true;
    try {
      this.misMensajes = await this.choferService.getMisMensajes(this.profile.id);
      const noLeidos = this.misMensajes.filter(m => !m.leido);
      this.mensajesNoLeidos = 0;
      for (const m of noLeidos) {
        this.choferService.marcarMensajeLeido(m.id).catch(() => {});
        m.leido = true;
      }
    } catch {
      this.misMensajes = [];
    } finally {
      this.loadingMensajes = false;
    }
  }

  closeMensajes() {
    this.mensajesOpen = false;
  }

  // ---- PANEL DE PERFIL ----
  toggleProfilePanel() {
    this.profilePanelOpen = !this.profilePanelOpen;
    if (!this.profilePanelOpen) this.editingProfile = false;
  }

  startEditProfile() {
    this.editName = this.profile?.nombre_completo || '';
    this.editPhone = this.profile?.telefono || '';
    this.editingProfile = true;
  }

  cancelEditProfile() {
    this.editingProfile = false;
  }

  async saveProfile() {
    if (!this.editName.trim() || this.savingProfile) return;
    this.savingProfile = true;
    try {
      await this.supabase.updateProfile({
        nombre_completo: this.editName.trim(),
        telefono: this.editPhone.trim() || null,
      });
      if (this.profile) {
        this.profile.nombre_completo = this.editName.trim();
        this.profile.telefono = this.editPhone.trim() || null;
      }
      this.editingProfile = false;
    } catch {
    } finally {
      this.savingProfile = false;
    }
  }

  async onLogout() {
    if (this.tracking) {
      await this.stopTracking();
    }

    const alert = await this.alertCtrl.create({
      cssClass: 'buxi-alert',
      header: 'Cerrar sesión',
      message: '¿Estás seguro?',
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
    if (this.qrScanner) {
      try { this.qrScanner.stop(); this.qrScanner.clear(); } catch {}
    }
  }
}
