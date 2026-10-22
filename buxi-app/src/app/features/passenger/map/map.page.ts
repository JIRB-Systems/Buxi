import { Component, OnInit, OnDestroy, AfterViewInit, NgZone, ViewChild, ViewChildren, QueryList, ElementRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ViewWillEnter, ViewDidEnter, AlertController, ToastController } from '@ionic/angular';
import * as maplibregl from 'maplibre-gl';
import { Subscription } from 'rxjs';
import { RealtimeChannel } from '@supabase/supabase-js';
import { BusTrackingService, EmpresaListItem, ReporteReciente, TipoReporte } from '../../../core/services/bus-tracking.service';
import { AlertaLlegada, PushService, ResultadoPush } from '../../../core/services/push.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { BusLocation, Ruta, Parada, TarifaAresep } from '../../../core/models/transport.model';
import { REGLA_ADULTO_MAYOR, tarifaAdultoMayorTexto, tituloAresep } from '../../../core/utils/aresep';
import { diaHorario, horaCorta, proximaSalida, ProximaSalida, salidaTexto } from '../../../core/utils/horario';
import { UserProfile } from '../../../core/models/user-profile.model';
import { Anuncio, HorarioSalida, Boleto, NotificacionEmpresa } from '../../../core/models/features.model';
import { FeaturesService, PuntoGeo } from '../../../core/services/features.service';
import { Geolocation } from '@capacitor/geolocation';
import { Capacitor } from '@capacitor/core';
import {
  TrazadoRuta, LatLng, Sentido, Llegada, estimarLlegada, sentidoSegunRumbo, suavizarVelocidad,
} from '../../../core/utils/eta';
import { OpcionViaje, RutaParaViaje, SinViaje, planificarViaje } from '../../../core/utils/viaje';
import { createMap, estiloCargo, htmlMarkerEl, set3DEnabled, circlePolygon, enable3D, mapStyleUrl, tintLightMap, setRelieve, TipoMapa } from '../../../core/utils/maplibre';
import { logError } from '../../../core/utils/log';
import { esc, colorSeguro } from '../../../core/utils/html';
import { rutaCorta, tintaSobre } from '../../../core/utils/marca';
import { nombreCortoLugar } from '../../../core/utils/lugar';
import {
  SpritesBus, SPRITE_PASO_MEDIO, cargarSpritesBus, dirDeSprite,
  registrarIconoBus as registrarSpriteBus,
} from '../../../core/utils/bus-sprite';

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

// Estado que se le muestra al pasajero sobre cada bus. No es `buses.estado` de
// la base (activo / en_ruta): eso es la disponibilidad administrativa del
// vehículo. Esto se deriva en vivo de la última ubicación.
export type BusEstadoVivo = 'en_ruta' | 'retrasado' | 'en_parada';

// Referencia estable para "no hay nada que listar". Devolver un [] nuevo en cada
// ciclo de detección de cambios obliga a *ngFor a re-diferenciar una lista que
// no cambió.
const SIN_NOTIFICACIONES: NotificacionEmpresa[] = [];

// Una fila de "Próximos buses a tu parada".
interface BusProximo {
  placa: string;
  // Minutos hasta la parada; 0 = llegando; null = no viene (ver `detalle`).
  etaMinutes: number | null;
  // "a 1.4 km · hacia Cartago", "Ya pasó tu parada", "Sin señal"…
  detalle: string;
}

// Una fila de "Cerca tuyo": una ruta con parada cerca y su próximo bus.
// Altura de la hoja "Cerca tuyo" en teléfono.
type AlturaCerca = 'mini' | 'resumen' | 'lista';

interface Cercana {
  ruta: Ruta;
  parada: Parada;
  distanciaKm: number;
  // Sin bus en camino: la próxima salida según el horario ("Sale a las…").
  salida: string | null;
  salidaMin: number | null;
  // Minutos del próximo bus hacia esa parada; null = ninguno viene.
  minutos: number | null;
  hacia: string | null;
}

// Una fila del recorrido de la ruta elegida: una parada, o un bus entre dos.
interface ItemRecorrido {
  tipo: 'parada' | 'bus';
  clave: string;
  nombre: string;
  tuParada?: boolean;
  // Bus: 1 = baja hacia el final de la lista (destino), -1 = sube.
  sentido?: Sentido;
  nota?: string;
  // Bus que viene hacia la parada del pasajero.
  viene?: boolean;
  apagado?: boolean;
}

// Una opción de viaje, con lo que hace falta para mostrarla.
interface OpcionVista extends OpcionViaje {
  ruta: Ruta;
  subir: Parada;
  bajar: Parada;
  // Hacia dónde va el bus de este viaje ("Cartago").
  hacia: string;
}

// El viaje que el pasajero está armando: a dónde va y cómo puede llegar.
interface Viaje {
  destino: { nombre: string; detalle: string; lat: number; lng: number };
  // Desde dónde se calculó; null mientras no hay ubicación.
  desde: PuntoGeo | null;
  opciones: OpcionVista[];
  aPie: { metros: number; minutos: number };
  motivo: SinViaje | 'sin_ubicacion' | null;
  paradaOrigenKm: number | null;
  paradaDestinoKm: number | null;
}

@Component({
  selector: 'app-map',
  templateUrl: './map.page.html',
  // El layout de escritorio vive aparte: junto con el móvil, la hoja superaba
  // el presupuesto de estilos por componente.
  styleUrls: ['./map.page.scss', './map.panels.scss', './map.desktop.scss', './map.llegar.scss', './map.viaje.scss', './map.cliente.scss', './map.tarifas.scss', './map.invitado.scss'],
  standalone: false,
})
export class MapPage implements OnInit, AfterViewInit, OnDestroy, ViewWillEnter, ViewDidEnter {
  private map!: maplibregl.Map;
  private mapReady = false;
  private destroyed = false;
  // Rutas dibujadas como capas GeoJSON + paradas como markers HTML.
  private routeLayerIds: string[] = [];
  private routeMarkers: maplibregl.Marker[] = [];
  // Los buses NO son marcadores del DOM. Van en una capa nativa de MapLibre por
  // dos razones:
  //
  // 1. maplibregl.Marker se ubica consultando la elevación del terreno 3D, y con
  //    `setTerrain` activo esa consulta devuelve valores erróneos: el ícono se va
  //    cientos de píxeles de su posición real (maplibre-gl-js#6701). Ya mordió al
  //    equipo en el mapa de empresa, el de JIRB y el del chofer; los tres se
  //    arreglaron pasando a capas nativas. Éste era el que faltaba, y este mapa
  //    tiene pitch 50 + enable3D, o sea todas las condiciones del bug.
  // 2. Un Marker es un nodo del DOM que el navegador reposiciona en cada cuadro.
  //    Con una flota de verdad eso es un nodo por bus compitiendo con el hilo
  //    principal; la capa nativa la dibuja la GPU y el costo por bus es marginal.
  private readonly BUSES_SRC = 'buses-src';
  private readonly BUSES_LAYER = 'buses-layer';
  private busLayerListo = false;
  private busIconosRegistrados = new Set<string>();
  private busLocationsMap = new Map<string, BusLocation>();
  private busLastSeen = new Map<string, number>();
  private staleCheckInterval: any = null;

  // Interpolación: en vez de animar cada bus por separado, se guarda origen y
  // destino de cada uno y un ÚNICO requestAnimationFrame interpola a todos y
  // hace un solo setData por cuadro.
  private busAnim = new Map<string, {
    lng0: number; lat0: number; lng1: number; lat1: number;
    head0: number; head1: number; t0: number;
  }>();
  private busRaf: number | null = null;
  private readonly BUS_TWEEN_MS = 1000;
  private userMarker: maplibregl.Marker | null = null;
  private userConeMarker: maplibregl.Marker | null = null;
  private gpsHeading: number | null = null;
  private compassHeading: number | null = null;
  private lastAccuracy: number | null = null;
  private compassHandler?: (e: DeviceOrientationEvent) => void;
  locating = false;
  locationError: string | null = null;
  private locationSub: Subscription | null = null;
  private watchId: string | null = null;

  private readonly STALE_MS = 45000;
  private readonly REMOVE_MS = 5 * 60 * 1000;

  selectedBus: BusLocation | null = null;
  loading = true;
  // El mapa de fondo no cargó: se avisa en vez de dejar la pantalla vacía.
  mapaFallo = false;
  userName = '';
  activeBusCount = 0;

  // ---- Chrome flotante ----
  @ViewChild('compassNeedle') compassNeedle?: ElementRef<HTMLElement>;
  navVisible = true;
  profilePanelOpen = false;
  // Panel aparte: el avatar abre IDENTIDAD (datos, favoritos, sesion) y el
  // dock abre AJUSTES (preferencias). Antes ambos abrian el mismo panel.
  settingsPanelOpen = false;
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
  activePanel: 'rutas' | 'favoritos' | 'alertas' | 'lugares' | null = null;
  panelSearch = '';
  favoritoRutaIds = new Set<string>();
  favoritoEmpresaIds = new Set<string>();
  favoritosLoading = false;

  // Favoritos tiene dos pestañas porque son dos cosas distintas: una ruta
  // guardada es un atajo para verla en el mapa, y una empresa seguida es una
  // suscripción a sus avisos. Mezclarlas en una lista sola obligaría a
  // explicar en cada fila cuál de las dos cosas hace la estrella.
  favoritosTab: 'rutas' | 'empresas' = 'rutas';

  // ---- Alertas ----
  notificaciones: NotificacionEmpresa[] = [];
  notificacionesLoading = false;
  // Un fallo de carga tiene que verse distinto de "no hay nada". Sin estas dos
  // banderas, una consulta caída —red, sesión vencida, tabla sin migrar— pintaba
  // el mismo "Sin novedades" que un día tranquilo, y el catch vacío tampoco
  // dejaba rastro en ninguna parte para enterarse.
  notificacionesError = false;
  favoritosEmpresaError = false;
  // Hasta la primera carga, favoritoEmpresaIds vacío no significa "no sigue a
  // nadie": sin esta bandera el cartel de "Seguí una empresa" parpadearía al
  // abrir el mapa en la cara de alguien que sigue cinco.
  favoritosEmpresaCargados = false;
  private notificacionesVistasAt: string | null = null;
  private notifChannel: RealtimeChannel | null = null;

  // Se congela al abrir el panel. Si el resaltado usara la marca en vivo, al
  // entrar se actualizaría a "ahora" y los avisos nuevos dejarían de verse
  // como nuevos en el mismo instante en que el usuario los abre para leerlos.
  private notifResaltarDesde = 0;

  // Tarjeta patrocinada, mezclada en el panel de rutas — nunca en
  // favoritos (no tiene sentido publicidad entre lo que el usuario ya
  // guardó a propósito) y nunca flotando sobre el mapa en vivo.
  listAd: Anuncio | null = null;

  get panelTitle(): string {
    switch (this.activePanel) {
      case 'rutas': return 'Rutas y empresas';
      case 'favoritos': return 'Tus favoritos';
      case 'alertas': return 'Alertas';
      case 'lugares': return '¿A dónde vas?';
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

  // Empresas de la pestaña "Empresas" de favoritos: solo las que el pasajero
  // sigue, pasadas por el mismo buscador del panel.
  get panelEmpresasFavoritas(): EmpresaListItem[] {
    const q = this.panelSearch.trim().toLowerCase();
    const base = this.empresas.filter(e => this.favoritoEmpresaIds.has(e.id));
    if (!q) return base;
    return base.filter(e => e.nombre.toLowerCase().includes(q));
  }

  // Globito de la campana. Si el usuario apagó las notificaciones en su perfil
  // no se le cuenta nada: el interruptor tiene que significar algo.
  get notificacionesNoLeidas(): number {
    if (!this.notificationsEnabled) return 0;
    const visto = this.notificacionesVistasAt ? Date.parse(this.notificacionesVistasAt) : 0;
    return this.notificaciones.filter(n => Date.parse(n.created_at) > visto).length;
  }

  // El panel de Alertas se apoya en DOS consultas y no puede afirmar nada si
  // falló cualquiera de las dos: sin la lista de empresas seguidas, "todavía no
  // seguís a ninguna" es mentira; sin los avisos, "sin novedades" también.
  get alertasError(): boolean {
    return this.notificacionesError || this.favoritosEmpresaError;
  }

  // ---- SIN CUENTA ----
  // El mapa, las rutas, los horarios, las tarifas y los buses en vivo se ven
  // sin cuenta (buses_en_vivo, 20261021172627). La cuenta es para lo personal:
  // favoritos, seguir empresas, avisos y boletos.
  get esInvitado(): boolean {
    return this.perfilCargado && !this.profile;
  }
  private perfilCargado = false;

  irAEntrar() {
    this.router.navigate(['/auth/login']);
  }

  // En vez de un botón que no hace nada: explicar para qué hace falta la
  // cuenta y ofrecer entrar.
  private async pedirCuenta(para: string) {
    const alert = await this.alertCtrl.create({
      cssClass: 'buxi-alert',
      header: 'Creá tu cuenta gratis',
      message: `Necesitás una cuenta para ${para}. El mapa y los buses en vivo los podés seguir viendo sin cuenta.`,
      buttons: [
        { text: 'Ahora no', role: 'cancel' },
        { text: 'Entrar o crear cuenta', handler: () => { this.irAEntrar(); } },
      ],
    });
    await alert.present();
  }

  // Lo que el panel lista de verdad. Con el interruptor apagado, o con un fallo
  // de carga, no hay lista: en ambos casos el panel ya tiene un cartel propio
  // que lo explica, y pintar además los avisos era decir dos cosas opuestas en
  // la misma pantalla.
  get notificacionesVisibles(): NotificacionEmpresa[] {
    return this.notificationsEnabled && !this.alertasError ? this.notificaciones : SIN_NOTIFICACIONES;
  }

  notifEsNueva(n: NotificacionEmpresa): boolean {
    return Date.parse(n.created_at) > this.notifResaltarDesde;
  }

  notifIcon(t: string): string {
    return { atraso: 'time-outline', desvio: 'git-branch-outline', cancelacion: 'close-circle-outline', info: 'information-circle-outline' }[t] || 'information-circle-outline';
  }

  notifColor(t: string): string {
    return { atraso: '#ff9800', desvio: '#2196f3', cancelacion: '#f44336', info: '#00c853' }[t] || '#9aa5b4';
  }

  notifLabel(t: string): string {
    return { atraso: 'Atraso', desvio: 'Desvío', cancelacion: 'Cancelación', info: 'Información' }[t] || t;
  }

  // "hace 10 min" en vez de una fecha: en un aviso de atraso lo único que
  // importa es cuán viejo es. Se apoya en `nowTs`, que ya se refresca con el
  // reloj del componente, así que el texto envejece solo.
  notifHace(n: NotificacionEmpresa): string {
    const mins = Math.floor((this.nowTs - Date.parse(n.created_at)) / 60000);
    if (mins < 1) return 'recién';
    if (mins < 60) return `hace ${mins} min`;
    const horas = Math.floor(mins / 60);
    if (horas < 24) return `hace ${horas} h`;
    const dias = Math.floor(horas / 24);
    return dias === 1 ? 'ayer' : `hace ${dias} días`;
  }

  // Se calcula UNA vez y se guarda. Antes esto era un getter llamado desde tres
  // puntos de la plantilla: recorria todas las paradas en cada ciclo de
  // deteccion de cambios —que con el mapa corre a cada rato— y ademas devolvia
  // un array nuevo, obligando a *ngFor a reconstruir la lista entera cada vez.
  // El panel quedaba pesado y los toques se perdian.
  empresasCercanas: { empresa: EmpresaListItem; distanceKm: number | null }[] = [];
  hayEmpresasCerca = false;

  // Identidad estable para *ngFor: sin esto Angular rehace cada fila aunque
  // los datos no hayan cambiado.
  trackEmpresa = (_: number, x: { empresa: EmpresaListItem }) => x.empresa.id;

  private recomputeEmpresasCercanas() {
    if (this.userLat === 0 || this.allParadas.length === 0) {
      this.empresasCercanas = this.empresas.map(e => ({ empresa: e, distanceKm: null }));
      this.hayEmpresasCerca = false;
      return;
    }

    const rutaToEmpresa = new Map(this.allRutas.map(r => [r.id, r.empresa_id]));
    const minDist = new Map<string, number>();

    for (const p of this.allParadas) {
      const empresaId = rutaToEmpresa.get(p.ruta_id);
      if (!empresaId) continue;
      const d = this.featuresService.distanceKm(this.userLat, this.userLng, p.latitud, p.longitud);
      const actual = minDist.get(empresaId);
      if (actual === undefined || d < actual) minDist.set(empresaId, d);
    }

    const conDistancia = this.empresas
      .map(e => ({ empresa: e, distanceKm: minDist.get(e.id) ?? null }))
      .sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));

    const cercanas = conDistancia.filter(x => x.distanceKm !== null && x.distanceKm <= this.NEARBY_KM);
    this.hayEmpresasCerca = cercanas.length > 0;
    // Si no hay ninguna en el radio se muestran todas: una lista vacia no le
    // sirve a nadie, y en zona rural el bus mas cercano puede estar lejos.
    this.empresasCercanas = cercanas.length ? cercanas : conDistancia;
  }
  toggleSidebar() { this.sidebarOpen = !this.sidebarOpen; }

  async selectEmpresaFromSidebar(e: EmpresaListItem) {
    // En telefono el menu tapa el mapa, asi que se cierra al elegir: la accion
    // termina en el mapa, no en la lista.
    if (window.innerWidth < 900) this.sidebarOpen = false;
    await this.openEmpresaDetail(e);
  }

  // ---- FICHA DE EMPRESA ----
  // Antes tocar una empresa dibujaba todas sus rutas de una en el mapa, sin
  // mostrar nada de horarios. Ahora abre una ficha con sus rutas y la próxima
  // salida de cada una; desde ahí se elige la ruta puntual a dibujar. Siempre
  // tiene un botón de cerrar a mano — la razón por la que el flujo anterior
  // "atrapaba" al usuario era un caso roto (ver commit de Felipe), no que
  // mostrar una ficha esté mal en sí.
  empresaDetailOpen = false;
  empresaDetail: EmpresaListItem | null = null;
  empresaDetailRutas: (Ruta & { proximaSalidaTexto: string | null })[] = [];

  async openEmpresaDetail(empresa: EmpresaListItem) {
    const rutas = this.allRutas.filter(r => r.empresa_id === empresa.id);
    if (rutas.length === 0) {
      await this.toast(`${empresa.nombre} no tiene rutas activas todavía.`, 'warning');
      return;
    }

    this.empresaDetail = empresa;
    this.empresaDetailRutas = rutas.map(r => ({ ...r, proximaSalidaTexto: null }));
    this.empresaDetailOpen = true;

    // Se resuelve en paralelo y aparte del render inicial: la ficha ya es
    // útil (nombre, origen/destino) sin esperar a que lleguen los horarios.
    await Promise.all(this.empresaDetailRutas.map(async r => {
      try {
        const salidas = await this.tracking.getHorarioSalidas(r.id);
        const proxima = proximaSalida(salidas);
        r.proximaSalidaTexto = proxima
          ? (proxima.diasDespues === 1 ? 'mañana ' : '') + horaCorta(proxima.hora)
          : null;
      } catch {}
    }));
  }

  closeEmpresaDetail() {
    this.empresaDetailOpen = false;
    this.empresaDetail = null;
    this.empresaDetailRutas = [];
  }

  async selectRutaFromEmpresaDetail(r: Ruta) {
    this.closeEmpresaDetail();
    this.sidebarOpen = false;
    await this.selectRutaFromPanel(r);
  }

  // Dibujar TODAS las rutas de la empresa a la vez sigue siendo útil (ver
  // cobertura completa); queda como acción secundaria dentro de la ficha en
  // vez de ser lo primero que pasa al tocar la empresa.
  async verTodasEnMapa() {
    if (!this.empresaDetail) return;
    const empresa = this.empresaDetail;
    this.closeEmpresaDetail();
    this.sidebarOpen = false;
    await this.showEmpresaRoutes(empresa);
  }

  empresaNombre(ruta: Ruta): string {
    return ruta.empresa?.nombre || '';
  }

  // El buscador de la barra superior abre el panel de rutas con el cursor ya
  // puesto, en vez de navegar a otra pantalla. Antes mandaba a la página vieja
  // de rutas, que arrastraba consigo la barra inferior y el diseño anteriores.
  @ViewChild('panelSearchInput') panelSearchInput?: ElementRef<HTMLInputElement>;

  // El buscador de la barra superior busca LUGARES; el boton verde del dock
  // lleva a rutas y empresas. Antes ambos abrian el mismo panel —que ademas
  // traia su propio buscador—, asi que habia tres entradas a lo mismo.
  async openSearch(prefill = '') {
    await this.openPanel('lugares');
    this.activePanel = 'lugares';
    this.placeQuery = prefill;
    this.placeResults = [];
    if (prefill) this.runPlaceSearch(prefill);
    setTimeout(() => this.panelSearchInput?.nativeElement.focus(), 120);
  }

  // ---- BUSQUEDA DE LUGARES ----
  placeQuery = '';
  placeResults: { label: string; lat: number; lng: number }[] = [];
  placeSearching = false;
  private placeDebounce: any = null;
  private placeMarker: maplibregl.Marker | null = null;

  onPlaceSearch(ev: Event) {
    const q = (ev.target as HTMLInputElement)?.value ?? '';
    this.placeQuery = q;
    clearTimeout(this.placeDebounce);
    // El geocodificador es un servicio externo con limite de uso: se espera a
    // que el usuario deje de escribir en vez de consultar en cada tecla.
    this.placeDebounce = setTimeout(() => this.runPlaceSearch(q), 350);
  }

  private async runPlaceSearch(q: string) {
    if (q.trim().length < 2) { this.placeResults = []; this.placeSearching = false; return; }
    this.placeSearching = true;
    try {
      this.placeResults = await this.featuresService.searchPlaces(q);
    } catch {
      this.placeResults = [];
    }
    this.placeSearching = false;
  }

  // Elegir un lugar es decir a dónde se va: se marca en el mapa y se arma el
  // viaje hasta ahí. Antes solo movía el mapa y dejaba al pasajero deducir
  // qué bus le servía.
  selectPlace(p: { label: string; lat: number; lng: number }) {
    this.closePanel();
    if (!this.mapReady) return;

    // Un destino nuevo reemplaza lo que hubiera en pantalla.
    if (this.activeRuta) this.clearRoute();
    this.quitarCaminata();
    this.quitarTramoViaje();
    this.viajeElegido = null;

    this.placeMarker?.remove();
    const el = htmlMarkerEl('place-marker', '<div class="place-pin"></div>');
    this.placeMarker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([p.lng, p.lat])
      .addTo(this.map);

    this.viaje = {
      destino: { nombre: p.label.split(',')[0].trim() || p.label, detalle: p.label, lat: p.lat, lng: p.lng },
      desde: null,
      opciones: [],
      aPie: { metros: 0, minutos: 0 },
      motivo: 'sin_ubicacion',
      paradaOrigenKm: null,
      paradaDestinoKm: null,
    };
    this.planificar();
    // Con la hoja ya dibujada, para encuadrar por encima de ella.
    setTimeout(() => this.encuadrarViaje(), 60);
  }

  async openPanel(panel: 'rutas' | 'favoritos' | 'alertas' | 'lugares') {
    this.activePanel = this.activePanel === panel ? null : panel;
    this.panelSearch = '';
    if (this.activePanel) {
      // Un solo panel a la vez: perfil, ajustes y listas comparten pantalla.
      this.profilePanelOpen = false;
      this.settingsPanelOpen = false;
      this.navVisible = true;
    }
    if (this.activePanel === 'favoritos') await this.loadFavoritos();
    if (this.activePanel === 'alertas') await this.abrirAlertas();
    if (this.activePanel === 'rutas' && !this.listAd) {
      this.featuresService.getAnuncio('lista').then(ad => { this.listAd = ad; }).catch(() => {});
    }
  }

  // "Mapa" devuelve al mapa limpio, venga de donde venga.
  showMap() {
    this.activePanel = null;
    this.profilePanelOpen = false;
    this.settingsPanelOpen = false;
    this.panelSearch = '';
  }

  closePanel() {
    this.activePanel = null;
    this.panelSearch = '';
  }

  onPanelSearch(ev: Event) {
    // El input es NATIVO: el valor vive en target.value. Antes leía
    // `ev.detail.value`, que es la convención de ion-input; sobre un InputEvent
    // nativo `detail` es un número, así que daba undefined y el `?? ''` dejaba el
    // término SIEMPRE vacío. El filtro corría, pero sobre una cadena vacía.
    this.panelSearch = (ev.target as HTMLInputElement)?.value ?? '';
  }

  private async loadFavoritos() {
    if (!this.profile) return;
    this.favoritosLoading = true;
    // Cada lista se resuelve por su cuenta y no dentro de un Promise.all con
    // un solo catch: si el favorito de empresas falla —tabla todavía sin
    // migrar, por ejemplo— un catch compartido se llevaría puestos también los
    // favoritos de rutas, que venían funcionando desde antes.
    const [rutas, empresas] = await Promise.allSettled([
      this.featuresService.getFavoritos(this.profile.id),
      this.featuresService.getFavoritosEmpresa(this.profile.id),
    ]);
    if (rutas.status === 'fulfilled') {
      this.favoritoRutaIds = new Set(rutas.value.map(f => f.ruta_id));
    } else {
      logError('cargar rutas favoritas', rutas.reason);
    }
    if (empresas.status === 'fulfilled') {
      this.favoritoEmpresaIds = new Set(empresas.value.map(f => f.empresa_id));
      this.favoritosEmpresaError = false;
      this.favoritosEmpresaCargados = true;
      this.programarCercanas();
    } else {
      // Le importa sobre todo al panel de Alertas: sin esta lista,
      // favoritoEmpresaIds queda vacío y el panel le diría "todavía no seguís
      // ninguna empresa" a alguien que sigue cinco.
      logError('cargar empresas seguidas', empresas.reason);
      this.favoritosEmpresaError = true;
    }
    this.favoritosLoading = false;
  }

  isFavoritoEmpresa(empresaId: string): boolean {
    return this.favoritoEmpresaIds.has(empresaId);
  }

  // Seguir una empresa es lo que da acceso a sus buses y a sus avisos (RLS,
  // 20260830000000 y 20260930000000). Por eso al marcarla se recargan las dos
  // cosas: los buses y los avisos que ya existían aparecen de una, y no recién
  // con el próximo punto GPS o la próxima vez que se abra la app.
  async toggleFavoritoEmpresa(empresa: EmpresaListItem, ev: Event) {
    // Sin esto, seguir la empresa además la seleccionaría en el mapa.
    ev.stopPropagation();
    if (!this.profile) { this.pedirCuenta('seguir empresas y recibir sus avisos'); return; }

    const seguia = this.favoritoEmpresaIds.has(empresa.id);
    // Optimista, igual que la estrella de las rutas.
    if (seguia) this.favoritoEmpresaIds.delete(empresa.id);
    else this.favoritoEmpresaIds.add(empresa.id);

    try {
      if (seguia) await this.featuresService.removeFavoritoEmpresa(this.profile.id, empresa.id);
      else await this.featuresService.addFavoritoEmpresa(this.profile.id, empresa.id);
      if (seguia) this.quitarBusesDeEmpresa(empresa.id);
      else this.recargarBusesVisibles();
      this.programarCercanas();
      await this.toast(seguia
        ? `Dejaste de seguir a ${empresa.nombre}: ya no ves sus buses ni recibís sus avisos`
        : `Ahora ves los buses de ${empresa.nombre} y recibís sus avisos`);
      await this.loadNotificaciones();
    } catch {
      // Revertir si el servidor rechazó, para no mentirle al usuario.
      if (seguia) this.favoritoEmpresaIds.add(empresa.id);
      else this.favoritoEmpresaIds.delete(empresa.id);
    }
  }

  // ---- ALERTAS ----
  private async loadNotificaciones() {
    // Con el interruptor apagado no se pide nada y la lista queda vacía. Hasta
    // ahora solo se silenciaban el globito y el toast: los avisos igual se
    // traían y se pintaban, debajo del cartel que decía que estaban apagados.
    if (!this.notificationsEnabled) {
      this.notificaciones = [];
      this.notificacionesError = false;
      return;
    }

    this.notificacionesLoading = true;
    this.notificacionesError = false;
    try {
      this.notificaciones = await this.featuresService.getNotificaciones();
    } catch (e) {
      logError('cargar avisos de las empresas seguidas', e);
      this.notificaciones = [];
      this.notificacionesError = true;
    }
    this.notificacionesLoading = false;
  }

  // El de error es el único vacío del panel del que se puede salir sin cerrarlo,
  // así que es el único que lleva botón. Reintenta las dos consultas porque
  // cualquiera de ellas pudo ser la que falló.
  async reintentarAlertas() {
    await this.loadFavoritos();
    await this.loadNotificaciones();
  }

  private async abrirAlertas() {
    this.notifResaltarDesde = this.notificacionesVistasAt ? Date.parse(this.notificacionesVistasAt) : 0;
    await this.loadNotificaciones();
    if (!this.profile) return;
    try {
      await this.featuresService.marcarNotificacionesVistas(this.profile.id);
      this.notificacionesVistasAt = new Date().toISOString();
    } catch {}
  }

  // Realtime respeta RLS, así que por este canal solo llegan los INSERT de las
  // empresas que este pasajero sigue. Igual se vuelve a pedir la lista en vez
  // de usar la fila del payload: viene sin los joins de empresa/ruta/bus.
  private escucharNotificaciones() {
    if (this.notifChannel) return;
    this.notifChannel = this.featuresService.subscribeNotificaciones(() => {
      // El websocket resuelve fuera de la zona de Angular en algunos casos;
      // sin esto el globito no se repinta hasta el próximo toque.
      this.zone.run(async () => {
        if (this.destroyed) return;
        await this.loadNotificaciones();
        if (this.notificationsEnabled && this.activePanel !== 'alertas') {
          const ultima = this.notificaciones[0];
          if (ultima) await this.toast(`${ultima.empresa?.nombre || 'Aviso'}: ${ultima.titulo}`);
        }
      });
    });
  }

  isFavorito(rutaId: string): boolean {
    return this.favoritoRutaIds.has(rutaId);
  }

  async toggleFavorito(ruta: Ruta, ev: Event) {
    // Sin esto, marcar favorito además abriría la ruta en el mapa.
    ev.stopPropagation();
    if (!this.profile) { this.pedirCuenta('guardar rutas favoritas'); return; }

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
  async selectRutaFromPanel(ruta: Ruta, opcion: OpcionVista | null = null) {
    this.closePanel();
    if (!this.mapReady) return;

    this.loading = true;
    this.clearRoute(false);
    // Elegir una ruta a mano deja de lado el viaje que se estaba armando.
    if (opcion) this.viajeElegido = opcion; else this.cerrarViaje();
    try {
      const paradas = await this.tracking.getParadas(ruta.id);
      if (paradas.length >= 2) {
        this.activeRuta = ruta;
        this.activeParadas = paradas;
        this.updateETA();
        await this.drawRoute(paradas, ruta.color, ruta.geometria);
        this.loadHorariosFor(ruta.id);
      }
      const locations = await this.tracking.getLocationsByRuta(ruta.id);
      this.activeBusCount = locations.length;
      for (const loc of locations) this.addOrUpdateBusMarker(loc);
    } catch {}
    this.loading = false;

    if (!opcion || this.viajeElegido !== opcion) return;
    if (this.activeRuta?.id === ruta.id) this.mostrarViajeElegido();
    else this.viajeElegido = null; // la ruta no se pudo cargar
  }

  activeRuta: Ruta | null = null;
  activeParadas: Parada[] = [];
  activeSalidas: HorarioSalida[] = [];
  nearestStop: { parada: Parada; distanceKm: number } | null = null;

  // Las salidas de hoy según el día de la semana real, ordenadas por hora —
  // los buses reales no salen a intervalos parejos (ver cartel físico de
  // Liberia-Puntarenas: 5:00, 7:45, 8:30, 9:30... huecos irregulares), así que
  // se muestra la lista completa en vez de un rango con frecuencia inventada.
  get todaySalidas(): HorarioSalida[] {
    return this.salidasDeHoy(this.activeSalidas);
  }

  // La salida de hoy que se resalta en la lista de salidas del panel.
  get nextSalida(): HorarioSalida | null {
    const p = this.proximaSalidaInfo;
    if (!p || p.diasDespues !== 0) return null;
    return this.todaySalidas.find(h => h.hora === p.hora) || null;
  }

  // Según el horario, no en vivo: la pantalla lo dice.
  get proximaSalidaInfo(): ProximaSalida | null {
    return proximaSalida(this.activeSalidas);
  }

  get proximaSalidaTexto(): string | null {
    const p = this.proximaSalidaInfo;
    return p ? salidaTexto(p) : null;
  }

  private salidasPorRuta = new Map<string, HorarioSalida[]>();

  private salidaDeRuta(rutaId: string): { salida: string | null; salidaMin: number | null } {
    const p = proximaSalida(this.salidasPorRuta.get(rutaId) || []);
    return p ? { salida: salidaTexto(p), salidaMin: p.minutos } : { salida: null, salidaMin: null };
  }

  private salidasDeHoy(salidas: HorarioSalida[]): HorarioSalida[] {
    const dia = diaHorario(new Date());
    return salidas.filter(h => h.dia === dia).sort((a, b) => a.hora.localeCompare(b.hora));
  }

  private async loadHorariosFor(rutaId: string) {
    this.cargarTarifas(this.activeRuta);
    this.cargarReportes(rutaId);
    // La parada para el aviso depende de la ubicación, que puede tardar.
    setTimeout(() => this.cargarAlertaLlegada(), 1500);
    try {
      this.activeSalidas = await this.tracking.getHorarioSalidas(rutaId);
    } catch {
      this.activeSalidas = [];
    }
  }

  // ---- AVISOS EN EL TELÉFONO (push) ----
  // Avisos de las empresas que se siguen y "avisame cuando falten 5 min" (los
  // manda el servidor, llegan con la app cerrada); "bajate en la próxima" lo
  // arma el propio teléfono durante el viaje.
  pushActivo = false;
  alertaLlegada: AlertaLlegada | null = null;
  alertaCargando = false;
  private bajadaAvisada: string | null = null;

  // Con viaje elegido, la parada donde se sube; si no, la más cercana.
  get paradaParaAviso(): Parada | null {
    return this.viajeElegido?.subir ?? this.nearestStop?.parada ?? null;
  }

  private async cargarAlertaLlegada() {
    this.alertaLlegada = null;
    const ruta = this.activeRuta, parada = this.paradaParaAviso;
    if (!this.profile || !ruta || !parada) return;
    try {
      const a = await this.push.alertaActiva(ruta.id, parada.id);
      if (this.activeRuta?.id === ruta.id) this.alertaLlegada = a;
    } catch (e) {
      logError('leer la alerta de llegada', e);
    }
  }

  async togglePush() {
    if (!this.profile) { this.pedirCuenta('recibir avisos en el teléfono'); return; }
    if (this.pushActivo) {
      await this.push.desactivar().catch(e => logError('apagar push', e));
      this.pushActivo = false;
      await this.toast('Listo: no te mandamos más avisos a este teléfono');
      return;
    }
    const r = await this.push.activar();
    this.pushActivo = r === 'ok';
    await this.contarResultadoPush(r);
  }

  private async contarResultadoPush(r: ResultadoPush) {
    switch (r) {
      case 'ok': return this.toast('Listo: te vamos a avisar en este teléfono');
      case 'denegado': return this.toast('El navegador bloqueó los avisos. Activalos en los permisos del sitio.', 'warning');
      case 'no-soportado': return this.toast('Este navegador no puede recibir avisos.', 'warning');
      case 'error': return this.toast('No se pudieron activar los avisos. Probá de nuevo.', 'danger');
      case 'ios-instalar': {
        const alert = await this.alertCtrl.create({
          cssClass: 'buxi-alert',
          header: 'Primero instalá Buxci',
          message: 'En iPhone los avisos solo llegan con la app en la pantalla de inicio: tocá Compartir y después "Agregar a inicio". Abrila desde ahí y activá los avisos.',
          buttons: ['Entendido'],
        });
        await alert.present();
      }
    }
  }

  async toggleAlertaLlegada() {
    if (!this.profile) { this.pedirCuenta('que te avisemos cuando llegue tu bus'); return; }
    const ruta = this.activeRuta, parada = this.paradaParaAviso;
    if (!ruta || !parada || this.alertaCargando) return;
    this.alertaCargando = true;
    try {
      if (this.alertaLlegada) {
        await this.push.cancelarAlerta(this.alertaLlegada.id);
        this.alertaLlegada = null;
        await this.toast('Listo, ya no te avisamos');
        return;
      }
      if (!(await this.push.activo())) {
        const r = await this.push.activar();
        if (r !== 'ok') { await this.contarResultadoPush(r); return; }
        this.pushActivo = true;
      }
      await this.push.crearAlerta(ruta.id, parada.id, 5);
      await this.cargarAlertaLlegada();
      await this.toast(`Te avisamos cuando el bus esté a 5 min de ${this.nombreCorto(parada)}`);
    } catch (e: any) {
      logError('alerta de llegada', e);
      await this.toast(e?.message || 'No se pudo guardar el aviso', 'danger');
    } finally {
      this.alertaCargando = false;
    }
  }

  // "Bajate en la próxima": ya lejos de donde subió y a menos de 500 m de
  // donde baja. Una vez por viaje.
  private revisarBajada(lat: number, lng: number) {
    const o = this.viajeElegido;
    if (!o) return;
    const clave = o.rutaId + ':' + o.bajarId;
    if (this.bajadaAvisada === clave) return;
    const aBajar = this.featuresService.distanceKm(lat, lng, o.bajar.latitud, o.bajar.longitud);
    const aSubir = this.featuresService.distanceKm(lat, lng, o.subir.latitud, o.subir.longitud);
    if (aSubir < 0.4 || aBajar > 0.5) return;
    this.bajadaAvisada = clave;
    const parada = this.nombreCorto(o.bajar);
    this.push.notificarLocal('Bajate en la próxima', `Tu parada: ${parada}`, 'bajada').catch(() => {});
    this.zone.run(() => this.toast(`Bajate en la próxima: ${parada}`, 'warning'));
  }

  // ---- REPORTES DE PASAJEROS ----
  // "Ya pasó", "va lleno"...: cubren lo que el GPS no ve (empresas que todavía
  // no transmiten). Se reporta con cuenta; se lee sin cuenta y sin saber quién.
  reportesRuta: ReporteReciente[] = [];
  reportesAbiertos = false;
  enviandoReporte: TipoReporte | null = null;
  private reportesCargadosEn = 0;
  readonly TIPOS_REPORTE: { tipo: TipoReporte; texto: string; icono: string }[] = [
    { tipo: 'ya_paso', texto: 'Ya pasó', icono: 'checkmark-done-outline' },
    { tipo: 'lleno', texto: 'Va lleno', icono: 'people-outline' },
    { tipo: 'atrasado', texto: 'Atrasado', icono: 'time-outline' },
    { tipo: 'no_paso', texto: 'No pasó', icono: 'close-circle-outline' },
  ];

  private async cargarReportes(rutaId: string) {
    this.reportesCargadosEn = Date.now();
    try {
      const reportes = await this.tracking.getReportesRecientes(rutaId);
      if (this.activeRuta?.id === rutaId) this.reportesRuta = reportes;
    } catch (e) {
      logError('cargar los reportes de pasajeros', e);
    }
  }

  reporteTexto(r: ReporteReciente): string {
    switch (r.tipo) {
      case 'ya_paso': return r.parada_nombre ? `Ya pasó por ${nombreCortoLugar(r.parada_nombre, 28)}` : 'Ya pasó';
      case 'lleno': return 'Va lleno';
      case 'atrasado': return 'Viene atrasado';
      default: return 'No pasó';
    }
  }

  iconoReporte(tipo: TipoReporte): string {
    return this.TIPOS_REPORTE.find(t => t.tipo === tipo)?.icono || 'chatbubble-outline';
  }

  haceTexto(iso: string): string {
    const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
    return min < 1 ? 'recién' : `hace ${min} min`;
  }

  async reportar(tipo: TipoReporte) {
    if (!this.profile) { this.pedirCuenta('avisarle a otros pasajeros'); return; }
    const ruta = this.activeRuta;
    if (!ruta || this.enviandoReporte) return;
    this.enviandoReporte = tipo;
    try {
      await this.tracking.reportar(ruta.id, this.nearestStop?.parada.id ?? null, tipo);
      await this.toast('Gracias: ya lo ven los demás pasajeros de esta ruta');
      await this.cargarReportes(ruta.id);
    } catch (e: any) {
      // El límite de frecuencia lo pone la base con un texto para mostrar.
      await this.toast(e?.message || 'No se pudo enviar el reporte', 'warning');
    } finally {
      this.enviandoReporte = null;
    }
  }

  // ---- TARIFAS (ARESEP) ----
  // Solo para rutas enlazadas a un tramo de ARESEP: todos los tramos de ese
  // ramal, con la tarifa de adulto mayor.
  tarifasRuta: TarifaAresep[] = [];
  tarifasAbiertas = false;
  readonly tituloAresep = tituloAresep;
  readonly tarifaAM = tarifaAdultoMayorTexto;
  readonly reglaAdultoMayor = REGLA_ADULTO_MAYOR;

  private async cargarTarifas(ruta: Ruta | null) {
    this.tarifasRuta = [];
    if (!ruta?.aresep_fraccionamiento) return;
    const pedida = ruta.id;
    try {
      const tarifas = await this.tracking.getTarifasDelRamal(ruta.aresep_fraccionamiento);
      // Si mientras tanto eligió otra ruta, no pisar la suya.
      if (this.activeRuta?.id === pedida) this.tarifasRuta = tarifas;
    } catch (e) {
      logError('cargar las tarifas de ARESEP', e);
    }
  }

  get tarifaPrincipal(): TarifaAresep | null {
    const t = this.activeRuta?.aresep_fraccionamiento;
    return this.tarifasRuta.find(x => x.codigo_fraccionamiento === t) || null;
  }

  // ---- BOLETOS (QR) ----
  boletoSheetOpen = false;
  misBoletos: Boleto[] = [];
  boletoDetalle: Boleto | null = null;
  boletoQrUrl: string | null = null;
  comprandoBoleto = false;

  async comprarBoleto() {
    if (!this.activeRuta) return;
    if (!this.profile) { this.pedirCuenta('comprar boletos'); return; }
    const ruta = this.activeRuta;
    const precio = ruta.precio || 0;
    const alert = await this.alertCtrl.create({
      cssClass: 'buxi-alert',
      header: 'Comprar boleto',
      message: `Ruta ${ruta.nombre}: ₡${precio.toLocaleString('es-CR')}. El cobro todavía es simulado — no se te va a cobrar de verdad hasta que Buxci tenga un método de pago conectado.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel', cssClass: 'ba-cancel' },
        {
          text: 'Comprar', role: 'confirm', cssClass: 'ba-confirm',
          handler: async () => {
            if (!this.profile) return;
            this.comprandoBoleto = true;
            try {
              const boleto = await this.featuresService.comprarBoleto(this.profile.id, ruta);
              await this.verBoletoDetalle(boleto);
              this.boletoSheetOpen = true;
              await this.toast('Boleto generado');
            } catch (e: any) {
              await this.toast(e?.message || 'No se pudo generar el boleto', 'danger');
            } finally {
              this.comprandoBoleto = false;
            }
          },
        },
      ],
    });
    await alert.present();
  }

  async openMisBoletos() {
    if (!this.profile) { this.pedirCuenta('ver tus boletos'); return; }
    this.boletoDetalle = null;
    this.boletoQrUrl = null;
    this.boletoSheetOpen = true;
    this.profilePanelOpen = false;
    try {
      this.misBoletos = await this.featuresService.getMisBoletos(this.profile.id);
    } catch {
      this.misBoletos = [];
    }
  }

  async verBoletoDetalle(boleto: Boleto) {
    this.boletoDetalle = boleto;
    this.boletoQrUrl = await this.featuresService.generarQR(boleto.codigo);
  }

  volverAMisBoletos() {
    this.boletoDetalle = null;
    this.boletoQrUrl = null;
  }

  closeBoletoSheet() {
    this.boletoSheetOpen = false;
    this.boletoDetalle = null;
    this.boletoQrUrl = null;
  }

  // Un boleto queda 'pagado' hasta que lo escanean o se vence solo — el
  // estado en la fila no refleja el vencimiento, así que se calcula acá.
  boletoEstadoLabel(b: Boleto): string {
    if (b.estado === 'usado') return 'Usado';
    if (b.estado === 'cancelado') return 'Cancelado';
    if (b.estado === 'pagado' && new Date(b.expira_at) < new Date()) return 'Expirado';
    return 'Vigente';
  }

  etaMinutes: number | null = null;
  private userLat = 0;
  private userLng = 0;

  empresas: EmpresaListItem[] = [];
  // Paradas de todas las rutas: son las que dicen POR DONDE pasa cada empresa,
  // que es lo unico que permite saber cuales sirven la zona del usuario.
  private allParadas: Parada[] = [];

  // El menu lateral arranca abierto en escritorio y cerrado en telefono, donde
  // taparia el mapa entero. Se puede alternar en ambos.
  sidebarOpen = typeof window !== 'undefined' && window.innerWidth >= 900;
  // Radio para considerar que una empresa sirve tu zona.
  private readonly NEARBY_KM = 25;
  private allRutas: Ruta[] = [];
  selectedEmpresaId: string | null = null;

  // Los buses de la ruta abierta respecto a la parada del pasajero. Lo arma
  // updateETA(); acá solo se lee, porque la plantilla lo consulta en cada
  // ciclo de detección de cambios y recalcularlo ahí era trabajo de más.
  get nearbyBuses(): BusProximo[] {
    return this.proximos;
  }

  // ---- Ficha del bus ----
  get selectedBusEmpresa(): string {
    return (this.selectedBus?.bus as any)?.empresa?.nombre || 'Sin empresa';
  }

  // Muestra el estado VIVO (el mismo que decide el color del ícono en el mapa),
  // no `buses.estado` de la base. Ese campo es la disponibilidad administrativa
  // del vehículo y decía "Activo" incluso con el bus parado en una terminal —
  // al pasajero no le sirve de nada.
  get selectedBusEstadoVivo(): BusEstadoVivo | null {
    return this.selectedBus ? this.estadoDeBus(this.selectedBus) : null;
  }

  get selectedBusEstado(): string {
    switch (this.selectedBusEstadoVivo) {
      case 'en_parada':  return 'En parada';
      case 'retrasado':  return 'Retrasado';
      case 'en_ruta':    return 'En ruta';
      default:           return 'Sin datos';
    }
  }

  // Distancia del bus al usuario, no a la parada: es la que el pasajero mira
  // para saber si le da tiempo de llegar.
  get selectedBusDistanceKm(): number | null {
    if (!this.selectedBus || this.userLat === 0) return null;
    return this.featuresService.distanceKm(
      this.selectedBus.latitud, this.selectedBus.longitud, this.userLat, this.userLng,
    );
  }

  // Cuánto le falta al bus elegido para llegar a la parada del pasajero: la
  // más cercana a él sobre la ruta de ESE bus. Antes era el tiempo en línea
  // recta hasta donde está parado el pasajero, como si el bus fuera a
  // buscarlo a la puerta.
  get selectedBusLlegada(): string | null {
    const loc = this.selectedBus;
    if (!loc || this.userLat === 0) return null;
    const rutaId = this.rutaDelBus(loc.bus_id);
    if (!rutaId) return null;
    const paradas = this.paradasPorRuta.get(rutaId)
      ?? (this.activeRuta?.id === rutaId ? this.activeParadas : []);
    const cercana = this.featuresService.findNearestStop(this.userLat, this.userLng, paradas);
    if (!cercana) return null;
    const r = this.llegadaDe(loc, cercana.parada);
    if (!r) return null;
    switch (r.llegada.estado) {
      case 'llegando': return 'Llegando';
      case 'viene':    return `${r.llegada.minutos} min`;
      case 'ya_paso':  return 'Ya pasó';
      default:         return null;
    }
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
  // El diseño del ícono (silueta asimétrica, trompa angosta y cola ancha) vive
  // ahora en `registrarIconoBus`, dibujado sobre un canvas. Era un SVG en el
  // DOM hasta que los buses pasaron a una capa nativa de MapLibre.

  // ---- ÍCONO DEL BUS: SPRITES ISOMÉTRICOS DEL MODELO 3D ----
  //
  // El ícono ya no se dibuja a mano: son 16 renders del modelo de Blender
  // (`diseno/bus_buxi.blend`), uno cada 22.5°, repartidos en DOS hojas —
  // carrocería en blanco por un lado, detalles (vidrios, ruedas, luces) por
  // otro. Se separan porque el color de la ruta tiene que teñir SOLO la
  // carrocería: tiñendo la imagen entera, el parabrisas de un bus azul saldría
  // azul y las ruedas también.
  //
  // El rumbo va horneado en el sprite, NO en `icon-rotate`: un dibujo
  // isométrico rotado en pantalla se ve torcido. Por eso la capa es billboard
  // ('viewport') y lo que cambia según el rumbo es cuál de los 16 sprites se usa.
  // Las hojas de sprites, el teñido y el paso angular viven en
  // core/utils/bus-sprite: los comparte con el mapa del chofer, para que el
  // bus sea el mismo dibujo en las dos pantallas y no dos copias que se van
  // separando con el tiempo.
  private sprites: SpritesBus | null = null;

  private colorDeEstado(estado: BusEstadoVivo, colorRuta: string): string {
    if (estado === 'retrasado') return '#f5a623';
    if (estado === 'en_parada') return '#9aa3b2';
    return colorRuta;
  }

  // Índice de sprite según el rumbo. Se le RESTA la rotación del mapa: el
  // sprite está dibujado en espacio de pantalla, así que si el usuario gira el
  // mapa el bus tiene que girar con él o quedaría apuntando a cualquier lado.
  private dirDeBus(loc: BusLocation): number {
    return dirDeSprite(loc.heading || 0, this.map ? this.map.getBearing() : 0);
  }

  private async cargarSprites(): Promise<void> {
    if (this.sprites) return;
    // Sin sprites no se dibuja ningún bus, pero el mapa sigue usable: eso lo
    // decide acá, la utilidad solo devuelve null si no pudo cargarlos.
    const sprites = await cargarSpritesBus();
    if (this.destroyed || !sprites) return;
    this.sprites = sprites;
    this.refrescarIconos();
  }

  // Recalcula el ícono de cada bus. Se llama al cargar los sprites, al girar el
  // mapa y después de un cambio de estilo (que borra las imágenes registradas).
  private refrescarIconos() {
    this.busIcono.clear();
    this.busLocationsMap.forEach((loc, id) => this.busIcono.set(
      id, this.registrarIconoBus(this.estadoDeBus(loc), this.busColor(loc), this.dirDeBus(loc))));
    this.pintarBuses(performance.now());
  }

  // Lo propio del pasajero es el color: el estado vivo del bus (retrasado, en
  // parada) pisa el color de la ruta. El dibujo en sí es compartido.
  private registrarIconoBus(estado: BusEstadoVivo, colorRuta: string, dir: number): string {
    return registrarSpriteBus(
      this.map,
      this.sprites,
      this.colorDeEstado(estado, colorRuta),
      dir,
      this.busIconosRegistrados,
    );
  }

  // ---- ESTADO VIVO DEL BUS ----
  //
  // 'en_parada': casi detenido y a menos de 70 m de una parada de su ruta.
  // 'retrasado': su salida programada ya pasó hace más de RETRASO_MIN minutos.
  //              Se calcula contra horario_salidas, que es la fuente correcta —
  //              hoy esa tabla está vacía, así que este estado no se enciende
  //              nunca. Es a propósito: preferimos que no aparezca a inventar un
  //              retraso que no podemos justificar con datos.
  // 'en_ruta':   todo lo demás.
  private readonly PARADA_RADIO_KM = 0.07;
  private readonly PARADA_VEL_MAX = 3;
  private readonly RETRASO_MIN = 5;

  // bus -> ruta y ruta -> paradas, cargados una vez. Sin esto "En parada" solo
  // funcionaba con una ruta abierta, que es la minoría del tiempo que el
  // pasajero pasa en el mapa.
  private busRuta = new Map<string, string>();
  private paradasPorRuta = new Map<string, Parada[]>();
  // bus -> empresa, para poder sacar del mapa los buses de una empresa que se
  // deja de seguir: el punto que llega por Realtime trae el bus_id pelado.
  private busEmpresa = new Map<string, string>();

  private paradasDelBus(loc: BusLocation): Parada[] {
    const rutaId = this.busRuta.get(loc.bus_id);
    if (rutaId) return this.paradasPorRuta.get(rutaId) || [];
    // Si la ruta del bus no se conoce, se cae a la ruta abierta (si la hay).
    return this.activeParadas;
  }

  private empresaDelBus(busId: string, loc?: BusLocation): string | undefined {
    const directa = this.busEmpresa.get(busId) || loc?.bus?.empresa_id;
    if (directa) return directa;
    const rutaId = this.busRuta.get(busId);
    return rutaId ? this.allRutas.find(r => r.id === rutaId)?.empresa_id : undefined;
  }

  // Al dejar de seguir una empresa, RLS deja de mandar sus puntos, pero los
  // buses que ya estaban dibujados seguirían ahí (atenuados) hasta REMOVE_MS.
  // Se sacan en el momento: si no, el pasajero ve que "dejar de seguir" no hizo
  // nada durante cinco minutos.
  private quitarBusesDeEmpresa(empresaId: string) {
    const ids: string[] = [];
    this.busLocationsMap.forEach((loc, busId) => {
      if (this.empresaDelBus(busId, loc) === empresaId) ids.push(busId);
    });
    if (!ids.length) return;

    for (const id of ids) {
      this.busLocationsMap.delete(id);
      this.busLastSeen.delete(id);
      this.busAnim.delete(id);
      this.busIcono.delete(id);
    }
    this.tracking.olvidarBuses(ids);

    if (this.selectedBus && ids.includes(this.selectedBus.bus_id)) this.closeBusInfo();
    if (this.followBusId && ids.includes(this.followBusId)) this.stopFollowing();

    this.activeBusCount = this.busLocationsMap.size;
    if (this.busLayerListo) this.pintarBuses(performance.now());
  }

  // Al empezar a seguir una empresa, RLS ya deja ver sus buses: se piden de
  // nuevo en vez de esperar a que cada uno mande su próximo punto.
  private async recargarBusesVisibles() {
    if (!this.activeRuta) {
      await this.loadBusLocations();
      return;
    }
    try {
      const locations = await this.tracking.getLocationsByRuta(this.activeRuta.id);
      for (const loc of locations) this.addOrUpdateBusMarker(loc);
    } catch (e) {
      logError('recargar los buses de la ruta', e);
    }
  }

  private estadoDeBus(loc: BusLocation): BusEstadoVivo {
    const paradas = this.paradasDelBus(loc);
    if ((loc.velocidad ?? 0) <= this.PARADA_VEL_MAX && paradas.length) {
      const cerca = paradas.some(p =>
        this.featuresService.distanceKm(loc.latitud, loc.longitud, p.latitud, p.longitud)
          <= this.PARADA_RADIO_KM);
      if (cerca) return 'en_parada';
    }
    if (this.minutosDeRetraso() > this.RETRASO_MIN) return 'retrasado';
    return 'en_ruta';
  }

  // Minutos transcurridos desde la salida programada más reciente de la ruta
  // activa. Sin horarios cargados devuelve 0 y nadie queda marcado como tarde.
  private minutosDeRetraso(): number {
    if (!this.activeSalidas?.length) return 0;
    const ahora = new Date();
    const minutosAhora = ahora.getHours() * 60 + ahora.getMinutes();
    let mejor = -1;
    for (const s of this.activeSalidas) {
      const [hh, mm] = String((s as any).hora || '').split(':').map(Number);
      if (isNaN(hh) || isNaN(mm)) continue;
      const m = hh * 60 + mm;
      if (m <= minutosAhora && m > mejor) mejor = m;
    }
    return mejor < 0 ? 0 : minutosAhora - mejor;
  }

  // Color de la ruta por bus, cacheado. Hace falta porque las dos fuentes de
  // ubicaciones no traen lo mismo: la carga inicial (getLatestLocations) viene
  // con el join a buses→rutas, pero el payload de Realtime es la fila cruda de
  // bus_locations y no lo trae. Sin caché, un bus que aparecía por Realtime se
  // pintaba con el verde de respaldo — y como el elemento del marcador se crea
  // una sola vez, se quedaba verde para siempre aunque su ruta fuera de otro
  // color.
  // empresa_id -> color elegido en Personalización. Se carga al abrir el mapa
  // y manda sobre el color de la ruta (ver busColor).
  private coloresEmpresa = new Map<string, string>();
  private busColors = new Map<string, string>();
  private readonly BUS_COLOR_FALLBACK = '#00c853';

  // El color de la empresa gana sobre el de la ruta: si una empresa eligió su
  // color en Personalización, toda su flota se ve de ese color aunque cada
  // unidad ande por una ruta distinta. Es lo que pidió el panel de empresa, y
  // tiene una consecuencia buscada: se gana identidad de empresa y se pierde
  // el poder distinguir rutas por el color del bus. La línea de la ruta en el
  // mapa sigue usando su propio color, así que el recorrido no se confunde.
  //
  // Sin color_bus (el caso de toda empresa que no entró a personalizar) esto
  // se comporta exactamente como antes.
  private busColor(loc: BusLocation): string {
    const bus = loc.bus as any;
    const crudo = this.coloresEmpresa.get(bus?.empresa_id) || bus?.ruta?.color;
    if (crudo) {
      const color = colorSeguro(crudo);
      this.busColors.set(loc.bus_id, color);
      return color;
    }
    return this.busColors.get(loc.bus_id) || this.BUS_COLOR_FALLBACK;
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
    private elRef: ElementRef<HTMLElement>,
    private push: PushService,
  ) {}

  // Ionic calcula --offset-top a partir de un ion-header que esta pagina
  // nunca tiene, pero tras la transicion de pagina desde /auth/login esa
  // cuenta queda pegada en la altura completa del viewport (bug propio de
  // Ionic) -- duplicando el alto real de .inner-scroll y corriendo todo el
  // contenido, mapa incluido, una pantalla entera hacia arriba. Ionic lo fija
  // via inline style (mayor especificidad que cualquier regla en el SCSS del
  // componente), asi que hay que pisarlo igual, por JS.
  private fixContentOffset() {
    const ic = this.elRef.nativeElement.querySelector('ion-content') as HTMLElement | null;
    if (!ic) return;
    ic.style.setProperty('--offset-top', '0px');
    ic.style.setProperty('--offset-bottom', '0px');
  }

  // El mapa arranca en paralelo a ngOnInit, así que antes podía crear el
  // marcador y evaluar la ubicación con `profile` todavía en null: la foto no
  // entraba en la chapa y la provincia de referencia no existía. initMap espera
  // esta promesa antes de tocar nada que dependa del perfil.
  private profileReady!: Promise<void>;

  async ngOnInit() {
    this.profileReady = this.loadProfile();
    await this.profileReady;
  }

  private async loadProfile() {
    try {
      const profile = await this.supabase.getProfile();
      if (profile) {
        this.profile = profile;
        this.userName = profile.nombre_completo.split(' ')[0];
        const center = PROVINCIA_CENTERS[(profile.provincia || '').trim().toLowerCase()];
        if (center) this.initialCenter = center;
        // Las preferencias se leen ACÁ y no al abrir el panel: el estilo del
        // mapa depende de `darkMode`, y initMap espera esta carga. Si se
        // leyeran después, el mapa abriría en oscuro y saltaría a claro al
        // abrir el perfil por primera vez.
        await this.loadPreferences();
      }
    } catch {}
    this.perfilCargado = true;
    if (this.profile) this.push.activo().then(a => this.pushActivo = a).catch(() => {});

    try {
      const [empresas, rutas, paradas] = await Promise.all([
        this.tracking.getEmpresas(),
        this.tracking.getRutas(),
        this.tracking.getAllParadas(),
      ]);
      this.empresas = empresas;
      this.allRutas = rutas;
      this.recalcularParadaCercana();
      this.allParadas = paradas;
      this.recomputeEmpresasCercanas();
    } catch {}

    // Aparte: si falla, "Cerca tuyo" solo se queda sin la próxima salida.
    this.tracking.getTodasLasSalidas().then(salidas => {
      this.salidasPorRuta.clear();
      for (const s of salidas) {
        const arr = this.salidasPorRuta.get(s.ruta_id);
        if (arr) arr.push(s); else this.salidasPorRuta.set(s.ruta_id, [s]);
      }
      this.programarCercanas();
    }).catch(e => logError('cargar los horarios de salida', e));

    // Los favoritos y las alertas se cargan al arrancar y no al abrir cada
    // panel: la estrella de las empresas se pinta en la barra lateral, que se
    // ve sin abrir nada, y el globito de la campana tiene que estar bien desde
    // el primer segundo.
    await this.loadFavoritos();
    await this.loadNotificaciones();
    this.escucharNotificaciones();
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
      // Antes esto abria openSearch(), que buscaba rutas por nombre de empresa.
      // Cuando openSearch paso a buscar LUGARES, este llamador quedo apuntando
      // al buscador equivocado: mandaba el nombre de la empresa al
      // geocodificador, que no devuelve nada, y dejaba al usuario encerrado en
      // un panel incapaz de ayudarlo. Ahora simplemente se dice lo que pasa.
      await this.toast(`${empresa.nombre} no tiene rutas activas todavia.`, 'warning');
      return;
    }

    this.loading = true;
    this.clearRoute(false);
    this.selectedEmpresaId = empresa.id;

    try {
      // En paralelo, no en fila. Cada ruta hace varias llamadas de red (paradas,
      // trazado por calles en OSRM, ubicaciones), y encadenarlas dejaba la
      // pantalla bloqueada por el overlay durante segundos con varias rutas.
      const porRuta = await Promise.all(rutas.map(async ruta => ({
        ruta,
        paradas: await this.tracking.getParadas(ruta.id),
        locations: await this.tracking.getLocationsByRuta(ruta.id),
      })));

      const allCoords: [number, number][] = [];
      for (const { ruta, paradas, locations } of porRuta) {
        if (paradas.length >= 2) {
          allCoords.push(...await this.drawRouteLayer(paradas, ruta.color, ruta.geometria));
        }
        for (const loc of locations) this.addOrUpdateBusMarker(loc);
      }
      this.activeBusCount = this.busLocationsMap.size;

      if (allCoords.length > 0) {
        const bounds = allCoords.reduce(
          (b, coord) => b.extend(coord),
          new maplibregl.LngLatBounds(allCoords[0], allCoords[0]),
        );
        // maxZoom: la caja se siembra con un punto, asi que una ruta con
        // todas sus paradas casi en el mismo lugar la deja de area cero y
        // fitBounds se va al zoom maximo, bajo el terreno 3D.
        this.map.fitBounds(bounds, { padding: this.margenDeEncuadre(), duration: 300, maxZoom: 16 });
      } else {
        // Rutas registradas pero sin paradas suficientes para trazarlas.
        await this.toast(`${empresa.nombre} aun no tiene paradas cargadas.`, 'warning');
        this.selectedEmpresaId = null;
      }
    } catch {
      // Antes se tragaba en silencio: la empresa quedaba marcada como activa
      // sin nada dibujado y no habia forma de saber que fallo.
      this.selectedEmpresaId = null;
      await this.toast('No se pudieron cargar las rutas de esa empresa.', 'danger');
    } finally {
      // En finally: si algo lanza, el overlay bloqueaba la pantalla para siempre.
      this.loading = false;
    }
  }

  ngAfterViewInit() {
    this.fixContentOffset();
    setTimeout(() => this.initMap(), 150);

    if (typeof ResizeObserver !== 'undefined') {
      this.hojaObs = new ResizeObserver(() => this.medirHoja());
      this.hojas.changes.subscribe(() => this.observarHoja());
      this.observarHoja();
    }
  }

  // La hoja de abajo (ruta o viaje) cambia de alto según lo que muestra. Los
  // controles del mapa se apoyan justo encima, así que su posición sale de
  // medirla: con un número fijo, cada cosa nueva en la hoja los tapaba.
  @ViewChildren('hoja') private hojas!: QueryList<ElementRef<HTMLElement>>;
  private hojaObs: ResizeObserver | null = null;
  private hojaAlto = 0;

  private observarHoja() {
    this.hojaObs?.disconnect();
    const el = this.hojas.first?.nativeElement;
    if (el) this.hojaObs?.observe(el);
    this.medirHoja();
  }

  private medirHoja() {
    this.hojaAlto = this.hojas.first?.nativeElement.offsetHeight ?? 0;
    this.elRef.nativeElement.style.setProperty('--bx-hoja-alto', `${this.hojaAlto}px`);
  }

  ionViewDidEnter() {
    this.fixContentOffset();
  }

  ionViewWillEnter() {
    this.fixContentOffset();
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
    // Sin esto, el mapa podía arrancar antes que el perfil y quedarse con el
    // centro por defecto en vez de la provincia del usuario.
    await this.profileReady?.catch(() => {});

    // MapLibre usa [lng, lat]. Arranca en la provincia del perfil; la
    // geolocalización lo afina después.
    this.map = await createMap({
      container: 'map',
      center: this.initialCenter,
      zoom: 13,
      pitch: 50,
      threeD: true,
      style: this.darkMode ? 'streets-v2-dark' : 'outdoor-v2',
    });
    // Si el usuario navegó fuera mientras el estilo cargaba, no operar sobre
    // un mapa huérfano (evita errores async que rompen la navegación).
    if (this.destroyed) { try { this.map.remove(); } catch {} return; }

    this.mapReady = true;
    // Si el estilo no cargó (clave de MapTiler rechazada, sin red), dibujar
    // rutas y buses encima tira errores; sin el finally el "Cargando mapa"
    // quedaba para siempre tapando toda la pantalla.
    try {
      setRelieve(this.map, this.tipoMapa === 'relieve', this.darkMode);

      const rutaId = this.route.snapshot.queryParams['ruta'] || null;
      if (rutaId) {
        await this.loadRoute(rutaId);
      } else {
        await this.loadBusLocations();
      }
      this.abrirBusCompartido();

      this.setupMapChrome();
      this.startClock();
      this.startRealtimeTracking();
      this.startUserLocation();
      this.startCompass();
      this.startStaleBusWatcher();
    } catch (e) {
      logError('iniciar el mapa', e);
    } finally {
      this.mapaFallo = !estiloCargo(this.map);
      this.loading = false;
    }
  }

  reintentarMapa() {
    location.reload();
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

      // Si el pasajero arrastra el mapa con la lista de "Cerca tuyo" abierta,
      // quiere ver el mapa: la hoja baja a resumen. Solo con 'dragstart', que
      // es del usuario; 'movestart' también salta cuando la app mueve la
      // cámara sola. No se recuerda: la próxima vez sigue abriendo como la dejó.
      this.map.on('dragstart', () => {
        if (this.cercaAltura === 'lista') this.zone.run(() => this.ponerCercaAltura('resumen', false));
      });

      // Las etiquetas de parada solo se muestran con zoom suficiente. Se
      // resuelve con una clase en el contenedor del mapa en vez de tocar cada
      // marcador: son decenas, y esto es un unico cambio de clase.
      const LABEL_MIN_ZOOM = 12.5;
      const syncLabels = () => {
        this.map.getContainer().classList.toggle('map-zoomed-in', this.map.getZoom() >= LABEL_MIN_ZOOM);
      };
      syncLabels();
      this.map.on('zoom', syncLabels);

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
    if (!visible && (this.profilePanelOpen || this.settingsPanelOpen)) return;
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
  // Por defecto oscuro: es la identidad de la app. Sólo cambia si el usuario
  // guardó lo contrario.
  darkMode = true;

  // Predeterminado (plano, como Google) o Relieve. Se guarda en el teléfono y
  // no en user_preferences: es cómo prefiere ver el mapa en ESTE dispositivo,
  // y así el ajuste no depende de una migración.
  tipoMapa: TipoMapa = (() => {
    try {
      return localStorage.getItem('buxi.tipoMapa') === 'relieve' ? 'relieve' : 'predeterminado';
    } catch {
      return 'predeterminado';
    }
  })();

  setTipoMapa(tipo: TipoMapa) {
    if (this.tipoMapa === tipo) return;
    this.tipoMapa = tipo;
    try { localStorage.setItem('buxi.tipoMapa', tipo); } catch {}
    if (this.mapReady) setRelieve(this.map, tipo === 'relieve', this.darkMode);
  }
  readonly provincias = [
    'San José', 'Alajuela', 'Cartago', 'Heredia', 'Guanacaste', 'Puntarenas', 'Limón',
  ];

  async toggleSettingsPanel() {
    this.settingsPanelOpen = !this.settingsPanelOpen;
    if (this.settingsPanelOpen) {
      this.profilePanelOpen = false;
      this.activePanel = null;
      this.navVisible = true;
      await this.loadPreferences();
    }
  }

  async toggleProfilePanel() {
    this.profilePanelOpen = !this.profilePanelOpen;
    if (this.profilePanelOpen) {
      this.settingsPanelOpen = false;
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
        this.notificacionesVistasAt = prefs.notificaciones_vistas_at;
      }
    } catch (e) {
      // No es inocuo: sin preferencias el interruptor se queda en "encendido" y
      // la marca de leído en null, así que TODO cuenta como no leído y el
      // globito de la campana aparece lleno sin motivo.
      logError('cargar preferencias del pasajero', e);
    }
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
    // El interruptor corta la entrega, no solo el globito: al prenderlo hay que
    // traer lo que se publicó mientras estuvo apagado, y al apagarlo la lista se
    // vacía sola ahí adentro.
    await this.loadNotificaciones();
    if (!this.profile) return;
    try {
      await this.featuresService.savePreferences(this.profile.id, {
        notifications_enabled: this.notificationsEnabled,
      });
    } catch (e) {
      logError('guardar preferencia de notificaciones', e);
      this.notificationsEnabled = !this.notificationsEnabled;
      await this.loadNotificaciones();
      await this.toast('No se pudo guardar la preferencia', 'danger');
    }
  }

  // Este interruptor cambia el ESTILO DEL MAPA, no una clase en el body.
  //
  // Antes alternaba `body.dark`, que servía cuando el pasajero tenía pantallas
  // claras. Al quedar todo sobre el mapa —que ya era oscuro— no había nada que
  // oscurecer y el botón no hacía nada visible. En una app donde el mapa es el
  // 90% de la pantalla, "modo oscuro" sólo puede significar esto.
  async toggleDarkMode() {
    this.darkMode = !this.darkMode;
    // Se conserva para las páginas que siguen fuera del mapa (legales, auth).
    document.body.classList.toggle('dark', this.darkMode);
    this.applyMapTheme();

    if (!this.profile) return;
    try {
      await this.featuresService.savePreferences(this.profile.id, { dark_mode: this.darkMode });
    } catch {}
  }

  // setStyle descarta TODAS las fuentes y capas propias: relieve, edificios,
  // la ruta dibujada y el círculo de precisión. Los marcadores sobreviven
  // porque son DOM, no estilo. Por eso hay que rehacer lo demás cuando el
  // estilo nuevo termina de cargar.
  private applyMapTheme() {
    if (!this.mapReady) return;

    this.map.setStyle(mapStyleUrl(this.darkMode ? 'streets-v2-dark' : 'outdoor-v2'));

    this.map.once('style.load', async () => {
      if (this.destroyed) return;

      if (this.is3D) {
        try { enable3D(this.map, this.darkMode); } catch {}
      }
      // El repintado va DESPUÉS del 3D (enable3D inserta la capa de edificios y
      // este paso ajusta el resto de la paleta), y va SIEMPRE: estaba adentro
      // del if de arriba, así que en 2D el modo claro quedaba con el estilo de
      // montaña crudo de MapTiler, con relieve y nombres en inglés.
      if (!this.darkMode) { try { tintLightMap(this.map); } catch {} }
      setRelieve(this.map, this.tipoMapa === 'relieve', this.darkMode);

      // El círculo se redibuja desde la última posición conocida.
      if (this.userLat !== 0) {
        this.updateAccuracyCircle(this.userLng, this.userLat, this.lastAccuracy);
      }

      // Y la ruta activa, si había uno dibujada.
      if (this.activeRuta && this.activeParadas.length >= 2) {
        this.routeLayerIds = [];
        try {
          await this.drawRouteLayer(this.activeParadas, this.activeRuta.color, this.activeRuta.geometria);
        } catch {}
      }

      // El camino a pie, si había uno dibujado.
      try { this.dibujarCaminata(); } catch {}
      try { this.dibujarTramoViaje(); } catch {}

      // setStyle destruye fuentes, capas Y las imágenes registradas con
      // addImage. Sin esto la capa de buses quedaba marcada como "lista"
      // apuntando a algo que ya no existe, y los buses desaparecían para
      // siempre al cambiar de tema.
      // Los ids cacheados apuntan a imágenes que setStyle acaba de borrar:
      // hay que volver a registrarlas antes del próximo volcado.
      this.busLayerListo = false;
      this.busIconosRegistrados.clear();
      this.refrescarIconos();
    });
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
    set3DEnabled(this.map, this.is3D, this.darkMode);
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
      let cambio = false;
      this.busLastSeen.forEach((lastSeen, busId) => {
        const age = now - lastSeen;
        if (age > this.REMOVE_MS) {
          this.busLocationsMap.delete(busId);
          this.busLastSeen.delete(busId);
          this.busAnim.delete(busId);
          this.busIcono.delete(busId);
          cambio = true;
        } else if (age > this.STALE_MS) {
          // La atenuación la resuelve `icon-opacity` leyendo la propiedad
          // `stale`, que pintarBuses recalcula en cada volcado.
          cambio = true;
        }
      });
      if (cambio) {
        this.activeBusCount = this.busLocationsMap.size;
        this.pintarBuses(performance.now());
      }
      // Un bus que deja de transmitir no manda ningún punto que dispare el
      // recálculo: sin esto su "llega en 4 min" se quedaba congelado.
      if (this.activeRuta) this.zone.run(() => this.updateETA());
      else this.zone.run(() => this.programarCercanas());
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
      this.updateETA();
      await this.drawRoute(paradas, ruta.color, ruta.geometria);
      this.loadHorariosFor(rutaId);

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
    // Mismo motivo que el otro fitBounds de esta pantalla: sin tope, una
    // caja de area cero manda la camara al zoom maximo.
    this.map.fitBounds(bounds, { padding: this.margenDeEncuadre(), duration: 0, maxZoom: 16 });
  }

  // fitBounds calcula el encuadre como si el mapa se viera desde arriba. Con la
  // vista inclinada, lo que queda cerca de la cámara se agranda y en un mapa
  // ancho el final de la ruta se salía de la pantalla. El margen lateral crece
  // con el ancho del mapa; en el teléfono sigue siendo el de siempre.
  private margenDeEncuadre(): number | { top: number; bottom: number; left: number; right: number } {
    const ancho = this.map?.getContainer().clientWidth ?? 0;
    const lateral = Math.round(ancho * 0.13);
    if (lateral <= 60) return 60;
    return { top: 70, bottom: 70, left: lateral, right: lateral };
  }

  // Dibuja una ruta (línea + paradas) sin encuadrar el mapa, para poder
  // dibujar varias rutas seguidas y encuadrar todas juntas al final.
  private async drawRouteLayer(paradas: Parada[], color: string, geometria?: [number, number][] | null): Promise<[number, number][]> {
    const c = colorSeguro(color);
    // Coords guardadas en formato Leaflet [lat, lng]; MapLibre las quiere [lng, lat].
    const latlng: [number, number][] = geometria?.length
      ? geometria
      : await this.featuresService.fetchRoadRouteCoords(paradas);
    const coords: [number, number][] = latlng.map(([lat, lng]) => [lng, lat]);

    // Si la ruta no traía trazado guardado, este (por calles) es mejor que
    // la línea entre paradas para calcular las llegadas: se recuerda.
    const rutaId = paradas[0]?.ruta_id;
    if (rutaId && !geometria?.length && latlng.length > paradas.length) {
      this.trazadoCalculado.set(rutaId, latlng);
      this.trazados.delete(rutaId);
    }

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
      const nombreCorto = this.nombreParadaCorto(parada.nombre);
      const html = isTerminal
        ? `<div class="stop-terminal" style="border-color:${c}"><div class="stop-inner" style="background:${c}"></div></div><div class="stop-label" title="${esc(parada.nombre)}">${esc(nombreCorto)}</div>`
        : `<div class="stop-dot" style="border-color:${c}"></div>`;
      const el = htmlMarkerEl('stop-marker', html);
      const m = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([parada.longitud, parada.latitud])
        .addTo(this.map);
      this.routeMarkers.push(m);
    });

    return coords;
  }

  // Muchas paradas quedaron guardadas con el nombre COMPLETO que devuelve el
  // geocodificador —"...Norte, Peñas Blancas, La Cruz, Guanacaste, 51001,
  // Costa Rica"—, asi que la etiqueta se estiraba de punta a punta del mapa.
  //
  // Se queda con el primer tramo, que es el nombre real del lugar; el resto
  // (canton, provincia, codigo postal, pais) es contexto que el mapa ya da.
  // El nombre completo sigue disponible en el title, al pasar el cursor.
  private nombreParadaCorto(nombre: string): string {
    return nombreCortoLugar(nombre, 24) || nombre;
  }

  /** Para las listas: el nombre del lugar sin la dirección entera detrás. */
  lugarCorto(nombre: string | null | undefined): string {
    return nombreCortoLugar(nombre, 34);
  }

  clearRoute(navigate = true) {
    this.quitarCaminata();
    // El viaje sigue armado (se vuelve a la lista de opciones); lo que se va
    // es la opción elegida, que era de esta ruta.
    this.quitarTramoViaje();
    this.viajeElegido = null;
    this.routeLayerIds.forEach(id => {
      if (this.map.getLayer(id)) this.map.removeLayer(id);
    });
    // Cada par de layers comparte un source (route-<ts>); quitarlos.
    const srcIds = new Set(this.routeLayerIds.map(id => id.replace(/-bg$|-main$/, '')));
    srcIds.forEach(sid => { if (this.map.getSource(sid)) this.map.removeSource(sid); });
    this.routeLayerIds = [];

    this.routeMarkers.forEach(m => m.remove());
    this.routeMarkers = [];

    this.busLocationsMap.clear();
    this.busLastSeen.clear();
    this.busAnim.clear();
    this.busIcono.clear();
    if (this.busLayerListo) this.pintarBuses(performance.now());
    this.activeBusCount = 0;
    this.selectedBus = null;
    this.followBusId = null;
    this.activeRuta = null;
    this.activeParadas = [];
    this.updateETA();
    this.activeSalidas = [];
    this.tarifasRuta = [];
    this.reportesRuta = [];
    this.alertaLlegada = null;
    this.selectedEmpresaId = null;

    if (navigate) {
      this.router.navigate(['/passenger/map'], { replaceUrl: true, queryParams: {} });
      this.loadBusLocations();
    }
  }

  private async loadBusLocations() {
    // Los sprites se piden en paralelo con los datos; cuando llegan,
    // cargarSprites() refresca los iconos por su cuenta.
    this.cargarSprites();

    // Se cebá el caché de colores ANTES de dibujar: así un bus que todavía no
    // transmitía al abrir el mapa, y que por lo tanto va a llegar por Realtime
    // (sin el join a su ruta), ya tiene su color resuelto cuando se cree su
    // marcador. Si esta consulta falla no se corta la carga: el mapa igual
    // dibuja los buses, apenas con el color de respaldo.
    try {
      const [buses, paradas, colores] = await Promise.all([
        this.tracking.getActiveBuses(),
        this.tracking.getAllParadas(),
        // Antes de cebar el caché: si llegara después, los buses ya dibujados
        // se quedarían con el color de la ruta hasta el próximo refresco.
        this.tracking.getColoresBusEmpresas(),
      ]);
      this.coloresEmpresa = colores;
      for (const b of buses) {
        // Misma precedencia que busColor(): el color que eligió la empresa
        // gana sobre el de la ruta. Si acá se cebara solo con el de la ruta,
        // un bus que empieza a transmitir con el mapa ya abierto se quedaría
        // con el color viejo — que es justo el caso que este caché atiende.
        const color = this.coloresEmpresa.get(b.empresa_id) || (b as any)?.ruta?.color;
        if (color) this.busColors.set(b.id, colorSeguro(color));
        if (b.ruta_id) this.busRuta.set(b.id, b.ruta_id);
        if (b.empresa_id) this.busEmpresa.set(b.id, b.empresa_id);
      }
      this.paradasPorRuta.clear();
      this.trazados.clear();
      for (const p of paradas) {
        const arr = this.paradasPorRuta.get(p.ruta_id);
        if (arr) arr.push(p); else this.paradasPorRuta.set(p.ruta_id, [p]);
      }
      this.recalcularParadaCercana();
      if (this.viaje && !this.viajeElegido) this.planificar();
    } catch {}

    try {
      const locations = await this.tracking.getLatestLocations();
      this.activeBusCount = locations.length;
      for (const loc of locations) {
        this.addOrUpdateBusMarker(loc);
      }
    } catch {}
  }

  // Realtime solo entrega lo que RLS deja leer: los buses de las empresas que
  // se siguen, y nada sin cuenta. El resto de la flota llega consultando
  // buses_en_vivo cada pocos segundos (el chofer manda un punto cada 5).
  private readonly ENVIVO_MS = 6000;
  private envivoInterval: any = null;
  private refrescandoEnVivo = false;

  private async refrescarEnVivo() {
    if (this.refrescandoEnVivo || this.destroyed || document.hidden) return;
    this.refrescandoEnVivo = true;
    try {
      const ruta = this.activeRuta;
      const locations = ruta
        ? await this.tracking.getLocationsByRuta(ruta.id)
        : await this.tracking.getLatestLocations();
      // Si mientras tanto cambió la ruta elegida, esta respuesta ya no aplica.
      if (this.activeRuta?.id !== ruta?.id) return;
      // Los reportes cambian despacio: alcanza con refrescarlos cada minuto.
      if (ruta && Date.now() - this.reportesCargadosEn > 60000) this.cargarReportes(ruta.id);
      for (const loc of locations) {
        const previo = this.busLocationsMap.get(loc.bus_id);
        // Mismo punto que ya llegó por Realtime: no reiniciar su animación.
        if (previo && Date.parse(previo.timestamp) >= Date.parse(loc.timestamp)) continue;
        this.addOrUpdateBusMarker(loc);
      }
    } catch (e) {
      // El próximo intento es en unos segundos; no vale la pena avisar.
      logError('refrescar los buses en vivo', e);
    } finally {
      this.refrescandoEnVivo = false;
    }
  }

  private startRealtimeTracking() {
    this.envivoInterval = setInterval(() => this.refrescarEnVivo(), this.ENVIVO_MS);
    this.locationSub = this.tracking.subscribeToLocations().subscribe((locations) => {
      locations.forEach((loc) => this.addOrUpdateBusMarker(loc));
      // El conteo sale de los buses que hay en el mapa, no de `locations`: ese
      // Map solo trae los que mandaron un punto desde que se abrió la pantalla,
      // y su primera emisión llega vacía. Con eso el contador decía "0 buses en
      // vivo" con los buses ya dibujados, hasta que alguno mandaba otro punto.
      this.activeBusCount = this.busLocationsMap.size;
    });
  }

  // Crea la fuente y la capa una sola vez. Se llama de forma perezosa desde el
  // primer bus que llega, porque el estilo del mapa puede no estar listo todavía
  // cuando se dispara la carga inicial.
  private esperandoEstilo = false;
  private rotateEnganchado = false;
  private ultimoBearing = 0;

  private ensureBusLayer(): boolean {
    if (this.busLayerListo) return true;
    if (!this.map) return false;
    if (!this.map.isStyleLoaded()) {
      // Si el estilo todavía no cargó, este volcado se pierde. Sin este
      // reintento un bus que dejó de transmitir justo en ese momento no se
      // dibujaba nunca (los que siguen transmitiendo se salvaban solos al
      // siguiente punto, 5 s después).
      if (!this.esperandoEstilo) {
        this.esperandoEstilo = true;
        this.map.once('idle', () => {
          this.esperandoEstilo = false;
          if (!this.destroyed) this.pintarBuses(performance.now());
        });
      }
      return false;
    }

    if (!this.map.getSource(this.BUSES_SRC)) {
      this.map.addSource(this.BUSES_SRC, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] } as any,
      });
    }
    if (!this.map.getLayer(this.BUSES_LAYER)) {
      this.map.addLayer({
        id: this.BUSES_LAYER,
        type: 'symbol',
        source: this.BUSES_SRC,
        layout: {
          'icon-image': ['get', 'icon'],
          // Billboard: el bus se mantiene derecho frente a la cámara, como los
          // iconos isométricos de la referencia. NO se usa icon-rotate — el
          // rumbo lo da cuál de los 16 sprites se elige (ver dirDeBus).
          'icon-rotation-alignment': 'viewport',
          'icon-pitch-alignment': 'viewport',
          'icon-anchor': 'bottom',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-size': 1,
        },
        paint: {
          // Un bus sin señal reciente se atenúa en vez de desaparecer de golpe.
          'icon-opacity': ['case', ['get', 'stale'], 0.35, 1],
        },
      });

      this.map.on('click', this.BUSES_LAYER, (e) => {
        const id = e.features?.[0]?.properties?.['bus_id'];
        if (!id) return;
        const loc = this.busLocationsMap.get(String(id));
        if (loc) this.zone.run(() => { this.selectedBus = loc; });
      });
      this.map.on('mouseenter', this.BUSES_LAYER, () => {
        this.map.getCanvas().style.cursor = 'pointer';
      });
      this.map.on('mouseleave', this.BUSES_LAYER, () => {
        this.map.getCanvas().style.cursor = '';
      });
    }

    // El listener de rotación va fuera del bloque de creación de la capa: tras
    // un cambio de tema la capa se recrea, y si estuviera adentro se irían
    // acumulando listeners duplicados en cada toggle.
    if (!this.rotateEnganchado) {
      this.rotateEnganchado = true;
      this.map.on('rotate', () => {
        if (this.destroyed) return;
        // Girar el mapa cambia el rumbo RELATIVO a la pantalla, o sea el sprite
        // que toca. Pero 'rotate' dispara decenas de veces por gesto y solo
        // importa cuando se cruza medio paso de sprite (11.25°): por debajo de
        // eso el ícono elegido sería el mismo y el trabajo iría a la basura.
        const b = this.map.getBearing();
        if (Math.abs(b - this.ultimoBearing) < SPRITE_PASO_MEDIO) return;
        this.ultimoBearing = b;
        this.refrescarIconos();
      });
    }

    this.busLayerListo = true;
    return true;
  }

  // Vuelca el estado actual de todos los buses a la fuente. Un solo setData por
  // llamada, sin importar cuántos buses haya.
  private pintarBuses(t: number) {
    if (!this.ensureBusLayer()) return;
    const src = this.map.getSource(this.BUSES_SRC) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;

    const ahora = Date.now();
    const features: any[] = [];
    this.busLocationsMap.forEach((loc, busId) => {
      const a = this.busAnim.get(busId);
      let lng = loc.longitud, lat = loc.latitud, head = loc.heading || 0;
      if (a) {
        const k = Math.min(1, (t - a.t0) / this.BUS_TWEEN_MS);
        const e = k * (2 - k);                       // ease-out suave
        lng = a.lng0 + (a.lng1 - a.lng0) * e;
        lat = a.lat0 + (a.lat1 - a.lat0) * e;
        // Interpolar el rumbo por el camino corto: de 350° a 10° son 20°, no 340.
        let d = ((a.head1 - a.head0 + 540) % 360) - 180;
        head = (a.head0 + d * e + 360) % 360;
      }
      const lastSeen = this.busLastSeen.get(busId) ?? ahora;
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lng, lat] },
        properties: {
          bus_id: busId,
          heading: head,
          stale: (ahora - lastSeen) > this.STALE_MS,
          // El ícono se resuelve cuando llega un punto nuevo, no acá: esto
          // corre en cada cuadro y calcular estado + color 60 veces por segundo
          // por bus es trabajo tirado.
          icon: this.busIcono.get(busId)
                || this.registrarIconoBus(this.estadoDeBus(loc), this.busColor(loc), this.dirDeBus(loc)),
        },
      });
    });

    src.setData({ type: 'FeatureCollection', features } as any);
  }

  // Un único rAF para toda la flota. Se apaga solo cuando ninguna interpolación
  // sigue viva, así que un mapa quieto no gasta cuadros.
  private tickBuses = () => {
    const t = performance.now();
    this.pintarBuses(t);
    let vivo = false;
    this.busAnim.forEach((a, id) => {
      if (t - a.t0 >= this.BUS_TWEEN_MS) this.busAnim.delete(id);
      else vivo = true;
    });
    this.busRaf = vivo && !this.destroyed ? requestAnimationFrame(this.tickBuses) : null;
  };

  private arrancarTick() {
    if (this.busRaf === null && !this.destroyed) {
      this.busRaf = requestAnimationFrame(this.tickBuses);
    }
  }

  // Ícono ya resuelto por bus, recalculado solo cuando llega un punto nuevo
  // (una vez cada 5 s por bus) en vez de en cada cuadro de animación.
  private busIcono = new Map<string, string>();

  private addOrUpdateBusMarker(location: BusLocation) {
    const heading = location.heading || 0;
    const previo = this.busLocationsMap.get(location.bus_id);
    this.busLastSeen.set(location.bus_id, Date.parse(location.timestamp) || Date.now());
    this.busLocationsMap.set(location.bus_id, location);
    this.actualizarMarcha(location);
    if (this.activeRuta) this.updateETA();
    else this.programarCercanas();
    if (location.bus?.empresa_id) this.busEmpresa.set(location.bus_id, location.bus.empresa_id);
    // Sin cuenta no se puede leer la tabla de buses, así que la ruta de cada
    // bus llega con su posición (buses_en_vivo).
    if (location.bus?.ruta_id) this.busRuta.set(location.bus_id, location.bus.ruta_id);
    if (this.busPedido === location.bus_id) setTimeout(() => this.seguirBusCompartido(location));
    this.busIcono.set(
      location.bus_id,
      this.registrarIconoBus(this.estadoDeBus(location), this.busColor(location),
                             this.dirDeBus(location)),
    );

    if (previo) {
      this.busAnim.set(location.bus_id, {
        lng0: previo.longitud, lat0: previo.latitud,
        lng1: location.longitud, lat1: location.latitud,
        head0: previo.heading || 0, head1: heading,
        t0: performance.now(),
      });
      this.arrancarTick();
    } else {
      // Bus nuevo: aparece directo en su posición, sin viajar desde ningún lado.
      this.pintarBuses(performance.now());
    }
    this.activeBusCount = this.busLocationsMap.size;

    // La ficha abierta y el modo seguimiento tienen que reflejar el punto nuevo,
    // no el que había cuando se tocó el bus.
    if (this.selectedBus?.bus_id === location.bus_id) {
      this.selectedBus = location;
    }
    if (this.followBusId === location.bus_id) {
      this.map.easeTo({
        center: [location.longitud, location.latitud],
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
      this.logFix('inicio', c);
      this.updateUserPosition(c.latitude, c.longitude, c.accuracy, c.heading);
      // Con una lectura fuera del país NO se encuadra el mapa: arrastrar al
      // usuario a Canadá apenas abre la app es peor que dejarlo en su provincia
      // y que el punto quede fuera de cuadro.
      if (!this.activeRuta && !this.isOutsideCostaRica(c.latitude, c.longitude)) {
        this.map.jumpTo({ center: [c.longitude, c.latitude], zoom: this.zoomForAccuracy(c.accuracy) });
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
    this.revisarBajada(lat, lng);

    const gpsHeading = heading !== null && heading !== undefined && !isNaN(heading)
      ? (heading as number)
      : null;
    if (gpsHeading !== null) this.gpsHeading = gpsHeading;

    if (this.userConeMarker && this.userMarker) {
      this.userConeMarker.setLngLat([lng, lat]);
      this.userMarker.setLngLat([lng, lat]);
    } else {
      const coneEl = htmlMarkerEl(
        'user-cone-marker',
        `<div class="ucm-inner"><div class="user-cone"></div></div>`,
      );
      this.userConeMarker = new maplibregl.Marker({
        element: coneEl,
        anchor: 'center',
        rotationAlignment: 'map',
        pitchAlignment: 'map',
      }).setLngLat([lng, lat]).addTo(this.map);

      // El contenido va dentro de un envoltorio propio. La raíz del marcador se
      // deja intacta para que MapLibre la posicione: es él quien le escribe
      // position y transform, y pisárselos desancla el marcador del mapa.
      const el = htmlMarkerEl(
        'user-marker',
        `<div class="um-inner"><div class="user-pulse"></div>${this.userPuckHtml()}</div>`,
      );
      this.userMarker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([lng, lat])
        .addTo(this.map);
    }

    // La chapa se atenúa cuando la lectura no es de fiar. El caso de la
    // posición inventada importa más que el de la imprecisa: llega con
    // precisión de metros y, sin esto, se vería tan rotunda como un GPS real.
    const unreliable = this.fixProblem(lat, lng, accuracy) !== null;
    this.userMarker.getElement().classList.toggle('coarse', unreliable);
    this.locationError = unreliable ? 'Ubicación poco fiable' : null;

    // Se recuerda para poder redibujar el círculo tras un cambio de estilo,
    // que borra todas las capas propias.
    this.lastAccuracy = accuracy ?? null;

    // La distancia a cada empresa depende de donde estas: se recalcula al
    // moverte, no en cada render.
    this.recomputeEmpresasCercanas();

    this.applyUserHeading();
    this.updateAccuracyCircle(lng, lat, accuracy);
    this.updateETA();
    this.recalcularParadaCercana();
    this.seguirCaminata();
    this.seguirViaje();
  }

  // Sólo la figura, sin chapa. El disco blanco no era adorno: daba el contraste
  // que necesita cualquier cosa dibujada sobre calles y edificios. Al quitarlo,
  // ese contraste pasa a un contorno oscuro dibujado DEBAJO del trazo verde
  // (el grupo de abajo, con trazo más grueso) más la sombra del CSS. Sin eso
  // la silueta se pierde sobre las zonas claras del mapa.
  //
  // La foto de perfil ya no va acá: sin marco circular no hay dónde recortarla.
  // Sigue estando en la barra superior y en el panel de perfil.
  //
  // El color no va fijo en el SVG: lo pone el CSS (verde neón en el mapa
  // oscuro, azul neón en el claro), así cambia con el modo sin rehacer el
  // marcador.
  private userPuckHtml(): string {
    const figura = `
      <path d="M11 8.4v6"/>
      <path d="M11 14.4 8.4 20.6"/>
      <path d="M11 14.4 13.4 20.6"/>
      <path d="M11 10.4 7.4 12.8"/>
      <path d="M11 10.2 15.6 6.2"/>`;

    return `
      <svg class="up-person" viewBox="0 0 24 24" width="34" height="34" fill="none"
           stroke-linecap="round" stroke-linejoin="round">
        <g stroke="rgba(3,18,10,0.85)" stroke-width="4.2">${figura}</g>
        <circle class="up-cabeza" cx="11" cy="5" r="3.1"
                stroke="rgba(3,18,10,0.85)" stroke-width="1.5"/>
        <g class="up-trazo" stroke-width="2.9">${figura}</g>
      </svg>`;
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

    // Del mismo color que el muñequito. No hace falta cambiarlo al pasar de
    // modo: setStyle borra el círculo y se vuelve a crear con el color nuevo.
    const color = this.darkMode ? '#00e06a' : '#00a8ff';
    this.map.addSource('user-accuracy', { type: 'geojson', data });
    this.map.addLayer({
      id: 'user-accuracy-fill',
      type: 'fill',
      source: 'user-accuracy',
      paint: { 'fill-color': color, 'fill-opacity': 0.13 },
    });
    this.map.addLayer({
      id: 'user-accuracy-line',
      type: 'line',
      source: 'user-accuracy',
      paint: { 'line-color': color, 'line-width': 1.2, 'line-opacity': 0.45 },
    });
  }

  // ====== TIEMPO DE LLEGADA ======
  // El cálculo en sí vive en core/utils/eta.ts (con sus pruebas). Acá está lo
  // que necesita del mapa: el trazado de cada ruta y lo que se va sabiendo de
  // cada bus de un punto al siguiente.

  // Por ruta: su trazado y en qué kilómetro cae cada parada. Se arma una vez.
  private trazados = new Map<string, { trazado: TrazadoRuta; kmParadas: Map<string, number> }>();
  // Trazado por calles de una ruta que no lo tiene guardado en la base: se
  // obtiene al dibujarla y se recuerda acá.
  private trazadoCalculado = new Map<string, LatLng[]>();
  // Por bus: avance sobre su ruta, sentido de marcha y velocidad en movimiento.
  private busMarcha = new Map<string, { km: number; desvioKm: number; sentido: Sentido; velKmh?: number }>();

  // Hacia dónde va el próximo bus ("Cartago"), para decirlo junto a los minutos.
  etaHacia: string | null = null;
  // Hay buses en la ruta, pero ninguno viene hacia la parada del pasajero.
  sinBusEnCamino = false;
  private proximos: BusProximo[] = [];

  private rutaDelBus(busId: string): string | null {
    return this.busRuta.get(busId) ?? this.activeRuta?.id ?? null;
  }

  private trazadoDe(rutaId: string): { trazado: TrazadoRuta; kmParadas: Map<string, number> } | null {
    const listo = this.trazados.get(rutaId);
    if (listo) return listo;

    const deLaActiva = this.activeRuta?.id === rutaId;
    const ruta = this.allRutas.find(r => r.id === rutaId) ?? (deLaActiva ? this.activeRuta : null);
    const paradas = [...(this.paradasPorRuta.get(rutaId) ?? (deLaActiva ? this.activeParadas : []))]
      .sort((x, y) => x.orden - y.orden);

    // El trazado guardado en la base; si no hay, el que se calculó por calles
    // al dibujar la ruta; y si tampoco, la línea que une las paradas en orden.
    // Esta última corta las curvas, pero conserva lo importante: qué parada
    // viene antes que cuál.
    const coords: LatLng[] = ruta?.geometria?.length
      ? ruta.geometria
      : this.trazadoCalculado.get(rutaId) ?? paradas.map(p => [p.latitud, p.longitud] as LatLng);

    const trazado = new TrazadoRuta(coords);
    if (!trazado.valido) return null;

    // Cada parada usa de pista el avance de la anterior: en un trazado que
    // pasa dos veces por la misma calle, así cae en la pasada que le toca.
    const kmParadas = new Map<string, number>();
    let pista = 0;
    for (const parada of paradas) {
      pista = trazado.proyectar(parada.latitud, parada.longitud, pista).km;
      kmParadas.set(parada.id, pista);
    }

    const entrada = { trazado, kmParadas };
    this.trazados.set(rutaId, entrada);
    return entrada;
  }

  // Con cada punto nuevo de un bus: dónde va sobre su ruta, en qué sentido y
  // a qué velocidad se mueve.
  private actualizarMarcha(loc: BusLocation) {
    const rutaId = this.rutaDelBus(loc.bus_id);
    const t = rutaId ? this.trazadoDe(rutaId) : null;
    if (!t) return;

    const previa = this.busMarcha.get(loc.bus_id);
    const p = t.trazado.proyectar(loc.latitud, loc.longitud, previa?.km);

    // El sentido sale, en este orden: del rumbo del bus si va andando (quieto,
    // el rumbo del GPS apunta a cualquier lado; y un 0 exacto es "sin dato");
    // de hacia dónde avanzó desde el punto anterior; o del que ya traía.
    let sentido: Sentido = previa?.sentido ?? 1;
    const andando = (loc.velocidad ?? 0) > 5;
    const porRumbo = andando && loc.heading ? sentidoSegunRumbo(loc.heading, p.rumbo) : null;
    if (porRumbo) {
      sentido = porRumbo;
    } else if (previa && Math.abs(p.km - previa.km) > 0.03) {
      sentido = p.km > previa.km ? 1 : -1;
    }

    this.busMarcha.set(loc.bus_id, {
      km: p.km,
      desvioKm: p.desvioKm,
      sentido,
      velKmh: suavizarVelocidad(previa?.velKmh, loc.velocidad),
    });
  }

  private llegadaDe(loc: BusLocation, parada: Parada): { llegada: Llegada; sentido: Sentido } | null {
    const rutaId = this.rutaDelBus(loc.bus_id);
    const t = rutaId ? this.trazadoDe(rutaId) : null;
    if (!t) return null;

    if (!this.busMarcha.has(loc.bus_id)) this.actualizarMarcha(loc);
    const marcha = this.busMarcha.get(loc.bus_id);
    if (!marcha) return null;

    const kmParada = t.kmParadas.get(parada.id)
      ?? t.trazado.proyectar(parada.latitud, parada.longitud).km;

    // Paradas que el bus todavía tiene que hacer antes de esta.
    const desde = Math.min(marcha.km, kmParada) + 0.03;
    const hasta = Math.max(marcha.km, kmParada) - 0.03;
    let enMedio = 0;
    for (const km of t.kmParadas.values()) if (km > desde && km < hasta) enMedio++;

    return {
      sentido: marcha.sentido,
      llegada: estimarLlegada({
        kmBus: marcha.km,
        kmParada,
        sentido: marcha.sentido,
        desvioKm: marcha.desvioKm,
        velocidadKmh: marcha.velKmh,
        paradasEnMedio: enMedio,
      }),
    };
  }

  // Placa y detalle del próximo bus, para la línea bajo los minutos.
  proximoPlaca: string | null = null;
  proximoDetalle: string | null = null;

  // Cifras para la pizarra: "19" → ["1","9"]; llegando → ["<","1"]; sin dato,
  // dos guiones (la pizarra no cambia de ancho cuando llega el número).
  get etaDigitos(): string[] {
    if (this.etaMinutes === null) return ['–', '–'];
    if (this.etaMinutes === 0) return ['<', '1'];
    return String(Math.min(this.etaMinutes, 999)).split('');
  }

  // Clave por posición y cifra: cuando una cifra cambia, Angular rehace solo
  // esa paleta y la animación de giro corre solo en ella.
  trackDigito = (i: number, d: string) => `${i}${d}`;

  // Las paradas de la ruta elegida, en orden, con los buses intercalados
  // donde van. En el teléfono arranca cerrado (la hoja ya es alta); en
  // escritorio, abierto.
  recorrido: ItemRecorrido[] = [];
  recorridoAbierto = typeof window !== 'undefined' && window.innerWidth >= 900;
  trackRecorrido = (_: number, it: ItemRecorrido) => it.clave;

  private armarRecorrido(
    ruta: Ruta,
    parada: Parada | null,
    buses: { id: string; placa: string; nota: string; viene: boolean; apagado: boolean }[],
  ) {
    const t = this.trazadoDe(ruta.id);
    if (!t) { this.recorrido = []; return; }
    const items: (ItemRecorrido & { km: number; orden: number })[] = [...this.activeParadas]
      .sort((a, b) => a.orden - b.orden)
      .map((p, i) => ({
        tipo: 'parada' as const,
        clave: 'p' + p.id,
        nombre: this.nombreParadaCorto(p.nombre),
        tuParada: p.id === parada?.id,
        km: t.kmParadas.get(p.id) ?? 0,
        orden: i,
      }));
    for (const b of buses) {
      const m = this.busMarcha.get(b.id);
      if (!m) continue;
      // Un bus va después de la parada en la que está, nunca antes: así se lee
      // "salió de Tres Ríos", no "llega a Tres Ríos".
      items.push({ tipo: 'bus', clave: 'b' + b.id, nombre: b.placa, sentido: m.sentido, nota: b.nota, viene: b.viene, apagado: b.apagado, km: m.km + 1e-6, orden: 1e6 });
    }
    items.sort((a, b) => a.km - b.km || a.orden - b.orden);
    this.recorrido = items.map(({ km, orden, ...it }) => it);
  }

  // Se llama al elegir o soltar una ruta, al moverse el pasajero, al llegar un
  // punto de un bus y cada 10 s (para notar al bus que se quedó sin señal).
  private updateETA() {
    // Con un viaje elegido la parada que importa es donde hay que subir, que
    // no siempre es la más cercana: puede convenir caminar un poco más para
    // quedar mejor del otro lado.
    const viaje = this.viajeElegido && this.viajeElegido.rutaId === this.activeRuta?.id ? this.viajeElegido : null;
    const subir = viaje ? this.activeParadas.find(p => p.id === viaje.subirId) ?? viaje.subir : null;
    if (subir && this.userLat !== 0) {
      this.nearestStop = {
        parada: subir,
        distanceKm: this.featuresService.distanceKm(this.userLat, this.userLng, subir.latitud, subir.longitud),
      };
    } else {
      this.nearestStop = this.activeParadas.length > 0 && this.userLat !== 0
        ? this.featuresService.findNearestStop(this.userLat, this.userLng, this.activeParadas)
        : null;
    }

    this.etaMinutes = null;
    this.etaHacia = null;
    this.sinBusEnCamino = false;
    this.proximos = [];
    this.proximoPlaca = null;
    this.proximoDetalle = null;
    if (!this.activeRuta) { this.recorrido = []; return; }
    if (!this.nearestStop) {
      // Sin ubicación igual se muestra el recorrido con los buses.
      this.armarRecorrido(this.activeRuta, null, [...this.busLocationsMap.values()].map(loc => ({
        id: loc.bus_id, placa: (loc.bus as any)?.placa || 'Bus', nota: '', viene: false, apagado: false,
      })));
      return;
    }

    const ruta = this.activeRuta;
    const parada = this.nearestStop.parada;
    const ahora = Date.now();
    const filas: (BusProximo & { hacia: string })[] = [];
    const enRecorrido: { id: string; placa: string; nota: string; viene: boolean; apagado: boolean }[] = [];
    // Buses de los que se sabe dónde van, aunque no vengan hacia la parada.
    let ubicados = 0;

    for (const loc of this.busLocationsMap.values()) {
      const rutaDelBus = this.busRuta.get(loc.bus_id);
      if (rutaDelBus && rutaDelBus !== ruta.id) continue;

      const placa = (loc.bus as any)?.placa || 'Bus';
      const r = this.llegadaDe(loc, parada);
      const hacia = r?.sentido === -1 ? ruta.origen : ruta.destino;
      const sinSenal = ahora - (this.busLastSeen.get(loc.bus_id) ?? ahora) > this.STALE_MS;

      let etaMinutes: number | null = null;
      let detalle: string;
      if (sinSenal) {
        // Con la posición vieja no se promete nada: el bus puede estar en
        // cualquier lado.
        detalle = 'Sin señal';
      } else if (!r) {
        detalle = 'Sin datos del recorrido';
      } else if (viaje && r.sentido !== viaje.sentido) {
        // Pasa por la parada, pero para el otro lado: no es el bus del viaje.
        detalle = `Va hacia ${hacia}`;
      } else if (r.llegada.estado === 'llegando') {
        etaMinutes = 0;
        detalle = 'Llegando a tu parada';
      } else if (r.llegada.estado === 'viene') {
        etaMinutes = r.llegada.minutos;
        detalle = `a ${this.metrosTexto((r.llegada.distanciaKm ?? 0) * 1000)} · hacia ${hacia}`;
      } else if (r.llegada.estado === 'ya_paso') {
        detalle = 'Ya pasó tu parada';
      } else {
        detalle = 'Fuera del recorrido';
      }
      if (!sinSenal && r) ubicados++;
      filas.push({ placa, etaMinutes, detalle, hacia });
      const vel = (loc.velocidad ?? 0) > 5 ? ` · ${Math.round(loc.velocidad!)} km/h` : '';
      enRecorrido.push({
        id: loc.bus_id,
        placa,
        nota: etaMinutes !== null
          ? `hacia ${hacia} · ${etaMinutes === 0 ? 'llegando' : etaMinutes + ' min'} a tu parada`
          : sinSenal || !r ? detalle : `hacia ${hacia}${vel}${r.llegada.estado === 'ya_paso' ? ' · ya pasó' : ''}`,
        viene: etaMinutes !== null,
        apagado: sinSenal,
      });
    }
    this.armarRecorrido(ruta, parada, enRecorrido);

    // Primero los que vienen, del más cercano al más lejano; después el resto.
    filas.sort((x, y) => (x.etaMinutes ?? Infinity) - (y.etaMinutes ?? Infinity));
    this.proximos = filas.slice(0, 4);

    const proximo = filas.find(f => f.etaMinutes !== null);
    if (proximo) {
      this.etaMinutes = proximo.etaMinutes;
      this.etaHacia = proximo.hacia;
      this.proximoPlaca = proximo.placa;
      this.proximoDetalle = proximo.detalle;
    } else {
      // Solo se afirma si se sabe: con todos los buses sin señal no se
      // puede decir que ninguno viene.
      this.sinBusEnCamino = ubicados > 0;
    }
  }

  // ====== ¿A DÓNDE VAS? ======
  // El pasajero elige un destino en el buscador y la app le dice qué ruta
  // tomar, en qué parada subir, en cuál bajar y cuánto caminar. El cálculo es
  // de core/utils/viaje.ts; acá va lo que toca pantalla y mapa.
  viaje: Viaje | null = null;
  // La opción que eligió: mientras está, la ruta en pantalla es la del viaje.
  viajeElegido: OpcionVista | null = null;
  // El camino a pie del final (de la parada de bajada al destino) o, si el
  // destino queda cerca, el camino directo. Null mientras no se pidió.
  viajeTramo: { metros: number; minutos: number; exacta: boolean } | null = null;
  viajeTramoCargando = false;

  private viajeTramoCoords: [number, number][] | null = null;
  private viajeMarkers: maplibregl.Marker[] = [];
  private readonly VIAJE_SRC = 'viaje-tramo-src';

  // Arma (o rehace) las opciones desde donde está el pasajero ahora.
  private planificar() {
    const v = this.viaje;
    if (!v) return;
    if (this.userLat === 0) {
      this.viaje = { ...v, desde: null, opciones: [], motivo: 'sin_ubicacion' };
      return;
    }

    // Las paradas agrupadas llegan con los buses; si el pasajero buscó antes
    // de que terminara esa carga, se arman con las que ya trajo el inicio.
    if (this.paradasPorRuta.size === 0) {
      for (const p of this.allParadas) {
        const arr = this.paradasPorRuta.get(p.ruta_id);
        if (arr) arr.push(p); else this.paradasPorRuta.set(p.ruta_id, [p]);
      }
    }

    const rutas: RutaParaViaje[] = [];
    for (const r of this.allRutas) {
      const paradas = this.paradasPorRuta.get(r.id);
      const t = paradas?.length ? this.trazadoDe(r.id) : null;
      if (!paradas || !t) continue;
      rutas.push({
        id: r.id,
        paradas: paradas.map(p => ({ id: p.id, lat: p.latitud, lng: p.longitud, km: t.kmParadas.get(p.id) ?? 0 })),
      });
    }

    const plan = planificarViaje([this.userLat, this.userLng], [v.destino.lat, v.destino.lng], rutas);
    const opciones: OpcionVista[] = [];
    for (const o of plan.opciones) {
      const ruta = this.allRutas.find(r => r.id === o.rutaId);
      const paradas = this.paradasPorRuta.get(o.rutaId) ?? [];
      const subir = paradas.find(p => p.id === o.subirId);
      const bajar = paradas.find(p => p.id === o.bajarId);
      if (!ruta || !subir || !bajar) continue;
      opciones.push({ ...o, ruta, subir, bajar, hacia: o.sentido === 1 ? ruta.destino : ruta.origen });
    }

    this.viaje = {
      ...v,
      desde: { lat: this.userLat, lng: this.userLng },
      opciones,
      aPie: plan.aPie,
      // Si alguna opción no se pudo armar con los datos en memoria, no se
      // inventa un motivo: el del plan solo vale cuando no devolvió ninguna.
      motivo: opciones.length ? null : (plan.motivo ?? 'sin_ruta_directa'),
      paradaOrigenKm: plan.paradaOrigenKm,
      paradaDestinoKm: plan.paradaDestinoKm,
    };
  }

  // Con el pasajero en movimiento: mientras elige, las opciones se rehacen si
  // se alejó de donde se calcularon (o si recién ahora llegó la ubicación).
  // Con una opción ya elegida no se le cambia el viaje bajo los pies.
  private seguirViaje() {
    const v = this.viaje;
    if (!v || this.viajeElegido) return;
    if (!v.desde) {
      this.planificar();
      setTimeout(() => this.encuadrarViaje(), 60);
      return;
    }
    if (this.featuresService.distanceKm(this.userLat, this.userLng, v.desde.lat, v.desde.lng) >= 0.15) {
      this.planificar();
    }
  }

  async elegirOpcion(o: OpcionVista) {
    await this.selectRutaFromPanel(o.ruta, o);
  }

  // Deja el viaje: se va el destino del mapa y, si había una ruta en pantalla,
  // vuelve a ser una ruta cualquiera (su parada es otra vez la más cercana).
  cerrarViaje() {
    if (!this.viaje && !this.viajeElegido) return;
    this.quitarTramoViaje();
    this.viaje = null;
    this.viajeElegido = null;
    this.placeMarker?.remove();
    this.placeMarker = null;
    if (this.activeRuta) this.updateETA();
  }

  // Lo que falta decir cuando no hay ningún bus que ofrecer.
  get viajeAviso(): { icono: string; titulo: string; texto: string } | null {
    const v = this.viaje;
    if (!v?.motivo) return null;
    const km = (n: number | null) => (n === null ? '' : this.metrosTexto(n * 1000));
    switch (v.motivo) {
      case 'sin_ubicacion':
        return { icono: 'locate-outline', titulo: 'Falta tu ubicación', texto: 'Para armar el viaje necesito saber desde dónde salís.' };
      case 'cerca': {
        const c = this.viajeTramo ?? v.aPie;
        return {
          icono: 'walk',
          titulo: `Queda cerca: ${c.minutos} min a pie`,
          texto: `Son ${this.metrosTexto(c.metros)}${this.viajeTramo?.exacta ? '' : ' aprox'}. No hace falta tomar un bus.`,
        };
      }
      case 'sin_parada_destino':
        return {
          icono: 'flag-outline',
          titulo: 'Ninguna ruta llega cerca de ahí',
          texto: v.paradaDestinoKm === null ? 'Todavía no hay paradas cargadas.' : `La parada más cercana a ese lugar queda a ${km(v.paradaDestinoKm)}.`,
        };
      case 'sin_parada_origen':
        return {
          icono: 'location-outline',
          titulo: 'No hay paradas cerca tuyo',
          texto: v.paradaOrigenKm === null ? 'Todavía no hay paradas cargadas.' : `La más cercana queda a ${km(v.paradaOrigenKm)}.`,
        };
      default:
        return {
          icono: 'git-branch-outline',
          titulo: 'No hay un bus directo',
          texto: 'Hay paradas cerca tuyo y cerca de ese lugar, pero ninguna ruta las une. Buxci todavía no arma viajes con trasbordo.',
        };
    }
  }

  // Minutos del último tramo a pie: los del enrutador si ya llegaron.
  get viajeMinutosAlDestino(): number {
    return this.viajeTramo?.minutos ?? this.viajeElegido?.minutosAlDestino ?? 0;
  }

  // El viaje completo, sin la espera del bus.
  get viajeMinutosTotal(): number {
    const o = this.viajeElegido;
    if (!o) return 0;
    const alSubir = this.caminataActiva && this.caminata ? this.caminata.minutos : o.minutosAlSubir;
    return alSubir + o.minutosEnBus + this.viajeMinutosAlDestino;
  }

  // Qué hacer al bajar. Si la parada está pegada al destino no se manda a
  // "caminar 1 minuto hasta" un lugar que se llama igual que la parada.
  get viajeFinalTexto(): string {
    const v = this.viaje, o = this.viajeElegido;
    if (!v || !o) return '';
    const metros = this.viajeTramo?.metros ?? this.featuresService.estimarCaminata(o.alDestinoKm).metros;
    if (metros < 40) return 'Tu destino queda ahí mismo';
    if (metros <= 250) return `Tu destino queda a ${this.metrosTexto(metros)}`;
    return `y caminá ${this.viajeMinutosAlDestino} min hasta ${v.destino.nombre}`;
  }

  paradasDelViaje(o: OpcionVista): string {
    const n = o.paradasEnMedio + 1;
    return n === 1 ? 'es la parada siguiente' : `${n} paradas`;
  }

  // Con la ruta del viaje ya dibujada: marca dónde subir y dónde bajar, y pide
  // los dos caminos a pie (a la parada, y de la bajada al destino).
  private mostrarViajeElegido() {
    const o = this.viajeElegido, v = this.viaje;
    if (!o || !v || !this.map) return;

    this.viajeMarkers.forEach(m => m.remove());
    this.viajeMarkers = [
      this.marcaDeViaje(o.subir, 'subir', 'Subí acá'),
      this.marcaDeViaje(o.bajar, 'bajar', 'Bajá acá'),
    ];

    setTimeout(() => this.encuadrarViaje(), 60);
    this.comoLlegar(false);
    this.pedirTramoViaje({ lat: o.bajar.latitud, lng: o.bajar.longitud }, v.destino);
  }

  private marcaDeViaje(parada: Parada, tipo: 'subir' | 'bajar', texto: string): maplibregl.Marker {
    const el = htmlMarkerEl('viaje-marker', `<div class="vjm vjm--${tipo}" title="${esc(parada.nombre)}">${texto}</div>`);
    // Debajo de la parada y centrada: arriba va el pin del camino a pie, y a
    // los costados se salía de pantalla cuando la parada quedaba en un borde.
    return new maplibregl.Marker({ element: el, anchor: 'top', offset: [0, 9] })
      .setLngLat([parada.longitud, parada.latitud])
      .addTo(this.map);
  }

  // El destino queda cerca: el camino directo, sin bus.
  async verCaminoDirecto() {
    const v = this.viaje;
    if (!v || this.userLat === 0) return;
    if (this.viajeTramo) { this.quitarTramoViaje(); return; }
    await this.pedirTramoViaje({ lat: this.userLat, lng: this.userLng }, v.destino);
    this.encuadrarViaje();
  }

  private async pedirTramoViaje(desde: PuntoGeo, hasta: PuntoGeo) {
    const destino = this.viaje?.destino, elegido = this.viajeElegido;
    this.viajeTramoCargando = true;
    const camino = await this.featuresService.rutaAPie(desde, hasta);
    this.viajeTramoCargando = false;

    // Mientras llegaba, el pasajero pudo cerrar el viaje o elegir otra opción.
    if (this.destroyed || !destino || this.viaje?.destino !== destino || this.viajeElegido !== elegido) return;

    this.viajeTramoCoords = camino.coords;
    this.viajeTramo = { metros: camino.metros, minutos: camino.minutos, exacta: camino.exacta };
    this.dibujarTramoViaje();
  }

  // Mismo trazo de guiones que el camino a la parada: en el mapa, guiones
  // azules siempre quieren decir "esto se camina".
  private dibujarTramoViaje() {
    if (!this.viajeTramoCoords || !this.map) return;
    const data = {
      type: 'Feature' as const, properties: {},
      geometry: { type: 'LineString' as const, coordinates: this.viajeTramoCoords },
    };
    const src = this.map.getSource(this.VIAJE_SRC) as maplibregl.GeoJSONSource | undefined;
    if (src) {
      src.setData(data);
    } else {
      this.map.addSource(this.VIAJE_SRC, { type: 'geojson', data });
      this.map.addLayer({
        id: `${this.VIAJE_SRC}-borde`, type: 'line', source: this.VIAJE_SRC,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#04101f', 'line-width': 9, 'line-opacity': 0.6 },
      });
      this.map.addLayer({
        id: `${this.VIAJE_SRC}-puntos`, type: 'line', source: this.VIAJE_SRC,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#6cb0ff', 'line-width': 5, 'line-dasharray': [0.5, 2] },
      });
      if (this.map.getLayer(this.BUSES_LAYER)) this.map.moveLayer(this.BUSES_LAYER);
    }
    this.atenuarEdificios(true);
  }

  private quitarTramoViaje() {
    this.viajeTramo = null;
    this.viajeTramoCoords = null;
    this.viajeTramoCargando = false;
    this.viajeMarkers.forEach(m => m.remove());
    this.viajeMarkers = [];
    if (!this.map) return;
    for (const id of [`${this.VIAJE_SRC}-puntos`, `${this.VIAJE_SRC}-borde`]) {
      if (this.map.getLayer(id)) this.map.removeLayer(id);
    }
    if (this.map.getSource(this.VIAJE_SRC)) this.map.removeSource(this.VIAJE_SRC);
    this.atenuarEdificios(false);
  }

  // Todo el viaje a la vista: el pasajero, dónde sube, dónde baja y el destino.
  private encuadrarViaje() {
    const v = this.viaje;
    if (!v || !this.map) return;
    const puntos: [number, number][] = [[v.destino.lng, v.destino.lat]];
    if (this.userLat !== 0) puntos.push([this.userLng, this.userLat]);
    const o = this.viajeElegido;
    if (o) puntos.push([o.subir.longitud, o.subir.latitud], [o.bajar.longitud, o.bajar.latitud]);
    if (this.viajeTramoCoords) puntos.push(...this.viajeTramoCoords);

    if (puntos.length === 1) {
      this.map.flyTo({ center: puntos[0], zoom: 15.5, duration: 900 });
      return;
    }
    const bounds = puntos.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(puntos[0], puntos[0]));
    const escritorio = window.innerWidth >= 900;
    const padding = escritorio
      ? { top: 100, bottom: 110, left: 120, right: 120 }
      : { top: 110, bottom: (this.hojaAlto || 300) + 56, left: 56, right: 76 };
    this.map.fitBounds(bounds, { padding, duration: 700, maxZoom: 16 });
  }

  // ====== CERCA TUYO ======
  // La pantalla de inicio responde "¿cuándo pasa mi bus?" sin tocar nada: las
  // rutas con una parada cerca y, para cada una, el próximo bus que viene
  // hacia esa parada. Antes mostraba solo la parada más cercana y cuánto se
  // caminaba, y para saber si venía algún bus había que elegir la ruta.
  cercanas: Cercana[] = [];
  private cercanasEn = 0;
  private cercanasTimer: any = null;
  // Más lejos que esto la ruta no está "cerca": para llegar a la parada
  // habría que tomar otra cosa.
  private readonly CERCANA_MAX_KM = 2;

  trackCercana = (_: number, c: Cercana) => c.ruta.id;

  get tieneUbicacion(): boolean {
    return this.userLat !== 0;
  }

  // La hoja de inicio está a la vista (y los controles del mapa van encima).
  get cercaVisible(): boolean {
    return !this.activeRuta && !this.viaje && !this.selectedBus && this.navVisible
      && !this.activePanel && !this.sidebarOpen && !this.profilePanelOpen && !this.settingsPanelOpen
      && (this.cercanas.length > 0 || !!this.paradaCercana || this.tieneUbicacion);
  }

  // ---- Tres alturas de la hoja (teléfono) ----
  // mini: una línea, el mapa casi libre. resumen: el bus que llega primero y
  // la caminata. lista: todas las rutas cerca. Se cambia arrastrando el asa o
  // tocando el encabezado, y se recuerda la que eligió el pasajero.
  cercaAltura: AlturaCerca = this.leerAlturaCerca();
  private readonly ALTURAS_CERCA: AlturaCerca[] = ['mini', 'resumen', 'lista'];
  // Un arrastre de menos de esto vuelve a la altura en la que estaba.
  private readonly ARRASTRE_MIN_PX = 40;

  private leerAlturaCerca(): AlturaCerca {
    try {
      const v = localStorage.getItem('buxi.cercaAltura');
      return v === 'mini' || v === 'lista' ? v : 'resumen';
    } catch { return 'resumen'; }
  }

  ponerCercaAltura(altura: AlturaCerca, recordar = true) {
    this.cercaAltura = altura;
    if (recordar) { try { localStorage.setItem('buxi.cercaAltura', altura); } catch {} }
  }

  // El encabezado abre la lista; con la lista abierta, la vuelve a resumen.
  alternarCerca() {
    this.ponerCercaAltura(this.cercaAltura === 'lista' ? 'resumen' : 'lista');
  }

  soltarCerca(dy: number) {
    if (Math.abs(dy) < this.ARRASTRE_MIN_PX) return;
    const i = this.ALTURAS_CERCA.indexOf(this.cercaAltura);
    // Un tirón largo salta dos alturas (de lista a mini, o al revés).
    const pasos = Math.abs(dy) > 220 ? 2 : 1;
    const j = Math.min(this.ALTURAS_CERCA.length - 1, Math.max(0, i + (dy < 0 ? pasos : -pasos)));
    this.ponerCercaAltura(this.ALTURAS_CERCA[j]);
  }

  // El primero de la lista ya es el que llega antes (ver recalcularCercanas).
  get cercaDestacada(): Cercana | null {
    const c = this.cercanas[0];
    return c && c.minutos !== null ? c : null;
  }

  // Lo que dice la hoja en una sola línea cuando está chica.
  // ---- ESPERA DE CADA OPCIÓN DEL PLANIFICADOR ----
  // Cuándo pasa el bus por la parada de subir, en el sentido del viaje: en
  // vivo si hay un bus en camino, si no según el horario (y lo dice). Con eso
  // se puede decir a qué hora se llega y cuál es el siguiente si se pierde.
  esperaDe(o: OpcionVista): { texto: string; enVivo: boolean; llegas: string | null; siguiente: string | null } | null {
    const ahora = Date.now();
    let enVivo: number | null = null;
    for (const loc of this.busLocationsMap.values()) {
      if (this.busRuta.get(loc.bus_id) !== o.ruta.id) continue;
      if (ahora - (this.busLastSeen.get(loc.bus_id) ?? ahora) > this.STALE_MS) continue;
      const r = this.llegadaDe(loc, o.subir);
      if (!r || r.sentido !== o.sentido || r.llegada.minutos === null) continue;
      if (enVivo === null || r.llegada.minutos < enVivo) enVivo = r.llegada.minutos;
    }
    const llegasEn = (espera: number) => {
      // Se sale caminando ya: si el bus pasa antes de que se llegue a la
      // parada, se toma el siguiente; acá se asume el que se alcanza.
      const total = Math.max(espera, o.minutosAlSubir) + o.minutosEnBus + o.minutosAlDestino;
      const t = new Date(ahora + total * 60000);
      return horaCorta(`${t.getHours()}:${t.getMinutes()}`);
    };
    if (enVivo !== null) {
      return { texto: enVivo === 0 ? 'Pasando ahora' : `Pasa en ${enVivo} min`, enVivo: true, llegas: llegasEn(enVivo), siguiente: null };
    }
    const salidas = this.salidasPorRuta.get(o.ruta.id) || [];
    const p = proximaSalida(salidas);
    if (!p) return null;
    const despues = proximaSalida(salidas, new Date(ahora + (p.minutos + 1) * 60000));
    return {
      texto: salidaTexto(p) + ' (horario)',
      enVivo: false,
      llegas: p.diasDespues === 0 ? llegasEn(p.minutos) : null,
      siguiente: despues ? (despues.diasDespues === 1 ? 'mañana ' : '') + horaCorta(despues.hora) : null,
    };
  }

  // "en vivo" solo si algún bus viene de verdad; una salida del horario no lo es.
  get hayCercaEnVivo(): boolean {
    return this.cercanas.some(c => c.minutos !== null);
  }

  get cercaLinea(): string {
    const d = this.cercaDestacada;
    if (d) return `${rutaCorta(d.ruta.nombre)} llega en ${d.minutos === 0 ? 'menos de 1' : d.minutos} min`;
    const n = this.cercanas.length;
    if (n) {
      // Sin buses en camino, lo útil es cuándo sale el próximo (según horario).
      const conSalida = this.cercanas.filter(c => c.salidaMin !== null)
        .sort((a, b) => a.salidaMin! - b.salidaMin!)[0];
      if (conSalida) return `${rutaCorta(conSalida.ruta.nombre)}: ${conSalida.salida!.charAt(0).toLowerCase()}${conSalida.salida!.slice(1)} (horario)`;
      return `${n} ${n === 1 ? 'ruta' : 'rutas'} cerca · ningún bus en camino`;
    }
    if (!this.tieneUbicacion) return 'Activá tu ubicación';
    return this.paradaCercana ? 'Tu parada más cercana' : 'Sin paradas a menos de 2 km';
  }

  // Los puntos de los buses llegan seguido y el cálculo recorre rutas y
  // buses: se hace como mucho cada 2 s, con una última pasada al final para
  // no quedarse con un dato viejo.
  private programarCercanas() {
    if (this.activeRuta) return;
    const espera = 2000 - (Date.now() - this.cercanasEn);
    if (espera <= 0) {
      this.recalcularCercanas();
      return;
    }
    if (this.cercanasTimer) return;
    this.cercanasTimer = setTimeout(() => {
      this.cercanasTimer = null;
      this.zone.run(() => this.recalcularCercanas());
    }, espera);
  }

  private recalcularCercanas() {
    this.cercanasEn = Date.now();
    if (!this.tieneUbicacion || this.paradasPorRuta.size === 0) {
      this.cercanas = [];
      return;
    }
    const ahora = Date.now();
    const filas: Cercana[] = [];
    for (const ruta of this.allRutas) {
      const paradas = this.paradasPorRuta.get(ruta.id);
      if (!paradas?.length) continue;
      const cerca = this.featuresService.findNearestStop(this.userLat, this.userLng, paradas);
      if (!cerca || cerca.distanceKm > this.CERCANA_MAX_KM) continue;

      // Mismo cálculo que la hoja de ruta: sobre el recorrido, con el sentido
      // del bus. Un bus sin señal no promete nada.
      let mejor: { minutos: number; hacia: string } | null = null;
      for (const loc of this.busLocationsMap.values()) {
        if (this.busRuta.get(loc.bus_id) !== ruta.id) continue;
        if (ahora - (this.busLastSeen.get(loc.bus_id) ?? ahora) > this.STALE_MS) continue;
        const r = this.llegadaDe(loc, cerca.parada);
        if (!r || r.llegada.minutos === null) continue;
        if (!mejor || r.llegada.minutos < mejor.minutos) {
          mejor = { minutos: r.llegada.minutos, hacia: r.sentido === -1 ? ruta.origen : ruta.destino };
        }
      }
      filas.push({
        ruta,
        parada: cerca.parada,
        distanciaKm: cerca.distanceKm,
        ...(mejor ? { salida: null, salidaMin: null } : this.salidaDeRuta(ruta.id)),
        minutos: mejor?.minutos ?? null,
        hacia: mejor?.hacia ?? null,
      });
    }
    // Primero las que tienen un bus en camino, del que llega antes; después
    // el resto, de la parada más cercana a la más lejana.
    filas.sort((a, b) => (a.minutos ?? Infinity) - (b.minutos ?? Infinity) || a.distanciaKm - b.distanciaKm);
    this.cercanas = filas.slice(0, 3);
  }

  // Color del texto sobre el color de una ruta (barra del planificador).
  tintaRuta(color: string | null | undefined): string {
    return tintaSobre(colorSeguro(color, '#8292aa'));
  }

  colorRuta(color: string | null | undefined): string {
    return colorSeguro(color, '#8292aa');
  }

  // En el teléfono Ajustes ya no está en la barra inferior (cuatro destinos
  // en vez de cinco): se llega desde el perfil.
  async abrirAjustesDesdePerfil() {
    this.profilePanelOpen = false;
    this.editingProfile = false;
    await this.toggleSettingsPanel();
  }

  // ====== PARADA MÁS CERCANA Y CÓMO LLEGAR ======
  // Sin ruta elegida, la parada más cercana de todas las rutas activas, con
  // las rutas que pasan por ahí. Con una ruta elegida el objetivo es la parada
  // más cercana de ESA ruta (`nearestStop`, que ya existía).
  paradaCercana: { parada: Parada; distanceKm: number; rutas: Ruta[] } | null = null;

  // El camino a pie dibujado, si hay uno.
  caminata: { paradaId: string; metros: number; minutos: number; exacta: boolean } | null = null;
  caminataCargando = false;

  private caminataCoords: [number, number][] | null = null;
  private caminataParada: Parada | null = null;
  private caminataDesde: { lat: number; lng: number; t: number } | null = null;
  private caminataMarker: maplibregl.Marker | null = null;
  private readonly CAMINATA_SRC = 'caminata-src';
  // Más lejos que esto no se ofrece ir caminando: la tarjeta sigue diciendo
  // cuál es la parada y a cuánto está, pero sin el botón.
  readonly CAMINATA_MAX_KM = 8;

  get paradaObjetivo(): { parada: Parada; distanceKm: number } | null {
    return this.activeRuta ? this.nearestStop : this.paradaCercana;
  }

  // El camino dibujado corresponde a la parada que se está mostrando.
  get caminataActiva(): boolean {
    const objetivo = this.paradaObjetivo;
    return !!objetivo && !!this.caminata && this.caminata.paradaId === objetivo.parada.id;
  }

  // Lo que muestra la fila "a pie": el dato del enrutador si ya se pidió el
  // camino, o una estimación mientras tanto.
  get caminataInfo(): { metros: number; minutos: number; exacta: boolean } | null {
    const objetivo = this.paradaObjetivo;
    if (!objetivo) return null;
    if (this.caminataActiva && this.caminata) return this.caminata;
    return { ...this.featuresService.estimarCaminata(objetivo.distanceKm), exacta: false };
  }

  get sePuedeCaminar(): boolean {
    const objetivo = this.paradaObjetivo;
    return !!objetivo && objetivo.distanceKm <= this.CAMINATA_MAX_KM;
  }

  nombreCorto(parada: Parada): string {
    return this.nombreParadaCorto(parada.nombre);
  }

  metrosTexto(metros: number): string {
    return metros < 1000 ? `${Math.round(metros / 10) * 10} m` : `${(metros / 1000).toFixed(1)} km`;
  }

  // Se llama al cargar las paradas y cada vez que el pasajero se mueve.
  private recalcularParadaCercana() {
    this.programarCercanas();
    if (this.userLat === 0 || this.paradasPorRuta.size === 0) {
      this.paradaCercana = null;
      return;
    }
    // Solo paradas de rutas activas, si ya se sabe cuáles son: una parada de
    // una ruta dada de baja no le sirve a nadie.
    const activas = this.allRutas.length ? new Set(this.allRutas.map(r => r.id)) : null;

    let mejor: Parada | null = null;
    let min = Infinity;
    for (const [rutaId, paradas] of this.paradasPorRuta) {
      if (activas && !activas.has(rutaId)) continue;
      for (const p of paradas) {
        const d = this.featuresService.distanceKm(this.userLat, this.userLng, p.latitud, p.longitud);
        if (d < min) { min = d; mejor = p; }
      }
    }
    if (!mejor) { this.paradaCercana = null; return; }

    // Cada ruta guarda su propia fila de parada, así que la misma esquina
    // aparece una vez por ruta. "Pasan por acá" junta las que tienen una
    // parada a menos de 80 m de la elegida.
    const ganadora = mejor;
    const rutaIds = new Set<string>();
    for (const [rutaId, paradas] of this.paradasPorRuta) {
      if (activas && !activas.has(rutaId)) continue;
      if (paradas.some(p => this.featuresService.distanceKm(ganadora.latitud, ganadora.longitud, p.latitud, p.longitud) <= 0.08)) {
        rutaIds.add(rutaId);
      }
    }
    this.paradaCercana = {
      parada: ganadora,
      distanceKm: min,
      rutas: this.allRutas.filter(r => rutaIds.has(r.id)),
    };
  }

  // Pide el camino a pie hasta la parada que se está mostrando y lo dibuja.
  async comoLlegar(encuadrar = true) {
    const objetivo = this.paradaObjetivo;
    if (!objetivo || !this.mapReady) return;
    if (this.userLat === 0) {
      // Sin ubicación no hay desde dónde: el mismo botón la pide.
      await this.centerOnUser();
      return;
    }

    const parada = objetivo.parada;
    const desde = { lat: this.userLat, lng: this.userLng };
    this.caminataCargando = true;
    const ruta = await this.featuresService.rutaAPie(desde, { lat: parada.latitud, lng: parada.longitud });
    this.caminataCargando = false;

    // Mientras llegaba la respuesta el pasajero pudo cambiar de ruta o cerrar
    // todo: un camino hacia una parada que ya no se muestra sobra.
    if (this.destroyed || this.paradaObjetivo?.parada.id !== parada.id) return;

    this.caminataCoords = ruta.coords;
    this.caminataParada = parada;
    this.caminataDesde = { ...desde, t: Date.now() };
    this.caminata = { paradaId: parada.id, metros: ruta.metros, minutos: ruta.minutos, exacta: ruta.exacta };
    this.dibujarCaminata();

    if (encuadrar) {
      const bounds = ruta.coords.reduce(
        (b, c) => b.extend(c),
        new maplibregl.LngLatBounds(ruta.coords[0], ruta.coords[0]),
      );
      this.map.fitBounds(bounds, { padding: this.margenDeCaminata(), duration: 600, maxZoom: 17 });
    }
  }

  quitarCaminata() {
    this.caminata = null;
    this.caminataCoords = null;
    this.caminataParada = null;
    this.caminataDesde = null;
    this.caminataCargando = false;
    this.caminataMarker?.remove();
    this.caminataMarker = null;
    if (!this.map) return;
    this.atenuarEdificios(false);
    for (const id of [`${this.CAMINATA_SRC}-puntos`, `${this.CAMINATA_SRC}-borde`]) {
      if (this.map.getLayer(id)) this.map.removeLayer(id);
    }
    if (this.map.getSource(this.CAMINATA_SRC)) this.map.removeSource(this.CAMINATA_SRC);
  }

  // Línea de puntos (la convención de "a pie" en cualquier mapa) y un pin en
  // la parada de destino. También se llama tras un cambio de estilo del mapa,
  // que borra todas las capas propias.
  private dibujarCaminata() {
    if (!this.caminataCoords || !this.caminataParada || !this.map) return;
    const data = {
      type: 'Feature' as const, properties: {},
      geometry: { type: 'LineString' as const, coordinates: this.caminataCoords },
    };
    const src = this.map.getSource(this.CAMINATA_SRC) as maplibregl.GeoJSONSource | undefined;
    if (src) {
      src.setData(data);
    } else {
      this.map.addSource(this.CAMINATA_SRC, { type: 'geojson', data });
      // Arriba de todo, edificios 3D incluidos: metida debajo de la capa de
      // buses quedaba tapada por los edificios y el camino se veía a pedazos.
      this.map.addLayer({
        id: `${this.CAMINATA_SRC}-borde`, type: 'line', source: this.CAMINATA_SRC,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#04101f', 'line-width': 9, 'line-opacity': 0.6 },
      });
      // Guiones cortos y no puntos: con la vista inclinada, un punto (un guion
      // de largo casi cero) se achica con la distancia hasta desaparecer, y el
      // camino se cortaba en la parte lejana del mapa.
      this.map.addLayer({
        id: `${this.CAMINATA_SRC}-puntos`, type: 'line', source: this.CAMINATA_SRC,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#6cb0ff', 'line-width': 5, 'line-dasharray': [0.5, 2] },
      });
      // Los buses siguen por encima del camino.
      if (this.map.getLayer(this.BUSES_LAYER)) this.map.moveLayer(this.BUSES_LAYER);
    }

    this.atenuarEdificios(true);

    const { longitud, latitud, nombre } = this.caminataParada;
    if (this.caminataMarker) {
      this.caminataMarker.setLngLat([longitud, latitud]);
    } else {
      const el = htmlMarkerEl(
        'walk-stop-marker',
        `<div class="wsm-pin" title="${esc(nombre)}"><span class="wsm-pulso"></span><span class="wsm-punta"></span></div>`,
      );
      this.caminataMarker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([longitud, latitud])
        .addTo(this.map);
    }
  }

  // Con el relieve activado MapLibre pinta las líneas sobre el terreno, y los
  // edificios 3D quedan encima sin importar el orden de las capas: de cerca
  // tapaban el camino a pedazos. Mientras hay un camino dibujado se vuelven
  // casi transparentes; al quitarlo recuperan su opacidad (la de enable3D).
  private atenuarEdificios(atenuar: boolean) {
    const id = 'buxi-buildings-3d';
    if (!this.map?.getLayer(id)) return;
    // Hay dos caminos posibles (a la parada y el último tramo del viaje):
    // quitar uno no devuelve los edificios si el otro sigue dibujado.
    const hayCamino = atenuar || !!this.caminataCoords || !!this.viajeTramoCoords;
    this.map.setPaintProperty(id, 'fill-extrusion-opacity', hayCamino ? 0.25 : (this.darkMode ? 0.85 : 0.92));
  }

  // En el teléfono el camino tiene que caber entre la barra de arriba y la
  // hoja o tarjeta de abajo; en escritorio el mapa ya está libre.
  private margenDeCaminata(): { top: number; bottom: number; left: number; right: number } {
    const escritorio = window.innerWidth >= 900;
    return escritorio
      ? { top: 90, bottom: 90, left: 90, right: 90 }
      : { top: 110, bottom: this.activeRuta ? 300 : 210, left: 50, right: 70 };
  }

  // Con el camino dibujado, al moverse el pasajero: se quita al llegar o si la
  // parada más cercana pasó a ser otra, y se vuelve a pedir si se alejó del
  // punto desde el que se calculó (sin pedirlo más de una vez cada 20 s).
  private seguirCaminata() {
    if (!this.caminata || !this.caminataParada || this.caminataCargando) return;

    if (this.paradaObjetivo?.parada.id !== this.caminata.paradaId) {
      this.quitarCaminata();
      return;
    }

    const aLaParada = this.featuresService.distanceKm(
      this.userLat, this.userLng, this.caminataParada.latitud, this.caminataParada.longitud);
    if (aLaParada <= 0.025) {
      this.quitarCaminata();
      this.toast('Llegaste a la parada');
      return;
    }

    if (!this.caminataDesde) return;
    const movido = this.featuresService.distanceKm(
      this.userLat, this.userLng, this.caminataDesde.lat, this.caminataDesde.lng);
    if (movido >= 0.04 && Date.now() - this.caminataDesde.t >= 20000) {
      this.comoLlegar(false);
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
      this.logFix('botón', coords);
      this.locationError = null;
      this.updateUserPosition(coords.latitude, coords.longitude, coords.accuracy, coords.heading);

      const problem = this.fixProblem(coords.latitude, coords.longitude, coords.accuracy);
      // Fuera del país no se encuadra: llevarte a Canadá no te acerca a ningún
      // bus. Se avisa y el mapa se queda donde estabas mirando.
      if (!this.isOutsideCostaRica(coords.latitude, coords.longitude)) {
        this.map.flyTo({
          center: [coords.longitude, coords.latitude],
          zoom: this.zoomForAccuracy(coords.accuracy),
        });
      }
      if (problem) await this.toast(problem, 'warning');
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

  // Una lectura puede ser PRECISA y estar MAL. Con una VPN activa (Brave trae
  // una incorporada) la IP geolocaliza en el país del servidor y el navegador
  // devuelve esa posición con precisión de metros. Contra eso el radio de
  // precisión no sirve: el dato afirma ser bueno.
  //
  // El chequeo anterior comparaba contra la provincia del perfil, pero `profile`
  // se carga en paralelo al mapa: si la ubicación llegaba primero, la
  // comprobación se desactivaba sola y la lectura falsa pasaba como válida.
  //
  // Esto no depende de nada que pueda no haber cargado: Buxci opera únicamente
  // en Costa Rica, así que una posición fuera del país es inservible para la
  // app aunque fuera cierta — no hay ningún bus que mostrar ahí.
  private static readonly CR_BOUNDS = { minLat: 7.9, maxLat: 11.4, minLng: -86.1, maxLng: -82.4 };

  private isOutsideCostaRica(lat: number, lng: number): boolean {
    const b = MapPage.CR_BOUNDS;
    return lat < b.minLat || lat > b.maxLat || lng < b.minLng || lng > b.maxLng;
  }

  // Devuelve el motivo por el que la lectura no es de fiar, o null si lo es.
  private fixProblem(lat: number, lng: number, accuracy?: number | null): string | null {
    if (this.isOutsideCostaRica(lat, lng)) {
      const center = PROVINCIA_CENTERS[(this.profile?.provincia || '').trim().toLowerCase()];
      const ref = center
        ? ` (a ${Math.round(this.featuresService.distanceKm(lat, lng, center[1], center[0]))} km de ${this.profile!.provincia})`
        : '';
      return `Tu navegador te ubica fuera de Costa Rica${ref}. Suele ser una VPN o la protección de ` +
        `privacidad del navegador: desactivala para este sitio y volvé a intentar.`;
    }
    if (accuracy && accuracy > 5000) {
      return `Ubicación aproximada (± ${Math.round(accuracy / 1000)} km). Sin GPS el navegador ubica por red.`;
    }
    return null;
  }

  // Los números crudos quedan en la consola: si la ubicación sale mal, esto es
  // lo primero que hay que mirar y evita adivinar sobre una captura.
  private logFix(source: string, c: { latitude: number; longitude: number; accuracy?: number | null }) {
    // eslint-disable-next-line no-console
    console.info(
      `[buxi] ubicación (${source}): lat=${c.latitude} lng=${c.longitude} ` +
      `precisión=${c.accuracy ?? 'desconocida'}m`,
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
      return 'La ubicación necesita HTTPS. Abrí la app en localhost o en app.buxci.com.';
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
          this.updateETA();
          this.loadHorariosFor(ruta.id);
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

  // ---- COMPARTIR EL VIAJE EN VIVO ----
  // Un enlace que abre Buxci siguiendo este bus, sin cuenta (los buses en
  // vivo son públicos): quien lo recibe ve dónde va mientras transmita. Antes
  // se mandaba por WhatsApp un punto fijo de Google Maps, que quedaba viejo
  // apenas el bus se movía.
  async shareBusLocation() {
    if (!this.selectedBus) return;
    const url = `${window.location.origin}/passenger/map?bus=${encodeURIComponent(this.selectedBus.bus_id)}`;
    const texto = `Seguí en vivo el bus ${this.selectedBusPlaca} (${this.selectedBusRuta}) en Buxci`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Mi bus en Buxci', text: texto, url });
        return;
      }
    } catch (e: any) {
      // Cancelar el menú de compartir no es un error.
      if (e?.name === 'AbortError') return;
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(`${texto}: ${url}`)}`, '_blank', 'noopener');
  }

  // Si se llegó por un enlace compartido (?bus=...), abrir ese bus y seguirlo.
  // Puede que todavía no haya llegado su posición: se espera al próximo
  // refresco (ver addOrUpdateBusMarker), y si no transmite se avisa.
  private busPedido: string | null = null;

  private abrirBusCompartido() {
    const id = this.route.snapshot.queryParams['bus'] || null;
    if (!id) return;
    const loc = this.busLocationsMap.get(id);
    if (loc) { this.seguirBusCompartido(loc); return; }
    this.busPedido = id;
    setTimeout(() => {
      if (this.busPedido !== id) return;
      this.busPedido = null;
      this.toast('Ese bus no está transmitiendo ahora. Cuando vuelva a salir, lo vas a ver en el mapa.', 'warning');
    }, this.ENVIVO_MS * 2 + 2000);
  }

  private seguirBusCompartido(loc: BusLocation) {
    this.busPedido = null;
    this.selectedBus = loc;
    this.toggleFollow();
  }


  ngOnDestroy() {
    this.destroyed = true;
    if (this.busRaf !== null) { cancelAnimationFrame(this.busRaf); this.busRaf = null; }
    this.tracking.unsubscribe();
    this.featuresService.unsubscribeNotificaciones(this.notifChannel);
    this.notifChannel = null;
    this.locationSub?.unsubscribe();
    if (this.envivoInterval) clearInterval(this.envivoInterval);
    if (this.navIdleTimer) clearTimeout(this.navIdleTimer);
    if (this.clockInterval) clearInterval(this.clockInterval);
    if (this.staleCheckInterval) clearInterval(this.staleCheckInterval);
    if (this.cercanasTimer) clearTimeout(this.cercanasTimer);
    if (this.watchId) Geolocation.clearWatch({ id: this.watchId });
    if (this.compassHandler) {
      window.removeEventListener('deviceorientationabsolute', this.compassHandler, true);
      window.removeEventListener('deviceorientation', this.compassHandler, true);
    }
    this.hojaObs?.disconnect();
    if (this.map) { try { this.map.remove(); } catch {} }
  }
}
