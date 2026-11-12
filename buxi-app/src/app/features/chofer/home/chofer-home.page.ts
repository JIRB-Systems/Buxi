import { Component, ElementRef, OnInit, OnDestroy, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController, ToastController } from '@ionic/angular';
import * as maplibregl from 'maplibre-gl';
import { Geolocation } from '@capacitor/geolocation';
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { SupabaseService } from '../../../core/services/supabase.service';
import { FeaturesService } from '../../../core/services/features.service';
import { UserProfile } from '../../../core/models/user-profile.model';
import { Bus, Parada } from '../../../core/models/transport.model';
import { Viaje, Calificacion, MensajeChofer } from '../../../core/models/features.model';
import { ChoferService } from '../../../core/services/chofer.service';
import { GpsFondoService } from '../../../core/services/gps-fondo.service';
import {
  createMap, set3DEnabled, distanceToPolylineMeters,
  capaComercios, paradasDelMapaBase, paradasMunicipalesPropias, desplazamientoLibre,
} from '../../../core/utils/maplibre';
import { ParadasMunicipalesService } from '../../../core/services/paradas-municipales.service';
import { logError } from '../../../core/utils/log';
import { colorSeguro } from '../../../core/utils/html';
import {
  SpritesBus, SPRITE_PASO_MEDIO, cargarSpritesBus, dirDeSprite,
  registrarIconoBus as registrarSpriteBus,
  registrarIconoPlano, layoutIconoBus, aplicarLayoutIconoBus, PREFIJO_ICONO_PLANO, segunEscalaBus,
} from '../../../core/utils/bus-sprite';
import { supabaseClient } from '../../../core/supabase-client';
import { suscribirCambios } from '../../../core/utils/live';
import { RealtimeChannel } from '@supabase/supabase-js';

@Component({
  selector: 'app-chofer-home',
  templateUrl: './chofer-home.page.html',
  styleUrls: ['./chofer-home.page.scss', './chofer-home.mapa.scss'],
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

  // Arranca en 2D, igual que el mapa del pasajero: abre más rápido sin el
  // relieve ni los edificios. El 3D se prende con el botón y queda recordado
  // en el teléfono (la misma preferencia que la del pasajero).
  is3D = (() => {
    try { return localStorage.getItem('buxci.vista3d.v1') === '1'; } catch { return false; }
  })();
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

  // ---- Estado real de la transmisión ----
  // El chip de arriba decía "Transmitiendo en vivo" mientras los envíos venían
  // fallando: el chofer seguía manejando convencido de que se lo estaba
  // grabando, y a los pasajeros el bus se les congelaba y la app se lo pintaba
  // como "sin señal", culpando al bus de un problema del teléfono.
  //
  // Dos fallos seguidos (10 s) antes de avisar, para no encender el cartel por
  // un bache de red de un solo intento.
  transmisionCaida = false;
  private enviosFallidos = 0;
  private readonly FALLOS_PARA_AVISAR = 2;
  // Con el GPS de fondo llega una posición por segundo; al servidor se manda
  // como mucho una cada 5 s, igual que el intervalo de siempre.
  private readonly ENVIO_MIN_MS = 5000;
  private ultimoEnvio = 0;

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
  private readonly USER_HALO_LAYER = 'chofer-self-halo';
  private readonly PARADAS_SRC = 'chofer-paradas';
  private readonly PARADAS_CIRCLE_LAYER = 'chofer-paradas-circle';
  private readonly PARADAS_LABEL_LAYER = 'chofer-paradas-label';
  private busIconReady = false;

  // El mismo bus 3D que ve el pasajero, del modelo de Blender: 16 direcciones
  // y teñido con el color de la ruta. El dibujo es compartido a propósito
  // (core/utils/bus-sprite) para que las dos pantallas no se separen.
  private sprites: SpritesBus | null = null;
  private busIconosRegistrados = new Set<string>();
  private ultimoBearing = 0;
  private readonly COLOR_BUS_FALLBACK = '#00c853';

  // El color con el que se tiñe el bus: el que la empresa eligió en
  // Personalización, y si no eligió ninguno, el de la ruta como siempre.
  // Vale para el bus propio y para toda la flota — es la misma empresa.
  private colorDeLaFlota(colorRuta?: string | null): string {
    return colorSeguro(
      this.colorEmpresa || colorRuta || this.assignedBus?.ruta?.color || '',
    );
  }

  // Lo elegido por la empresa en Personalización. null = el de cada ruta.
  private colorEmpresa: string | null = null;
  // El modelo de bus de la empresa (null = urbano) y el propio de cada unidad
  // de la flota: en 2D se dibuja el bus visto desde arriba con ese modelo.
  private modeloEmpresa: string | null = null;
  private flotaModelos = new Map<string, string | null>();

  private readonly paradasMunicipales = inject(ParadasMunicipalesService);

  // ---- La cámara sigue al bus ----
  // Manejando, el chofer no puede andar arrastrando el mapa para encontrarse:
  // la cámara va con el bus y lo deja en el pedazo de mapa que no tapan la
  // tarjeta ni los botones (desplazamientoLibre). Si el chofer arrastra el
  // mapa deja de seguirlo, y el botón de ubicación lo vuelve a enganchar.
  siguiendo = true;
  private gestoDelChofer = false;

  // initMap() corre en ionViewDidEnter, que puede dispararse antes de que
  // ngOnInit termine de resolver el bus asignado (son dos llamadas de red).
  // Todo lo que dependa de assignedBus tiene que esperar esto: sin la espera,
  // la flota arrancaba con assignedBus en null, salía por el return temprano
  // y no volvía a intentarlo nunca.
  //
  // El orden de estos dos campos importa: con target es2022 y
  // useDefineForClassFields, declarar el resolver DESPUÉS lo redefine como
  // undefined y pisa la asignación que hace el initializer de la promesa.
  private resolverAsignacion!: () => void;
  private asignacionLista = new Promise<void>(r => { this.resolverAsignacion = r; });

  // ---- El resto de la flota de la empresa ----
  // Mismo motivo que arriba para usar capas nativas y no maplibregl.Marker:
  // el bug de elevación con terreno 3D deja los marcadores fuera de lugar.
  private readonly FLOTA_SRC = 'chofer-flota';
  private readonly FLOTA_LAYER = 'chofer-flota-icon';
  private readonly FLOTA_LABEL_LAYER = 'chofer-flota-label';
  private flotaChannel: RealtimeChannel | null = null;
  private flotaInterval: any = null;
  // bus_id -> etiqueta. Se carga una vez al entrar y además hace de filtro:
  // el payload de Realtime no dice de qué empresa es el bus que se movió.
  private flotaEtiquetas = new Map<string, string>();
  private flotaColores = new Map<string, string>();
  private flotaPosiciones = new Map<string, { lng: number; lat: number; heading: number; visto: number }>();
  // Un bus que dejó de transmitir tiene que desaparecer. Un marcador clavado
  // donde se lo vio hace media hora es peor que ninguno cuando justamente lo
  // que se está mirando es la distancia entre unidades.
  private readonly FLOTA_OLVIDO_MS = 5 * 60 * 1000;

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
    private gpsFondo: GpsFondoService,
  ) {}

  async ngOnInit() {
    window.addEventListener('online', this.alVolverLaRed);
    try {
      this.profile = await this.supabase.getProfile();
      if (this.profile) {
        this.vaciarCola();
        this.assignedBus = await this.choferService.getAssignedBus(this.profile.id);
        if (this.assignedBus?.ruta_id) {
          this.paradasReady = this.loadRutaParadas(this.assignedBus.ruta_id);
        }
        await this.checkAssignmentChanged();
        this.refreshMensajesNoLeidos();
        this.iniciarDatosEnVivo();
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
      this.resolverAsignacion();
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
      pitch: this.is3D ? 50 : 0,
      threeD: this.is3D,
      style: 'streets-v2-dark',
    });
    if (this.destroyed) { try { this.map.remove(); } catch {} return; }

    // El mismo mapa base que ve el pasajero: comercios al día, paradas
    // municipales en ámbar, terminales en azul y las que cargó JIRB. Van antes
    // que todo lo del chofer para quedar debajo de la ruta y de los buses (las
    // de JIRB nacen vacías por eso mismo, y se llenan cuando llega la lista).
    try { capaComercios(this.map, true); } catch {}
    try { paradasDelMapaBase(this.map, true); } catch {}
    try { paradasMunicipalesPropias(this.map, true, []); } catch {}
    this.cargarParadasMunicipales();

    // Antes de empezar a posicionar nada: el marcador se crea en cuanto llega
    // la primera lectura del GPS, y si los sprites no están todavía nacería
    // con el ícono de reserva.
    this.sprites = await cargarSpritesBus();
    if (this.destroyed) return;
    this.ensureBusIcon();
    this.engancharRotacion();
    this.engancharSeguimiento();
    await this.startWatchingPosition();

    await this.asignacionLista;
    await this.paradasReady;
    if (!this.destroyed && this.rutaParadas.length >= 2) {
      this.drawAssignedRoute();
    }
    if (!this.destroyed) await this.iniciarFlota();
    // Al final: retomar un viaje necesita el mapa, el GPS y las paradas.
    if (!this.destroyed) await this.revisarViajeAbierto();
  }

  private async cargarParadasMunicipales() {
    try {
      const filas = await this.paradasMunicipales.listar();
      if (this.destroyed || !this.map) return;
      paradasMunicipalesPropias(this.map, true, filas);
    } catch (e) {
      logError('chofer: no se pudieron cargar las paradas municipales', e);
    }
  }

  // Si la app se cerró o se recargó a mitad de un viaje, ese viaje quedó
  // abierto. Uno reciente del mismo bus se ofrece retomar; los demás (viejos,
  // o de un bus que ya no es el suyo) se cierran solos.
  private readonly RETOMAR_MAX_MS = 4 * 60 * 60 * 1000;

  private async revisarViajeAbierto() {
    if (!this.profile || !this.assignedBus || this.tracking) return;
    let abiertos: Viaje[];
    try {
      abiertos = await this.choferService.getViajesAbiertos(this.profile.id);
    } catch (e) {
      logError('chofer: no se pudieron leer los viajes abiertos', e);
      return;
    }
    if (!abiertos.length) return;

    const [ultimo, ...resto] = abiertos;
    const retomable = ultimo.bus_id === this.assignedBus.id
      && Date.now() - Date.parse(ultimo.inicio) < this.RETOMAR_MAX_MS;
    const aCerrar = retomable ? resto : abiertos;
    if (aCerrar.length) {
      try { await this.choferService.cancelarViajes(aCerrar); }
      catch (e) { logError('chofer: no se pudieron cerrar viajes viejos', e); }
    }
    if (!retomable || this.destroyed) return;

    const hora = new Date(ultimo.inicio).toLocaleTimeString('es-CR', { hour: 'numeric', minute: '2-digit' });
    const alert = await this.alertCtrl.create({
      cssClass: 'buxi-alert',
      header: 'Tenés un viaje sin terminar',
      // La hora en es-CR ya termina en punto ("10:13 p. m."): no agregar otro.
      message: `Lo empezaste a las ${hora} y quedó abierto. ¿Lo seguís o lo das por terminado?`,
      backdropDismiss: false,
      buttons: [
        { text: 'Terminarlo', handler: () => { this.terminarViajeAbierto(ultimo); } },
        { text: 'Seguir viaje', handler: () => { this.startTracking(ultimo); } },
      ],
    });
    await alert.present();
  }

  private async terminarViajeAbierto(viaje: Viaje) {
    try {
      this.choferService.retomarViaje(viaje.id);
      await this.choferService.endViaje(viaje.distancia_km || 0);
    } catch (e) {
      logError('chofer: no se pudo terminar el viaje abierto', e);
      const toast = await this.toastCtrl.create({ message: 'No se pudo terminar el viaje. Intentá de nuevo.', duration: 3000, color: 'danger', position: 'top' });
      await toast.present();
    }
  }

  // Traza la ruta asignada (línea + paradas) apenas se conoce la ruta, pero
  // oculta (ver routeVisibility abajo) hasta que el chofer arranca de verdad:
  // mostrarla antes daba la impresión de un viaje ya en curso.
  //
  // El bus propio salía oculto por el mismo motivo y ya no: ahora se ve
  // siempre y es la opacidad la que distingue "todavía no arrancaste" (ver
  // refrescarBusPropio). La ruta se deja como estaba a propósito — un bus
  // apagado en el mapa se entiende solo, pero un recorrido completo trazado
  // sin viaje en curso sigue siendo confuso.
  private drawAssignedRoute() {
    const color = this.assignedBus?.ruta?.color || '#00c853';
    const geometria = this.assignedBus?.ruta?.geometria as [number, number][] | null | undefined;
    const coords: [number, number][] = geometria?.length
      ? geometria.map(([lat, lng]) => [lng, lat] as [number, number])
      : this.rutaParadas.map(p => [p.longitud, p.latitud] as [number, number]);

    // El primer/último punto de la geometría (calculado por el servicio de
    // ruteo) no siempre cae exacto sobre la parada guardada -- a veces quedan
    // a 30-40 m, imperceptible a zoom normal pero muy visible pegado a la
    // terminal: la línea "arranca" en un punto distinto al de la parada. Se
    // pisan los extremos con la coordenada real de la parada para que la
    // línea siempre nazca y termine exacto en el punto marcado.
    if (this.rutaParadas.length >= 2 && coords.length >= 2) {
      const primera = this.rutaParadas[0];
      const ultima = this.rutaParadas[this.rutaParadas.length - 1];
      coords[0] = [primera.longitud, primera.latitud];
      coords[coords.length - 1] = [ultima.longitud, ultima.latitud];
    }
    this.routeCoords = coords;

    this.map.addSource('chofer-route', {
      type: 'geojson',
      data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } },
    });
    // Oculta hasta que arranca el viaje -- ver setRouteVisible.
    const routeVisibility = this.tracking ? 'visible' : 'none';
    this.map.addLayer({
      id: 'chofer-route-bg', type: 'line', source: 'chofer-route',
      layout: { 'line-cap': 'round', 'line-join': 'round', visibility: routeVisibility },
      paint: { 'line-color': color, 'line-width': 12, 'line-opacity': 0.12 },
    });
    this.map.addLayer({
      id: 'chofer-route-main', type: 'line', source: 'chofer-route',
      layout: { 'line-cap': 'round', 'line-join': 'round', visibility: routeVisibility },
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
      layout: { visibility: routeVisibility },
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
        visibility: routeVisibility,
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

  // El ícono del bus propio: mismo sprite que el del pasajero, teñido con el
  // color de la ruta asignada y con el sprite que corresponde al rumbo.
  //
  // Si los sprites no cargaron se cae al ícono de reserva. El pasajero en ese
  // caso simplemente no dibuja buses, pero un chofer sin su propio marcador
  // pierde lo único que le dice dónde está: no es el mismo trato.
  private iconoBusPropio(): string {
    const color = this.colorDeLaFlota();
    if (!this.is3D) {
      const plano = registrarIconoPlano(
        this.map, this.assignedBus?.modelo_bus || this.modeloEmpresa, color,
        this.busIconosRegistrados, this.alCargarPlano);
      if (plano) return plano;
    }
    const dir = dirDeSprite(this.currentHeading, this.map ? this.map.getBearing() : 0);
    const id = registrarSpriteBus(this.map, this.sprites, color, dir, this.busIconosRegistrados);
    return this.sprites ? id : 'chofer-bus-icon';
  }

  // El halo del bus propio y la placa de los demás siguen al bus cuando crece
  // con el zoom. En 3D la placa no se mueve: el bus crece hacia arriba.
  private radioHalo(): any {
    return segunEscalaBus(this.is3D, e => (this.is3D ? 12 : 18) * e);
  }

  private offsetEtiquetaFlota(): any {
    return this.is3D ? [0, 1.4] : segunEscalaBus(false, e => [0, 2.2 * e]);
  }

  // Cuando el bus visto desde arriba termina de dibujarse, se repintan el
  // propio y la flota (hasta ahí iban con el isométrico).
  private alCargarPlano = () => {
    if (this.destroyed || !this.map || this.is3D) return;
    try {
      if (this.currentLat !== 0 || this.currentLng !== 0) this.updateUserMarkerLayer(this.currentLng, this.currentLat);
      // Solo si ya hay flota dibujada: renderFlota crea la capa si no existe.
      if (this.map.getSource(this.FLOTA_SRC)) this.renderFlota();
    } catch { /* sin estilo cargado no hay capas que tocar */ }
  };

  private updateUserMarkerLayer(lng: number, lat: number) {
    const icon = this.iconoBusPropio();
    const geojson = {
      type: 'Feature' as const,
      // Solo el bus visto desde arriba se gira; el isométrico trae el rumbo
      // dibujado.
      properties: { icon, rot: icon.startsWith(PREFIJO_ICONO_PLANO) ? this.currentHeading : 0 },
      geometry: { type: 'Point' as const, coordinates: [lng, lat] },
    };
    const src = this.map.getSource(this.USER_SRC) as maplibregl.GeoJSONSource | undefined;
    if (src) {
      src.setData(geojson as any);
      return;
    }
    this.map.addSource(this.USER_SRC, { type: 'geojson', data: geojson as any });
    // El halo va DEBAJO del bus y solo lo lleva el propio. Con el mismo sprite
    // y el mismo color de ruta que el resto de la flota, es lo único que dice
    // cuál de todos los buses en pantalla sos vos.
    this.map.addLayer({
      id: this.USER_HALO_LAYER, type: 'circle', source: this.USER_SRC,
      paint: {
        // En 2D el bus va acostado encima del punto: el halo lo rodea. Crece
        // con el zoom, como el bus.
        'circle-radius': this.radioHalo(),
        'circle-color': '#00c853',
        'circle-opacity': 0.22,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#00e676',
        'circle-stroke-opacity': 0.9,
      },
    });
    this.map.addLayer({
      id: this.USER_LAYER, type: 'symbol', source: this.USER_SRC,
      layout: {
        'icon-image': ['get', 'icon'],
        // Igual que en el mapa del pasajero: en 3D billboard y anclado abajo,
        // con el rumbo horneado en el sprite (un dibujo isométrico rotado en
        // pantalla se ve torcido); en 2D el bus visto desde arriba, acostado
        // sobre el mapa y girado con icon-rotate.
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        ...layoutIconoBus(this.is3D),
      },
    });
    this.refrescarBusPropio();
  }

  // Girar el mapa cambia el rumbo RELATIVO a la pantalla, o sea cuál de los 16
  // sprites toca. 'rotate' dispara decenas de veces por gesto y solo importa
  // al cruzar medio paso de sprite: por debajo, el ícono elegido sería el
  // mismo y el trabajo iría a la basura.
  private engancharRotacion() {
    this.map.on('rotate', () => {
      if (this.destroyed || !this.map) return;
      const b = this.map.getBearing();
      if (Math.abs(b - this.ultimoBearing) < SPRITE_PASO_MEDIO) return;
      this.ultimoBearing = b;
      if (this.currentLat !== 0 || this.currentLng !== 0) {
        this.updateUserMarkerLayer(this.currentLng, this.currentLat);
      }
      this.renderFlota();
    });
  }

  // El bus propio se ve SIEMPRE desde que hay una posición: el chofer quiere
  // ubicarse en el mapa antes de salir, no después.
  //
  // Antes estaba oculto hasta tocar "Iniciar ruta" por un motivo real: verlo
  // ya "puesto" en algún punto del recorrido se leía como un viaje en curso.
  // Eso ahora lo resuelve la opacidad en vez de la visibilidad — apagado
  // significa "acá estás, todavía no arrancaste", y es la misma distinción
  // que ya hace el chip de estado, que no puede contradecir al mapa.
  private get busPropioActivo(): boolean {
    return this.tracking && !this.paused && !this.transmisionCaida;
  }

  private refrescarBusPropio() {
    if (!this.map) return;
    const activo = this.busPropioActivo;
    if (this.map.getLayer(this.USER_LAYER)) {
      this.map.setPaintProperty(this.USER_LAYER, 'icon-opacity', activo ? 1 : 0.45);
    }
    if (this.map.getLayer(this.USER_HALO_LAYER)) {
      this.map.setPaintProperty(this.USER_HALO_LAYER, 'circle-opacity', activo ? 0.22 : 0.08);
      this.map.setPaintProperty(this.USER_HALO_LAYER, 'circle-stroke-opacity', activo ? 0.9 : 0.3);
    }
  }

  // ---- EL RESTO DE LA FLOTA ----
  private async iniciarFlota() {
    const empresaId = this.assignedBus?.empresa_id;
    if (!empresaId || !this.map) return;

    // El color propio de la empresa manda sobre el de la ruta, así que se
    // resuelve antes de armar los iconos de la flota y del bus propio.
    const personalizacion = await this.choferService.getPersonalizacionEmpresa(empresaId);
    this.colorEmpresa = personalizacion.color;
    this.modeloEmpresa = personalizacion.modelo;
    if (this.currentLat !== 0 || this.currentLng !== 0) {
      this.updateUserMarkerLayer(this.currentLng, this.currentLat);
    }

    try {
      const buses = await this.choferService.getBusesDeEmpresa(empresaId);
      // El propio queda afuera: ya se dibuja como el marcador de arriba, y
      // verlo dos veces en el mismo punto es peor que no verlo.
      const ajenos = buses.filter(b => b.id !== this.assignedBus?.id);
      this.flotaEtiquetas = new Map(ajenos.map(b => [b.id, b.numero_unidad || b.placa]));
      this.flotaColores = new Map(ajenos.map(b => [b.id, this.colorDeLaFlota(b.ruta?.color)]));
      this.flotaModelos = new Map(ajenos.map(b => [b.id, b.modelo_bus || this.modeloEmpresa]));
    } catch (e) {
      logError('chofer: no se pudo cargar la flota de la empresa', e);
      return;
    }
    if (!this.flotaEtiquetas.size) return;

    await this.refrescarFlota();
    this.escucharFlota();
    this.flotaInterval = setInterval(() => this.olvidarFlotaVieja(), 30000);
  }

  private async refrescarFlota() {
    // flotaEtiquetas ya viene sin el bus propio, así que el filtro de la
    // consulta lo excluye solo.
    const ids = [...this.flotaEtiquetas.keys()];
    if (!ids.length) return;
    try {
      const ubicaciones = await this.choferService.getUbicacionesFlota(ids);
      const ahora = Date.now();
      for (const u of ubicaciones) {
        if (!this.flotaEtiquetas.has(u.bus_id)) continue;
        this.flotaPosiciones.set(u.bus_id, {
          lng: u.longitud,
          lat: u.latitud,
          heading: u.heading || 0,
          visto: u.timestamp ? Date.parse(u.timestamp) : ahora,
        });
      }
      this.renderFlota();
    } catch (e) {
      logError('chofer: no se pudieron cargar las ubicaciones de la flota', e);
    }
  }

  // Sin debounce y parcheando fila por fila, al revés que suscribirCambios():
  // acá cae un punto cada 5 segundos por cada bus, y volver a pedir la lista
  // entera en cada uno sería justo el caso que ese helper dice no cubrir.
  private escucharFlota() {
    if (this.flotaChannel) return;
    this.flotaChannel = supabaseClient()
      .channel('chofer-flota')
      .on(
        'postgres_changes' as any,
        { event: 'INSERT', schema: 'public', table: 'bus_locations' },
        (payload: any) => {
          const loc = payload?.new;
          if (this.destroyed || !loc || !this.flotaEtiquetas.has(loc.bus_id)) return;
          this.flotaPosiciones.set(loc.bus_id, {
            lng: loc.longitud,
            lat: loc.latitud,
            heading: loc.heading || 0,
            visto: Date.now(),
          });
          this.renderFlota();
        },
      )
      .subscribe();
  }

  private olvidarFlotaVieja() {
    const limite = Date.now() - this.FLOTA_OLVIDO_MS;
    let cambio = false;
    for (const [busId, p] of this.flotaPosiciones) {
      if (p.visto < limite) { this.flotaPosiciones.delete(busId); cambio = true; }
    }
    if (cambio) this.renderFlota();
  }

  private renderFlota() {
    if (!this.map) return;
    const bearing = this.map.getBearing();
    const data = {
      type: 'FeatureCollection' as const,
      features: [...this.flotaPosiciones.entries()].map(([busId, p]) => {
        const color = this.flotaColores.get(busId) || this.COLOR_BUS_FALLBACK;
        const plano = this.is3D ? null : registrarIconoPlano(
          this.map, this.flotaModelos.get(busId), color, this.busIconosRegistrados, this.alCargarPlano);
        return {
          type: 'Feature' as const,
          properties: {
            etiqueta: this.flotaEtiquetas.get(busId) || '',
            icon: plano || registrarSpriteBus(
              this.map,
              this.sprites,
              color,
              dirDeSprite(p.heading, bearing),
              this.busIconosRegistrados,
            ),
            rot: plano ? p.heading : 0,
          },
          geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
        };
      }),
    };

    const src = this.map.getSource(this.FLOTA_SRC) as maplibregl.GeoJSONSource | undefined;
    if (src) { src.setData(data as any); return; }

    // Sin sprites no se dibuja la flota, igual que en el mapa del pasajero.
    // Acá sí vale ese trato: lo que no puede faltar es el bus propio, que
    // tiene su ícono de reserva.
    this.map.addSource(this.FLOTA_SRC, { type: 'geojson', data: data as any });
    this.map.addLayer({
      id: this.FLOTA_LAYER, type: 'symbol', source: this.FLOTA_SRC,
      layout: {
        'icon-image': ['get', 'icon'],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        ...layoutIconoBus(this.is3D),
      },
      // Un punto por debajo del propio: son contexto, no el protagonista.
      paint: { 'icon-opacity': 0.9 },
    });
    this.map.addLayer({
      id: this.FLOTA_LABEL_LAYER, type: 'symbol', source: this.FLOTA_SRC,
      layout: {
        'text-field': ['get', 'etiqueta'],
        'text-size': 10,
        'text-offset': this.offsetEtiquetaFlota(),
        'text-anchor': 'top',
        'text-allow-overlap': false,
        'text-pitch-alignment': 'viewport',
      },
      paint: {
        'text-color': '#cfe0f2',
        'text-halo-color': 'rgba(10, 22, 40, 0.95)',
        'text-halo-width': 1.5,
      },
    });
  }

  // La línea de la ruta y las paradas solo se ven mientras hay un viaje
  // activo -- ver el comentario en drawAssignedRoute.
  private readonly ROUTE_LAYERS = ['chofer-route-bg', 'chofer-route-main', this.PARADAS_CIRCLE_LAYER, this.PARADAS_LABEL_LAYER];
  private setRouteVisible(visible: boolean) {
    for (const id of this.ROUTE_LAYERS) {
      if (this.map?.getLayer(id)) {
        this.map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
      }
    }
  }

  private async startWatchingPosition() {
    try {
      if (Capacitor.isNativePlatform()) {
        await Geolocation.requestPermissions();
      }
      const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true });
      this.updatePosition(pos.coords.latitude, pos.coords.longitude, pos.coords.speed, pos.coords.heading);
      this.map.easeTo({
        center: [pos.coords.longitude, pos.coords.latitude], zoom: 16,
        offset: desplazamientoLibre(this.map), duration: 0,
      });

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
    this.seguirCamara();

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
        message: 'No tenés un bus asignado. Contactá a tu empresa.',
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

  // `retomar`: el viaje que quedó abierto (ver revisarViajeAbierto). Se sigue
  // ese mismo en vez de abrir otro.
  private async startTracking(retomar?: Viaje) {
    this.tracking = true;
    this.refrescarBusPropio();
    this.setRouteVisible(true);
    this.paused = false;
    this.tripDistanceKm = retomar?.distancia_km || 0;
    this.boletosEscaneados = 0;
    this.transmisionCaida = false;
    this.enviosFallidos = 0;
    this.tripStartTime = retomar ? Date.parse(retomar.inicio) : Date.now();
    this.lastTripLat = this.currentLat;
    this.lastTripLng = this.currentLng;

    // Sin esto, si fallaba la red la pantalla quedaba en "transmitiendo" sin
    // viaje abierto en el servidor. Se revierte y se avisa.
    try {
      await this.reintentar(() => this.choferService.updateBusStatus(this.assignedBus!.id, 'en_ruta'));
      if (!retomar && this.profile && this.assignedBus!.ruta_id) {
        await this.reintentar(() => this.choferService.startViaje(this.assignedBus!.id, this.profile!.id, this.assignedBus!.ruta_id!));
      }
    } catch {
      this.tracking = false;
      this.refrescarBusPropio();
      this.setRouteVisible(false);
      const t = await this.toastCtrl.create({ message: 'No se pudo iniciar el viaje. Revisá tu conexión e intentá de nuevo', duration: 4000, color: 'danger', position: 'top' });
      await t.present();
      return;
    }

    if (retomar) {
      this.choferService.retomarViaje(retomar.id);
    } else if (this.profile && this.assignedBus!.ruta_id) {
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
    await this.iniciarGpsFondo();

    const toast = await this.toastCtrl.create({
      message: retomar ? 'Viaje retomado — transmitiendo ubicación' : 'Viaje iniciado — transmitiendo ubicación',
      duration: 2000,
      color: 'success',
      position: 'top',
    });
    await toast.present();
  }

  private async vaciarCola() {
    const n = await this.choferService.vaciarColaReportes().catch(() => 0);
    if (n > 0) {
      const t = await this.toastCtrl.create({
        message: n === 1 ? 'Se envió el reporte que estaba pendiente' : `Se enviaron ${n} reportes pendientes`,
        duration: 3000, color: 'success', position: 'top',
      });
      await t.present();
    }
  }

  private readonly alVolverLaRed = () => this.vaciarCola();

  private async reintentar<T>(fn: () => Promise<T>, intentos = 3): Promise<T> {
    let ultimo: unknown;
    for (let i = 0; i < intentos; i++) {
      try { return await fn(); } catch (e) {
        ultimo = e;
        if (i < intentos - 1) await new Promise(r => setTimeout(r, 800 * (i + 1)));
      }
    }
    throw ultimo;
  }

  private async stopTracking() {
    this.tracking = false;
    this.refrescarBusPropio();
    this.setRouteVisible(false);
    this.paused = false;
    this.speedWarning = false;
    this.offRoute = false;
    this.transmisionCaida = false;
    this.enviosFallidos = 0;

    if (this.trackingInterval) {
      clearInterval(this.trackingInterval);
      this.trackingInterval = null;
    }
    await this.gpsFondo.detener();

    // Sin red, estos dos awaits fallaban sin aviso y el viaje quedaba
    // "en_curso" para siempre. Se reintenta y, si no hay manera, se avisa:
    // al reabrir la app, revisarViajeAbierto lo ofrece retomar o cerrar.
    try {
      await this.reintentar(() => this.choferService.updateBusStatus(this.assignedBus!.id, 'activo'));
      // Antes siempre mandaba 0 acá — la distancia real ya se venía sumando en
      // updatePosition() pero nunca se usaba al cerrar el viaje.
      await this.reintentar(() => this.choferService.endViaje(this.tripDistanceKm));
    } catch {
      const t = await this.toastCtrl.create({ message: 'No se pudo cerrar el viaje en el servidor. Al abrir la app de nuevo vas a poder cerrarlo', duration: 6000, color: 'warning', position: 'top' });
      await t.present();
    }

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
    this.refrescarBusPropio();

    if (this.paused) {
      if (this.trackingInterval) {
        clearInterval(this.trackingInterval);
        this.trackingInterval = null;
      }
      // En pausa no se transmite: se apaga también la notificación fija.
      this.gpsFondo.detener();
      this.speedWarning = false;
      this.offRoute = false;
    } else {
      // Al retomar se arranca de cero: un fallo anterior a la pausa no tiene
      // por qué pintar "sin señal" antes del primer envío nuevo.
      this.transmisionCaida = false;
      this.enviosFallidos = 0;
      this.sendLocation();
      this.trackingInterval = setInterval(() => this.sendLocation(), 5000);
      this.iniciarGpsFondo();
    }
  }

  // App de Android: el GPS sigue con la pantalla apagada (ver GpsFondoService).
  // Cada posición actualiza la pantalla y, cada 5 s, se manda al servidor. El
  // intervalo de siempre queda andando: con la app abierta sigue mandando
  // aunque el GPS de fondo tarde en dar la primera posición.
  private async iniciarGpsFondo() {
    if (!this.gpsFondo.disponible) return;
    const r = await this.gpsFondo.iniciar(this.assignedBus?.ruta?.nombre || null, l => {
      this.updatePosition(l.latitude, l.longitude, l.speed, l.bearing);
      if (this.tracking && !this.paused && Date.now() - this.ultimoEnvio >= this.ENVIO_MIN_MS) this.sendLocation();
    });
    if (r === 'sin-permiso') {
      const alert = await this.alertCtrl.create({
        cssClass: 'buxi-alert',
        header: 'Buxci necesita tu ubicación',
        message: 'Sin el permiso de ubicación el bus no aparece en el mapa de los pasajeros. Abrí los ajustes y elegí "Permitir mientras se usa la app".',
        buttons: [
          { text: 'Ahora no', role: 'cancel' },
          { text: 'Abrir ajustes', handler: () => this.gpsFondo.abrirAjustes() },
        ],
      });
      await alert.present();
    }
  }

  // El chip de estado tiene que decir la verdad: "Transmitiendo en vivo" con
  // los envíos caídos es exactamente lo que el chofer no puede leer.
  get estadoTransmisionTexto(): string {
    if (this.paused) return 'En pausa';
    if (!this.tracking) return 'Sin transmitir';
    return this.transmisionCaida ? 'Sin señal · no se guarda' : 'Transmitiendo en vivo';
  }

  private async sendLocation() {
    if (!this.assignedBus || this.currentLat === 0) return;
    this.ultimoEnvio = Date.now();

    try {
      await this.choferService.sendLocation(
        this.assignedBus.id,
        this.currentLat,
        this.currentLng,
        this.currentSpeedKmh,
        this.currentHeading,
      );
      this.enviosFallidos = 0;
      this.transmisionCaida = false;
      // Hay red: si quedó alguna alerta o incidente sin enviar, sale ahora.
      this.vaciarCola();
    } catch (e) {
      // Esto era un catch vacío, en el camino de datos más importante del
      // producto y corriendo cada 5 segundos.
      this.enviosFallidos++;
      logError('chofer: no se pudo enviar la ubicación (fallos seguidos: ' + this.enviosFallidos + ')', e);
      if (this.enviosFallidos >= this.FALLOS_PARA_AVISAR) this.transmisionCaida = true;
    }

    // Acá y no solo al arrancar/parar: la transmisión se puede caer o volver
    // en medio del viaje, y el bus del mapa tiene que decir lo mismo que el
    // chip. Corre cada 5 segundos, que es cada cuánto puede cambiar.
    this.refrescarBusPropio();
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
    this.siguiendo = true;
    if (this.currentLat && this.currentLng) {
      this.map.flyTo({
        center: [this.currentLng, this.currentLat],
        zoom: Math.max(this.map.getZoom(), 16),
        offset: desplazamientoLibre(this.map),
      });
    }
  }

  private engancharSeguimiento() {
    this.map.on('dragstart', () => { this.siguiendo = false; });
    // Mientras pellizca o gira no se le pelea la cámara; al soltar, sigue.
    for (const ev of ['zoomstart', 'rotatestart', 'pitchstart'] as const) {
      this.map.on(ev, (e: any) => { if (e?.originalEvent) this.gestoDelChofer = true; });
    }
    for (const ev of ['zoomend', 'rotateend', 'pitchend'] as const) {
      this.map.on(ev, () => { this.gestoDelChofer = false; });
    }
  }

  private seguirCamara() {
    if (!this.siguiendo || this.gestoDelChofer || !this.map) return;
    if (this.currentLat === 0 && this.currentLng === 0) return;
    this.map.easeTo({
      center: [this.currentLng, this.currentLat],
      offset: desplazamientoLibre(this.map),
      duration: 700,
    });
  }

  toggle3D() {
    this.is3D = !this.is3D;
    try { localStorage.setItem('buxci.vista3d.v1', this.is3D ? '1' : '0'); } catch {}
    // Sin estilo cargado (sin red, clave rechazada) MapLibre no deja tocar
    // capas: la preferencia queda guardada igual y no se rompe nada.
    if (!this.map) return;
    try { set3DEnabled(this.map, this.is3D, true); } catch (e) { logError('chofer: cambiar la vista 3D', e); }
    // El bus cambia de dibujo: parado en 3D, visto desde arriba en 2D.
    aplicarLayoutIconoBus(this.map, this.USER_LAYER, this.is3D);
    aplicarLayoutIconoBus(this.map, this.FLOTA_LAYER, this.is3D);
    try {
      if (this.map.getLayer(this.USER_HALO_LAYER)) this.map.setPaintProperty(this.USER_HALO_LAYER, 'circle-radius', this.radioHalo());
      if (this.map.getLayer(this.FLOTA_LABEL_LAYER)) this.map.setLayoutProperty(this.FLOTA_LABEL_LAYER, 'text-offset', this.offsetEtiquetaFlota());
    } catch { /* el estilo no está listo */ }
    try {
      if (this.currentLat !== 0 || this.currentLng !== 0) this.updateUserMarkerLayer(this.currentLng, this.currentLat);
      // Solo si ya hay flota dibujada: renderFlota crea la capa si no existe.
      if (this.map.getSource(this.FLOTA_SRC)) this.renderFlota();
    } catch { /* sin estilo cargado no hay capas que tocar */ }
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
            const r = await this.choferService.createReporteConCola(this.profile!.empresa_id!, this.profile!.id, tipo, d.descripcion.trim());
            const toast = await this.toastCtrl.create({
              message: r === 'enviado' ? 'Reporte enviado a tu empresa' : 'Sin señal: el reporte se envía solo apenas vuelva la conexión',
              duration: r === 'enviado' ? 2500 : 4000,
              color: r === 'enviado' ? 'success' : 'warning',
              position: 'top',
            });
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
  // ---- EMERGENCIA: se envía manteniendo presionado ----
  // Antes era tocar el botón y después buscar "Enviar ahora" en un diálogo:
  // dos gestos en el peor momento, y el primero se podía disparar sin querer
  // con el bus en movimiento. Ahora es uno solo, sostenido 1,2 s: un toque
  // accidental no envía nada (solo explica cómo se usa) y en una emergencia
  // real no hay que leer ni apuntar a un segundo botón.
  readonly PANICO_MS = 1200;
  panicoCargando = false;
  private panicoTimer: any = null;

  panicoInicio(ev?: Event) {
    if (this.sendingPanic || this.panicoTimer || !this.profile?.empresa_id) return;
    ev?.preventDefault();
    this.panicoCargando = true;
    this.vibrar(ImpactStyle.Light);
    this.panicoTimer = setTimeout(() => {
      this.panicoTimer = null;
      this.panicoCargando = false;
      this.enviarEmergencia();
    }, this.PANICO_MS);
  }

  // Se soltó antes de tiempo: no se envía nada.
  async panicoFin() {
    if (!this.panicoTimer) return;
    clearTimeout(this.panicoTimer);
    this.panicoTimer = null;
    this.panicoCargando = false;
    const toast = await this.toastCtrl.create({
      message: 'Para enviar la alerta, mantené presionado el botón',
      duration: 2500,
      position: 'top',
    });
    await toast.present();
  }

  private async enviarEmergencia() {
    if (!this.profile?.empresa_id || this.sendingPanic) return;
    this.sendingPanic = true;
    try {
      const ubicacion = this.currentLat && this.currentLng
        ? `https://maps.google.com/?q=${this.currentLat},${this.currentLng}`
        : 'ubicación no disponible';
      const r = await this.choferService.createReporteConCola(
        this.profile.empresa_id,
        this.profile.id,
        'Emergencia',
        `Botón de pánico activado. Ubicación: ${ubicacion}`,
      );
      this.notificar(r === 'enviado' ? NotificationType.Success : NotificationType.Warning);
      // Sin señal la alerta no se pierde, pero el chofer tiene que saber que
      // todavía no llegó: puede necesitar llamar por teléfono mientras tanto.
      const toast = await this.toastCtrl.create({
        message: r === 'enviado'
          ? 'Alerta enviada a tu empresa'
          : 'Sin señal: la alerta se envía sola apenas haya conexión. Si es urgente, llamá al 911',
        duration: r === 'enviado' ? 3000 : 8000,
        color: 'danger',
        position: 'top',
      });
      await toast.present();
    } catch {
      this.notificar(NotificationType.Error);
      const toast = await this.toastCtrl.create({ message: 'No se pudo enviar la alerta', duration: 3000, color: 'danger', position: 'top' });
      await toast.present();
    } finally {
      this.sendingPanic = false;
    }
  }

  // La vibración confirma sin mirar la pantalla. En la web no hace nada.
  private vibrar(estilo: ImpactStyle) {
    Haptics.impact({ style: estilo }).catch(() => {});
  }

  private notificar(tipo: NotificationType) {
    Haptics.notification({ type: tipo }).catch(() => {});
  }

  // Velocidad para mostrar, redondeada; 0 con el bus quieto.
  get velocidadKmh(): number {
    return Math.round(this.currentSpeedKmh);
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

  // El chofer maneja: no puede estar recargando la pantalla para enterarse de
  // que la empresa le mando un mensaje o le cambio el bus asignado.
  private liveChannel: RealtimeChannel | null = null;

  private iniciarDatosEnVivo() {
    if (this.liveChannel) return;
    this.liveChannel = suscribirCambios(
      supabaseClient().channel('chofer-datos'),
      ['mensajes_chofer', 'buses', 'avisos_sistema'],
      async () => {
        if (this.destroyed || !this.profile) return;
        this.refreshMensajesNoLeidos();
        try {
          const bus = await this.choferService.getAssignedBus(this.profile.id);
          // Solo se toca assignedBus si de verdad cambio: reasignarlo en cada
          // evento reiniciaria la vista del bus en medio de un viaje.
          if (bus?.id !== this.assignedBus?.id) {
            this.assignedBus = bus;
            await this.checkAssignmentChanged();
          }
        } catch (e) {
          logError('Chofer: refresco en vivo del bus asignado', e);
        }
      },
    ).subscribe();
  }

  ngOnDestroy() {
    this.destroyed = true;
    window.removeEventListener('online', this.alVolverLaRed);
    if (this.panicoTimer) clearTimeout(this.panicoTimer);
    if (this.liveChannel) supabaseClient().removeChannel(this.liveChannel);
    if (this.flotaChannel) supabaseClient().removeChannel(this.flotaChannel);
    if (this.flotaInterval) clearInterval(this.flotaInterval);
    if (this.tracking) {
      clearInterval(this.trackingInterval);
    }
    if (this.watchId) {
      Geolocation.clearWatch({ id: this.watchId });
    }
    this.gpsFondo.detener();
    if (this.map) {
      try { this.map.remove(); } catch {}
    }
    if (this.qrScanner) {
      try { this.qrScanner.stop(); this.qrScanner.clear(); } catch {}
    }
  }
}
