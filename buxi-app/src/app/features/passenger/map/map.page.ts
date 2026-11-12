import { Component, OnInit, OnDestroy, AfterViewInit, NgZone, ViewChild, ViewChildren, QueryList, ElementRef, inject } from '@angular/core';
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
import { Anuncio, HorarioSalida, Boleto, NotificacionEmpresa, ReporteBug, TipoMensajePasajero, ViajePasajero } from '../../../core/models/features.model';
import { FeaturesService, PuntoGeo } from '../../../core/services/features.service';
import { Geolocation } from '@capacitor/geolocation';
import { Capacitor } from '@capacitor/core';
import {
  TrazadoRuta, LatLng, Sentido, Llegada, estimarLlegada, sentidoSegunRumbo, suavizarVelocidad,
  CalidadSenal, LlegadaMostrada, calidadSenal, haceTexto, mostrarLlegada, proximaParada,
} from '../../../core/utils/eta';
import { OpcionViaje, RutaParaViaje, SinViaje, planificarViaje } from '../../../core/utils/viaje';
import { createMap, desplazamientoLibre, estiloCargo, soloParadasBuxci, paradasDelMapaBase, paradasMunicipalesPropias, capaComercios, CAPAS_PARADAS_MUNICIPALES, CAPAS_TERMINALES_MAPA, htmlMarkerEl, set3DEnabled, enable3D, mapStyleUrl, tintLightMap, setRelieve, TipoMapa } from '../../../core/utils/maplibre';
import { logError } from '../../../core/utils/log';
import { normalizarTelefono } from '../../../core/utils/telefono';
import { claveValida, REGLA_CLAVE } from '../../../core/utils/clave';
import { ParadaMunicipal, ParadasMunicipalesService } from '../../../core/services/paradas-municipales.service';
import { ModeloBus, esModeloBus, nombreModeloBus } from '../../../core/utils/bus-modelos';
import { fotoCuadrada } from '../../../core/utils/imagen';
import { esc, colorSeguro } from '../../../core/utils/html';
import { rutaCorta, tintaSobre } from '../../../core/utils/marca';
import { nombreCortoLugar } from '../../../core/utils/lugar';
import {
  SpritesBus, SPRITE_PASO_MEDIO, cargarSpritesBus, dirDeSprite,
  registrarIconoBus as registrarSpriteBus,
  registrarIconoPlano, layoutIconoBus, aplicarLayoutIconoBus, PREFIJO_ICONO_PLANO, segunEscalaBus,
} from '../../../core/utils/bus-sprite';

// Centro aproximado de cada provincia, para abrir el mapa ya en la zona del
// usuario mientras la geolocalización (que tarda) todavía no respondió. Evita
// el salto feo de arrancar en San José y after moverse a Guanacaste.
// Un uuid nuevo. randomUUID solo existe en contextos seguros; el respaldo
// arma uno v4 con getRandomValues.
function nuevoUuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

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
  // El segundo bus, si el viaje tiene transbordo (ver `transbordo`).
  ruta2?: Ruta;
  subir2?: Parada;
  bajar2?: Parada;
  hacia2?: string;
}

// El viaje que el pasajero está armando: a dónde va y cómo puede llegar.
interface LugarViaje { nombre: string; detalle: string; lat: number; lng: number; miUbicacion?: boolean }
interface Viaje {
  // Desde dónde sale. Null = desde donde está el pasajero (y se rehace si se mueve).
  origen: LugarViaje | null;
  destino: LugarViaje;
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
  styleUrls: ['./map.page.scss', './map.panels.scss', './map.desktop.scss', './map.llegar.scss', './map.viaje.scss', './map.cliente.scss', './map.tarifas.scss', './map.invitado.scss', './map.red.scss', './map.bus.scss', './map.buscador.scss', './map.cuenta.scss', './map.ficha.scss', './map.ayuda.scss', './map.abordo.scss'],
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
  // El código de la ruta ("101") al lado de cada bus, para saber cuál es sin tocarlo.
  private readonly BUSES_COD_LAYER = 'buses-codigo-layer';
  private codigoPorRuta = new Map<string, { codigo: string; fondo: string; tinta: string }>();
  // La pastilla de fondo: una imagen estirable por color, que MapLibre ajusta
  // al largo del texto (icon-text-fit). Se registra la primera vez que hace falta.
  private pastillaDe(fondo: string): string {
    const id = 'pastilla-' + fondo;
    if (this.map.hasImage(id)) return id;
    // Alto y ancho de más para que las zonas estirables no queden en cero
    // (MapLibre descarta la imagen si una zona mide 0).
    const r = 2, w = 24 * r, h = 22 * r, rad = 9 * r;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    if (!ctx) return id;
    ctx.fillStyle = fondo;
    ctx.strokeStyle = 'rgba(7, 15, 28, 0.85)';
    ctx.lineWidth = 2 * r;
    ctx.beginPath();
    ctx.roundRect(r, r, w - 2 * r, h - 2 * r, rad - r);
    ctx.fill();
    ctx.stroke();
    this.map.addImage(id, ctx.getImageData(0, 0, w, h), {
      pixelRatio: r,
      stretchX: [[rad, w - rad]],
      stretchY: [[rad, h - rad]],
      content: [rad - 3 * r, 4 * r, w - rad + 3 * r, h - 4 * r],
    });
    return id;
  }

  private codigoDeRuta(rutaId: string | undefined): { codigo: string; fondo: string; tinta: string } | null {
    if (!rutaId) return null;
    const hecho = this.codigoPorRuta.get(rutaId);
    if (hecho) return hecho;
    const r = this.allRutas.find(x => x.id === rutaId);
    if (!r) return null;
    const fondo = colorSeguro(r.color, '#8292aa');
    const c = { codigo: (r.codigo_ruta || rutaCorta(r.nombre)).trim(), fondo, tinta: tintaSobre(fondo) };
    this.codigoPorRuta.set(rutaId, c);
    return c;
  }
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
  private compassHandler?: (e: DeviceOrientationEvent) => void;
  locating = false;
  locationError: string | null = null;
  private locationSub: Subscription | null = null;
  private watchId: string | null = null;

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
  // Arranca en 2D: el relieve y los edificios en 3D son lo más pesado de
  // bajar y de dibujar, y el mapa abre bastante más rápido sin ellos. Quien
  // prefiere el 3D lo prende con el botón o en Ajustes, y queda recordado en
  // este teléfono (como el tipo de mapa).
  is3D = (() => {
    try { return localStorage.getItem('buxci.vista3d.v1') === '1'; } catch { return false; }
  })();
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
      case 'lugares':
        switch (this.buscarPara) {
          case 'origen': return '¿Desde dónde salís?';
          case 'casa': return '¿Dónde es tu casa?';
          case 'trabajo': return '¿Dónde trabajás?';
          default: return '¿A dónde vas?';
        }
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

  // ---- RUTAS Y EMPRESAS: pestañas y filtros ----
  // El panel "Rutas" muestra también las empresas: antes solo se llegaba a
  // ellas por el tirador lateral del mapa, que en el teléfono casi no se ve.
  rutasTab: 'rutas' | 'empresas' = 'rutas';
  filtroRutas: 'todas' | 'cerca' | 'vivo' = 'todas';

  // Buses con GPS al día de cada ruta, ahora.
  private vivosPorRuta(): Map<string, number> {
    const ahora = Date.now();
    const m = new Map<string, number>();
    for (const loc of this.busLocationsMap.values()) {
      const r = this.busRuta.get(loc.bus_id);
      if (!r || !this.gpsEnVivo(loc, ahora)) continue;
      m.set(r, (m.get(r) ?? 0) + 1);
    }
    return m;
  }

  // Rutas con alguna parada a distancia de caminar. Se guarda por posición:
  // el getter corre en cada detección de cambios y las paradas son cientos.
  private cercaCache: { clave: string; ids: Set<string> } | null = null;
  private rutasCercaIds(): Set<string> {
    const clave = `${this.userLat.toFixed(3)},${this.userLng.toFixed(3)},${this.allParadas.length}`;
    if (this.cercaCache?.clave === clave) return this.cercaCache.ids;
    const ids = new Set<string>();
    if (this.tieneUbicacion) {
      for (const p of this.allParadas) {
        if (ids.has(p.ruta_id)) continue;
        if (this.featuresService.distanceKm(this.userLat, this.userLng, p.latitud, p.longitud) <= this.CERCANA_MAX_KM) ids.add(p.ruta_id);
      }
    }
    this.cercaCache = { clave, ids };
    return ids;
  }

  get panelFilas(): { ruta: Ruta; vivos: number }[] {
    const vivos = this.vivosPorRuta();
    let rutas = this.panelRutas;
    if (this.activePanel === 'rutas' && this.filtroRutas === 'vivo') rutas = rutas.filter(r => (vivos.get(r.id) ?? 0) > 0);
    if (this.activePanel === 'rutas' && this.filtroRutas === 'cerca') {
      const ids = this.rutasCercaIds();
      rutas = rutas.filter(r => ids.has(r.id));
    }
    return rutas.map(ruta => ({ ruta, vivos: vivos.get(ruta.id) ?? 0 }));
  }

  trackFila = (_: number, f: { ruta: Ruta }) => f.ruta.id;

  // Todas las empresas, las más cercanas primero, pasadas por el buscador.
  get panelEmpresas(): { empresa: EmpresaListItem; distanceKm: number | null }[] {
    const q = this.panelSearch.trim().toLowerCase();
    const base = this.empresasTodas.length ? this.empresasTodas : this.empresas.map(e => ({ empresa: e, distanceKm: null }));
    if (!q) return base;
    return base.filter(x => `${x.empresa.nombre} ${x.empresa.rutaResumen}`.toLowerCase().includes(q));
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
  // Todas, ordenadas por distancia (las de arriba son solo las de la zona).
  empresasTodas: { empresa: EmpresaListItem; distanceKm: number | null }[] = [];
  hayEmpresasCerca = false;

  // Identidad estable para *ngFor: sin esto Angular rehace cada fila aunque
  // los datos no hayan cambiado.
  trackEmpresa = (_: number, x: { empresa: EmpresaListItem }) => x.empresa.id;

  private recomputeEmpresasCercanas() {
    if (this.userLat === 0 || this.allParadas.length === 0) {
      this.empresasCercanas = this.empresas.map(e => ({ empresa: e, distanceKm: null }));
      this.empresasTodas = this.empresasCercanas;
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
    this.empresasTodas = conDistancia;
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
  empresaDetailBusqueda = '';

  // Con muchas rutas (La Reina del Campo tiene decenas) se busca adentro.
  get empresaDetailFiltradas() {
    const q = this.empresaDetailBusqueda.trim().toLowerCase();
    if (!q) return this.empresaDetailRutas;
    return this.empresaDetailRutas.filter(r => `${r.nombre} ${r.origen} ${r.destino}`.toLowerCase().includes(q));
  }

  get empresaDetailVivos(): number {
    const vivos = this.vivosPorRuta();
    return this.empresaDetailRutas.reduce((n, r) => n + (vivos.get(r.id) ?? 0), 0);
  }

  async openEmpresaDetail(empresa: EmpresaListItem) {
    const rutas = this.allRutas.filter(r => r.empresa_id === empresa.id);
    if (rutas.length === 0) {
      await this.toast(`${empresa.nombre} no tiene rutas activas todavía.`, 'warning');
      return;
    }

    this.empresaDetail = empresa;
    this.empresaDetailBusqueda = '';
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
  async openSearch(prefill = '', para: 'destino' | 'origen' | 'casa' | 'trabajo' = 'destino') {
    // El origen solo se cambia con un viaje armado: sin destino no hay viaje.
    this.buscarPara = para === 'origen' && !this.viaje ? 'destino' : para;
    await this.openPanel('lugares');
    this.activePanel = 'lugares';
    this.placeQuery = prefill;
    this.placeResults = [];
    if (prefill) this.runPlaceSearch(prefill);
    setTimeout(() => this.panelSearchInput?.nativeElement.focus(), 120);
  }

  // ---- BUSQUEDA DE LUGARES ----
  // El mismo buscador sirve para el destino y para el origen del viaje.
  // 'casa' y 'trabajo': se está guardando ese lugar, no armando un viaje.
  buscarPara: 'destino' | 'origen' | 'casa' | 'trabajo' = 'destino';

  // ---- RECIENTES Y LUGARES GUARDADOS ----
  // Como "Seneste Rejser" de Rejseplanen: al abrir el buscador, los últimos
  // destinos y Casa/Trabajo a un toque. Viven en este teléfono (localStorage).
  lugaresGuardados: { casa?: LugarViaje; trabajo?: LugarViaje } = this.leerLocal('buxci.lugares.v1', {});
  recientes: LugarViaje[] = this.leerLocal('buxci.recientes.v1', []);
  private readonly MAX_RECIENTES = 6;

  private leerLocal<T>(clave: string, porDefecto: T): T {
    try {
      const v = localStorage.getItem(clave);
      return v ? JSON.parse(v) as T : porDefecto;
    } catch { return porDefecto; }
  }

  private escribirLocal(clave: string, valor: unknown) {
    try { localStorage.setItem(clave, JSON.stringify(valor)); } catch { /* sin almacenamiento: se pierde al cerrar */ }
  }

  private mismoLugar(a: LugarViaje, b: LugarViaje): boolean {
    return this.featuresService.distanceKm(a.lat, a.lng, b.lat, b.lng) < 0.05;
  }

  private guardarReciente(l: LugarViaje) {
    if (l.miUbicacion) return;
    const { casa, trabajo } = this.lugaresGuardados;
    if ((casa && this.mismoLugar(casa, l)) || (trabajo && this.mismoLugar(trabajo, l))) return;
    this.recientes = [l, ...this.recientes.filter(r => !this.mismoLugar(r, l))].slice(0, this.MAX_RECIENTES);
    this.escribirLocal('buxci.recientes.v1', this.recientes);
  }

  borrarRecientes() {
    this.recientes = [];
    this.escribirLocal('buxci.recientes.v1', []);
  }

  // Tocar Casa, Trabajo o un reciente: es el destino (o el origen, si se
  // estaba eligiendo desde dónde salir).
  elegirLugar(l: LugarViaje) {
    this.selectPlace({ label: l.detalle, lat: l.lat, lng: l.lng, nombre: l.nombre });
  }

  get recientesVisibles(): LugarViaje[] {
    return this.buscarPara === 'casa' || this.buscarPara === 'trabajo' ? [] : this.recientes;
  }
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
  selectPlace(p: { label: string; lat: number; lng: number; nombre?: string }) {
    const lugar: LugarViaje = { nombre: p.nombre || p.label.split(',')[0].trim() || p.label, detalle: p.label, lat: p.lat, lng: p.lng };

    // Guardando Casa o Trabajo: se guarda y se vuelve al buscador, que ahora
    // ya lo muestra arriba.
    if (this.buscarPara === 'casa' || this.buscarPara === 'trabajo') {
      const cual = this.buscarPara;
      this.lugaresGuardados = { ...this.lugaresGuardados, [cual]: { ...lugar, nombre: cual === 'casa' ? 'Casa' : 'Trabajo' } };
      this.escribirLocal('buxci.lugares.v1', this.lugaresGuardados);
      this.toast(cual === 'casa' ? 'Casa guardada' : 'Trabajo guardado');
      this.openSearch();
      return;
    }

    this.closePanel();
    if (!this.mapReady) return;

    if (this.buscarPara === 'origen' && this.viaje) {
      this.buscarPara = 'destino';
      this.cambiarViaje({ ...this.viaje, origen: lugar });
      return;
    }

    // Un destino nuevo reemplaza lo que hubiera en pantalla.
    if (this.activeRuta) this.clearRoute();
    this.quitarCaminata();
    this.quitarTramoViaje();
    this.viajeElegido = null;

    this.viaje = {
      // Un destino nuevo conserva el origen que se hubiera elegido.
      origen: this.viaje?.origen ?? null,
      destino: lugar,
      desde: null,
      opciones: [],
      aPie: { metros: 0, minutos: 0 },
      motivo: 'sin_ubicacion',
      paradaOrigenKm: null,
      paradaDestinoKm: null,
    };
    this.guardarReciente(lugar);
    this.marcarLugares();
    this.planificar();
    // Con la hoja ya dibujada, para encuadrar por encima de ella.
    setTimeout(() => this.encuadrarViaje(), 60);
  }

  // Salir desde donde está el pasajero (deja de lado el origen elegido).
  usarMiUbicacionComoOrigen() {
    this.closePanel();
    this.buscarPara = 'destino';
    const v = this.viaje;
    // Si el destino es "Tu ubicación" (por haber invertido), ida y vuelta
    // serían el mismo punto: se deja como estaba.
    if (!v || v.destino.miUbicacion) return;
    this.cambiarViaje({ ...v, origen: null });
  }

  // La vuelta: el destino pasa a ser el origen y al revés. "Tu ubicación"
  // queda fija donde estaba el pasajero al invertir.
  get puedeInvertir(): boolean {
    return !!this.viaje && (!!this.viaje.origen || this.tieneUbicacion);
  }

  invertirViaje() {
    const v = this.viaje;
    if (!v || !this.puedeInvertir) return;
    const yo: LugarViaje = { nombre: 'Tu ubicación', detalle: 'Donde estabas al invertir el viaje', lat: this.userLat, lng: this.userLng, miUbicacion: true };
    this.cambiarViaje({ ...v, origen: v.destino.miUbicacion ? null : v.destino, destino: v.origen ?? yo });
  }

  // Cambia origen o destino de un viaje ya armado: vuelve a la lista de
  // opciones, rehace el plan y encuadra.
  private cambiarViaje(v: Viaje) {
    if (this.activeRuta) this.clearRoute();
    this.quitarTramoViaje();
    this.viajeElegido = null;
    this.viaje = { ...v, desde: null, opciones: [] };
    this.marcarLugares();
    this.planificar();
    setTimeout(() => this.encuadrarViaje(), 60);
  }

  // Los pines del viaje: azul el destino y, si no sale de donde está el
  // pasajero, un aro blanco en el origen.
  private origenMarker: maplibregl.Marker | null = null;
  private marcarLugares() {
    this.placeMarker?.remove();
    this.placeMarker = null;
    this.origenMarker?.remove();
    this.origenMarker = null;
    const v = this.viaje;
    if (!v || !this.map) return;
    if (!v.destino.miUbicacion) {
      const el = htmlMarkerEl('place-marker', '<div class="place-pin"></div>');
      this.placeMarker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([v.destino.lng, v.destino.lat])
        .addTo(this.map);
    }
    if (v.origen) {
      const el = htmlMarkerEl('place-marker', '<div class="origen-pin"></div>');
      this.origenMarker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([v.origen.lng, v.origen.lat])
        .addTo(this.map);
    }
  }

  // Lo que dice el campo "Desde".
  get origenTexto(): string {
    const v = this.viaje;
    if (v?.origen) return v.origen.nombre;
    return this.tieneUbicacion ? 'Tu ubicación' : 'Activá tu ubicación';
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

  // Seguir una empresa es lo que da acceso a sus avisos (RLS, 20260830000000).
  // Los buses no dependen de esto: desde buses_en_vivo (20261021172627) se ven
  // todos, se siga o no a la empresa. Al marcarla se recargan los avisos para
  // que los que ya existían aparezcan de una.
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
      this.programarCercanas();
      await this.toast(seguia
        ? `Dejaste de seguir a ${empresa.nombre}: ya no te llegan sus avisos`
        : `Ahora seguís a ${empresa.nombre}: te van a llegar sus avisos`);
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
      case 'denegado': {
        // En iPhone no hay "permisos del sitio": el permiso vive en Ajustes, y
        // dentro de otra app (un enlace abierto desde WhatsApp, un ícono viejo)
        // iOS lo niega sin preguntar.
        if (!this.push.esIos) return this.toast('El navegador bloqueó los avisos. Activalos en los permisos del sitio.', 'warning');
        const alert = await this.alertCtrl.create({
          cssClass: 'buxi-alert',
          header: 'El iPhone bloqueó los avisos',
          message: 'Abrí app.buxci.com en Safari, tocá Compartir → "Agregar a inicio" y entrá desde ese ícono. Si ya lo hiciste, activalos en Ajustes → Notificaciones → Buxci.',
          buttons: ['Entendido'],
        });
        await alert.present();
        return;
      }
      case 'no-soportado': return this.toast('Este navegador no puede recibir avisos.', 'warning');
      case 'error': return this.toast('No se pudieron activar los avisos. Probá de nuevo.', 'danger');
      case 'ios-instalar': {
        const alert = await this.alertCtrl.create({
          cssClass: 'buxi-alert',
          header: 'Primero instalá Buxci',
          message: 'En iPhone los avisos solo llegan con la app en la pantalla de inicio: tocá Compartir y después "Agregar a inicio". Abrila desde ahí y activá los avisos.',
          buttons: [
            { text: 'Ahora no', role: 'cancel', cssClass: 'ba-cancel' },
            { text: 'Ver cómo', cssClass: 'ba-confirm', handler: () => { this.abrirInstalar(); } },
          ],
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
    // Llegó: el viaje del historial pasa a completado.
    if (this.viajeAnotado && this.viajeAnotado.clave === clave) {
      this.featuresService.completarViaje(this.viajeAnotado.id)
        .catch(e => logError('completar el viaje del historial', e));
    }
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

  // ---- HOJA DE RUTA: compacta o con todo ----
  // En el teléfono arranca compacta (cuánto falta, dónde y el boleto) para
  // que el mapa se vea; el resto se abre tocando o arrastrando el asa.
  hojaRutaAbierta = false;
  soltarHojaRuta(dy: number) {
    if (Math.abs(dy) < this.ARRASTRE_MIN_PX) return;
    this.hojaRutaAbierta = dy < 0;
  }
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
  // Apagado hasta que haya una pasarela de pago de verdad: sin ella, comprar
  // generaba un boleto vigente —que el chofer valida— sin cobrar nada.
  readonly ventaBoletosActiva = false;

  async comprarBoleto() {
    if (!this.ventaBoletosActiva || !this.activeRuta) return;
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

  // ---- MIS VIAJES (historial, 20261109120400) ----
  // Se anota un viaje al elegir cómo llegar a un destino, y se completa
  // cuando la app avisa "bajate en la próxima". Volver a elegir la misma
  // opción enseguida no anota otro: sería el mismo viaje.
  viajesSheetOpen = false;
  misViajes: ViajePasajero[] = [];
  misViajesCargando = false;
  private viajeAnotado: { id: string; clave: string; at: number } | null = null;

  private async anotarViaje(o: OpcionVista, destino: { nombre: string; lat: number; lng: number }) {
    if (!this.profile) return;
    // La clave es la de la bajada final: con transbordo, la del segundo bus,
    // que es donde revisarBajada da el viaje por completado.
    const t = o.transbordo;
    const clave = t ? t.rutaId + ':' + t.bajarId : o.rutaId + ':' + o.bajarId;
    if (this.viajeAnotado?.clave === clave && Date.now() - this.viajeAnotado.at < 30 * 60_000) return;
    try {
      // user_id lo pone la base (auth.uid()).
      const id = await this.featuresService.anotarViaje({
        ruta_id: o.rutaId,
        ruta2_id: t?.rutaId ?? null,
        subir_parada_id: o.subirId,
        bajar_parada_id: t?.bajarId ?? o.bajarId,
        destino_nombre: destino.nombre.slice(0, 200),
        destino_lat: destino.lat,
        destino_lng: destino.lng,
      });
      this.viajeAnotado = { id, clave, at: Date.now() };
    } catch (e) {
      // Sin la migración la tabla no existe: el viaje sigue igual, solo no se anota.
      logError('anotar el viaje en el historial', e);
    }
  }

  async openMisViajes() {
    if (!this.profile) { this.pedirCuenta('ver tus viajes'); return; }
    this.profilePanelOpen = false;
    this.viajesSheetOpen = true;
    this.misViajesCargando = true;
    try {
      this.misViajes = await this.featuresService.getMisViajes();
    } catch (e) {
      logError('cargar mis viajes', e);
      this.misViajes = [];
    } finally {
      this.misViajesCargando = false;
    }
  }

  closeMisViajes() {
    this.viajesSheetOpen = false;
  }

  repetirViaje(v: ViajePasajero) {
    this.viajesSheetOpen = false;
    this.selectPlace({ label: v.destino_nombre, lat: v.destino_lat, lng: v.destino_lng });
  }

  async borrarViaje(v: ViajePasajero, ev: Event) {
    ev.stopPropagation();
    const antes = this.misViajes;
    this.misViajes = this.misViajes.filter(x => x.id !== v.id);
    try {
      await this.featuresService.borrarViaje(v.id);
    } catch (e) {
      logError('borrar un viaje del historial', e);
      this.misViajes = antes;
      await this.toast('No se pudo borrar el viaje', 'danger');
    }
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
      case 'retrasado': {
        const m = this.busRetraso.get(this.selectedBus!.bus_id);
        return m ? `Salió ${m} min tarde` : 'Retrasado';
      }
      case 'en_ruta':    return 'En ruta';
      default:           return 'Sin datos';
    }
  }

  // Cuánto le falta al bus elegido para llegar a la parada del pasajero: la
  // más cercana a él sobre la ruta de ESE bus. Pasa por mostrarLlegada: con
  // el GPS viejo nunca se muestra un número como si fuera exacto.
  get selectedBusLlegada(): LlegadaMostrada | null {
    const loc = this.selectedBus;
    if (!loc || this.userLat === 0) return null;
    const rutaId = this.rutaDelBus(loc.bus_id);
    if (!rutaId) return null;
    const paradas = this.paradasPorRuta.get(rutaId)
      ?? (this.activeRuta?.id === rutaId ? this.activeParadas : []);
    const cercana = this.featuresService.findNearestStop(this.userLat, this.userLng, paradas);
    if (!cercana) return null;
    const r = this.llegadaDe(loc, cercana.parada);
    return r ? mostrarLlegada(r.llegada, this.selectedBusEdadS) : null;
  }

  // Segundos desde el último punto GPS del bus elegido.
  get selectedBusEdadS(): number {
    if (!this.selectedBus) return Infinity;
    return Math.max(0, (this.nowTs - Date.parse(this.selectedBus.timestamp)) / 1000);
  }

  get selectedBusSenal(): CalidadSenal {
    return calidadSenal(this.selectedBusEdadS);
  }

  get selectedBusSenalTexto(): string {
    switch (this.selectedBusSenal) {
      case 'en_vivo':  return 'En vivo';
      case 'demorada': return 'Señal demorada';
      default:         return 'Sin señal';
    }
  }

  get selectedBusUnidad(): string | null {
    const n = (this.selectedBus?.bus as any)?.numero_unidad;
    return n ? `Unidad ${n}` : null;
  }

  // "Hacia Cartago": el extremo de la ruta al que avanza, según su marcha.
  get selectedBusHacia(): string | null {
    const loc = this.selectedBus;
    if (!loc) return null;
    const rutaId = this.rutaDelBus(loc.bus_id);
    const ruta = this.allRutas.find(r => r.id === rutaId) ?? (this.activeRuta?.id === rutaId ? this.activeRuta : null);
    if (!ruta) return null;
    if (!this.busMarcha.has(loc.bus_id)) this.actualizarMarcha(loc);
    const sentido = this.busMarcha.get(loc.bus_id)?.sentido;
    if (!sentido) return null;
    return (sentido === -1 ? ruta.origen : ruta.destino) || null;
  }

  // La próxima parada que el bus tiene adelante y a cuánto está. Con la señal
  // perdida no se dice: el bus pudo haberla pasado hace rato.
  get selectedBusProximaParada(): { nombre: string; distancia: string } | null {
    const loc = this.selectedBus;
    if (!loc || this.selectedBusSenal === 'perdida') return null;
    const rutaId = this.rutaDelBus(loc.bus_id);
    const t = rutaId ? this.trazadoDe(rutaId) : null;
    if (!t) return null;
    if (!this.busMarcha.has(loc.bus_id)) this.actualizarMarcha(loc);
    const m = this.busMarcha.get(loc.bus_id);
    if (!m) return null;
    const p = proximaParada(m.km, m.sentido, t.kmParadas);
    if (!p) return null;
    const paradas = this.paradasPorRuta.get(rutaId!) ?? (this.activeRuta?.id === rutaId ? this.activeParadas : []);
    const parada = paradas.find(x => x.id === p.id);
    return parada ? { nombre: parada.nombre, distancia: this.metrosTexto(p.distanciaKm * 1000) } : null;
  }

  get selectedBusAgeText(): string {
    if (!this.selectedBus) return '';
    const t = haceTexto(this.selectedBusEdadS);
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  get followingBus(): boolean {
    return this.followBusId !== null;
  }

  // Siguiendo un bus, la ficha queda chica (placa, estado, cuánto falta y los
  // botones): abierta entera tapaba medio mapa y no se veía el bus que se
  // estaba siguiendo. Tocando la rayita se abre y se vuelve a achicar.
  fichaChica = true;

  alternarFicha() {
    if (!this.followingBus) return;
    this.fichaChica = !this.fichaChica;
  }

  get avatarUrl(): string | null { return this.profile?.foto_url || null; }
  get displayName(): string { return this.profile?.nombre_completo || 'Invitado'; }
  get displayEmail(): string { return this.profile?.correo || ''; }

  get selectedBusPlaca(): string {
    return (this.selectedBus?.bus as any)?.placa || 'Bus';
  }

  get selectedBusRuta(): string {
    return (this.selectedBus?.bus as any)?.ruta?.nombre || 'Sin ruta asignada';
  }

  // El modelo del bus abierto, solo si la empresa eligió uno: sin elección no
  // se dibuja nada, para no inventarle un aspecto que el bus real no tiene.
  get selectedBusModelo(): ModeloBus | null {
    return this.selectedBus ? this.busModelo.get(this.selectedBus.bus_id) || null : null;
  }

  get selectedBusColor(): string {
    return this.selectedBus ? this.busColors.get(this.selectedBus.bus_id) || this.BUS_COLOR_FALLBACK : this.BUS_COLOR_FALLBACK;
  }

  nombreModelo(m: ModeloBus): string {
    return nombreModeloBus(m);
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
      id, this.iconoDe(loc)));
    this.pintarBuses(performance.now());
  }

  // El ícono de un bus: en 2D, el bus visto desde arriba con el modelo que
  // eligió su empresa; en 3D (o mientras el de arriba se termina de dibujar),
  // el sprite isométrico.
  private iconoDe(loc: BusLocation): string {
    const estado = this.estadoDeBus(loc);
    if (!this.is3D) {
      const plano = registrarIconoPlano(
        this.map, this.busModelo.get(loc.bus_id), this.colorDeEstado(estado, this.busColor(loc)),
        this.busIconosRegistrados, this.alCargarPlano);
      if (plano) return plano;
    }
    return this.registrarIconoBus(estado, this.busColor(loc), this.dirDeBus(loc));
  }

  private alCargarPlano = () => { if (!this.destroyed && !this.is3D) this.refrescarIconos(); };

  // Ajusta la capa de buses a la vista: en 3D el sprite va parado y anclado
  // abajo; en 2D va acostado, centrado y girado con el rumbo. Las etiquetas
  // se corren porque el bus ya no queda por encima del punto sino encima, y
  // se alejan a medida que el bus crece con el zoom.
  private aplicarVistaBuses() {
    if (!this.map) return;
    aplicarLayoutIconoBus(this.map, this.BUSES_LAYER, this.is3D);
    try {
      if (this.map.getLayer(this.BUSES_LAYER)) {
        this.map.setLayoutProperty(this.BUSES_LAYER, 'text-offset', this.offsetEtiquetaBus());
      }
      if (this.map.getLayer(this.BUSES_COD_LAYER)) {
        this.map.setLayoutProperty(this.BUSES_COD_LAYER, 'text-offset', this.offsetCodigoBus());
      }
    } catch { /* el estilo se está cambiando */ }
    this.refrescarIconos();
  }

  // "hace 2 min", debajo del bus. En 3D el bus crece hacia arriba (está
  // anclado abajo) y la etiqueta no se mueve; en 2D crece para los dos lados.
  private offsetEtiquetaBus(): any {
    return this.is3D ? [0, 0.25] : segunEscalaBus(false, e => [0, 2 * e]);
  }

  // El código de la ruta, arriba a la derecha del bus.
  private offsetCodigoBus(): any {
    return this.is3D
      ? segunEscalaBus(true, e => [e, -2.5 * e])
      : segunEscalaBus(false, e => [1.2 * e, -1.2 * e]);
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
  // 'retrasado': su viaje en curso salió más de RETRASO_MIN minutos tarde,
  //              contra la salida programada más cercana de su ruta. Lo
  //              calcula la base por bus (buses_en_vivo.retraso_min, con la
  //              misma regla que la puntualidad de la empresa). Sin viaje en
  //              curso o sin horario comparable no hay atraso: no se inventa.
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

  private estadoDeBus(loc: BusLocation): BusEstadoVivo {
    const paradas = this.paradasDelBus(loc);
    if ((loc.velocidad ?? 0) <= this.PARADA_VEL_MAX && paradas.length) {
      const cerca = paradas.some(p =>
        this.featuresService.distanceKm(loc.latitud, loc.longitud, p.latitud, p.longitud)
          <= this.PARADA_RADIO_KM);
      if (cerca) return 'en_parada';
    }
    if ((this.busRetraso.get(loc.bus_id) ?? 0) > this.RETRASO_MIN) return 'retrasado';
    return 'en_ruta';
  }

  // bus -> minutos que salió tarde su viaje en curso (null: no comparable).
  // Llega con buses_en_vivo; los puntos de Realtime no lo traen y no lo pisan.
  private busRetraso = new Map<string, number | null>();

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
  // Modelo elegido en Personalización (del bus o de su flota), por bus.
  private busModelo = new Map<string, ModeloBus>();
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
  //
  // Y por encima de todo, el color propio del bus: en Personalización la
  // empresa puede pintar unidades sueltas distinto del resto de la flota.
  private busColor(loc: BusLocation): string {
    const bus = loc.bus as any;
    // El de la empresa también viene con cada bus en vivo (bus.empresa): si la
    // lista de colores no cargó, igual gana sobre el de la ruta.
    const crudo = bus?.color_bus || this.coloresEmpresa.get(bus?.empresa_id) || bus?.empresa?.color_bus || bus?.ruta?.color;
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

  // Sin red el mapa se quedaba en blanco o con buses congelados, y el pasajero
  // no sabía si era la app, el bus o su conexión. Un aviso fijo lo dice.
  sinConexion = typeof navigator !== 'undefined' && navigator.onLine === false;
  private readonly alCambiarRed = () => this.zone.run(() => { this.sinConexion = !navigator.onLine; });

  // ---- INSTALAR LA APP (web instalable) ----
  // En iPhone, Buxci se instala desde Safari ("Agregar a inicio"): queda como
  // una app, a pantalla completa y con avisos (Web Push solo funciona así en
  // iOS). En Android, si el navegador ofrece instalar, se usa su propio
  // diálogo; si no, se explican los pasos.
  instalarOpen = false;
  private eventoInstalar: any = null;
  private avisoInstalarCerrado = (() => {
    try { return localStorage.getItem('buxci.avisoInstalar.v1') === '1'; } catch { return false; }
  })();
  private readonly alPoderInstalar = (e: Event) => {
    e.preventDefault(); // el aviso lo da la app, en su momento
    this.zone.run(() => { this.eventoInstalar = e; });
  };
  private readonly alInstalarse = () => this.zone.run(() => {
    this.eventoInstalar = null;
    this.instalarOpen = false;
    this.toast('Listo: Buxci quedó instalada');
  });

  get esIos(): boolean {
    return this.push.esIos;
  }

  get estaInstalada(): boolean {
    return Capacitor.isNativePlatform()
      || (navigator as any).standalone === true
      || window.matchMedia('(display-mode: standalone)').matches;
  }

  // El aviso suelto sobre el mapa: solo en iPhone, una vez, hasta que lo cierre.
  get mostrarAvisoInstalar(): boolean {
    return this.esIos && !this.estaInstalada && !this.avisoInstalarCerrado;
  }

  abrirInstalar() {
    this.showMap();
    this.instalarOpen = true;
  }

  cerrarInstalar() {
    this.instalarOpen = false;
  }

  cerrarAvisoInstalar(ev?: Event) {
    ev?.stopPropagation();
    this.avisoInstalarCerrado = true;
    try { localStorage.setItem('buxci.avisoInstalar.v1', '1'); } catch {}
  }

  async instalarAhora() {
    const e = this.eventoInstalar;
    if (!e) return;
    this.eventoInstalar = null; // el diálogo del navegador se puede mostrar una sola vez
    await e.prompt();
    const { outcome } = await e.userChoice;
    if (outcome !== 'accepted') await this.toast('Cuando quieras, la instalás desde Ajustes', 'medium');
  }

  get puedeInstalarDirecto(): boolean {
    return !!this.eventoInstalar;
  }

  async ngOnInit() {
    window.addEventListener('online', this.alCambiarRed);
    window.addEventListener('offline', this.alCambiarRed);
    window.addEventListener('beforeinstallprompt', this.alPoderInstalar);
    window.addEventListener('appinstalled', this.alInstalarse);
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
      this.codigoPorRuta.clear();
      this.recalcularParadaCercana();
      this.allParadas = paradas;
      this.dibujarParadasTodas();
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
      // En 2D ni se pide el relieve: createMap solo lo carga con threeD.
      pitch: this.is3D ? 50 : 0,
      threeD: this.is3D,
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
      try { capaComercios(this.map, this.darkMode); } catch {}
      try { paradasDelMapaBase(this.map, this.darkMode); } catch {}
      // Vacías por ahora: así sus capas nacen debajo de los buses aunque la
      // lista llegue después (agregarlas al final las ponía encima).
      try { paradasMunicipalesPropias(this.map, this.darkMode, []); } catch {}
      this.cargarParadasPropias();
      this.engancharToqueParadas();

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
  // ---- Gestos mientras se sigue un bus ----
  // Al tocar el mapa (zoom, arrastre, rueda) la ficha se esconde y la cámara
  // deja de moverse sola; al soltar, la ficha vuelve y el bus se centra de
  // nuevo en lo que queda libre, con el zoom que dejó el pasajero.
  fichaOculta = false;
  private gestoSiguiendo = false;
  private reaparecerFicha: any = null;

  private engancharGestosSeguimiento() {
    this.zone.runOutsideAngular(() => {
      this.map.on('movestart', (e: any) => {
        if (!e?.originalEvent || !this.followBusId) return;
        this.gestoSiguiendo = true;
        clearTimeout(this.reaparecerFicha);
        if (!this.fichaOculta) this.zone.run(() => { this.fichaOculta = true; });
      });
      this.map.on('moveend', () => {
        if (!this.gestoSiguiendo) return;
        this.gestoSiguiendo = false;
        clearTimeout(this.reaparecerFicha);
        this.reaparecerFicha = setTimeout(() => {
          if (!this.followBusId) return;
          this.zone.run(() => { this.fichaOculta = false; });
          // Con la ficha ya de vuelta, para medir bien lo que queda libre.
          setTimeout(() => this.recentrarSeguido(), 320);
        }, 900);
      });
    });
  }

  private recentrarSeguido() {
    const id = this.followBusId;
    if (!id || this.gestoSiguiendo || !this.mapReady) return;
    const loc = this.busLocationsMap.get(id);
    if (!loc) return;
    this.map.easeTo({
      center: [loc.longitud, loc.latitud],
      offset: desplazamientoLibre(this.map),
      duration: 600,
    });
  }

  private setupMapChrome() {
    this.engancharGestosSeguimiento();
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
        this.usuarioMovioMapa = true;
        if (this.cercaAltura === 'lista') this.zone.run(() => this.ponerCercaAltura('resumen', false));
      });
      // Zoom con los dedos o la rueda (trae originalEvent; el de la app, no):
      // el pasajero ya eligió qué mirar y el encuadre automático no lo pisa.
      this.map.on('zoomstart', (e: any) => { if (e?.originalEvent) this.usuarioMovioMapa = true; });

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
      this.cancelCambiarClave();
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
    this.cambiandoClave = false;
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

    const telefono = this.editPhone.trim() ? normalizarTelefono(this.editPhone) : null;
    if (this.editPhone.trim() && !telefono) {
      await this.toast('El teléfono tiene que ser un número de Costa Rica, de 8 dígitos', 'warning');
      return;
    }

    this.savingProfile = true;
    try {
      this.profile = await this.supabase.updateProfile({
        nombre_completo: nombre,
        telefono,
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

  // ---- AYUDA Y CONTACTO ----
  // Preguntas frecuentes y un formulario. Los mensajes van a reportes_bugs
  // (20261109120200): los problemas y sugerencias los lee JIRB; las quejas y
  // felicitaciones, también la empresa. Ahí mismo se responden, y el pasajero
  // ve la respuesta en "Tus mensajes".
  ayudaOpen = false;
  faqAbierta: number | null = null;
  ayudaTipo: TipoMensajePasajero = 'problema';
  ayudaEmpresaId: string | null = null;
  ayudaMensaje = '';
  enviandoAyuda = false;
  misMensajes: ReporteBug[] = [];

  readonly TIPOS_AYUDA: { tipo: TipoMensajePasajero; texto: string }[] = [
    { tipo: 'problema', texto: 'Un problema con la app' },
    { tipo: 'sugerencia', texto: 'Una sugerencia' },
    { tipo: 'queja', texto: 'Una queja de una empresa' },
    { tipo: 'felicitacion', texto: 'Felicitar a una empresa' },
  ];

  readonly FAQ: { p: string; r: string }[] = [
    {
      p: '¿Por qué no veo buses en el mapa?',
      r: 'Solo aparecen los buses que están transmitiendo en este momento. Si la empresa todavía no usa Buxci o el bus no salió, no se ve.',
    },
    {
      p: '¿Qué tan exacto es el tiempo de llegada?',
      r: 'Se calcula con la posición en vivo del bus, que se actualiza cada pocos segundos. Cuando dice "según horario", es el horario que publicó la empresa, no la posición en vivo.',
    },
    {
      p: '¿Cómo recibo los avisos de una empresa?',
      r: 'Tocá la estrella de la empresa para seguirla. Para recibirlos con la app cerrada, activá "Avisos en el teléfono" en Ajustes.',
    },
    {
      p: '¿Puedo pagar el pasaje en la app?',
      r: 'Todavía no: viene pronto. Por ahora ves el precio de cada ruta.',
    },
    {
      p: '¿Cómo borro mi cuenta?',
      r: 'Desde tu perfil, en "Eliminar cuenta". Se borran tu cuenta, tus favoritos, tus calificaciones y tus preferencias.',
    },
  ];

  get ayudaNecesitaEmpresa(): boolean {
    return this.ayudaTipo === 'queja' || this.ayudaTipo === 'felicitacion';
  }

  get ayudaPlaceholder(): string {
    switch (this.ayudaTipo) {
      case 'problema': return 'Contanos qué pasó y en qué pantalla';
      case 'sugerencia': return '¿Qué te gustaría que tuviera Buxci?';
      case 'queja': return 'Contanos qué pasó, en qué ruta y a qué hora';
      default: return '¿Qué hicieron bien?';
    }
  }

  async abrirAyuda() {
    this.showMap();
    this.faqAbierta = null;
    this.ayudaOpen = true;
    await this.cargarMisMensajes();
  }

  cerrarAyuda() {
    this.ayudaOpen = false;
  }

  private async cargarMisMensajes() {
    if (!this.profile) { this.misMensajes = []; return; }
    try {
      this.misMensajes = await this.featuresService.getMisMensajes(this.profile.id);
    } catch (e) {
      // Sin la migración la columna `origen` no existe: la lista queda vacía
      // y el formulario sigue a mano.
      logError('cargar los mensajes del pasajero', e);
      this.misMensajes = [];
    }
  }

  async enviarAyuda() {
    if (!this.profile) { this.pedirCuenta('escribirnos'); return; }
    const mensaje = this.ayudaMensaje.trim();
    if (mensaje.length < 10) {
      await this.toast('Contanos un poco más (al menos 10 letras)', 'warning');
      return;
    }
    const empresaId = this.ayudaNecesitaEmpresa ? this.ayudaEmpresaId : null;
    if (this.ayudaNecesitaEmpresa && !empresaId) {
      await this.toast('Elegí la empresa', 'warning');
      return;
    }
    this.enviandoAyuda = true;
    try {
      await this.featuresService.enviarMensajePasajero(this.profile.id, this.ayudaTipo, mensaje, empresaId);
      this.ayudaMensaje = '';
      this.ayudaEmpresaId = null;
      await this.toast('Recibimos tu mensaje. Te respondemos acá mismo.');
      await this.cargarMisMensajes();
    } catch (e: any) {
      logError('enviar mensaje del pasajero', e);
      const msg = String(e?.message || '');
      await this.toast(msg.startsWith('Mandaste') ? msg : 'No se pudo enviar el mensaje', 'danger');
    } finally {
      this.enviandoAyuda = false;
    }
  }

  tituloMensaje(m: ReporteBug): string {
    const tipo = m.titulo.replace(/^Pasajero:\s*/, '');
    const texto = tipo.charAt(0).toUpperCase() + tipo.slice(1);
    return m.empresa?.nombre ? `${texto} · ${m.empresa.nombre}` : texto;
  }

  estadoMensaje(m: ReporteBug): string {
    if (m.estado === 'resuelto') return 'Resuelto';
    if (m.estado === 'en_revision') return 'En revisión';
    return 'Recibido';
  }

  // ---- Foto de perfil ----
  // Se toca la foto del panel y se elige una imagen; se recorta, se achica y
  // se sube a la carpeta del usuario (20261109120100). La vieja se borra.
  subiendoFoto = false;

  async onFotoElegida(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const archivo = input.files?.[0];
    input.value = ''; // para que elegir la misma foto de nuevo vuelva a disparar
    if (!archivo || !this.profile || this.subiendoFoto) return;
    this.subiendoFoto = true;
    try {
      const foto = await fotoCuadrada(archivo);
      const vieja = this.profile.foto_url;
      const url = await this.supabase.subirFotoPerfil(foto);
      this.profile = await this.supabase.updateProfile({ foto_url: url });
      this.supabase.borrarFotoPerfil(vieja).catch(e => logError('borrar la foto de perfil vieja', e));
      await this.toast('Foto actualizada');
    } catch (e: any) {
      logError('subir la foto de perfil', e);
      const msg = String(e?.message || '');
      await this.toast(msg.startsWith('La foto') ? msg : 'No se pudo subir la foto', 'danger');
    } finally {
      this.subiendoFoto = false;
    }
  }

  async quitarFoto() {
    if (!this.profile?.foto_url || this.subiendoFoto) return;
    this.subiendoFoto = true;
    try {
      const vieja = this.profile.foto_url;
      this.profile = await this.supabase.updateProfile({ foto_url: null });
      this.supabase.borrarFotoPerfil(vieja).catch(e => logError('borrar la foto de perfil', e));
      await this.toast('Foto quitada');
    } catch (e) {
      logError('quitar la foto de perfil', e);
      await this.toast('No se pudo quitar la foto', 'danger');
    } finally {
      this.subiendoFoto = false;
    }
  }

  // ---- Cambiar contraseña ----
  // Antes la única forma era salir de la cuenta y usar "¿Olvidaste tu
  // contraseña?". La regla es la misma que la de recuperarla (core/utils/clave).
  cambiandoClave = false;
  guardandoClave = false;
  claveNueva = '';
  claveConfirmar = '';
  readonly reglaClave = REGLA_CLAVE;

  startCambiarClave() {
    this.editingProfile = false;
    this.claveNueva = '';
    this.claveConfirmar = '';
    this.cambiandoClave = true;
  }

  cancelCambiarClave() {
    this.cambiandoClave = false;
    this.claveNueva = '';
    this.claveConfirmar = '';
  }

  async guardarClave() {
    if (!claveValida(this.claveNueva)) {
      await this.toast(`La contraseña tiene que tener ${REGLA_CLAVE}`, 'warning');
      return;
    }
    if (this.claveNueva !== this.claveConfirmar) {
      await this.toast('Las dos contraseñas no coinciden', 'warning');
      return;
    }
    this.guardandoClave = true;
    try {
      await this.supabase.actualizarClave(this.claveNueva);
      this.cancelCambiarClave();
      await this.toast('Contraseña actualizada');
    } catch (e: any) {
      const codigo = e?.code || '';
      const msg = codigo === 'same_password' ? 'Esa es tu contraseña actual. Elegí una distinta.'
        : codigo === 'weak_password' ? 'Esa contraseña es muy fácil de adivinar. Probá con otra.'
        : codigo === 'reauthentication_needed' ? 'Por seguridad, cerrá sesión y usá "¿Olvidaste tu contraseña?" para cambiarla.'
        : 'No se pudo cambiar la contraseña. Intentá de nuevo.';
      await this.toast(msg, 'danger');
    } finally {
      this.guardandoClave = false;
    }
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
      try { soloParadasBuxci(this.map); } catch {}
      // El estilo nuevo trae el mapa base limpio: las terminales y paradas
      // municipales hay que volver a ponerlas (antes que las de Buxi). Lo mismo
      // los comercios de Overture.
      try { capaComercios(this.map, this.darkMode); } catch {}
      try { paradasDelMapaBase(this.map, this.darkMode); } catch {}
      try { paradasMunicipalesPropias(this.map, this.darkMode, this.paradasPropias); } catch {}
      setRelieve(this.map, this.tipoMapa === 'relieve', this.darkMode);
      this.dibujarParadasTodas();

      // Y la ruta activa, si había uno dibujada.
      if (this.activeRuta && this.activeParadas.length >= 2) {
        this.routeLayerIds = [];
        this.paradasFuentes = [];
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

  openFavoritosFromProfile(tab: 'rutas' | 'empresas' = 'rutas') {
    this.profilePanelOpen = false;
    this.favoritosTab = tab;
    this.openPanel('favoritos');
  }

  // Debajo de "Editar perfil": lo que hay cargado, para no tener que entrar a ver.
  get perfilResumen(): string {
    const p = this.profile;
    const partes = [p?.telefono, p?.provincia].filter(Boolean);
    return partes.length ? partes.join(' · ') : 'Nombre, teléfono y provincia';
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
              // La foto vive en Storage, fuera de las tablas que borra la
              // cuenta: se borra antes, mientras todavía hay sesión.
              await this.supabase.borrarFotoPerfil(this.profile?.foto_url)
                .catch(e => logError('borrar la foto al eliminar la cuenta', e));
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
    try { localStorage.setItem('buxci.vista3d.v1', this.is3D ? '1' : '0'); } catch {}
    // El relieve y los edificios se cargan recién acá, la primera vez que se pide.
    // Si el estilo del mapa no cargó (sin red, clave rechazada), MapLibre no
    // deja agregar fuentes: la preferencia queda guardada igual y no se rompe.
    if (!this.mapReady) return;
    try { set3DEnabled(this.map, this.is3D, this.darkMode); } catch (e) { logError('cambiar la vista 3D', e); }
    // El bus cambia de dibujo: parado en 3D, visto desde arriba en 2D.
    this.aplicarVistaBuses();
    // Mismo criterio que zoomDeVista: al aplanar se abre la vista para no
    // perder los buses que se veían hacia el horizonte, y al inclinar se cierra.
    // Va después de set3DEnabled porque reemplaza su animación.
    const zoom = this.map.getZoom() + (this.is3D ? this.ZOOM_PLANO : -this.ZOOM_PLANO);
    this.map.easeTo({
      pitch: this.is3D ? 55 : 0,
      bearing: this.is3D ? this.map.getBearing() : 0,
      zoom: Math.min(18, Math.max(6, zoom)),
      duration: 600,
    });
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
          this.busRetraso.delete(busId);
          cambio = true;
        } else {
          // Un bus que no está en vivo se repinta aunque no lleguen puntos:
          // su etiqueta ("hace 2 min") y su atenuación avanzan con el reloj.
          const loc = this.busLocationsMap.get(busId);
          if (loc && calidadSenal((now - Date.parse(loc.timestamp)) / 1000) !== 'en_vivo') cambio = true;
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
    // Entrando directo a una ruta (link compartido, aviso) no pasa por
    // loadBusLocations: sin esto los buses quedaban sin dibujo, solo con su
    // etiqueta.
    this.cargarSprites();
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
  //
  // En el teléfono la hoja de abajo tapa más o menos la mitad del mapa: con un
  // margen parejo de 60 px la ruta, sus paradas y "Tu parada" quedaban
  // dibujadas DEBAJO de la hoja. El margen de abajo es el alto de la hoja (o la
  // mitad del mapa si todavía no se midió), dejando siempre 220 px de mapa.
  private margenDeEncuadre(): number | { top: number; bottom: number; left: number; right: number } {
    const cont = this.map?.getContainer();
    const ancho = cont?.clientWidth ?? 0;
    const alto = cont?.clientHeight ?? 0;
    if (ancho >= 900) {
      const lateral = Math.round(ancho * 0.13);
      return { top: 70, bottom: 70, left: lateral, right: lateral };
    }
    const hoja = this.hojaAlto || Math.round(alto * 0.5);
    return { top: 96, bottom: Math.max(60, Math.min(hoja + 24, alto - 220)), left: 40, right: 64 };
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

    // Las paradas van como capas del mapa, igual que la línea y los buses.
    // Eran marcadores HTML encima del mapa, y con el relieve 3D se corrían de
    // la ruta cuando cargaba el terreno (quedaban dibujadas lejos de la línea).
    const ultima = paradas.length - 1;
    const features = paradas.map((parada, i) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [parada.longitud, parada.latitud] },
      properties: { id: parada.id, nombre: this.nombreParadaCorto(parada.nombre), terminal: i === 0 || i === ultima, tuya: false, etiqueta: '' },
    }));
    this.mostrarParadasTodas(false);
    const paradasSrc = `${srcId}-paradas`;
    this.map.addSource(paradasSrc, { type: 'geojson', data: { type: 'FeatureCollection', features } as any });
    const fuente = this.fuenteDelEstilo();
    const oscuro = this.darkMode;
    const halo = oscuro ? 'rgba(7, 15, 28, 0.92)' : 'rgba(255, 255, 255, 0.95)';
    this.map.addLayer({
      id: `${paradasSrc}-halo`, type: 'circle', source: paradasSrc, filter: ['==', ['get', 'tuya'], true],
      paint: { 'circle-radius': 15, 'circle-color': '#00c853', 'circle-opacity': 0.28 },
    });
    this.map.addLayer({
      id: `${paradasSrc}-circ`, type: 'circle', source: paradasSrc,
      paint: {
        'circle-radius': ['case', ['get', 'tuya'], 8, ['get', 'terminal'], 6.5, 4.5],
        'circle-color': '#ffffff',
        'circle-stroke-color': ['case', ['get', 'tuya'], '#00c853', c],
        'circle-stroke-width': ['case', ['get', 'tuya'], 4, 2.5],
      },
    });
    // El nombre de cada parada, solo de cerca: de lejos se amontonan.
    this.map.addLayer({
      id: `${paradasSrc}-txt`, type: 'symbol', source: paradasSrc, minzoom: 13,
      filter: ['!=', ['get', 'tuya'], true],
      layout: {
        'text-field': ['get', 'nombre'], 'text-font': fuente, 'text-size': 11,
        'text-anchor': 'top', 'text-offset': [0, 0.7], 'text-max-width': 10, 'text-optional': true,
      },
      paint: { 'text-color': oscuro ? '#e8eef7' : '#13243a', 'text-halo-color': halo, 'text-halo-width': 1.6 },
    });
    // "Tu parada" (o "Subí acá"), a todo zoom y sin que otra etiqueta la tape.
    this.map.addLayer({
      id: `${paradasSrc}-tuya`, type: 'symbol', source: paradasSrc,
      filter: ['==', ['get', 'tuya'], true],
      layout: {
        'text-field': ['concat', ['get', 'etiqueta'], '\n', ['get', 'nombre']], 'text-font': fuente, 'text-size': 12,
        'text-anchor': 'bottom', 'text-offset': [0, -1.1], 'text-allow-overlap': true, 'text-ignore-placement': true,
      },
      paint: { 'text-color': oscuro ? '#5dffa0' : '#00782f', 'text-halo-color': halo, 'text-halo-width': 2 },
    });
    this.routeLayerIds.push(`${paradasSrc}-halo`, `${paradasSrc}-circ`, `${paradasSrc}-txt`, `${paradasSrc}-tuya`);
    this.paradasFuentes.push({ src: paradasSrc, features });
    this.paradaMarcada = null;

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
    this.hojaRutaAbierta = false;
    this.mostrarParadasTodas(true);
    this.routeLayerIds.forEach(id => {
      if (this.map.getLayer(id)) this.map.removeLayer(id);
    });
    // Cada par de layers comparte un source (route-<ts>); quitarlos.
    // Las de paradas (route-<ts>-paradas) también.
    const srcIds = new Set(this.routeLayerIds.map(id => id.replace(/-(bg|main|halo|circ|txt|tuya)$/, '')));
    srcIds.forEach(sid => { if (this.map.getSource(sid)) this.map.removeSource(sid); });
    this.routeLayerIds = [];

    this.routeMarkers.forEach(m => m.remove());
    this.routeMarkers = [];
    this.paradasFuentes = [];
    this.paradaMarcada = null;

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
    //
    // Cada consulta por su lado (allSettled): sin cuenta la tabla de buses da
    // "permiso denegado", y con Promise.all esa sola falla tiraba también los
    // colores de las empresas y las paradas. Resultado: los buses salían con
    // el color de la ruta en vez del que eligió la empresa ("el bus cambió de
    // color solo") y faltaban las paradas para "En parada" y "a bordo".
    try {
      const [busesR, paradasR, coloresR] = await Promise.allSettled([
        this.tracking.getActiveBuses(),
        this.tracking.getAllParadas(),
        // Antes de cebar el caché: si llegara después, los buses ya dibujados
        // se quedarían con el color de la ruta hasta el próximo refresco.
        this.tracking.getColoresBusEmpresas(),
      ]);
      if (coloresR.status === 'fulfilled') this.coloresEmpresa = coloresR.value;
      // Sin cuenta no hay lista de buses: sus datos llegan con cada posición
      // (buses_en_vivo), que ya trae el color de la empresa.
      const buses = busesR.status === 'fulfilled' ? busesR.value : [];
      for (const b of buses) {
        // Misma precedencia que busColor(): el color que eligió la empresa
        // gana sobre el de la ruta. Si acá se cebara solo con el de la ruta,
        // un bus que empieza a transmitir con el mapa ya abierto se quedaría
        // con el color viejo — que es justo el caso que este caché atiende.
        const color = b.color_bus || this.coloresEmpresa.get(b.empresa_id) || (b as any)?.ruta?.color;
        if (color) this.busColors.set(b.id, colorSeguro(color));
        if (esModeloBus(b.modelo_bus)) this.busModelo.set(b.id, b.modelo_bus);
        if (b.ruta_id) this.busRuta.set(b.id, b.ruta_id);
        if (b.empresa_id) this.busEmpresa.set(b.id, b.empresa_id);
        if (b.numero_unidad || b.placa) this.busEtiqueta.set(b.id, b.numero_unidad || b.placa);
        if (b.placa) this.busPlaca.set(b.id, b.placa);
      }
      if (paradasR.status === 'fulfilled') {
        this.paradasPorRuta.clear();
        this.trazados.clear();
        for (const p of paradasR.value) {
          const arr = this.paradasPorRuta.get(p.ruta_id);
          if (arr) arr.push(p); else this.paradasPorRuta.set(p.ruta_id, [p]);
        }
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
      // Si la ubicación llegó antes que los buses, el encuadre se hace ahora.
      this.encuadrarBusCercano();
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
        // El atraso cambia aunque el punto sea el mismo (el viaje arrancó).
        if (loc.retraso_min !== undefined) this.busRetraso.set(loc.bus_id, loc.retraso_min);
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

  // La tipografía de las etiquetas sale del propio estilo de MapTiler: una
  // fuente que el estilo no trae no se dibuja, sin error ni aviso.
  // La negrita del estilo, si tiene: el código de ruta y los nombres que se
  // leen de un vistazo. Si no hay, la misma que el resto.
  private fuenteNegrita(): string[] {
    for (const capa of this.map.getStyle()?.layers ?? []) {
      const f = (capa as any).layout?.['text-font'];
      if (Array.isArray(f) && f.every(x => typeof x === 'string') && f.some((x: string) => /bold/i.test(x) && !/italic/i.test(x))) return f;
    }
    return this.fuenteDelEstilo();
  }

  private fuenteDelEstilo(): string[] {
    for (const capa of this.map.getStyle()?.layers ?? []) {
      const f = (capa as any).layout?.['text-font'];
      if (Array.isArray(f) && f.every(x => typeof x === 'string')) return f;
    }
    return ['Noto Sans Regular'];
  }

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
          // En 3D, billboard: el bus se mantiene derecho frente a la cámara,
          // como los iconos isométricos de la referencia, y el rumbo lo da
          // cuál de los 16 sprites se elige (ver dirDeBus). En 2D, el bus visto
          // desde arriba acostado sobre el mapa y girado con icon-rotate.
          ...layoutIconoBus(this.is3D),
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          // Debajo de un bus que no está en vivo, desde cuándo no reporta
          // ("hace 2 min"): el pasajero lo ve sin tener que tocarlo.
          'text-field': ['get', 'etiqueta'],
          'text-font': this.fuenteDelEstilo(),
          'text-size': 11,
          'text-anchor': 'top',
          'text-offset': this.offsetEtiquetaBus(),
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: {
          // Misma regla que la ficha (calidadSenal, por la hora del GPS): en
          // vivo entero, señal demorada a medias, sin señal casi transparente.
          'icon-opacity': ['match', ['get', 'senal'], 'perdida', 0.4, 'demorada', 0.72, 1],
          'text-color': ['match', ['get', 'senal'], 'perdida', '#ff7a73', '#ffb020'],
          'text-halo-color': 'rgba(7, 15, 28, 0.92)',
          'text-halo-width': 1.6,
        },
      });

      this.map.on('click', this.BUSES_LAYER, (e) => {
        const id = e.features?.[0]?.properties?.['bus_id'];
        if (!id) return;
        const loc = this.busLocationsMap.get(String(id));
        if (loc) this.zone.run(() => { this.paradaAbierta = null; this.selectedBus = loc; });
      });
    }

    // El código va en su propia capa: si dos chocan, se esconde uno de los
    // códigos pero ningún bus. Encima del bus, a la derecha, con el color de
    // la ruta de fondo (el halo grueso hace de pastilla).
    if (!this.map.getLayer(this.BUSES_COD_LAYER)) {
      this.map.addLayer({
        id: this.BUSES_COD_LAYER,
        type: 'symbol',
        source: this.BUSES_SRC,
        minzoom: 11.5,
        filter: ['!=', ['get', 'codigo'], ''],
        layout: {
          'text-field': ['get', 'codigo'],
          'text-font': this.fuenteNegrita(),
          'text-size': 11,
          'text-anchor': 'bottom-left',
          'text-offset': this.offsetCodigoBus(),
          'text-max-width': 8,
          'text-padding': 2,
          'icon-image': ['get', 'pastilla'],
          'icon-text-fit': 'both',
          'icon-text-fit-padding': [2, 6, 2, 6],
          'icon-anchor': 'bottom-left',
          'icon-offset': [0, 0],
        },
        paint: {
          'text-color': ['get', 'tinta'],
          'text-opacity': ['match', ['get', 'senal'], 'perdida', 0.55, 1],
          'icon-opacity': ['match', ['get', 'senal'], 'perdida', 0.55, 1],
        },
      });
      this.map.on('click', this.BUSES_COD_LAYER, (e) => {
        const id = e.features?.[0]?.properties?.['bus_id'];
        const loc = id ? this.busLocationsMap.get(String(id)) : undefined;
        if (loc) this.zone.run(() => { this.paradaAbierta = null; this.selectedBus = loc; });
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
      const edadS = Math.max(0, (ahora - Date.parse(loc.timestamp)) / 1000);
      const senal = calidadSenal(edadS);
      const cod = this.codigoDeRuta(this.busRuta.get(busId));
      // El ícono se resuelve cuando llega un punto nuevo, no acá: esto corre
      // en cada cuadro y calcular estado + color 60 veces por segundo por bus
      // es trabajo tirado.
      const icon = this.busIcono.get(busId) || this.iconoDe(loc);
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lng, lat] },
        properties: {
          bus_id: busId,
          heading: head,
          senal,
          etiqueta: senal === 'en_vivo' ? '' : haceTexto(edadS),
          codigo: cod?.codigo ?? '',
          pastilla: cod ? this.pastillaDe(cod.fondo) : '',
          fondo: cod?.fondo ?? '#8292aa',
          tinta: cod?.tinta ?? '#ffffff',
          icon,
          // Solo el bus visto desde arriba se gira; el isométrico ya trae el
          // rumbo dibujado.
          rot: icon.startsWith(PREFIJO_ICONO_PLANO) ? head : 0,
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
    if (location.retraso_min !== undefined) this.busRetraso.set(location.bus_id, location.retraso_min);
    const datosBus = location.bus as any;
    if (datosBus?.numero_unidad || datosBus?.placa) this.busEtiqueta.set(location.bus_id, datosBus.numero_unidad || datosBus.placa);
    if (datosBus?.placa) this.busPlaca.set(location.bus_id, datosBus.placa);
    this.actualizarMarcha(location);
    this.revisarABordo(location);
    if (this.activeRuta) this.updateETA();
    else this.programarCercanas();
    if (location.bus?.empresa_id) this.busEmpresa.set(location.bus_id, location.bus.empresa_id);
    // Sin cuenta no se puede leer la tabla de buses, así que la ruta de cada
    // bus llega con su posición (buses_en_vivo).
    if (location.bus?.ruta_id) this.busRuta.set(location.bus_id, location.bus.ruta_id);
    // Igual con el modelo: los puntos que llegan por Realtime no traen el bus.
    const modelo = location.bus?.modelo_bus;
    if (esModeloBus(modelo)) this.busModelo.set(location.bus_id, modelo);
    if (this.busPedido === location.bus_id) setTimeout(() => this.seguirBusCompartido(location));
    this.busIcono.set(
      location.bus_id,
      this.iconoDe(location),
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
    if (this.followBusId === location.bus_id && !this.gestoSiguiendo && !this.fichaOculta) {
      this.map.easeTo({
        center: [location.longitud, location.latitud],
        bearing: heading,
        duration: 1000,
        easing: (t) => t,
        offset: desplazamientoLibre(this.map),
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
        if (permission.location === 'denied') {
          // Antes era un return mudo: sin punto azul, sin paradas cercanas y
          // sin saber por qué. Acaba de responder al diálogo del sistema, así
          // que avisar ahora no lo toma por sorpresa.
          this.locationError = this.geolocationError({ code: 1 });
          await this.toast(this.locationError, 'warning');
          return;
        }
      }
      const c = await this.acquirePosition();
      this.logFix('inicio', c);
      this.updateUserPosition(c.latitude, c.longitude, c.accuracy, c.heading);
      // Con una lectura fuera del país NO se encuadra el mapa: arrastrar al
      // usuario a Canadá apenas abre la app es peor que dejarlo en su provincia
      // y que el punto quede fuera de cuadro.
      if (!this.activeRuta && !this.isOutsideCostaRica(c.latitude, c.longitude)) {
        this.map.jumpTo({ center: [c.longitude, c.latitude], zoom: this.zoomDeVista(this.zoomForAccuracy(c.accuracy)) });
        this.encuadrarBusCercano();
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
        `<div class="um-inner">${this.userPuckHtml()}</div>`,
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

    this.recordarPosicion(lat, lng, accuracy);
    this.revisarBusMudo();

    // La distancia a cada empresa depende de donde estas: se recalcula al
    // moverte, no en cada render.
    this.recomputeEmpresasCercanas();

    this.applyUserHeading();
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

  // El muñequito va solo, sin el círculo de precisión ni el halo que latía:
  // tapaban la calle y los buses de alrededor. Una lectura poco fiable se
  // sigue avisando donde no estorba (el botón de ubicación en ámbar).

  // ---- ¿VA ARRIBA DE UN BUS? ----
  //
  // Subido al bus, el muñequito y el bus quedan uno encima del otro y el
  // muñequito tapa el bus, que es lo que importa: por dónde va. Ahí el
  // muñequito se esconde y el bus pasa a representarlo.
  //
  // No hay un botón de "me subí": se deduce. Va arriba de un bus cuando su
  // teléfono y el GPS del bus coinciden en dos lecturas seguidas del bus y
  // además se mueve más rápido que caminando. Sin esa condición, esperar en la
  // parada al lado de un bus detenido lo escondería. Para bajarse alcanzan dos
  // lecturas del bus que ya no coinciden, o que el bus deje de transmitir; ahí
  // no se pide movimiento, porque el bus para en las paradas con él adentro.
  //
  // Se compara con dónde estaba el pasajero CUANDO se tomó esa lectura del
  // bus, no con su última posición: a 50 km/h son 14 m por segundo y el punto
  // del bus llega con unos segundos de atraso.
  private aBordoBusId: string | null = null;
  private aBordoCandidato: { busId: string; veces: number } | null = null;
  private aBordoFallos = 0;
  private posicionesRecientes: { t: number; lat: number; lng: number; precision: number }[] = [];
  private readonly ABORDO_M = 45;
  private readonly ABORDO_PRECISION_MAX_M = 30;
  private readonly ABORDO_VEL_MIN_MS = 2.8;      // ~10 km/h
  private readonly ABORDO_BUS_MUDO_MS = 30000;
  private readonly ABORDO_LECTURA_MAX_MS = 20000;

  private recordarPosicion(lat: number, lng: number, precision?: number | null) {
    const t = Date.now();
    this.posicionesRecientes.push({ t, lat, lng, precision: precision && precision > 0 ? precision : 0 });
    while (this.posicionesRecientes.length && t - this.posicionesRecientes[0].t > 60000) this.posicionesRecientes.shift();
  }

  // La posición del pasajero más cercana en el tiempo a ese instante.
  private posicionEn(t: number) {
    let mejor: { t: number; lat: number; lng: number; precision: number } | null = null;
    let dif = Infinity;
    for (const p of this.posicionesRecientes) {
      const d = Math.abs(p.t - t);
      if (d < dif) { dif = d; mejor = p; }
    }
    return mejor && dif <= 6000 ? mejor : null;
  }

  // Metros por segundo en los últimos 5 a 20 s. Con la distancia entre dos
  // lecturas y no con coords.speed, que muchos navegadores no informan.
  private velocidadPasajero(): number | null {
    const ps = this.posicionesRecientes;
    const ult = ps[ps.length - 1];
    if (!ult) return null;
    let ref: typeof ult | null = null;
    for (let i = ps.length - 2; i >= 0; i--) {
      if (ult.t - ps[i].t >= 5000) { ref = ps[i]; break; }
    }
    if (!ref || ult.t - ref.t > 20000) return null;
    const m = this.featuresService.distanceKm(ref.lat, ref.lng, ult.lat, ult.lng) * 1000;
    return m / ((ult.t - ref.t) / 1000);
  }

  // Con cada lectura de un bus.
  private revisarABordo(loc: BusLocation) {
    if (!this.posicionesRecientes.length) return;
    // Una lectura vieja (la carga inicial, un bus sin señal) no dice nada de
    // dónde está el bus ahora. La edad se acota por si el reloj del teléfono
    // del chofer viene corrido.
    const edad = Date.now() - Date.parse(loc.timestamp);
    if (!(edad <= this.ABORDO_LECTURA_MAX_MS)) return;
    const p = this.posicionEn(Date.now() - Math.max(0, edad));
    if (!p) return;
    const metros = this.featuresService.distanceKm(p.lat, p.lng, loc.latitud, loc.longitud) * 1000;
    const coincide = metros <= this.ABORDO_M + Math.min(p.precision, this.ABORDO_PRECISION_MAX_M);

    if (this.aBordoBusId === loc.bus_id) {
      if (coincide) { this.aBordoFallos = 0; this.alSeguirABordo(loc); return; }
      if (++this.aBordoFallos >= 2) this.ponerABordo(null);
      return;
    }
    if (this.aBordoBusId || this.aBordoIgnorados.has(loc.bus_id)) return;
    if (!coincide) {
      if (this.aBordoCandidato?.busId === loc.bus_id) this.aBordoCandidato = null;
      return;
    }
    const vel = this.velocidadPasajero();
    if (vel === null || vel < this.ABORDO_VEL_MIN_MS) return;
    const veces = this.aBordoCandidato?.busId === loc.bus_id ? this.aBordoCandidato.veces + 1 : 1;
    this.aBordoCandidato = { busId: loc.bus_id, veces };
    if (veces >= 2) this.ponerABordo(loc.bus_id);
  }

  // Con cada lectura del pasajero: si el bus en el que iba dejó de
  // transmitir (o se fue del mapa), el muñequito vuelve.
  private revisarBusMudo() {
    const id = this.aBordoBusId;
    if (!id) return;
    const visto = this.busLastSeen.get(id);
    if (!this.busLocationsMap.has(id) || !visto || Date.now() - visto > this.ABORDO_BUS_MUDO_MS) {
      this.ponerABordo(null);
    }
  }

  private ponerABordo(busId: string | null) {
    this.aBordoCandidato = null;
    this.aBordoFallos = 0;
    if (this.aBordoBusId === busId) return;
    const antes = this.aBordoBusId;
    this.aBordoBusId = busId;
    for (const m of [this.userMarker, this.userConeMarker]) {
      m?.getElement().classList.toggle('a-bordo', !!busId);
    }
    this.zone.run(() => (busId ? this.alSubir(busId) : this.alBajar(antes)));
  }

  // ---- VIAJE A BORDO ----
  // Arriba del bus la app lo sigue sola y dice adónde va: la parada donde se
  // baja (si armó el viaje) o la próxima, con cuánto falta. Si la detección se
  // equivocó (un auto al lado del bus), "No voy acá" lo descarta.
  aBordo: { unidad: string; ruta: string; color: string; parada: string | null; bajas: boolean; llegada: string | null } | null = null;
  private aBordoIgnorados = new Set<string>();
  // true si el seguimiento lo prendió la subida (y no el pasajero a mano):
  // solo ese se apaga solo al bajarse.
  private aBordoSigue = false;
  private aBordoRegistrado = 0;
  private readonly ABORDO_REGISTRO_MS = 2 * 60 * 1000;
  // bus -> unidad o placa. Los puntos de Realtime no traen el bus.
  private busEtiqueta = new Map<string, string>();
  // bus -> placa, para el mensaje de compartir (por la misma razón).
  private busPlaca = new Map<string, string>();
  private sesionHoy: { dia: string; id: string } | null = null;

  private alSubir(busId: string) {
    const loc = this.busLocationsMap.get(busId);
    this.aBordoRegistrado = 0;
    if (loc) {
      this.registrarABordo(loc);
      if (!this.followBusId && this.mapReady) {
        this.followBusId = busId;
        this.aBordoSigue = true;
        // Un instante después: la subida se detecta adentro del mismo punto
        // que después mueve la cámara del seguimiento (sin zoom), y ese
        // movimiento cortaba este acercamiento a la mitad.
        setTimeout(() => {
          if (this.destroyed || this.followBusId !== busId) return;
          const ultimo = this.busLocationsMap.get(busId) || loc;
          this.map.flyTo({
            center: [ultimo.longitud, ultimo.latitud],
            zoom: Math.max(this.map.getZoom(), 16),
            pitch: this.is3D ? 60 : 0,
            bearing: ultimo.heading || 0,
            duration: 1200,
            offset: desplazamientoLibre(this.map),
          });
        }, 50);
        this.map.once('dragstart', () => this.zone.run(() => {
          this.aBordoSigue = false;
          this.stopFollowing();
        }));
      }
    }
    this.actualizarABordo();
  }

  private alBajar(busId: string | null) {
    if (this.aBordoSigue && busId && this.followBusId === busId) this.stopFollowing();
    this.aBordoSigue = false;
    this.aBordo = null;
  }

  private alSeguirABordo(loc: BusLocation) {
    this.registrarABordo(loc);
    this.actualizarABordo();
  }

  noVoyEnEsteBus() {
    const id = this.aBordoBusId;
    if (!id) return;
    this.aBordoIgnorados.add(id);
    this.ponerABordo(null);
  }

  // Anónimo: el bus y un id al azar del teléfono que cambia cada día (ver
  // sesionDelDia). Una vez al subir y después cada 2 minutos, para que la
  // empresa sepa cuánto duró el viaje. Si falla no se avisa: es estadística.
  private registrarABordo(loc: BusLocation) {
    const ahora = Date.now();
    if (ahora - this.aBordoRegistrado < this.ABORDO_REGISTRO_MS) return;
    this.aBordoRegistrado = ahora;
    this.tracking.registrarABordo(loc.bus_id, this.sesionDelDia(), this.userLat, this.userLng)
      .catch(e => logError('anotar el viaje a bordo', e));
  }

  // Alcanza para no contar dos veces el mismo viaje y no sirve para seguir a
  // nadie de un día al otro. Queda también en memoria: sin almacenamiento
  // (modo privado) cada llamada inventaría uno nuevo y contaría de más.
  private sesionDelDia(): string {
    const d = new Date();
    const hoy = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    if (this.sesionHoy?.dia === hoy) return this.sesionHoy.id;
    try {
      const g = JSON.parse(localStorage.getItem('buxci.abordo.v1') || 'null');
      if (g && g.dia === hoy && typeof g.id === 'string') {
        this.sesionHoy = g;
        return g.id;
      }
    } catch {}
    this.sesionHoy = { dia: hoy, id: nuevoUuid() };
    try { localStorage.setItem('buxci.abordo.v1', JSON.stringify(this.sesionHoy)); } catch {}
    return this.sesionHoy.id;
  }

  private actualizarABordo() {
    const id = this.aBordoBusId;
    const loc = id ? this.busLocationsMap.get(id) : undefined;
    if (!id || !loc) { this.zone.run(() => { this.aBordo = null; }); return; }
    const rutaId = this.rutaDelBus(id);
    const ruta = rutaId ? this.allRutas.find(r => r.id === rutaId) : undefined;

    // Donde se baja si armó el viaje en esta ruta (o en la del transbordo);
    // si no, la próxima parada que el bus tiene adelante.
    let parada: Parada | null = null;
    let bajas = false;
    const o = this.viajeElegido;
    if (o && rutaId) {
      if (o.ruta.id === rutaId) { parada = o.bajar; bajas = true; }
      else if (o.ruta2?.id === rutaId && o.bajar2) { parada = o.bajar2; bajas = true; }
    }
    if (!parada && rutaId) {
      const t = this.trazadoDe(rutaId);
      const m = this.busMarcha.get(id);
      const p = t && m ? proximaParada(m.km, m.sentido, t.kmParadas) : null;
      parada = p ? (this.paradasPorRuta.get(rutaId) || []).find(x => x.id === p.id) || null : null;
    }
    let llegada: string | null = null;
    if (parada) {
      const l = this.llegadaDe(loc, parada);
      const edadS = Math.max(0, (Date.now() - Date.parse(loc.timestamp)) / 1000);
      llegada = mostrarLlegada(l?.llegada ?? null, edadS)?.principal ?? null;
      if (llegada === 'Ya pasó' || llegada === 'Sin dato') llegada = null;
    }
    const info = {
      unidad: this.busEtiqueta.get(id) || '',
      ruta: ruta?.nombre || (loc.bus as any)?.ruta?.nombre || '',
      color: colorSeguro(this.busColor(loc)),
      parada: parada ? this.nombreCorto(parada) : null,
      bajas,
      llegada,
    };
    this.zone.run(() => { this.aBordo = info; });
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

  // "En vivo" cuenta solo los buses con GPS de menos de 45 s; los demás se
  // dicen aparte. Antes el contador decía "3 buses en vivo" con dos sin señal.
  // nowTs (el reloj de la pantalla) hace que se recalcule solo.
  get conteoBuses(): { enVivo: number; sinSenal: number } {
    const ahora = this.nowTs;
    let enVivo = 0, sinSenal = 0;
    for (const loc of this.busLocationsMap.values()) {
      if (this.activeRuta && this.rutaDelBus(loc.bus_id) !== this.activeRuta.id) continue;
      if (this.gpsEnVivo(loc, ahora)) enVivo++; else sinSenal++;
    }
    return { enVivo, sinSenal };
  }

  // Un tiempo de llegada solo se calcula con el GPS en vivo (menos de 45 s,
  // por la hora del punto, no por cuándo llegó a la app).
  private gpsEnVivo(loc: BusLocation, ahora = Date.now()): boolean {
    return calidadSenal((ahora - Date.parse(loc.timestamp)) / 1000) === 'en_vivo';
  }

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

  // "Tu parada" en el mapa: la parada donde esperar (la más cercana, o la de
  // subir del viaje elegido) se agranda y lleva su etiqueta siempre visible,
  // para que el pasajero no tenga que buscarla entre los puntos de la ruta.
  private paradasFuentes: { src: string; features: any[] }[] = [];
  private paradaMarcada: string | null = null;
  private marcarTuParada(paradaId: string | null, esDeSubir: boolean) {
    const etiqueta = esDeSubir ? 'Subí acá' : 'Tu parada';
    const clave = paradaId ? `${paradaId}|${etiqueta}` : null;
    if (this.paradaMarcada === clave) return;
    this.paradaMarcada = clave;
    for (const f of this.paradasFuentes) {
      for (const ft of f.features) {
        ft.properties.tuya = ft.properties.id === paradaId;
        ft.properties.etiqueta = ft.properties.tuya ? etiqueta : '';
      }
      const src = this.map?.getSource(f.src) as maplibregl.GeoJSONSource | undefined;
      src?.setData({ type: 'FeatureCollection', features: f.features } as any);
    }
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
    this.marcarTuParada(this.nearestStop?.parada.id ?? null, !!subir);

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
      // Por la hora del GPS, igual que la ficha y el mapa (calidadSenal). Sin
      // señal en vivo no se da un número de minutos: acá no hay lugar para el
      // rango con su aclaración, que sí muestra la ficha del bus.
      const edadS = Math.max(0, (ahora - Date.parse(loc.timestamp)) / 1000);
      const senal = calidadSenal(edadS);
      const sinSenal = senal !== 'en_vivo';

      let etaMinutes: number | null = null;
      let detalle: string;
      if (sinSenal) {
        detalle = senal === 'demorada' ? `Señal demorada · GPS ${haceTexto(edadS)}` : `Sin señal · GPS ${haceTexto(edadS)}`;
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

  // ====== PARADAS: TOCAR UNA Y VER QUÉ PASA POR AHÍ ======
  // Como movemad o Rejseplanen: se toca una parada del mapa y se ven los
  // próximos buses de todas las rutas que paran ahí. En vivo si hay un bus
  // con GPS al día en camino; si no, la próxima salida del horario.
  private readonly PARADAS_TODAS = 'paradas-todas';
  private readonly PARADA_JUNTAS_KM = 0.06;

  // Todas las paradas, de cerca (zoom 14+), para poder tocarlas sin elegir
  // antes una ruta. Las que están a pocos metros (una por ruta en la misma
  // esquina) se dibujan como un solo punto.
  // Las terminales ("la parada municipal" de cada pueblo) se resaltan: son
  // donde sale y llega casi todo, y el punto de referencia de cualquiera.
  // Se reconocen por el nombre que les puso la empresa.
  private esTerminal(nombre: string): boolean {
    return /\b(terminal|parada municipal|estaci[oó]n de (buses|autobuses))\b/i.test(nombre);
  }

  private dibujarParadasTodas() {
    if (!this.map || !this.map.isStyleLoaded() || !this.allParadas.length) return;
    const vistas = new Map<string, any>();
    for (const p of this.allParadas) {
      const clave = `${Math.round(p.latitud * 2500)},${Math.round(p.longitud * 2500)}`;
      const terminal = this.esTerminal(p.nombre);
      // En la misma esquina, si alguna de las paradas es la terminal, gana esa.
      if (vistas.has(clave) && !(terminal && !vistas.get(clave).properties.terminal)) continue;
      vistas.set(clave, {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.longitud, p.latitud] },
        properties: { nombre: this.nombreParadaCorto(p.nombre), terminal },
      });
    }
    const data = { type: 'FeatureCollection', features: [...vistas.values()] } as any;
    const src = this.map.getSource(this.PARADAS_TODAS) as maplibregl.GeoJSONSource | undefined;
    if (src) { src.setData(data); return; }
    this.map.addSource(this.PARADAS_TODAS, { type: 'geojson', data });
    const antes = this.map.getLayer(this.BUSES_LAYER) ? this.BUSES_LAYER : undefined;
    const visibility = this.activeRuta ? 'none' : 'visible';
    this.map.addLayer({
      id: `${this.PARADAS_TODAS}-circ`, type: 'circle', source: this.PARADAS_TODAS, minzoom: 14,
      filter: ['!', ['get', 'terminal']],
      layout: { visibility },
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 3.5, 17, 6],
        'circle-color': '#ffffff',
        'circle-stroke-color': '#2f6fe0',
        'circle-stroke-width': 2,
      },
    }, antes);
    // Terminales: desde más lejos, más grandes y azules, con el ícono de bus
    // adentro y el nombre abajo.
    this.map.addLayer({
      id: `${this.PARADAS_TODAS}-terminal-circ`, type: 'circle', source: this.PARADAS_TODAS, minzoom: 11,
      filter: ['==', ['get', 'terminal'], true],
      layout: { visibility },
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 6, 14, 10, 17, 13],
        'circle-color': '#2f6fe0',
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2.5,
      },
    }, antes);
    this.map.addLayer({
      id: `${this.PARADAS_TODAS}-terminal-txt`, type: 'symbol', source: this.PARADAS_TODAS, minzoom: 11,
      filter: ['==', ['get', 'terminal'], true],
      layout: {
        visibility,
        'icon-image': 'bus_stop',
        'icon-size': ['interpolate', ['linear'], ['zoom'], 11, 0.5, 14, 0.75, 17, 0.95],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'text-field': ['step', ['zoom'], '', 12.5, ['get', 'nombre']],
        'text-font': this.fuenteNegrita(),
        'text-size': 12,
        'text-anchor': 'top',
        'text-offset': [0, 1.15],
        'text-max-width': 9,
        'text-optional': true,
      },
      paint: {
        'icon-color': '#ffffff',
        'text-color': this.darkMode ? '#dbe7ff' : '#1d4fb8',
        'text-halo-color': this.darkMode ? 'rgba(7, 15, 28, 0.92)' : 'rgba(255, 255, 255, 0.95)',
        'text-halo-width': 1.6,
      },
    }, antes);
  }

  // Con una ruta en pantalla se esconden también las paradas municipales: con
  // las de la ruta alcanza, y dos íconos por esquina confunden. Las terminales
  // del mapa base quedan: son referencia.
  private readonly CAPAS_PARADAS_TODAS = [
    ...['-circ', '-terminal-circ', '-terminal-txt'].map(s => `paradas-todas${s}`),
    ...CAPAS_PARADAS_MUNICIPALES,
  ];

  // Capas donde un toque abre la parada: las generales (también las
  // terminales) y las de la ruta en pantalla.
  private esCapaDeParada(id: string): boolean {
    return id === `${this.PARADAS_TODAS}-circ` || id === `${this.PARADAS_TODAS}-terminal-circ` || id.endsWith('-paradas-circ');
  }

  // Con una ruta en pantalla, sus paradas ya están dibujadas: las otras se esconden.
  private mostrarParadasTodas(si: boolean) {
    for (const id of this.CAPAS_PARADAS_TODAS) {
      if (this.map?.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', si ? 'visible' : 'none');
    }
  }

  // Un solo manejador de toques para todas las capas de paradas (la general y
  // la de cada ruta, que cambia de id cada vez que se dibuja). Si el toque cae
  // sobre un bus, gana el bus.
  private toqueParadasListo = false;
  private engancharToqueParadas() {
    if (this.toqueParadasListo || !this.map) return;
    this.toqueParadasListo = true;
    this.map.on('click', (e) => {
      const caja: [maplibregl.PointLike, maplibregl.PointLike] = [[e.point.x - 10, e.point.y - 10], [e.point.x + 10, e.point.y + 10]];
      const capas = (this.map.getStyle()?.layers ?? []).map(l => l.id);
      const deBuses = capas.filter(id => id === this.BUSES_LAYER || id === this.BUSES_COD_LAYER);
      if (deBuses.length && this.map.queryRenderedFeatures(caja, { layers: deBuses }).length) return;
      const deParadas = capas.filter(id => this.esCapaDeParada(id));
      const f = deParadas.length ? this.map.queryRenderedFeatures(caja, { layers: deParadas })[0] : undefined;
      if (f && f.geometry.type === 'Point') {
        const [lng, lat] = (f.geometry as any).coordinates as [number, number];
        this.zone.run(() => this.abrirParada(lat, lng));
        return;
      }
      // Una terminal del mapa base (OpenStreetMap): si coincide con paradas
      // de Buxi se abre esa ficha; si no, la de la terminal sola, para el
      // botón "Cómo llegar".
      const deTerminales = CAPAS_TERMINALES_MAPA.filter(id => capas.includes(id));
      const t = deTerminales.length ? this.map.queryRenderedFeatures(caja, { layers: deTerminales })[0] : undefined;
      if (t && t.geometry.type === 'Point') {
        const [lng, lat] = (t.geometry as any).coordinates as [number, number];
        const nombre = String(t.properties?.['name'] || t.properties?.['nombre'] || 'Terminal de buses');
        this.zone.run(() => this.abrirParada(lat, lng, nombre));
      }
    });
    this.map.on('mousemove', (e) => {
      const capas = (this.map.getStyle()?.layers ?? []).map(l => l.id)
        .filter(id => this.esCapaDeParada(id) || CAPAS_TERMINALES_MAPA.includes(id));
      if (!capas.length) return;
      const hay = this.map.queryRenderedFeatures(e.point, { layers: capas }).length > 0;
      if (hay) this.map.getCanvas().style.cursor = 'pointer';
      else if (this.map.getCanvas().style.cursor === 'pointer' && !this.map.queryRenderedFeatures(e.point, { layers: [this.BUSES_LAYER].filter(id => this.map.getLayer(id)) }).length) this.map.getCanvas().style.cursor = '';
    });
  }

  // Paradas municipales y terminales que cargó JIRB (las que le faltan a
  // OpenStreetMap y las correcciones de las que tiene). Se piden una vez y se
  // guardan para volver a dibujarlas cuando cambia el tema del mapa.
  private readonly paradasMunicipalesSrv = inject(ParadasMunicipalesService);
  private paradasPropias: ParadaMunicipal[] = [];

  private async cargarParadasPropias() {
    try {
      this.paradasPropias = await this.paradasMunicipalesSrv.listar();
    } catch (e) {
      // Sin la migración la tabla no existe: quedan solo las de OpenStreetMap.
      logError('cargar las paradas municipales', e);
      this.paradasPropias = [];
    }
    if (!this.mapReady || this.destroyed) return;
    try { paradasMunicipalesPropias(this.map, this.darkMode, this.paradasPropias); } catch {}
    this.mostrarParadasTodas(!this.activeRuta);
  }

  // La parada abierta: el punto tocado y las paradas (una por ruta) que hay
  // ahí. `paradas` puede venir vacío: una terminal del mapa base por donde
  // todavía no pasa ninguna ruta de Buxi.
  paradaAbierta: { nombre: string; lat: number; lng: number; paradas: Parada[]; terminal: boolean } | null = null;

  // `terminalBase`: el nombre de una terminal del mapa base tocada; con él la
  // ficha se abre aunque no haya paradas de Buxi en ese punto.
  abrirParada(lat: number, lng: number, terminalBase?: string) {
    const juntas = this.allParadas
      .map(p => ({ p, d: this.featuresService.distanceKm(lat, lng, p.latitud, p.longitud) }))
      .filter(x => x.d <= (terminalBase ? 0.15 : this.PARADA_JUNTAS_KM))
      .sort((a, b) => a.d - b.d);
    // Una por ruta: la más cercana al toque.
    const porRuta = new Map<string, Parada>();
    for (const { p } of juntas) if (!porRuta.has(p.ruta_id)) porRuta.set(p.ruta_id, p);
    const paradas = [...porRuta.values()];
    if (!paradas.length && !terminalBase) return;
    this.selectedBus = null;
    const nombre = paradas.length && !terminalBase ? this.nombreParadaCorto(paradas[0].nombre) : (terminalBase || '');
    this.paradaAbierta = {
      nombre, lat, lng, paradas,
      terminal: !!terminalBase || paradas.some(p => this.esTerminal(p.nombre)),
    };
  }

  cerrarParada() { this.paradaAbierta = null; }

  // "Cómo llegar" desde la ficha: la parada pasa a ser el destino del viaje,
  // igual que si se la hubiera buscado en "¿A dónde vas?".
  comoLlegarAParada() {
    const pa = this.paradaAbierta;
    if (!pa) return;
    this.paradaAbierta = null;
    this.buscarPara = 'destino';
    // El nombre de la ficha viene recortado con "…": para el destino va el
    // nombre de la parada hasta la primera coma ("Terminal de Buses Municipal").
    const completo = pa.paradas[0]?.nombre;
    const nombre = pa.terminal && !completo ? pa.nombre : (completo ? completo.split(',')[0].trim() : pa.nombre);
    this.selectPlace({ label: completo || pa.nombre, lat: pa.lat, lng: pa.lng, nombre });
  }

  // Qué viene a esta parada, ruta por ruta y para cada lado. Se recalcula en
  // cada detección de cambios: los buses se mueven y el número tiene que seguirlos.
  get paradaFilas(): { clave: string; ruta: Ruta; hacia: string; minutos: number | null; horario: string | null }[] {
    const pa = this.paradaAbierta;
    if (!pa) return [];
    const ahora = Date.now();
    const filas: { clave: string; ruta: Ruta; hacia: string; minutos: number | null; horario: string | null }[] = [];
    for (const parada of pa.paradas) {
      const ruta = this.allRutas.find(r => r.id === parada.ruta_id);
      if (!ruta) continue;
      const mejor = new Map<number, number>();
      for (const loc of this.busLocationsMap.values()) {
        if (this.busRuta.get(loc.bus_id) !== ruta.id || !this.gpsEnVivo(loc, ahora)) continue;
        const r = this.llegadaDe(loc, parada);
        if (!r || r.llegada.minutos === null) continue;
        const antes = mejor.get(r.sentido);
        if (antes === undefined || r.llegada.minutos < antes) mejor.set(r.sentido, r.llegada.minutos);
      }
      if (mejor.size) {
        for (const [sentido, minutos] of mejor) {
          filas.push({ clave: `${ruta.id}${sentido}`, ruta, hacia: sentido === 1 ? ruta.destino : ruta.origen, minutos, horario: null });
        }
        continue;
      }
      const p = proximaSalida(this.salidasPorRuta.get(ruta.id) || []);
      filas.push({ clave: ruta.id, ruta, hacia: `${this.lugarCorto(ruta.origen)} ↔ ${this.lugarCorto(ruta.destino)}`, minutos: null, horario: p ? salidaTexto(p) : null });
    }
    // Primero lo que viene en vivo (lo más cerca arriba), después el horario.
    return filas.sort((a, b) => (a.minutos ?? 9999) - (b.minutos ?? 9999) || (a.horario ? 0 : 1) - (b.horario ? 0 : 1));
  }

  trackParadaFila = (_: number, f: { clave: string }) => f.clave;

  get paradaDistancia(): string | null {
    const pa = this.paradaAbierta;
    if (!pa || !this.tieneUbicacion) return null;
    const km = this.featuresService.distanceKm(this.userLat, this.userLng, pa.lat, pa.lng);
    const c = this.featuresService.estimarCaminata(km);
    return `A ${this.metrosTexto(c.metros)} de vos · ${c.minutos} min a pie`;
  }

  async verRutaDesdeParada(ruta: Ruta) {
    this.paradaAbierta = null;
    await this.selectRutaFromPanel(ruta);
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
    const desde: PuntoGeo | null = v.origen
      ? { lat: v.origen.lat, lng: v.origen.lng }
      : (this.userLat === 0 ? null : { lat: this.userLat, lng: this.userLng });
    if (!desde) {
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

    const plan = planificarViaje([desde.lat, desde.lng], [v.destino.lat, v.destino.lng], rutas);
    const opciones: OpcionVista[] = [];
    for (const o of plan.opciones) {
      const ruta = this.allRutas.find(r => r.id === o.rutaId);
      const paradas = this.paradasPorRuta.get(o.rutaId) ?? [];
      const subir = paradas.find(p => p.id === o.subirId);
      const bajar = paradas.find(p => p.id === o.bajarId);
      if (!ruta || !subir || !bajar) continue;
      const vista: OpcionVista = { ...o, ruta, subir, bajar, hacia: o.sentido === 1 ? ruta.destino : ruta.origen };
      const t = o.transbordo;
      if (t) {
        const ruta2 = this.allRutas.find(r => r.id === t.rutaId);
        const paradas2 = this.paradasPorRuta.get(t.rutaId) ?? [];
        const subir2 = paradas2.find(p => p.id === t.subirId);
        const bajar2 = paradas2.find(p => p.id === t.bajarId);
        if (!ruta2 || !subir2 || !bajar2) continue;
        Object.assign(vista, { ruta2, subir2, bajar2, hacia2: t.sentido === 1 ? ruta2.destino : ruta2.origen });
      }
      opciones.push(vista);
    }

    this.viaje = {
      ...v,
      desde,
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
    // Con un origen elegido a mano, moverse no cambia nada.
    if (!v || this.viajeElegido || v.origen) return;
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
    const destino = this.viaje?.destino;
    await this.selectRutaFromPanel(o.ruta, o);
    if (destino) this.anotarViaje(o, destino);
  }

  // Deja el viaje: se va el destino del mapa y, si había una ruta en pantalla,
  // vuelve a ser una ruta cualquiera (su parada es otra vez la más cercana).
  cerrarViaje() {
    if (!this.viaje && !this.viajeElegido) return;
    this.quitarTramoViaje();
    this.viaje = null;
    this.viajeElegido = null;
    this.buscarPara = 'destino';
    this.placeMarker?.remove();
    this.placeMarker = null;
    this.origenMarker?.remove();
    this.origenMarker = null;
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
          titulo: v.origen ? `No hay paradas cerca de ${v.origen.nombre}` : 'No hay paradas cerca tuyo',
          texto: v.paradaOrigenKm === null ? 'Todavía no hay paradas cargadas.' : `La más cercana queda a ${km(v.paradaOrigenKm)}.`,
        };
      default:
        return {
          icono: 'git-branch-outline',
          titulo: 'No hay un bus directo',
          texto: `Hay paradas cerca ${v.origen ? 'de ' + v.origen.nombre : 'tuyo'} y cerca de ${v.destino.nombre}, pero ninguna ruta las une, ni siquiera cambiando de bus una vez.`,
        };
    }
  }

  // Minutos del último tramo a pie: los del enrutador si ya llegaron.
  get viajeMinutosAlDestino(): number {
    return this.viajeTramo?.minutos ?? this.viajeElegido?.minutosAlDestino ?? 0;
  }

  // El viaje completo, sin la espera del bus. Con transbordo suma el segundo
  // bus, su margen de espera y la última caminata.
  get viajeMinutosTotal(): number {
    const o = this.viajeElegido;
    if (!o) return 0;
    const alSubir = this.caminataActiva && this.caminata && !this.viaje?.origen ? this.caminata.minutos : o.minutosAlSubir;
    const t = o.transbordo;
    const segundo = t ? t.minutosEspera + t.minutosEnBus + t.minutosAlDestino : 0;
    return alSubir + o.minutosEnBus + this.viajeMinutosAlDestino + segundo;
  }

  // Qué hacer al bajar. Si la parada está pegada al destino no se manda a
  // "caminar 1 minuto hasta" un lugar que se llama igual que la parada.
  // Con transbordo, "el destino" de este tramo es la parada del otro bus.
  get viajeFinalTexto(): string {
    const v = this.viaje, o = this.viajeElegido;
    if (!v || !o) return '';
    const metros = this.viajeTramo?.metros ?? this.featuresService.estimarCaminata(o.alDestinoKm).metros;
    if (o.subir2) {
      if (metros < 40) return `El otro bus para ahí mismo`;
      return `y caminá ${this.viajeMinutosAlDestino} min hasta ${this.nombreCorto(o.subir2)}`;
    }
    if (metros < 40) return 'Tu destino queda ahí mismo';
    if (metros <= 250) return `Tu destino queda a ${this.metrosTexto(metros)}`;
    return `y caminá ${this.viajeMinutosAlDestino} min hasta ${v.destino.nombre}`;
  }

  // Paso 1 del viaje elegido: caminar hasta la parada. Desde donde está el
  // pasajero vale el camino real (si ya se pidió); con otro origen, la
  // estimación del plan, porque ese camino no se puede pedir desde acá.
  get pasoAlSubir(): { minutos: number; metros: number; exacta: boolean; desde: string } | null {
    const o = this.viajeElegido, v = this.viaje;
    if (!o || !v) return null;
    if (v.origen) {
      return { ...this.featuresService.estimarCaminata(o.alSubirKm), exacta: false, desde: 'Desde ' + v.origen.nombre };
    }
    const c = this.caminataInfo ?? { ...this.featuresService.estimarCaminata(o.alSubirKm), exacta: false };
    return { ...c, desde: 'Desde donde estás' };
  }

  // El último paso de un viaje con transbordo: al bajar del segundo bus.
  get viajeFinal2Texto(): string {
    const v = this.viaje, t = this.viajeElegido?.transbordo;
    if (!v || !t) return '';
    const metros = this.featuresService.estimarCaminata(t.alDestinoKm).metros;
    if (metros < 40) return 'Tu destino queda ahí mismo';
    if (metros <= 250) return `Tu destino queda a ${this.metrosTexto(metros)}`;
    return `y caminá ${t.minutosAlDestino} min hasta ${v.destino.nombre}`;
  }

  // Con el primer bus ya en pantalla: pasar al segundo. Arma su tramo como un
  // viaje directo más (subir en la parada del transbordo, bajar en la final),
  // así la hoja, las llegadas y el aviso de bajada funcionan igual.
  async seguirTransbordo() {
    const o = this.viajeElegido, t = o?.transbordo;
    if (!o || !t || !o.ruta2 || !o.subir2 || !o.bajar2) return;
    const tramo: OpcionVista = {
      rutaId: t.rutaId,
      subirId: t.subirId,
      bajarId: t.bajarId,
      sentido: t.sentido,
      alSubirKm: o.alDestinoKm,
      alDestinoKm: t.alDestinoKm,
      enBusKm: t.enBusKm,
      paradasEnMedio: t.paradasEnMedio,
      minutosAlSubir: o.minutosAlDestino,
      minutosEnBus: t.minutosEnBus,
      minutosAlDestino: t.minutosAlDestino,
      minutosTotal: t.minutosEnBus + t.minutosAlDestino,
      ruta: o.ruta2,
      subir: o.subir2,
      bajar: o.bajar2,
      hacia: o.hacia2 || '',
    };
    await this.selectRutaFromPanel(o.ruta2, tramo);
  }

  paradasDelViaje(o: OpcionVista): string {
    const n = o.paradasEnMedio + 1;
    return n === 1 ? 'es la parada siguiente' : `${n} paradas`;
  }

  // Lo que se paga por el viaje: con transbordo, los dos pasajes. Si a alguna
  // de las dos rutas le falta el precio, no se muestra un total incompleto.
  precioOpcion(o: OpcionVista): number | null {
    if (!o.ruta.precio) return null;
    if (!o.ruta2) return o.ruta.precio;
    return o.ruta2.precio ? o.ruta.precio + o.ruta2.precio : null;
  }

  // Con la ruta del viaje ya dibujada: marca dónde subir y dónde bajar, y pide
  // los dos caminos a pie (a la parada, y de la bajada al destino).
  private mostrarViajeElegido() {
    const o = this.viajeElegido, v = this.viaje;
    if (!o || !v || !this.map) return;

    this.viajeMarkers.forEach(m => m.remove());
    this.viajeMarkers = [
      this.marcaDeViaje(o.subir, 'subir', 'Subí acá'),
      this.marcaDeViaje(o.bajar, 'bajar', o.subir2 ? 'Cambiá acá' : 'Bajá acá'),
    ];

    setTimeout(() => this.encuadrarViaje(), 60);
    if (!v.origen) this.comoLlegar(false);
    // Con transbordo, el camino a pie de este tramo va hasta el otro bus.
    const hasta = o.subir2 ? { lat: o.subir2.latitud, lng: o.subir2.longitud } : v.destino;
    this.pedirTramoViaje({ lat: o.bajar.latitud, lng: o.bajar.longitud }, hasta);
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
    if (!v || !v.desde) return;
    if (this.viajeTramo) { this.quitarTramoViaje(); return; }
    await this.pedirTramoViaje(v.desde, v.destino);
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
    if (v.desde) puntos.push([v.desde.lng, v.desde.lat]);
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
      if (!this.gpsEnVivo(loc, ahora)) continue;
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
      // El reloj gris de bx-dato ya dice que es por horario.
      texto: salidaTexto(p),
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
        if (!this.gpsEnVivo(loc, ahora)) continue;
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
      this.map.flyTo({ center: this.userMarker.getLngLat(), zoom: this.zoomDeVista(16) });
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
          zoom: this.zoomDeVista(this.zoomForAccuracy(coords.accuracy)),
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
  // Inclinado (3D) se ve hasta el horizonte; plano, con el mismo zoom, apenas
  // unas cuadras alrededor, y los demás buses quedan fuera de cuadro. En 2D se
  // abre un poco la vista para cubrir un área parecida.
  private readonly ZOOM_PLANO = 1.5;
  private zoomDeVista(zoom: number): number {
    return this.is3D ? zoom : Math.max(6, zoom - this.ZOOM_PLANO);
  }

  // Al abrir: si no se ve ningún bus, se abre la vista hasta el más cercano
  // (dentro de 8 km), para que el mapa no arranque vacío. Una sola vez, y
  // nunca si el pasajero ya movió el mapa o está mirando una ruta o un viaje.
  private encuadreBusHecho = false;
  private usuarioMovioMapa = false;
  private encuadrarBusCercano() {
    if (this.encuadreBusHecho || this.usuarioMovioMapa || !this.mapReady) return;
    if (this.activeRuta || this.viaje || this.busPedido || this.userLat === 0) return;
    if (!this.busLocationsMap.size) return; // se reintenta cuando lleguen los buses
    this.encuadreBusHecho = true;

    let cercano: BusLocation | null = null;
    let km = Infinity;
    this.busLocationsMap.forEach(loc => {
      const d = this.featuresService.distanceKm(this.userLat, this.userLng, loc.latitud, loc.longitud);
      if (d < km) { km = d; cercano = loc; }
    });
    const bus = cercano as BusLocation | null;
    if (!bus || km > 8) return;
    if (this.map.getBounds().contains([bus.longitud, bus.latitud])) return;

    this.map.fitBounds(
      [[Math.min(this.userLng, bus.longitud), Math.min(this.userLat, bus.latitud)],
       [Math.max(this.userLng, bus.longitud), Math.max(this.userLat, bus.latitud)]],
      { padding: { top: 140, bottom: 260, left: 60, right: 60 }, maxZoom: this.zoomDeVista(16), duration: 900 },
    );
  }

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
      // En la app instalada no hay barra de direcciones: el permiso se cambia
      // en los ajustes del teléfono.
      return Capacitor.isNativePlatform()
        ? 'La ubicación está bloqueada para Buxci. Activala en Ajustes del teléfono → Apps → Buxci → Permisos. Mientras tanto podés buscar tu destino con «¿A dónde vas?».'
        : 'Bloqueaste la ubicación para este sitio. Habilitala en el candado de la barra de direcciones.';
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

  // ---- CALIFICAR EL BUS ----
  // Desde la ficha del bus, que es donde se sabe de qué bus se habla: la
  // calificación va con su ruta (la ve la empresa) y con el bus (la ve su
  // chofer). Una por bus y por día en este teléfono; el servidor pone el mismo
  // tope para quien lo saltee.
  readonly UNO_A_CINCO = [1, 2, 3, 4, 5];
  calificandoBus = false;

  private claveCalificacion(busId: string): string {
    // Fecha local (en-CA da AAAA-MM-DD): el "día" es el de Costa Rica, no UTC.
    return `buxi.calificado.${busId}.${new Date().toLocaleDateString('en-CA')}`;
  }

  // Las estrellas que este teléfono ya le dio hoy al bus abierto (0 si ninguna).
  get estrellasDadas(): number {
    if (!this.selectedBus) return 0;
    try {
      return Number(localStorage.getItem(this.claveCalificacion(this.selectedBus.bus_id))) || 0;
    } catch {
      return 0;
    }
  }

  async calificarBus(estrellas: number) {
    const loc = this.selectedBus;
    if (!loc || this.calificandoBus || this.estrellasDadas) return;
    if (!this.profile) { this.pedirCuenta('calificar los buses'); return; }
    const rutaId = this.rutaDelBus(loc.bus_id);
    if (!rutaId) {
      await this.toast('Este bus todavía no tiene una ruta asignada', 'warning');
      return;
    }
    const alert = await this.alertCtrl.create({
      cssClass: 'buxi-alert',
      header: `${estrellas} ${estrellas === 1 ? 'estrella' : 'estrellas'}`,
      message: '¿Querés contar algo más? Es opcional.',
      inputs: [{ name: 'comentario', type: 'textarea', placeholder: 'Ej.: el chofer manejó muy bien', attributes: { maxlength: 300 } }],
      buttons: [
        { text: 'Cancelar', role: 'cancel', cssClass: 'ba-cancel' },
        {
          text: 'Enviar', role: 'confirm', cssClass: 'ba-confirm',
          handler: (datos: { comentario?: string }) => {
            this.enviarCalificacion(loc.bus_id, rutaId, estrellas, datos?.comentario);
          },
        },
      ],
    });
    await alert.present();
  }

  private async enviarCalificacion(busId: string, rutaId: string, estrellas: number, comentario?: string) {
    if (!this.profile) return;
    this.calificandoBus = true;
    try {
      await this.featuresService.addCalificacion(this.profile.id, rutaId, estrellas, comentario?.trim() || undefined, busId);
      try { localStorage.setItem(this.claveCalificacion(busId), String(estrellas)); } catch {}
      await this.toast('¡Gracias por calificar!');
    } catch (e: any) {
      logError('calificar el bus', e);
      // El tope del servidor (una por bus y por día) llega como este error.
      const msg = /una calificaci/i.test(e?.message || '')
        ? 'Ya calificaste este bus hoy'
        : 'No se pudo enviar la calificación';
      await this.toast(msg, 'danger');
    } finally {
      this.calificandoBus = false;
    }
  }

  // ---- MODO SEGUIMIENTO ----
  // Centra el bus, lo persigue, inclina y rota la cámara hacia su rumbo, y
  // dibuja su ruta con las paradas. Sigue hasta tocar "Dejar de seguir": antes
  // se cortaba con cualquier arrastre, y pellizcar para hacer zoom también
  // cuenta como arrastre, así que acercarse al bus dejaba de seguirlo. Ahora,
  // mientras el dedo está en el mapa la cámara no se le pelea (y la ficha se
  // esconde para ver mejor); al soltar, vuelve al bus con el zoom elegido
  // (ver engancharGestosSeguimiento).
  async toggleFollow() {
    if (this.followBusId) { this.stopFollowing(); return; }
    if (!this.selectedBus) return;

    const bus = this.selectedBus;
    this.followBusId = bus.bus_id;
    this.fichaChica = true;

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

    // Un instante después, para medir el lugar libre con la ficha ya chica.
    await new Promise(r => setTimeout(r, 60));
    if (this.followBusId !== bus.bus_id) return;
    this.map.flyTo({
      center: [bus.longitud, bus.latitud],
      zoom: 16.5,
      // En 2D el mapa sigue plano también al seguir un bus.
      pitch: this.is3D ? 60 : 0,
      bearing: bus.heading || 0,
      duration: 1200,
      // El bus en lo que no tapan la ficha ni el buscador.
      offset: desplazamientoLibre(this.map),
    });

  }

  stopFollowing() {
    if (!this.followBusId) return;
    this.followBusId = null;
    this.gestoSiguiendo = false;
    clearTimeout(this.reaparecerFicha);
    this.fichaOculta = false;
    this.map.easeTo({ pitch: this.is3D ? 50 : 0, duration: 600 });
  }

  // ---- COMPARTIR EL VIAJE EN VIVO ----
  // Un enlace que abre Buxci siguiendo este bus, sin cuenta (los buses en
  // vivo son públicos): quien lo recibe ve dónde va mientras transmita. Antes
  // se mandaba por WhatsApp un punto fijo de Google Maps, que quedaba viejo
  // apenas el bus se movía.
  async shareBusLocation() {
    if (!this.selectedBus) return;
    const id = this.selectedBus.bus_id;
    // El enlace corto /v/<bus> trae la tarjeta del bus en WhatsApp (unidad,
    // ruta e imagen de "Ubicación en vivo": api/compartir.js). En local no hay
    // esa función, así que ahí va el enlace directo al mapa.
    const local = /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);

    // Los puntos que llegan por Realtime no traen el bus: unidad y ruta salen
    // de lo que el mapa ya sabe de él.
    const datos = this.selectedBus.bus as any;
    const unidad = datos?.placa || this.busPlaca.get(id) || this.busEtiqueta.get(id) || '';
    const rutaId = this.rutaDelBus(id);
    const ruta = datos?.ruta?.nombre || (rutaId ? this.allRutas.find(r => r.id === rutaId)?.nombre : '') || '';
    const elBus = `el bus${unidad ? ' ' + unidad : ''}${ruta ? ` (${ruta})` : ''}`;

    // Arriba de ese bus, el mensaje dice adónde llega y cuándo, como en
    // "Voy en el bus R12 y llego a la terminal en 12 min".
    const ab = this.aBordoBusId === id ? this.aBordo : null;
    const llega = ab?.bajas && ab.parada && ab.llegada && (ab.llegada === 'Llegando' || /\d/.test(ab.llegada))
      ? { parada: ab.parada, en: ab.llegada } : null;
    let texto = `Seguí en vivo ${elBus} en Buxci`;
    if (ab) {
      texto = `Voy en ${elBus}`;
      if (llega) {
        texto += llega.en === 'Llegando' ? ` y ya estoy llegando a ${llega.parada}` : ` y llego a ${llega.parada} en ${llega.en}`;
      }
      texto += '. Seguime en vivo en Buxci';
    }

    // Adónde llega y en cuánto viaja en el enlace: así lo dice la tarjeta
    // ("Llega a la Terminal en 12 min"), que es lo que se ve en WhatsApp.
    const q = new URLSearchParams();
    if (llega) { q.set('a', llega.parada.slice(0, 60)); q.set('en', llega.en.slice(0, 16)); }
    const extra = q.toString() ? '?' + q.toString() : '';
    const url = local
      ? `${window.location.origin}/passenger/map?bus=${encodeURIComponent(id)}`
      : `${window.location.origin}/v/${encodeURIComponent(id)}${extra}`;

    try {
      if (navigator.share) {
        // Solo el enlace, sin texto: con texto y enlace juntos WhatsApp (sobre
        // todo en iPhone) lo manda como texto común y no arma la tarjeta. La
        // tarjeta ya dice qué bus es, la ruta y adónde llega.
        await navigator.share({ title: `Bus${unidad ? ' ' + unidad : ''} en vivo`, url });
        return;
      }
    } catch (e: any) {
      // Cancelar el menú de compartir no es un error.
      if (e?.name === 'AbortError') return;
    }
    // En la compu (WhatsApp Web) va el mensaje con el enlace.
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
    window.removeEventListener('online', this.alCambiarRed);
    window.removeEventListener('offline', this.alCambiarRed);
    window.removeEventListener('beforeinstallprompt', this.alPoderInstalar);
    window.removeEventListener('appinstalled', this.alInstalarse);
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
