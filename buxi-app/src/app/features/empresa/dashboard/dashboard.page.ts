import { Component, ElementRef, OnInit, OnDestroy } from '@angular/core';
import { supabaseClient } from '../../../core/supabase-client';
import { esc, colorSeguro } from '../../../core/utils/html';
import { suscribirCambios } from '../../../core/utils/live';
import { logError } from '../../../core/utils/log';
import { SpritesBus, cargarSpritesBus, tintarSpriteBus } from '../../../core/utils/bus-sprite';
import { MODELOS_BUS, MODELO_BUS_DEFECTO, ModeloBus, esModeloBus, nombreModeloBus } from '../../../core/utils/bus-modelos';
import { Router } from '@angular/router';
import { AlertController, LoadingController, ModalController, ToastController } from '@ionic/angular';
import * as maplibregl from 'maplibre-gl';
import { RealtimeChannel } from '@supabase/supabase-js';
import { environment } from '../../../../environments/environment';
import { SupabaseService } from '../../../core/services/supabase.service';
import { AdminEmpresaService, PuntualidadRuta } from '../../../core/services/admin-empresa.service';
import { FeaturesService } from '../../../core/services/features.service';
import { UserProfile } from '../../../core/models/user-profile.model';
import { Bus, Ruta, Parada, BusLocation, Empresa } from '../../../core/models/transport.model';
import { ReporteBug, AvisoSistema, Plan, Suscripcion, SolicitudPlan, Factura, Viaje, NotificacionEmpresa, TipoNotificacion } from '../../../core/models/features.model';
import { RutaFormComponent } from './ruta-form.component';
import { HorariosFormComponent } from './horarios-form.component';
import { ReporteFormComponent } from './reporte-form.component';
import { NotificacionFormComponent } from './notificacion-form.component';
import { createMap, htmlMarkerEl, animateMarkerTo } from '../../../core/utils/maplibre';
import { descargarFacturaPDF } from '../../../core/utils/factura-pdf';
import { descargarReporteMensualPDF } from '../../../core/utils/reporte-mensual-pdf';

interface Senal { ts: number; kmh: number; lat: number; lng: number; }

interface AccionAtencion { texto: string; estilo: 'pri' | 'sec' | 'ghost'; hacer: () => void; }

// Una tarjeta de "Requiere tu atención". Si trae ruta, el título se lee con la
// insignia de la ruta adelante ("[SJ · Cartago] no tiene precio").
interface Atencion {
  clave: string;
  tipo: string;
  grave?: boolean;
  cuando?: string | null;
  ruta?: Ruta | null;
  titulo: string;
  texto: string;
  acciones: AccionAtencion[];
}

@Component({
  selector: 'app-empresa-dashboard',
  templateUrl: './dashboard.page.html',
  styleUrls: ['./dashboard.page.scss', '../../../shared/consola/consola.scss', './dashboard.perso.scss', './dashboard.diseno.scss'],
  standalone: false,
})
export class EmpresaDashboardPage implements OnInit, OnDestroy {
  profile: UserProfile | null = null;
  activeTab = 'inicio';
  loading = true;
  // En teléfono el menú es un cajón encima del contenido: abierto de entrada
  // tapaba la pantalla y había que cerrarlo antes de ver nada.
  sidebarOpen = window.innerWidth > 768;
  empresaNombre = '';

  // Agrupado por lo que la empresa viene a hacer: mover la flota, hablarle a
  // sus pasajeros o resolver cosas de su cuenta con JIRB. Antes eran catorce
  // entradas sueltas en una sola lista, y "Avisos" y "Notificaciones" se
  // confundían: uno es lo que manda JIRB y el otro lo que manda la empresa.
  readonly menuGrupos = [
    { titulo: 'Operación', items: [
      { id: 'inicio', icon: 'grid-outline', label: 'Resumen' },
      { id: 'mapa', icon: 'map-outline', label: 'Seguimiento en vivo' },
      { id: 'emergencias', icon: 'alert-circle-outline', label: 'Emergencias' },
      { id: 'buses', icon: 'bus-outline', label: 'Buses' },
      { id: 'choferes', icon: 'people-outline', label: 'Choferes' },
      { id: 'rutas', icon: 'git-branch-outline', label: 'Rutas' },
      { id: 'horarios', icon: 'time-outline', label: 'Horarios' },
    ]},
    { titulo: 'Pasajeros', items: [
      { id: 'notificaciones', icon: 'notifications-outline', label: 'Avisos a pasajeros' },
      { id: 'personalizacion', icon: 'color-palette-outline', label: 'Personalización' },
      { id: 'gtfs', icon: 'globe-outline', label: 'Google Maps y apps' },
    ]},
    { titulo: 'Cuenta', items: [
      { id: 'avisos', icon: 'megaphone-outline', label: 'Avisos de JIRB' },
      { id: 'reportes', icon: 'bug-outline', label: 'Reportes' },
      { id: 'planes', icon: 'card-outline', label: 'Planes' },
      { id: 'facturas', icon: 'receipt-outline', label: 'Facturas' },
      { id: 'equipo', icon: 'people-circle-outline', label: 'Mi equipo' },
    ]},
  ];
  readonly menuItems = this.menuGrupos.flatMap(g => g.items);

  get tituloTab(): string {
    return this.menuItems.find(i => i.id === this.activeTab)?.label || '';
  }

  // El número gris al lado de cada entrada: cuántos hay. Las alarmas (rojo,
  // ámbar) van aparte, en nav-badge.
  cuentaNav(id: string): number | null {
    switch (id) {
      case 'mapa': return this.activeBusCount;
      case 'buses': return this.buses.length;
      case 'choferes': return this.choferes.length;
      case 'rutas': return this.rutas.length;
      default: return null;
    }
  }

  // En teléfono, la barra de abajo lleva los tres destinos de todos los días
  // y "Más" abre el menú completo.
  readonly TABS_TELEFONO = ['inicio', 'buses', 'rutas'];
  get enMas(): boolean { return !this.TABS_TELEFONO.includes(this.activeTab); }

  abrirMas() { this.sidebarOpen = true; }

  // ---- PERSONALIZACIÓN DEL BUS ----
  // Primer ajuste: el color de la flota. El modelo y el diseño del bus van a
  // vivir en este mismo apartado, por eso es una sección y no un campo suelto
  // dentro de la ficha de la empresa.
  readonly COLOR_BUS_DEFECTO = '#00c853';
  // Ocho colores que se distinguen entre sí sobre el mapa oscuro y que no se
  // pisan con los estados del bus en el mapa del pasajero: naranja es
  // "retrasado" y gris es "en parada", así que ninguno de los dos está acá.
  readonly PALETA_BUS = [
    '#00c853', '#2196f3', '#e53935', '#8e24aa',
    '#00acc1', '#fdd835', '#7cb342', '#546e7a',
  ];
  // Cuatro de las 16 direcciones del sprite: alcanza para ver el bus por los
  // cuatro costados sin convertir la previa en un catálogo.
  readonly PREVIEW_DIRS = [0, 4, 8, 12];

  usaColorPropio = false;
  colorBus = '#00c853';
  guardandoPersonalizacion = false;
  subiendoLogo = false;
  logoError: string | null = null;
  private colorBusGuardado: string | null = null;
  private spritesPreview: SpritesBus | null = null;

  // Modelo del bus: urbano, buseta, interurbano… (core/utils/bus-modelos).
  readonly MODELOS = MODELOS_BUS;
  modeloBus: ModeloBus = MODELO_BUS_DEFECTO;
  // El de la flota (empresas.modelo_bus).
  modeloBusGuardado: ModeloBus = MODELO_BUS_DEFECTO;

  // ---- A quién se aplica ----
  // Toda la flota (empresas.color_bus y modelo_bus) o algunas unidades
  // (buses.color_bus y modelo_bus, que pisan a los de la flota). Un solo
  // selector manda sobre el color y el modelo a la vez.
  alcance: 'flota' | 'buses' = 'flota';
  busesElegidos = new Set<string>();
  // Color de las unidades elegidas: el de la flota o uno propio.
  colorUnidadPropio = false;
  colorUnidad = '#e53935';
  // Qué tocó la persona desde el último guardado. En la flota evita que la
  // sección abra "sucia" por las unidades con algo propio; en las unidades
  // dice qué hay que guardarles.
  private colorTocado = false;
  private modeloTocado = false;

  // El color con que se ve de verdad una unidad: el suyo; si no, el de la
  // flota; si no, el de su ruta.
  colorDeBus(b: Bus): string {
    return colorSeguro(b.color_bus || this.colorBusGuardado || b.ruta?.color || this.COLOR_BUS_DEFECTO);
  }

  modeloDeBus(b: Bus): ModeloBus {
    return esModeloBus(b.modelo_bus) ? b.modelo_bus : this.modeloBusGuardado;
  }

  tieneModeloPropio(b: Bus): boolean {
    return esModeloBus(b.modelo_bus);
  }

  tienePersonalizacionPropia(b: Bus): boolean {
    return !!b.color_bus || this.tieneModeloPropio(b);
  }

  nombreModelo(modelo: string | null | undefined): string {
    return nombreModeloBus(modelo);
  }

  // El modelo elegido, con su descripción, para la vista previa.
  get modeloInfo() {
    return MODELOS_BUS.find(m => m.id === this.modeloBus) ?? null;
  }

  get busesConPropio(): number {
    return this.buses.filter(b => this.tienePersonalizacionPropia(b)).length;
  }

  // El color de las vistas previas (el bus 3D y los modelos). Con el color de
  // cada ruta no hay un único color: va el de la primera ruta como muestra y
  // el texto del panel aclara que es un ejemplo.
  get colorPreview(): string {
    if (this.alcance === 'buses') {
      if (this.colorUnidadPropio) return colorSeguro(this.colorUnidad);
      const primera = this.buses.find(b => this.busesElegidos.has(b.id));
      return colorSeguro(this.colorBusGuardado || primera?.ruta?.color || this.rutas[0]?.color || this.COLOR_BUS_DEFECTO);
    }
    if (this.usaColorPropio) return colorSeguro(this.colorBus);
    return colorSeguro(this.rutas[0]?.color || this.COLOR_BUS_DEFECTO);
  }

  // Para la plantilla: el selector de color muestra lo del alcance elegido.
  get colorEsPropio(): boolean {
    return this.alcance === 'buses' ? this.colorUnidadPropio : this.usaColorPropio;
  }

  get colorElegido(): string {
    return this.alcance === 'buses' ? this.colorUnidad : this.colorBus;
  }

  private get colorFlotaSucio(): boolean {
    const actual = this.usaColorPropio ? colorSeguro(this.colorBus) : null;
    return actual !== this.colorBusGuardado;
  }

  private get modeloFlotaSucio(): boolean {
    return this.modeloBus !== this.modeloBusGuardado;
  }

  // "Toda la flota" es toda: al guardar, las unidades con algo propio pasan a
  // lo de la flota en lo que se tocó.
  private get colorPropioAQuitar(): boolean {
    return this.colorTocado && this.buses.some(b => !!b.color_bus);
  }

  private get modeloPropioAQuitar(): boolean {
    return this.modeloTocado && this.buses.some(b => this.tieneModeloPropio(b));
  }

  get personalizacionSucia(): boolean {
    if (this.alcance === 'buses') {
      return this.busesElegidos.size > 0 && (this.colorTocado || this.modeloTocado);
    }
    return this.colorFlotaSucio || this.modeloFlotaSucio || this.colorPropioAQuitar || this.modeloPropioAQuitar;
  }

  // Lo que dice la barra de guardar: qué se va a guardar, no solo "hay cambios".
  get resumenCambios(): string {
    const partes: string[] = [];
    let destino: string;
    if (this.alcance === 'buses') {
      if (this.colorTocado) partes.push(this.colorUnidadPropio ? 'color propio' : 'color de la flota');
      if (this.modeloTocado) partes.push(nombreModeloBus(this.modeloBus));
      const n = this.busesElegidos.size;
      destino = `en ${n === 1 ? '1 unidad' : n + ' unidades'}`;
    } else {
      if (this.colorFlotaSucio || this.colorPropioAQuitar) {
        partes.push(this.usaColorPropio ? 'un color' : 'el color de cada ruta');
      }
      if (this.modeloFlotaSucio || this.modeloPropioAQuitar) partes.push(nombreModeloBus(this.modeloBus));
      destino = 'para toda la flota';
    }
    const texto = partes.join(' y ');
    return `${texto.charAt(0).toUpperCase()}${texto.slice(1)} ${destino} · sin guardar`;
  }

  stats = { buses: 0, rutas: 0, choferes: 0, busesEnRuta: 0 };
  rutas: Ruta[] = [];
  buses: Bus[] = [];
  equipo: UserProfile[] = [];
  choferes: UserProfile[] = [];
  anomalias: BusLocation[] = [];
  reportes: ReporteBug[] = [];
  emergencias: ReporteBug[] = [];
  avisos: AvisoSistema[] = [];
  planes: Plan[] = [];
  miSuscripcion: Suscripcion | null = null;
  solicitudPlanPendiente: SolicitudPlan | null = null;
  facturas: Factura[] = [];
  empresa: Empresa | null = null;
  viajesRecientes: Viaje[] = [];
  notificaciones: NotificacionEmpresa[] = [];
  seguidores = 0;

  get emergenciasPendientes(): number {
    return this.emergencias.filter(e => e.estado === 'pendiente').length;
  }

  // Todo reporte que JIRB no haya resuelto todavía cuenta como "nuevo" para
  // la empresa -- así se entera sin tener que abrir la pestaña a revisar.
  get reportesPendientes(): number {
    return this.reportes.filter(r => r.estado === 'pendiente').length;
  }

  get planesBadge(): number {
    return this.solicitudPlanPendiente ? 1 : 0;
  }

  // ---- RESUMEN ----
  calificaciones: { estrellas: number }[] = [];
  // Última señal de cada bus propio. La siembra getUltimasSenales al cargar y
  // la mantiene al día el canal de Realtime del mapa.
  senales: Record<string, Senal> = {};
  // Reloj de la pantalla: con él avanzan "hace 12 s" y la hora del encabezado
  // sin esperar a que llegue un dato nuevo.
  ahora = Date.now();
  private relojTimer: any = null;
  verAnomalias = false;
  atencion: Atencion[] = [];
  // En teléfono se ven las dos primeras; el resto, a pedido.
  atencionAbierta = false;

  private readonly ORDEN_ESTADO: Record<string, number> = { en_ruta: 0, activo: 1, mantenimiento: 2, inactivo: 3 };
  readonly FLOTA_MAX = 8;
  readonly RUTAS_MAX = 6;

  get flota(): Bus[] {
    return [...this.buses].sort((a, b) =>
      (this.ORDEN_ESTADO[a.estado] ?? 4) - (this.ORDEN_ESTADO[b.estado] ?? 4) || a.placa.localeCompare(b.placa));
  }

  private senalFresca(b: Bus) {
    const s = this.senales[b.id];
    return s && this.ahora - s.ts <= this.STALE_MS ? s : null;
  }

  // Color más palabra (ver .bx-estado). Un bus "en ruta" que dejó de mandar
  // posición no se pinta verde: es justo el que hay que mirar.
  estadoClase(b: Bus): string {
    switch (b.estado) {
      case 'en_ruta': {
        const s = this.senalFresca(b);
        if (!s) return 'bx-estado--alerta';
        return s.kmh < 3 ? 'bx-estado--detenido' : 'bx-estado--ruta';
      }
      case 'mantenimiento': return 'bx-estado--taller';
      case 'inactivo': return 'bx-estado--inactivo';
      default: return '';
    }
  }

  estadoTexto(b: Bus): string {
    switch (b.estado) {
      case 'en_ruta': {
        const s = this.senalFresca(b);
        if (!s) return 'Sin señal';
        return s.kmh < 3 ? 'Detenido' : 'En ruta';
      }
      case 'activo': return 'Disponible';
      case 'mantenimiento': return 'En taller';
      case 'inactivo': return 'Inactivo';
      default: return b.estado;
    }
  }

  velocidadDe(b: Bus): number | null {
    if (b.estado !== 'en_ruta') return null;
    const s = this.senalFresca(b);
    return s ? Math.round(s.kmh) : null;
  }

  senalDe(b: Bus): string {
    const s = this.senales[b.id];
    return s ? this.edad(s.ts) : '—';
  }

  get ultimaSenal(): string | null {
    const ts = Object.values(this.senales).map(s => s.ts);
    return ts.length ? this.edad(Math.max(...ts)) : null;
  }

  get fechaHora(): string {
    const d = new Date(this.ahora);
    const dia = new Intl.DateTimeFormat('es-CR', { weekday: 'short', day: 'numeric', month: 'short' })
      .format(d).replace(/\./g, '').replace(',', '');
    const hora = new Intl.DateTimeFormat('es-CR', { hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
    return `${dia} · ${hora}`.toUpperCase();
  }

  // "12 s", "4 min", "3 h", "2 d": la edad de algo, corta, para columnas.
  private edad(ts: number): string {
    const seg = Math.max(0, Math.round((this.ahora - ts) / 1000));
    if (seg < 60) return `${seg} s`;
    const min = Math.round(seg / 60);
    if (min < 60) return `${min} min`;
    const h = Math.round(min / 60);
    if (h < 48) return `${h} h`;
    return `${Math.round(h / 24)} d`;
  }

  private hace(iso: string | null | undefined): string | null {
    const ts = iso ? Date.parse(iso) : NaN;
    return isNaN(ts) ? null : 'hace ' + this.edad(ts);
  }

  private listaNatural(partes: string[]): string {
    if (partes.length <= 1) return partes[0] || '';
    return partes.slice(0, -1).join(', ') + ' y ' + partes[partes.length - 1];
  }

  // ---- Indicadores ----
  get segmentosFlota(): string[] {
    return this.flota.map(b => b.estado);
  }

  get restoFlota(): string {
    const n = (e: string) => this.buses.filter(b => b.estado === e).length;
    const partes = [
      [n('activo'), 'disponible', 'disponibles'],
      [n('mantenimiento'), 'en taller', 'en taller'],
      [n('inactivo'), 'inactivo', 'inactivos'],
    ].filter(([c]) => (c as number) > 0).map(([c, uno, varios]) => `${c} ${c === 1 ? uno : varios}`);
    if (this.buses.length === 0) return 'Todavía no tenés buses';
    return partes.length ? partes.join(' · ') : 'Toda la flota está en ruta';
  }

  get promedioCalificacion(): string | null {
    if (!this.calificaciones.length) return null;
    const p = this.calificaciones.reduce((s, c) => s + c.estrellas, 0) / this.calificaciones.length;
    return p.toLocaleString('es-CR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }

  // Cuántas reseñas de 5, 4, 3... estrellas: el ancho de cada barrita.
  get repartoCalificacion(): { estrellas: number; n: number }[] {
    return [5, 4, 3, 2, 1]
      .map(e => ({ estrellas: e, n: this.calificaciones.filter(c => c.estrellas === e).length }))
      .filter(r => r.n > 0);
  }

  get hallazgoViajes(): string {
    const dias = this.tripsChartData;
    if (this.tripsChartTotal === 0) return 'Ninguno en los últimos 7 días';
    const hoy = dias[dias.length - 1];
    const mejor = dias.reduce((m, d) => d.count > m.count ? d : m, dias[0]);
    if (mejor === hoy) return `Hoy es el mejor día, con ${hoy.count}`;
    return `Hoy ${hoy.count} · el mejor día, ${mejor.label.toLowerCase()} con ${mejor.count}`;
  }

  get notaCalificacion(): string {
    const n = this.calificaciones.length;
    if (!n) return 'Todavía sin reseñas';
    const reparto = this.repartoCalificacion.map(r => `${r.n} de ${r.estrellas}★`).join(', ');
    return `${n} ${n === 1 ? 'reseña' : 'reseñas'} · ${reparto}`;
  }

  get ariaSemana(): string {
    return 'Viajes por día en los últimos 7 días: ' +
      this.tripsChartData.map(d => `${d.label} ${d.count}`).join(', ');
  }

  // Lo que está en orden, dicho una vez debajo de las tarjetas: que no haya
  // emergencias también es información.
  get lineaEnOrden(): string {
    const partes: string[] = [];
    if (!this.emergenciasPendientes) partes.push('Sin emergencias abiertas');
    if (!this.anomalias.length) partes.push('sin alertas de GPS');
    if (!this.atencion.some(a => a.clave === 'ruta-sin-bus') && this.rutas.length) partes.push('todas tus rutas activas tienen bus');
    const t = partes.join(' · ');
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  get iniciales(): string {
    const p = (this.profile?.nombre_completo || '').trim().split(/\s+/).filter(Boolean);
    return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '·';
  }

  busesDeRuta(r: Ruta): number {
    return this.buses.filter(b => b.ruta_id === r.id).length;
  }

  // ---- Requiere tu atención ----
  // Solo lo que pide una decisión de la empresa, de lo más grave a lo menos.
  // Se arma después de cada carga y no en un getter: las acciones son
  // funciones y no tiene sentido rehacerlas en cada ciclo de Angular.
  private armarAtencion() {
    const lista: Atencion[] = [];

    const pend = this.emergencias.filter(e => e.estado === 'pendiente');
    if (pend.length) {
      const e = pend[0];
      const quien = (e as any).autor?.nombre_completo || 'Un chofer';
      const acciones: AccionAtencion[] = [];
      if (this.getEmergenciaCoords(e)) acciones.push({ texto: 'Ver en el mapa', estilo: 'pri', hacer: () => this.verEmergenciaEnMapa(e) });
      acciones.push(pend.length === 1
        ? { texto: 'Marcar resuelta', estilo: 'sec', hacer: () => this.resolverEmergencia(e) }
        : { texto: `Ver las ${pend.length}`, estilo: 'sec', hacer: () => this.switchTab('emergencias') });
      lista.push({
        clave: 'emergencia', tipo: 'Emergencia', grave: true, cuando: this.hace(e.created_at),
        titulo: pend.length === 1 ? `${quien} activó el botón de pánico` : `${pend.length} emergencias sin resolver`,
        texto: pend.length === 1 ? 'Queda abierta hasta que la marqués como resuelta.' : `La última es de ${quien}.`,
        acciones,
      });
    }

    const disponible = (b: Bus) => b.estado === 'activo' || b.estado === 'en_ruta';
    const sinBus = this.rutas.filter(r => r.estado === 'activa' && !this.buses.some(b => b.ruta_id === r.id && disponible(b)));
    if (sinBus.length) {
      const r = sinBus[0];
      const asignados = this.buses.filter(b => b.ruta_id === r.id);
      lista.push({
        clave: 'ruta-sin-bus', tipo: 'Ruta sin bus', ruta: sinBus.length === 1 ? r : null,
        titulo: sinBus.length === 1 ? 'no tiene ningún bus disponible' : `${sinBus.length} rutas activas sin bus disponible`,
        texto: sinBus.length === 1
          ? (asignados.length
              ? this.listaNatural(asignados.map(b => `${b.placa} está ${b.estado === 'mantenimiento' ? 'en taller' : 'inactivo'}`)) + '.'
              : 'Ningún bus tiene asignada esta ruta, así que los pasajeros no van a ver ninguno.')
          : this.listaNatural(sinBus.slice(0, 3).map(x => x.nombre)) + (sinBus.length > 3 ? ' y otras.' : '.'),
        acciones: [{ texto: 'Asignar un bus', estilo: 'sec', hacer: () => this.switchTab('buses') }],
      });
    }

    const sinChofer = this.buses.filter(b => disponible(b) && !b.chofer_id);
    if (sinChofer.length) {
      const b = sinChofer[0];
      lista.push({
        clave: 'bus-sin-chofer', tipo: 'Bus sin chofer',
        titulo: sinChofer.length === 1 ? `${b.placa} no tiene chofer` : `${sinChofer.length} buses sin chofer`,
        texto: sinChofer.length === 1
          ? 'Sin chofer asignado, nadie puede iniciar su ruta desde la app.'
          : this.listaNatural(sinChofer.slice(0, 3).map(x => x.placa)) + (sinChofer.length > 3 ? ' y otros.' : '.'),
        acciones: [sinChofer.length === 1
          ? { texto: 'Asignar chofer', estilo: 'sec', hacer: () => this.assignBusChofer(b) }
          : { texto: 'Ver los buses', estilo: 'sec', hacer: () => this.switchTab('buses') }],
      });
    }

    if (this.anomalias.length) {
      const a = this.anomalias[0];
      const placa = (a.bus as any)?.placa || 'un bus';
      lista.push({
        clave: 'gps', tipo: 'Alerta de GPS', cuando: this.hace(a.timestamp),
        titulo: this.anomalias.length === 1 ? `Un salto raro en el GPS de ${placa}` : `${this.anomalias.length} saltos de GPS sin revisar`,
        texto: 'Posiciones que implican más de 200 km/h desde la anterior: señal mala o un GPS falseado.',
        acciones: [{ texto: this.verAnomalias ? 'Ocultar' : 'Revisar', estilo: 'sec', hacer: () => { this.verAnomalias = !this.verAnomalias; this.armarAtencion(); } }],
      });
    }

    const sinPrecio = this.rutas.filter(r => r.estado === 'activa' && !r.precio);
    if (sinPrecio.length) {
      const r = sinPrecio[0];
      lista.push({
        clave: 'sin-precio', tipo: 'Ruta sin precio', ruta: sinPrecio.length === 1 ? r : null,
        titulo: sinPrecio.length === 1 ? 'no tiene precio' : `${sinPrecio.length} rutas sin precio`,
        texto: 'Sin precio, tus pasajeros no pueden comprar el boleto en la app.',
        acciones: [sinPrecio.length === 1
          ? { texto: 'Ponerle precio', estilo: 'sec', hacer: () => this.editRutaDetails(r) }
          : { texto: 'Ver las rutas', estilo: 'sec', hacer: () => this.switchTab('rutas') }],
      });
    }

    this.atencion = lista;
  }

  trackAtencion = (_: number, a: Atencion) => a.clave;
  trackBus = (_: number, b: Bus) => b.id;

  private async cargarSenales() {
    const ids = this.buses.map(b => b.id);
    const locs = await this.admin.getUltimasSenales(ids);
    const nuevas: Record<string, Senal> = {};
    for (const l of locs) {
      const ts = Date.parse(l.timestamp);
      if (isNaN(ts)) continue;
      nuevas[l.bus_id] = { ts, kmh: l.velocidad || 0, lat: l.latitud, lng: l.longitud };
    }
    // Un punto que llegó por Realtime mientras tanto puede ser más nuevo que
    // el de la consulta: se queda el más reciente.
    for (const [id, s] of Object.entries(this.senales)) {
      if (ids.includes(id) && (!nuevas[id] || nuevas[id].ts < s.ts)) nuevas[id] = s;
    }
    this.senales = nuevas;
  }

  private registrarSenal(loc: BusLocation) {
    if (!this.buses.some(b => b.id === loc.bus_id)) return;
    const ts = Date.parse(loc.timestamp) || Date.now();
    this.senales = { ...this.senales, [loc.bus_id]: { ts, kmh: loc.velocidad || 0, lat: loc.latitud, lng: loc.longitud } };
  }

  // ---- BUSCADOR (choferes/buses) ----
  choferQuery = '';
  busQuery = '';

  get filteredChoferes(): UserProfile[] {
    const q = this.choferQuery.trim().toLowerCase();
    if (!q) return this.choferes;
    return this.choferes.filter(c => c.nombre_completo.toLowerCase().includes(q) || c.correo.toLowerCase().includes(q));
  }

  get filteredBuses(): Bus[] {
    const q = this.busQuery.trim().toLowerCase();
    if (!q) return this.buses;
    return this.buses.filter(b =>
      b.placa.toLowerCase().includes(q) ||
      (b.numero_unidad || '').toLowerCase().includes(q) ||
      (b.ruta?.nombre || '').toLowerCase().includes(q)
    );
  }

  // ---- GRÁFICO: VIAJES POR DÍA (últimos 7 días) ----
  get tripsChartData(): { label: string; count: number }[] {
    const days: { label: string; key: string; count: number }[] = [];
    const fmt = new Intl.DateTimeFormat('es-CR', { weekday: 'short' });
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const label = fmt.format(d).replace('.', '');
      days.push({ label: label.charAt(0).toUpperCase() + label.slice(1), key, count: 0 });
    }
    for (const v of this.viajesRecientes) {
      const key = v.inicio.slice(0, 10);
      const day = days.find(d => d.key === key);
      if (day) day.count++;
    }
    return days;
  }

  get tripsChartMax(): number {
    return Math.max(1, ...this.tripsChartData.map(d => d.count));
  }

  get tripsChartTotal(): number {
    return this.tripsChartData.reduce((s, d) => s + d.count, 0);
  }

  private liveMap: maplibregl.Map | null = null;
  private liveMarkers = new Map<string, maplibregl.Marker>();
  private liveMarkersLastSeen = new Map<string, number>();
  private staleCheckInterval: any = null;
  private realtimeChannel: RealtimeChannel | null = null;
  // Canal de DATOS, aparte del canal del mapa. El del mapa se crea al iniciar
  // el mapa, asi que estando en Reportes o en Choferes no existia y esas
  // pantallas solo se actualizaban recargando.
  private liveChannel: RealtimeChannel | null = null;
  // Fuentes/capas de las líneas de ruta y markers de paradas dibujados sobre
  // el mapa: se limpian a mano en cada redibujo porque MapLibre no tiene un
  // grupo tipo L.LayerGroup que los saque a todos de una.
  private rutaSourceIds: string[] = [];
  private rutaLayerIds: string[] = [];
  private rutaMarkers: maplibregl.Marker[] = [];
  private mapClickHandler: ((e: maplibregl.MapMouseEvent) => void) | null = null;

  private readonly STALE_MS = 45000;
  private readonly REMOVE_MS = 5 * 60 * 1000;

  editingRuta: Ruta | null = null;
  editingParadas: Parada[] = [];

  constructor(
    private supabase: SupabaseService,
    private admin: AdminEmpresaService,
    private features: FeaturesService,
    private router: Router,
    private alertCtrl: AlertController,
    private loadingCtrl: LoadingController,
    private toastCtrl: ToastController,
    private modalCtrl: ModalController,
    private elRef: ElementRef<HTMLElement>,
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

  async ngOnInit() {
    this.fixContentOffset();
    this.relojTimer = setInterval(() => this.ahora = Date.now(), 5000);
    try {
      this.profile = await this.supabase.getProfile();
      if (this.profile?.empresa_id) {
        await this.loadData();
        this.iniciarDatosEnVivo();
      }
    } catch {} finally {
      this.loading = false;
      setTimeout(() => { this.fixContentOffset(); this.initLiveMap(); }, 150);
    }
  }

  async loadData() {
    if (!this.profile?.empresa_id) return;
    const eid = this.profile.empresa_id;
    const [stats, rutas, buses, choferes, anomalias, reportes, emergencias, avisos, planes, miSuscripcion, solicitudPlanPendiente, facturas, empresa, viajesRecientes, equipo, notificaciones, seguidores] = await Promise.all([
      this.admin.getStats(eid),
      this.admin.getRutas(eid),
      this.admin.getBuses(eid),
      this.admin.getChoferes(eid),
      this.admin.getAnomalousLocations(eid),
      this.admin.getReportes(eid),
      this.admin.getEmergencias(eid),
      this.admin.getAvisosActivos(),
      this.admin.getPlanes(),
      this.admin.getMiSuscripcion(eid),
      this.admin.getSolicitudPlanPendiente(eid),
      this.admin.getFacturas(eid),
      this.admin.getEmpresa(eid).catch(() => null),
      this.admin.getViajesRecientes(eid),
      this.admin.getEquipo(eid).catch(() => []),
      // Estas dos no deben tumbar el panel entero si fallan: son de una
      // funcionalidad nueva y el resto del dashboard no depende de ellas.
      this.admin.getNotificaciones(eid).catch(() => []),
      this.admin.contarSeguidores(eid).catch(() => 0),
    ]);
    this.stats = stats;
    this.rutas = rutas;
    this.buses = buses;
    this.choferes = choferes;
    this.anomalias = anomalias;
    this.reportes = reportes;
    this.emergencias = emergencias;
    this.avisos = avisos;
    this.planes = planes;
    this.miSuscripcion = miSuscripcion;
    this.solicitudPlanPendiente = solicitudPlanPendiente;
    this.facturas = facturas;
    this.empresa = empresa;
    // null = nunca personalizó: cada bus sigue con el color de su ruta.
    this.colorBusGuardado = empresa?.color_bus || null;
    this.modeloBusGuardado = esModeloBus(empresa?.modelo_bus) ? empresa!.modelo_bus as ModeloBus : MODELO_BUS_DEFECTO;
    // El refresco en vivo vuelve a pasar por acá: lo que la persona está
    // eligiendo sin guardar no se le pisa.
    if (!this.colorTocado) {
      this.usaColorPropio = !!this.colorBusGuardado;
      this.colorBus = this.colorBusGuardado || this.COLOR_BUS_DEFECTO;
    }
    if (!this.modeloTocado) this.modeloBus = this.modeloBusGuardado;
    this.viajesRecientes = viajesRecientes;
    this.equipo = equipo;
    this.notificaciones = notificaciones;
    this.seguidores = seguidores;
    // Aparte: si falla, el indicador queda en "—" y nada más.
    this.admin.getPuntualidad(30).then(p => this.puntualidadRutas = p)
      .catch(e => logError('cargar la puntualidad', e));
    // Dependen de las rutas y los buses recién cargados. Ninguna de las dos
    // debe tumbar el panel si falla.
    await Promise.all([
      this.admin.getCalificacionesDeRutas(rutas.map(r => r.id))
        .then(c => this.calificaciones = c)
        .catch(e => logError('Empresa: calificaciones', e)),
      this.cargarSenales().catch(e => logError('Empresa: última señal de los buses', e)),
    ]);
    this.armarAtencion();
  }

  // ---- NOTIFICACIONES A LOS PASAJEROS ----
  // Le llegan a quien haya marcado esta empresa como favorita en la app. El
  // alcance se recalcula al abrir el modal y no solo en loadData: entre que se
  // cargó el panel y que la empresa se sienta a escribir un aviso puede haber
  // pasado media mañana.
  async nuevaNotificacion(prefill: {
    tipo?: TipoNotificacion; titulo?: string; mensaje?: string;
    rutaId?: string | null; busId?: string | null; busLabel?: string | null;
  } | null = null) {
    if (!this.profile?.empresa_id) return;
    this.seguidores = await this.admin.contarSeguidores(this.profile.empresa_id).catch(() => this.seguidores);

    const modal = await this.modalCtrl.create({
      component: NotificacionFormComponent,
      componentProps: { rutas: this.rutas, seguidores: this.seguidores, prefill },
    });
    await modal.present();

    const { data, role } = await modal.onWillDismiss();
    if (role !== 'confirm' || !data) return;

    try {
      await this.admin.crearNotificacion({
        empresaId: this.profile.empresa_id,
        autorId: this.profile.id,
        tipo: data.tipo,
        titulo: data.titulo,
        mensaje: data.mensaje,
        rutaId: data.rutaId,
        busId: data.busId,
      });
      this.notificaciones = await this.admin.getNotificaciones(this.profile.empresa_id);
      this.showToast(this.seguidores > 0 ? 'Aviso enviado' : 'Aviso publicado (todavía no te sigue nadie)');
    } catch (e: any) {
      this.showToast(e?.message || 'No se pudo enviar el aviso', 'danger');
    }
  }

  // Atajo desde la lista de buses: el caso que más se repite es "este bus va
  // atrasado", y llegar hasta él pasando por el formulario en blanco son cinco
  // pasos. Esto lo deja en dos, con el texto ya redactado y editable.
  async avisarAtrasoDeBus(bus: Bus, ev?: Event) {
    ev?.stopPropagation();
    const rutaNombre = (bus as any)?.ruta?.nombre as string | undefined;
    const unidad = bus.numero_unidad ? `${bus.placa} (${bus.numero_unidad})` : bus.placa;
    await this.nuevaNotificacion({
      tipo: 'atraso',
      titulo: rutaNombre ? `Atraso en ${rutaNombre}` : 'Atraso en el servicio',
      mensaje: rutaNombre
        ? `El bus ${unidad} de la ruta ${rutaNombre} está circulando con atraso. Perdoná la demora.`
        : `El bus ${unidad} está circulando con atraso. Perdoná la demora.`,
      rutaId: bus.ruta_id || null,
      busId: bus.id,
      busLabel: unidad,
    });
  }

  async eliminarNotificacion(n: NotificacionEmpresa) {
    const alert = await this.alertCtrl.create({ cssClass: 'buxi-alert',
      header: 'Retirar aviso',
      message: `¿Retirar "${n.titulo}"? Va a desaparecer del panel de alertas de los pasajeros.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Retirar', role: 'destructive', handler: async () => {
          try {
            await this.admin.deleteNotificacion(n.id);
            this.notificaciones = this.notificaciones.filter(x => x.id !== n.id);
            this.showToast('Aviso retirado');
          } catch (e: any) { this.showToast(e?.message || 'Error', 'danger'); }
        }},
      ],
    });
    await alert.present();
  }

  getNotifLabel(t: string) { return { atraso: 'Atraso', desvio: 'Desvío', cancelacion: 'Cancelación', info: 'Información' }[t] || t; }
  getNotifColor(t: string) { return { atraso: '#ff9800', desvio: '#2196f3', cancelacion: '#f44336', info: '#00c853' }[t] || '#9aa5b4'; }
  getNotifIcon(t: string) { return { atraso: 'time-outline', desvio: 'git-branch-outline', cancelacion: 'close-circle-outline', info: 'information-circle-outline' }[t] || 'information-circle-outline'; }

  // ---- FACTURAS ----
  descargarFactura(f: Factura) {
    descargarFacturaPDF(f);
  }

  // ---- REPORTE MENSUAL (PDF) ----
  mesReporte = new Date().toISOString().slice(0, 7); // "YYYY-MM", arranca en el mes actual
  generandoReporte = false;

  private readonly MESES = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
  ];

  // El input nativo type="month" se queda con la rueda del mouse y cambia
  // el mes en vez de dejar scrollear la página; desenfocarlo apenas se
  // detecta la rueda evita eso (mismo fix que ya se usa en Horarios).
  blurTarget(event: Event) {
    (event.target as HTMLElement).blur();
  }

  async descargarReporteMensual() {
    if (!this.profile?.empresa_id || this.generandoReporte || !this.mesReporte) return;
    this.generandoReporte = true;
    try {
      const [anioStr, mesStr] = this.mesReporte.split('-');
      const anio = parseInt(anioStr, 10);
      const mes = parseInt(mesStr, 10); // 1-12
      const desde = new Date(anio, mes - 1, 1).toISOString();
      const hasta = new Date(anio, mes, 1).toISOString(); // primer día del mes siguiente, exclusivo

      const [viajes, reportes] = await Promise.all([
        this.admin.getViajesDelMes(desde, hasta),
        this.admin.getReportesDelMes(this.profile.empresa_id, desde, hasta),
      ]);

      descargarReporteMensualPDF({
        empresa: this.empresa,
        mesLabel: `${this.MESES[mes - 1]} ${anio}`,
        viajes,
        reportes,
      });
    } catch (e: any) {
      this.showToast(e?.message || 'No se pudo generar el reporte', 'danger');
    } finally {
      this.generandoReporte = false;
    }
  }

  // ---- PERFIL DE LA EMPRESA ----
  async editarEmpresa() {
    if (!this.empresa) return;
    const e = this.empresa;
    const alert = await this.alertCtrl.create({ cssClass: 'buxi-alert',
      header: 'Datos de la empresa',
      inputs: [
        { name: 'nombre', placeholder: 'Nombre', type: 'text', value: e.nombre },
        { name: 'cedula_juridica', placeholder: 'Cédula jurídica', type: 'text', value: e.cedula_juridica || '' },
        { name: 'telefono', placeholder: 'Teléfono', type: 'tel', value: e.telefono || '' },
        { name: 'email', placeholder: 'Correo', type: 'email', value: e.email || '' },
      ],
      // El logo se sube desde Personalización; acá ya no se toca.
      message: 'El logo se cambia en Personalización.',
      buttons: [{ text: 'Cancelar', role: 'cancel' }, { text: 'Guardar', handler: async (d) => {
        if (!d.nombre?.trim()) return false;
        try {
          await this.admin.updateEmpresa(e.id, {
            nombre: d.nombre.trim(),
            cedula_juridica: d.cedula_juridica?.trim() || null,
            telefono: d.telefono?.trim() || null,
            email: d.email?.trim() || null,
          });
          await this.loadData();
          this.showToast('Datos actualizados');
        } catch (err: any) {
          this.showToast(err?.message || 'No se pudo actualizar', 'danger');
          return false;
        }
        return true;
      }}],
    });
    await alert.present();
  }

  // ---- EXPORTAR REPORTES A CSV ----
  exportarReportesCSV() {
    if (this.reportes.length === 0) { this.showToast('No hay reportes para exportar', 'warning'); return; }
    const filas = [
      ['Título', 'Descripción', 'Estado', 'Respuesta JIRB', 'Fecha'],
      ...this.reportes.map(r => [
        r.titulo, r.descripcion, this.getReporteEstadoLabel(r.estado), r.respuesta_jirb || '', new Date(r.created_at).toLocaleString('es-CR'),
      ]),
    ];
    // Envolver en comillas y escapar comillas internas: descripciones y
    // respuestas son texto libre y pueden traer comas o saltos de línea.
    const csv = filas.map(fila => fila.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reportes-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---- EMERGENCIAS ----
  getUbicacionUrl(r: ReporteBug): string | null {
    return r.descripcion.match(/https:\/\/maps\.google\.com\/\?q=[\d.,-]+/)?.[0] || null;
  }

  // El botón de pánico guarda "...q=lat,lng" dentro de la descripción; en vez
  // de mandar a la empresa a Google Maps, se saca lat/lng de ahí para
  // ubicarla directo en nuestro propio mapa, junto a los buses.
  getEmergenciaCoords(r: ReporteBug): [number, number] | null {
    const m = r.descripcion.match(/q=(-?[\d.]+),(-?[\d.]+)/);
    if (!m) return null;
    return [parseFloat(m[1]), parseFloat(m[2])];
  }

  async verEmergenciaEnMapa(r: ReporteBug) {
    const coords = this.getEmergenciaCoords(r);
    if (!coords) return;
    this.focusTarget = coords;
    this.activeTab = 'mapa';
    setTimeout(() => this.initLiveMap(), 150);
  }

  resolviendo: string | null = null;

  async resolverEmergencia(r: ReporteBug) {
    if (this.resolviendo) return;
    this.resolviendo = r.id;
    try {
      await this.admin.resolverEmergencia(r.id);
      r.estado = 'resuelto';
      this.armarAtencion();
      this.showToast('Marcada como resuelta');
    } catch (e: any) {
      this.showToast(e?.message || 'No se pudo actualizar', 'danger');
    } finally {
      this.resolviendo = null;
    }
  }

  resolviendoTodas = false;

  // Para cuando se juntan muchas (pruebas del botón de pánico, emergencias
  // ya atendidas por teléfono): una por una eran trece clics iguales.
  async resolverTodasEmergencias() {
    const pendientes = this.emergencias.filter(e => e.estado === 'pendiente');
    if (this.resolviendoTodas || pendientes.length === 0) return;
    const n = pendientes.length;
    const alert = await this.alertCtrl.create({ cssClass: 'buxi-alert',
      header: 'Resolver todas',
      message: `¿Marcar ${n === 1 ? 'la emergencia pendiente' : `las ${n} emergencias pendientes`} como resueltas? JIRB también las va a ver resueltas.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Resolver todas', handler: () => { this.ejecutarResolverTodas(pendientes); } },
      ],
    });
    await alert.present();
  }

  private async ejecutarResolverTodas(pendientes: ReporteBug[]) {
    this.resolviendoTodas = true;
    try {
      const resueltas = new Set(await this.admin.resolverEmergencias(pendientes.map(e => e.id)));
      for (const e of pendientes) if (resueltas.has(e.id)) e.estado = 'resuelto';
      this.armarAtencion();
      if (resueltas.size === pendientes.length) {
        this.showToast(resueltas.size === 1 ? 'Marcada como resuelta' : `${resueltas.size} emergencias marcadas como resueltas`);
      } else {
        // Las que no cambiaron: ya las había resuelto otra persona o no hubo
        // permiso. Se recarga para mostrar el estado real.
        await this.loadData();
        this.showToast(`Se resolvieron ${resueltas.size} de ${pendientes.length}`, 'warning');
      }
    } catch (e: any) {
      this.showToast(e?.message || 'No se pudieron resolver', 'danger');
    } finally {
      this.resolviendoTodas = false;
    }
  }

  async addReporte() {
    const modal = await this.modalCtrl.create({ component: ReporteFormComponent });
    await modal.present();
    const { data, role } = await modal.onDidDismiss();
    if (role !== 'confirm' || !data) return;

    try {
      await this.admin.createReporte(this.profile!.empresa_id!, this.profile!.id, data.titulo, data.descripcion);
      await this.loadData();
      this.showToast('Reporte enviado');
    } catch (e: any) { this.showToast(e?.message || 'Error', 'danger'); }
  }

  getReporteEstadoLabel(e: string) { return { pendiente: 'Pendiente', en_revision: 'En revisión', resuelto: 'Resuelto' }[e] || e; }
  // Ámbar mientras espera a JIRB, neutro en revisión, hueco cuando ya cerró.
  reporteEstadoClase(e: string) { return { pendiente: 'bx-estado--detenido', resuelto: 'bx-estado--inactivo' }[e] || ''; }
  getAvisoColor(t: string) { return { info: '#2196f3', advertencia: '#ff9800', urgente: '#f44336' }[t] || '#2196f3'; }
  getAvisoIcon(t: string) { return { info: 'information-circle-outline', advertencia: 'warning-outline', urgente: 'alert-circle-outline' }[t] || 'information-circle-outline'; }

  async dismissAnomalia(loc: BusLocation) {
    try {
      await this.admin.dismissAnomaly(loc.id);
      this.anomalias = this.anomalias.filter(a => a.id !== loc.id);
      if (!this.anomalias.length) this.verAnomalias = false;
      this.armarAtencion();
    } catch { this.showToast('Error al descartar la alerta', 'danger'); }
  }

  switchTab(tab: string) {
    if (window.innerWidth <= 768) this.sidebarOpen = false;
    if (this.editingRuta && tab !== 'mapa') {
      this.exitEditMode();
    }
    this.activeTab = tab;
    if (tab === 'mapa' || tab === 'inicio') {
      setTimeout(() => this.initLiveMap(), 150);
    }
    if (tab === 'horarios') {
      this.loadHorariosResumen();
    }
    if (tab === 'gtfs') this.cargarEstadoGtfs();
    if (tab === 'personalizacion') {
      // Los canvas recién existen cuando Angular pintó el panel.
      setTimeout(() => this.prepararPreview(), 0);
    }
  }

  // ---- PERSONALIZACIÓN ----
  private async prepararPreview() {
    if (!this.spritesPreview) this.spritesPreview = await cargarSpritesBus();
    this.dibujarPreview();
  }

  // Dibuja el bus con el MISMO teñido que usa el mapa (tintarSpriteBus, de
  // core/utils/bus-sprite). Es a propósito: una previa hecha con otro código
  // puede quedar linda y mentir sobre cómo se va a ver de verdad.
  dibujarPreview() {
    const color = this.colorPreview;
    for (const dir of this.PREVIEW_DIRS) {
      const destino = this.elRef.nativeElement
        .querySelector('#preview-bus-' + dir) as HTMLCanvasElement | null;
      if (!destino) continue;
      const ctx = destino.getContext('2d');
      if (!ctx) continue;
      ctx.clearRect(0, 0, destino.width, destino.height);
      const bus = tintarSpriteBus(this.spritesPreview, color, dir);
      if (bus) ctx.drawImage(bus, 0, 0, destino.width, destino.height);
    }
  }

  elegirColor(color: string) {
    if (this.alcance === 'buses') {
      this.colorUnidad = color;
      this.colorUnidadPropio = true;
    } else {
      this.colorBus = color;
      this.usaColorPropio = true;
    }
    this.colorTocado = true;
    this.dibujarPreview();
  }

  // Flota: false = el color de cada ruta. Unidades: false = el de la flota.
  elegirColorPropio(propio: boolean) {
    if (this.alcance === 'buses') this.colorUnidadPropio = propio;
    else this.usaColorPropio = propio;
    this.colorTocado = true;
    this.dibujarPreview();
  }

  elegirModeloBus(modelo: ModeloBus) {
    this.modeloBus = modelo;
    this.modeloTocado = true;
  }

  // Cambiar de alcance descarta lo elegido sin guardar: se estaba armando
  // para el otro.
  elegirAlcance(alcance: 'flota' | 'buses') {
    if (alcance === this.alcance) return;
    this.alcance = alcance;
    this.busesElegidos.clear();
    this.restablecerEdicion();
  }

  alternarBus(busId: string) {
    if (this.busesElegidos.has(busId)) this.busesElegidos.delete(busId);
    else this.busesElegidos.add(busId);
    // Con una sola unidad elegida y nada tocado todavía, la sección muestra
    // cómo es esa unidad hoy.
    if (this.busesElegidos.size === 1 && !this.colorTocado && !this.modeloTocado) {
      const b = this.buses.find(x => this.busesElegidos.has(x.id));
      if (b) {
        this.colorUnidadPropio = !!b.color_bus;
        if (b.color_bus) this.colorUnidad = colorSeguro(b.color_bus);
        this.modeloBus = this.modeloDeBus(b);
      }
    }
    this.dibujarPreview();
  }

  private restablecerEdicion() {
    this.usaColorPropio = !!this.colorBusGuardado;
    this.colorBus = this.colorBusGuardado || this.COLOR_BUS_DEFECTO;
    this.colorUnidadPropio = false;
    this.modeloBus = this.modeloBusGuardado;
    this.colorTocado = false;
    this.modeloTocado = false;
    this.dibujarPreview();
  }

  async guardarPersonalizacion() {
    const empresaId = this.profile?.empresa_id;
    if (!empresaId || this.guardandoPersonalizacion || !this.personalizacionSucia) return;
    this.guardandoPersonalizacion = true;
    try {
      if (this.alcance === 'buses') await this.guardarEnUnidades();
      else await this.guardarEnFlota(empresaId);
    } catch (e: any) {
      logError('guardar la personalización del bus', e);
      // Mientras no se aplique la migración, Supabase responde que no conoce
      // la columna: se dice eso y no el mensaje técnico.
      const msg = e?.message || '';
      const sinColumna = /(modelo_bus|color_bus)/.test(msg) && /(column|schema cache)/i.test(msg);
      this.showToast(sinColumna
        ? 'Falta aplicar en Supabase la migración de la personalización por bus'
        : msg || 'No se pudo guardar la personalización', 'danger');
    }
    this.guardandoPersonalizacion = false;
  }

  // ---- LOGO ----
  // Mismos límites que el balde `logos` (PNG/JPG/WebP); 2 MB acá porque un
  // logo no necesita más y en el teléfono del pasajero se baja cada vez.
  async onLogoElegido(event: Event) {
    const input = event.target as HTMLInputElement;
    const archivo = input.files?.[0];
    input.value = '';
    if (!archivo || !this.profile?.empresa_id || this.subiendoLogo) return;
    this.logoError = null;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(archivo.type)) {
      this.logoError = 'El logo tiene que ser PNG, JPG o WebP.';
      return;
    }
    if (archivo.size > 2 * 1024 * 1024) {
      this.logoError = 'El logo puede pesar hasta 2 MB.';
      return;
    }
    this.subiendoLogo = true;
    try {
      const url = await this.admin.subirLogoEmpresa(this.profile.empresa_id, archivo);
      await this.admin.updateEmpresa(this.profile.empresa_id, { logo_url: url });
      if (this.empresa) this.empresa.logo_url = url;
      this.showToast('Listo: los pasajeros ya ven tu logo');
    } catch (e: any) {
      logError('subir el logo de la empresa', e);
      this.logoError = 'No se pudo subir el logo. Intentá de nuevo.';
    }
    this.subiendoLogo = false;
  }

  async quitarLogo() {
    if (!this.profile?.empresa_id || this.subiendoLogo) return;
    this.subiendoLogo = true;
    try {
      await this.admin.updateEmpresa(this.profile.empresa_id, { logo_url: null });
      if (this.empresa) this.empresa.logo_url = null;
      this.showToast('Quitaste el logo');
    } catch (e: any) {
      logError('quitar el logo de la empresa', e);
      this.showToast('No se pudo quitar el logo', 'danger');
    }
    this.subiendoLogo = false;
  }

  // ---- PUNTUALIDAD ----
  // Cada salida de un chofer contra la salida programada más cercana: a tiempo
  // si fue de 2 min antes a 5 después. Sin salidas exactas cargadas no hay
  // contra qué comparar, y el indicador lo dice.
  puntualidadRutas: PuntualidadRuta[] = [];

  get puntualidad(): { pct: number; comparables: number; aTiempo: number; tarde: number; temprano: number } | null {
    const t = this.puntualidadRutas.reduce((acc, r) => ({
      comparables: acc.comparables + r.comparables,
      aTiempo: acc.aTiempo + r.a_tiempo,
      tarde: acc.tarde + r.tarde,
      temprano: acc.temprano + r.temprano,
    }), { comparables: 0, aTiempo: 0, tarde: 0, temprano: 0 });
    if (!t.comparables) return null;
    return { ...t, pct: Math.round((t.aTiempo / t.comparables) * 100) };
  }

  get notaPuntualidad(): string {
    const p = this.puntualidad;
    if (!p) {
      const viajes = this.puntualidadRutas.reduce((n, r) => n + r.viajes, 0);
      return viajes
        ? 'Cargá las salidas exactas en Horarios para medirla'
        : 'Se mide cuando tus choferes hagan viajes';
    }
    const partes = [`${p.aTiempo} de ${p.comparables} salidas`];
    if (p.tarde) partes.push(`${p.tarde} tarde`);
    if (p.temprano) partes.push(`${p.temprano} antes de hora`);
    return partes.join(' · ');
  }

  // ---- GOOGLE MAPS Y APPS (GTFS) ----
  // Los enlaces que se le dan a Google, Moovit o Transit: la función gtfs arma
  // el GTFS de la empresa al momento, con lo que tenga cargado.
  gtfsRutas: { ruta: Ruta; lista: boolean; falta: string }[] = [];
  gtfsCargando = false;

  get gtfsUrl(): string {
    return `${environment.supabaseUrl}/functions/v1/gtfs?empresa=${this.empresa?.id ?? ''}`;
  }

  get gtfsRtUrl(): string {
    return `${this.gtfsUrl}&rt=1`;
  }

  get gtfsListas(): number {
    return this.gtfsRutas.filter(r => r.lista).length;
  }

  private async cargarEstadoGtfs() {
    const activas = this.rutas.filter(r => r.estado === 'activa');
    this.gtfsCargando = true;
    try {
      const estado = await this.admin.getEstadoGtfs(activas.map(r => r.id));
      this.gtfsRutas = activas.map(ruta => {
        const e = estado[ruta.id];
        const falta = [
          e.paradas < 2 ? 'paradas' : '',
          e.horarios === 0 ? 'horario' : '',
        ].filter(Boolean).join(' y ');
        return { ruta, lista: !falta, falta: falta ? `Falta ${falta}` : '' };
      });
    } catch (e) {
      logError('estado GTFS', e);
    }
    this.gtfsCargando = false;
  }

  async copiarEnlace(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      this.showToast('Enlace copiado');
    } catch {
      this.showToast('No se pudo copiar: seleccioná el enlace y copialo a mano', 'warning');
    }
  }

  abrirEnlace(url: string) {
    window.open(url, '_blank', 'noopener');
  }

  private async guardarEnUnidades() {
    const cambios: Partial<Bus> = {};
    // null = la unidad sigue a la flota. El modelo igual al de la flota se
    // guarda como null por lo mismo: si mañana la flota cambia, la sigue.
    if (this.colorTocado) cambios.color_bus = this.colorUnidadPropio ? colorSeguro(this.colorUnidad) : null;
    if (this.modeloTocado) cambios.modelo_bus = this.modeloBus === this.modeloBusGuardado ? null : this.modeloBus;
    const cambiados = new Set(await this.admin.personalizarBuses([...this.busesElegidos], cambios));
    for (const b of this.buses) if (cambiados.has(b.id)) Object.assign(b, cambios);
    const n = cambiados.size;
    this.busesElegidos.clear();
    this.restablecerEdicion();
    this.showToast(n === 1 ? 'Listo: la unidad quedó personalizada' : `Listo: ${n} unidades personalizadas`);
  }

  private async guardarEnFlota(empresaId: string) {
    // null vuelve al comportamiento de siempre: el color de cada ruta.
    const color = this.usaColorPropio ? colorSeguro(this.colorBus) : null;
    // Solo se manda lo que cambió: guardar un color no depende de que exista
    // la columna del modelo, ni al revés.
    const cambios: Partial<Empresa> = {};
    if (this.colorFlotaSucio) cambios.color_bus = color;
    if (this.modeloFlotaSucio) cambios.modelo_bus = this.modeloBus;
    const quitar: ('color_bus' | 'modelo_bus')[] = [];
    if (this.colorPropioAQuitar) quitar.push('color_bus');
    if (this.modeloPropioAQuitar) quitar.push('modelo_bus');

    if (Object.keys(cambios).length) await this.admin.updateEmpresa(empresaId, cambios);
    if (quitar.length) await this.admin.quitarPersonalizacionDeBuses(empresaId, quitar);

    this.colorBusGuardado = color;
    this.modeloBusGuardado = this.modeloBus;
    if (this.empresa) Object.assign(this.empresa, cambios);
    for (const b of this.buses) for (const campo of quitar) b[campo] = null;
    this.colorTocado = false;
    this.modeloTocado = false;
    this.showToast('Listo: los cambios se ven en toda tu flota');
  }

  // ---- HORARIOS (resumen por ruta) ----
  horariosResumen: Record<string, number> = {};

  private async loadHorariosResumen() {
    await Promise.all(this.rutas.map(async r => {
      try {
        const salidas = await this.admin.getHorarioSalidas(r.id);
        this.horariosResumen[r.id] = salidas.length;
      } catch {}
    }));
  }

  // ---- PLANES ----
  // No hay pasarela de pago: "comprar" acá crea una solicitud pendiente que
  // JIRB confirma manualmente. Solo una activa a la vez, por simplicidad.
  async solicitarPlan(plan: Plan) {
    if (this.esMiPlanActual(plan) || this.solicitudPlanPendiente) return;
    const alert = await this.alertCtrl.create({ cssClass: 'buxi-alert',
      header: `¿Solicitar el plan ${plan.nombre}?`,
      message: 'JIRB va a revisar tu solicitud y confirmarte el cambio.',
      buttons: [{ text: 'Cancelar', role: 'cancel' }, { text: 'Solicitar', handler: async () => {
        try {
          await this.admin.solicitarPlan(this.profile!.empresa_id!, plan.id);
          await this.loadData();
          this.showToast('Solicitud enviada');
        } catch (e: any) {
          this.showToast(e?.message || 'Error enviando la solicitud', 'danger');
        }
      }}],
    });
    await alert.present();
  }

  esMiPlanActual(plan: Plan): boolean {
    return this.miSuscripcion?.plan_id === plan.id;
  }

  toggleSidebar() { this.sidebarOpen = !this.sidebarOpen; }

  // ---- LIVE MAP ----
  // Coordenadas [lat, lng] pendientes de centrar la próxima vez que se abra
  // el mapa (ver verEmergenciaEnMapa): se consume una sola vez.
  private focusTarget: [number, number] | null = null;

  private async initLiveMap() {
    const elId = this.activeTab === 'mapa' ? 'emp-map-full' : 'emp-map-mini';
    const el = document.getElementById(elId);
    if (!el) return;
    if (this.liveMap) { this.liveMap.remove(); this.liveMap = null; }

    const isFull = this.activeTab === 'mapa';
    const focus = this.focusTarget;
    this.focusTarget = null;
    const map = await createMap({
      container: elId,
      center: focus ? [focus[1], focus[0]] : [-84.0907, 9.9281],
      zoom: focus ? 15 : 11,
      // Mismo estilo "rico" que el mapa de pasajero (edificios 3D, relieve,
      // cielo, íconos de POI) en vez del `dataviz-dark` plano: la empresa
      // quiere reconocer el mismo mapa, no una versión "pelada" de panel.
      style: 'streets-v2-dark',
      threeD: true,
      pitch: 50,
      // La vista mini vive dentro de una página con scroll: sin gestos
      // cooperativos la rueda hace zoom en vez de bajar la página.
      cooperativeGestures: !isFull,
    });
    this.liveMap = map;
    if (isFull) {
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    }

    this.liveMarkers.forEach(m => m.remove());
    this.liveMarkers.clear();
    this.liveMarkersLastSeen.clear();
    this.clearRutaLayers();
    this.drawEmergencyMarkers(map);

    // Subscribe to realtime
    if (!this.realtimeChannel) {
      const sb = supabaseClient();
      this.realtimeChannel = sb.channel('emp-live')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bus_locations' }, (payload) => {
          const loc = payload.new as BusLocation;
          this.registrarSenal(loc);
          this.updateMapMarker(loc.bus_id, loc.latitud, loc.longitud, loc.timestamp);
        })
        .subscribe();
    }

    if (!this.staleCheckInterval) this.startStaleBusWatcher();

    // Los buses que ya venían transmitiendo, sin esperar su próximo punto.
    for (const [busId, s] of Object.entries(this.senales)) {
      if (this.ahora - s.ts < this.REMOVE_MS) this.updateMapMarker(busId, s.lat, s.lng, new Date(s.ts).toISOString());
    }

    if (this.editingRuta) {
      this.mapClickHandler = (e) => this.onMapClickAddParada(e);
      this.liveMap.on('click', this.mapClickHandler);
      this.drawEditingRutaPath();
    } else {
      this.drawAllRutaPaths(map);
    }

    // El fitBounds de las emergencias tiene que calcularse DESPUÉS del
    // resize(), no antes: el mapa recién se creó y su contenedor puede no
    // tener todavía el tamaño final (la pestaña/layout se está acomodando),
    // así que un fitBounds inmediato calcula la cámara contra un tamaño
    // equivocado -- por eso una emergencia terminaba mostrándose fuera del
    // mapa, montada sobre la barra superior en vez de encuadrada adentro.
    //
    // Ojo: acá adentro hay que usar la constante local `map`, no
    // `this.liveMap`. ngOnInit ya dispara un initLiveMap() propio para el
    // mini-mapa de Inicio 150ms después de cargar, y si el usuario entra a
    // "Seguimiento en vivo" rápido, ese initLiveMap() y este pueden quedar
    // corriendo en paralelo: `this.liveMap` termina apuntando al que
    // resolvió último (no necesariamente el que está en pantalla), y el
    // resize()/salto de cámara de ESTE mapa se aplicaba al mapa equivocado
    // -- por eso el mapa visible se quedaba centrado en San José sin moverse
    // nunca, aunque los marcadores sí se hubieran dibujado bien.
    setTimeout(() => {
      map.resize();
      if (!focus) this.fitEmergencyBounds(map);
    }, 200);
  }

  private clearRutaLayers() {
    if (!this.liveMap) return;
    this.rutaLayerIds.forEach(id => { if (this.liveMap!.getLayer(id)) this.liveMap!.removeLayer(id); });
    this.rutaSourceIds.forEach(id => { if (this.liveMap!.getSource(id)) this.liveMap!.removeSource(id); });
    this.rutaLayerIds = [];
    this.rutaSourceIds = [];
    this.rutaMarkers.forEach(m => m.remove());
    this.rutaMarkers = [];
  }

  // ---- TRAZADO DE RUTAS ----
  private async drawAllRutaPaths(map: maplibregl.Map) {
    const activas = this.rutas.filter(r => r.estado === 'activa');
    const results = await Promise.all(activas.map(async r => {
      const paradas = await this.admin.getParadas(r.id);
      return { ruta: r, paradas };
    }));

    if (!this.liveMap) return;
    const features: any[] = [];
    for (const { ruta, paradas } of results) {
      if (paradas.length === 0) continue;
      const color = ruta.color || '#00c853';

      if (paradas.length >= 2) {
        let latlng: [number, number][] = ruta.geometria as [number, number][] | null || [];
        if (latlng.length === 0) {
          latlng = await this.features.fetchRoadRouteCoords(paradas);
          this.admin.updateRuta(ruta.id, { geometria: latlng }).catch(() => {});
        }
        this.drawRouteLine(`ruta-${ruta.id}`, latlng, color);
      }

      paradas.forEach((p, i) => {
        const isTerminal = i === 0 || i === paradas.length - 1;
        features.push({
          type: 'Feature' as const,
          properties: { color, isTerminal, nombre: p.nombre },
          geometry: { type: 'Point' as const, coordinates: [p.longitud, p.latitud] },
        });
      });
    }
    this.drawParadaMarkers(map, features);
  }

  // Paradas dibujadas como capa nativa (circle + symbol), no maplibregl.Marker
  // -- mismo bug de MapLibre que las emergencias (ver drawEmergencyMarkers):
  // Marker consulta la elevación del terreno 3D para ubicarse, y esa
  // consulta devuelve valores erróneos, así que la parada terminal
  // ("Terminal de Buses...") aparecía flotando cientos de píxeles fuera del
  // mapa y se corría al mover la cámara.
  private readonly PARADAS_SRC = 'ruta-paradas';
  private readonly PARADAS_CIRCLE_LAYER = 'ruta-paradas-circle';
  private readonly PARADAS_LABEL_LAYER = 'ruta-paradas-label';

  private drawParadaMarkers(map: maplibregl.Map, features: any[]) {
    const geojson = { type: 'FeatureCollection' as const, features };

    const existingSrc = map.getSource(this.PARADAS_SRC) as maplibregl.GeoJSONSource | undefined;
    if (existingSrc) {
      existingSrc.setData(geojson as any);
      return;
    }

    try {
      map.addSource(this.PARADAS_SRC, { type: 'geojson', data: geojson as any });
      map.addLayer({
        id: this.PARADAS_CIRCLE_LAYER, type: 'circle', source: this.PARADAS_SRC,
        paint: {
          'circle-radius': ['case', ['get', 'isTerminal'], 8, 4.5],
          'circle-color': ['get', 'color'],
          'circle-stroke-width': ['case', ['get', 'isTerminal'], 2, 1.5],
          'circle-stroke-color': '#ffffff',
          'circle-pitch-alignment': 'viewport',
        },
      });
      map.addLayer({
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
    } catch (err) {
      console.error('No se pudieron dibujar las paradas en el mapa:', err);
    }
  }

  // Dibuja la línea de una ruta como halo grueso translúcido + línea
  // principal encima, igual que el mapa de pasajero (mismo lenguaje visual
  // en toda la app). `latlng` viene en formato [lat, lng] (el que se guarda
  // en `ruta.geometria`); GeoJSON/MapLibre lo quiere invertido.
  private drawRouteLine(idBase: string, latlng: [number, number][], color: string) {
    // Si el estilo de MapTiler no cargó (caída del proveedor, cuota, sin red),
    // addSource/addLayer tiran una excepción síncrona ("Style is not done
    // loading"). Sin esta guarda, esa excepción interrumpe el for-loop de
    // drawAllRutaPaths antes de llegar a las paradas: una ruta se queda sin
    // línea Y sin markers, en vez de sólo sin línea.
    if (!this.liveMap || !this.liveMap.isStyleLoaded()) return;
    const coords = latlng.map(([lat, lng]) => [lng, lat]);
    const srcId = `${idBase}-src`;
    const bgId = `${idBase}-bg`;
    const mainId = `${idBase}-main`;

    try {
      this.liveMap.addSource(srcId, {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } },
      });
      this.liveMap.addLayer({
        id: bgId, type: 'line', source: srcId,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': color, 'line-width': 12, 'line-opacity': 0.15 },
      });
      this.liveMap.addLayer({
        id: mainId, type: 'line', source: srcId,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': color, 'line-width': 5, 'line-opacity': 0.85 },
      });
      this.rutaSourceIds.push(srcId);
      this.rutaLayerIds.push(bgId, mainId);
    } catch { /* el mapa sigue usable sin esta línea */ }
  }

  async startEditRuta(r: Ruta) {
    this.editingRuta = r;
    this.editingParadas = await this.admin.getParadas(r.id);
    this.activeTab = 'mapa';
    setTimeout(() => this.initLiveMap(), 150);
  }

  private exitEditMode() {
    if (this.mapClickHandler && this.liveMap) {
      this.liveMap.off('click', this.mapClickHandler);
      this.mapClickHandler = null;
    }
    this.editingRuta = null;
    this.editingParadas = [];
  }

  stopEditRuta() {
    this.exitEditMode();
    setTimeout(() => this.initLiveMap(), 150);
  }

  private async onMapClickAddParada(e: maplibregl.MapMouseEvent) {
    if (!this.editingRuta) return;
    const orden = this.editingParadas.length;
    const optimistic: Parada = {
      id: `temp-${Date.now()}`,
      ruta_id: this.editingRuta.id,
      nombre: `Parada ${orden + 1}`,
      latitud: e.lngLat.lat,
      longitud: e.lngLat.lng,
      orden,
    };

    // Se dibuja de inmediato para que el click siempre dé feedback visual,
    // aunque el guardado en el servidor falle (RLS, red, etc.).
    this.editingParadas.push(optimistic);
    this.drawEditingRutaPath();

    try {
      const saved = await this.admin.createParada({
        ruta_id: optimistic.ruta_id,
        nombre: optimistic.nombre,
        latitud: optimistic.latitud,
        longitud: optimistic.longitud,
        orden: optimistic.orden,
      });
      const idx = this.editingParadas.findIndex(p => p.id === optimistic.id);
      if (idx >= 0) this.editingParadas[idx] = saved;
    } catch (err: any) {
      this.editingParadas = this.editingParadas.filter(p => p.id !== optimistic.id);
      this.drawEditingRutaPath();
      this.showToast(err?.message || 'No se pudo guardar la parada', 'danger');
    }
  }

  async undoLastParada() {
    const last = this.editingParadas[this.editingParadas.length - 1];
    if (!last) return;

    if (!last.id.startsWith('temp-')) {
      const alert = await this.alertCtrl.create({ cssClass: 'buxi-alert',
        header: 'Quitar parada',
        message: `¿Eliminar "${last.nombre}" del trazado? Esto la borra permanentemente.`,
        buttons: [
          { text: 'Cancelar', role: 'cancel' },
          { text: 'Eliminar', role: 'destructive', handler: async () => {
            this.editingParadas.pop();
            try { await this.admin.deleteParada(last.id); } catch {}
            await this.drawEditingRutaPath();
          }},
        ],
      });
      await alert.present();
    } else {
      this.editingParadas.pop();
      await this.drawEditingRutaPath();
    }
  }

  private async drawEditingRutaPath() {
    if (!this.liveMap) return;
    this.clearRutaLayers();

    const color = this.editingRuta?.color || '#00c853';
    this.editingParadas.forEach((p, i) => {
      const html = `<div class="ruta-point-dot" style="background:${colorSeguro(color)}">${i + 1}</div><div class="ruta-point-label">${esc(p.nombre)}</div>`;
      const el = htmlMarkerEl('ruta-point-marker', html);
      const m = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([p.longitud, p.latitud])
        .addTo(this.liveMap!);
      this.rutaMarkers.push(m);
    });

    if (this.editingParadas.length >= 2) {
      const coords = await this.features.fetchRoadRouteCoords(this.editingParadas);
      this.drawRouteLine('ruta-editing', coords, color);

      if (this.editingRuta) {
        this.editingRuta.geometria = coords;
        this.admin.updateRuta(this.editingRuta.id, { geometria: coords }).catch(() => {});
      }
    } else if (this.editingRuta && this.editingRuta.geometria) {
      // Ya no hay suficientes paradas para formar un camino: no dejar un trazado viejo huérfano.
      this.editingRuta.geometria = null;
      this.admin.updateRuta(this.editingRuta.id, { geometria: null }).catch(() => {});
    }
  }

  private updateMapMarker(busId: string, lat: number, lng: number, timestamp?: string) {
    if (!this.liveMap) return;
    this.liveMarkersLastSeen.set(busId, timestamp ? (Date.parse(timestamp) || Date.now()) : Date.now());
    const lngLat: [number, number] = [lng, lat];

    if (this.liveMarkers.has(busId)) {
      const marker = this.liveMarkers.get(busId)!;
      animateMarkerTo(marker, lngLat);
      marker.getElement().style.opacity = '1';
      this.refreshMarkerTooltip(busId, marker, false);
    } else {
      const el = htmlMarkerEl('emp-bus-marker', this.busMarkerHtml());
      const m = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat(lngLat)
        .addTo(this.liveMap);
      this.liveMarkers.set(busId, m);
      this.refreshMarkerTooltip(busId, m, false);
    }
  }

  private busMarkerHtml(): string {
    return `<div class="emp-bus-icon"><svg viewBox="0 0 24 24" fill="white" width="12" height="12"><path d="M4 16c0 .88.39 1.67 1 2.22V20c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h8v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1.78c.61-.55 1-1.34 1-2.22V6c0-3.5-3.58-4-8-4s-8 .5-8 4v10zm3.5 1c-.83 0-1.5-.67-1.5-1.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17zm9 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm1.5-6H6V6h12v5z"/></svg></div><div class="emp-bus-label"></div>`;
  }

  // ---- MARCADORES DE EMERGENCIA EN EL MAPA ----
  // El botón de pánico del chofer ya manda la ubicación; en vez de que la
  // empresa tenga que abrir Google Maps aparte, las emergencias pendientes
  // se dibujan directo sobre el mismo mapa donde ya ve los buses.
  //
  // Van como capa nativa (fuente GeoJSON + circle/symbol), NO como
  // maplibregl.Marker: confirmado con el navegador real que Marker consulta
  // la elevación del terreno para ubicarse (el mapa tiene terreno 3D
  // activado, ver enable3D) y esa consulta es un bug conocido de MapLibre
  // (github.com/maplibre/maplibre-gl-js/issues/6701, valores de elevación
  // muy alejados de la realidad) -- el marcador terminaba proyectado a
  // cientos de píxeles de donde debía, aunque la cámara sí estaba bien
  // centrada. Una capa de circle no pasa por ese camino de terreno.
  private readonly EMERGENCY_SRC = 'emergency-points';
  private readonly EMERGENCY_CIRCLE_LAYER = 'emergency-points-circle';
  private readonly EMERGENCY_LABEL_LAYER = 'emergency-points-label';

  private drawEmergencyMarkers(map: maplibregl.Map) {
    // Sin el guard de isStyleLoaded() que sí necesita drawRouteLine: acá no
    // depende de que OTRAS fuentes (el DEM del terreno, por ejemplo) hayan
    // terminado de cargar -- agregar una fuente/capa GeoJSON propia es
    // seguro en cualquier momento después de que el mapa exista, y ese
    // guard hacía que esto nunca llegara a dibujar nada (isStyleLoaded()
    // quedaba en false un rato después de que enable3D() agrega la fuente
    // del terreno).
    const features = this.emergencias
      .filter(e => e.estado === 'pendiente')
      .map(em => {
        const coords = this.getEmergenciaCoords(em);
        if (!coords) return null;
        return {
          type: 'Feature' as const,
          properties: { nombre: em.autor?.nombre_completo || 'Chofer' },
          geometry: { type: 'Point' as const, coordinates: [coords[1], coords[0]] },
        };
      })
      .filter((f): f is NonNullable<typeof f> => !!f);
    const geojson = { type: 'FeatureCollection' as const, features };

    const existingSrc = map.getSource(this.EMERGENCY_SRC) as maplibregl.GeoJSONSource | undefined;
    if (existingSrc) {
      existingSrc.setData(geojson as any);
      return;
    }

    try {
      map.addSource(this.EMERGENCY_SRC, { type: 'geojson', data: geojson as any });
      map.addLayer({
        id: this.EMERGENCY_CIRCLE_LAYER, type: 'circle', source: this.EMERGENCY_SRC,
        paint: {
          'circle-radius': 12,
          'circle-color': '#ff5449',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
          'circle-pitch-alignment': 'viewport',
        },
      });
      map.addLayer({
        id: this.EMERGENCY_LABEL_LAYER, type: 'symbol', source: this.EMERGENCY_SRC,
        layout: {
          'text-field': '!',
          'text-size': 14,
          'text-allow-overlap': true,
          'text-pitch-alignment': 'viewport',
        },
        paint: { 'text-color': '#ffffff' },
      });
      map.on('click', this.EMERGENCY_CIRCLE_LAYER, () => this.switchTab('emergencias'));
      map.on('mouseenter', this.EMERGENCY_CIRCLE_LAYER, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', this.EMERGENCY_CIRCLE_LAYER, () => { map.getCanvas().style.cursor = ''; });
    } catch (err) {
      // El mapa sigue usable sin estos marcadores; se deja en consola para
      // poder diagnosticar por qué no aparecieron en vez de fallar en
      // silencio total.
      console.error('No se pudieron dibujar las emergencias en el mapa:', err);
    }
  }

  // Separado de drawEmergencyMarkers a propósito: tiene que correr DESPUÉS
  // de map.resize() (ver initLiveMap), cuando el contenedor ya tiene su
  // tamaño real. Recibe el mapa como parámetro (no lee this.liveMap) por la
  // misma razón que resize() en initLiveMap: para no terminar operando
  // sobre una instancia de mapa vieja si mientras tanto se disparó otro
  // initLiveMap().
  private fitEmergencyBounds(map: maplibregl.Map) {
    const coordsList = this.emergencias
      .filter(e => e.estado === 'pendiente')
      .map(e => this.getEmergenciaCoords(e))
      .filter((c): c is [number, number] => !!c);
    if (coordsList.length === 0) return;

    // Cámara armada a mano en vez de fitBounds(): centro = punto medio de
    // las emergencias, zoom aproximado según qué tan separadas están entre
    // sí -- más simple de razonar que pelear con fitBounds en un mapa con
    // pitch 3D.
    const lats = coordsList.map(c => c[0]);
    const lngs = coordsList.map(c => c[1]);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const center: [number, number] = [(minLng + maxLng) / 2, (minLat + maxLat) / 2];

    const spread = Math.max(maxLat - minLat, (maxLng - minLng) * 1.2);
    let zoom = 14;
    if (spread > 0.5) zoom = 8;
    else if (spread > 0.2) zoom = 10;
    else if (spread > 0.08) zoom = 11.5;
    else if (spread > 0.03) zoom = 13;

    map.jumpTo({ center, zoom });
  }

  private refreshMarkerTooltip(busId: string, marker: maplibregl.Marker, stale: boolean) {
    const placa = this.buses.find(b => b.id === busId)?.placa || 'Bus';
    const label = marker.getElement().querySelector('.emp-bus-label');
    if (!label) return;
    label.textContent = stale ? `${placa} · sin señal` : placa;
    label.className = `emp-bus-label${stale ? ' stale' : ''}`;
  }

  private startStaleBusWatcher() {
    this.staleCheckInterval = setInterval(() => {
      if (!this.liveMap) return;
      const now = Date.now();
      this.liveMarkersLastSeen.forEach((lastSeen, busId) => {
        const marker = this.liveMarkers.get(busId);
        if (!marker) return;
        const age = now - lastSeen;
        if (age > this.REMOVE_MS) {
          marker.remove();
          this.liveMarkers.delete(busId);
          this.liveMarkersLastSeen.delete(busId);
        } else if (age > this.STALE_MS) {
          marker.getElement().style.opacity = '0.35';
          this.refreshMarkerTooltip(busId, marker, true);
        }
      });
    }, 10000);
  }

  get activeBusCount(): number { return this.buses.filter(b => b.estado === 'en_ruta').length; }
  get activeRoutesCount(): number { return this.rutas.filter(r => r.estado === 'activa').length; }

  // ---- RUTAS ----
  async addRuta() {
    const modal = await this.modalCtrl.create({ component: RutaFormComponent });
    await modal.present();
    const { data, role } = await modal.onDidDismiss();
    if (role !== 'confirm' || !data) return;

    try {
      const nueva = await this.admin.createRuta({
        empresa_id: this.profile!.empresa_id!,
        nombre: data.nombre,
        origen: data.origen.label,
        destino: data.destino.label,
        color: data.color || '#00c853',
        precio: data.precio ?? null,
        codigo_ruta: data.codigo_ruta ?? null,
        aresep_fraccionamiento: data.aresep_fraccionamiento ?? null,
        estado: 'activa',
      });

      const origenParada = await this.admin.createParada({ ruta_id: nueva.id, nombre: data.origen.label, latitud: data.origen.lat, longitud: data.origen.lng, orden: 0 });
      const destinoParada = await this.admin.createParada({ ruta_id: nueva.id, nombre: data.destino.label, latitud: data.destino.lat, longitud: data.destino.lng, orden: 1 });

      const geometria = await this.features.fetchRoadRouteCoords([origenParada, destinoParada]);
      await this.admin.updateRuta(nueva.id, { geometria });

      await this.loadData();
      if (this.activeTab === 'mapa' || this.activeTab === 'inicio') setTimeout(() => this.initLiveMap(), 150);
      this.showToast('Ruta creada con recorrido automático');

      // Encadenado en vez de un campo más en "Nueva ruta": ese formulario ya
      // tiene bastante (nombre, precio, origen, destino, color) y el horario
      // es opcional por ruta — pero así la empresa no tiene que acordarse de
      // volver, y el pasajero ve el horario desde el primer momento.
      await this.manageHorarios(nueva);
    } catch {
      this.showToast('Error creando la ruta', 'danger');
    }
  }

  async editRutaDetails(r: Ruta) {
    const modal = await this.modalCtrl.create({ component: RutaFormComponent, componentProps: { ruta: r } });
    await modal.present();
    const { data, role } = await modal.onDidDismiss();
    if (role !== 'confirm' || !data) return;

    try {
      await this.admin.updateRuta(r.id, {
        nombre: data.nombre, color: data.color, precio: data.precio ?? null,
        codigo_ruta: data.codigo_ruta ?? null, aresep_fraccionamiento: data.aresep_fraccionamiento ?? null,
      });
      await this.loadData();
      this.showToast('Ruta actualizada');
    } catch {
      this.showToast('Error actualizando la ruta', 'danger');
    }
  }

  async manageHorarios(r: Ruta) {
    const modal = await this.modalCtrl.create({ component: HorariosFormComponent, componentProps: { ruta: r } });
    await modal.present();
    await modal.onDidDismiss();
    try {
      const salidas = await this.admin.getHorarioSalidas(r.id);
      this.horariosResumen[r.id] = salidas.length;
    } catch {}
  }

  async deleteRuta(r: Ruta) {
    const alert = await this.alertCtrl.create({ cssClass: 'buxi-alert',
      header: 'Eliminar ruta', message: `¿Eliminar "${r.nombre}"?`,
      buttons: [{ text: 'Cancelar', role: 'cancel' }, { text: 'Eliminar', role: 'destructive', handler: async () => {
        await this.admin.deleteRuta(r.id); await this.loadData(); this.showToast('Eliminada');
      }}],
    });
    await alert.present();
  }

  // ---- BUSES ----
  async addBus() {
    const alert = await this.alertCtrl.create({ cssClass: 'buxi-alert',
      header: 'Nuevo bus',
      inputs: [
        { name: 'placa', placeholder: 'Placa', type: 'text' },
        { name: 'numero_unidad', placeholder: 'Número de unidad', type: 'text' },
        { name: 'capacidad', placeholder: 'Capacidad', type: 'number', value: '40' },
      ],
      buttons: [{ text: 'Cancelar', role: 'cancel' }, { text: 'Crear', handler: async (d) => {
        if (!d.placa) return false;
        await this.admin.createBus({ empresa_id: this.profile!.empresa_id!, placa: d.placa, numero_unidad: d.numero_unidad || null, capacidad: parseInt(d.capacidad) || 40, estado: 'inactivo' });
        await this.loadData(); this.showToast('Bus creado');
        return true;
      }}],
    });
    await alert.present();
  }

  async assignBusRoute(bus: Bus) {
    const inputs = this.rutas.map(r => ({ type: 'radio' as const, label: r.nombre, value: r.id, checked: bus.ruta_id === r.id }));
    inputs.unshift({ type: 'radio' as const, label: 'Sin ruta', value: '', checked: !bus.ruta_id });
    const alert = await this.alertCtrl.create({ cssClass: 'buxi-alert', header: `Ruta de ${bus.placa}`, inputs, buttons: [{ text: 'Cancelar', role: 'cancel' }, { text: 'Asignar', handler: async (v) => { await this.admin.updateBus(bus.id, { ruta_id: v || null }); await this.loadData(); } }] });
    await alert.present();
  }

  async assignBusChofer(bus: Bus) {
    const inputs = this.choferes.map(c => ({ type: 'radio' as const, label: c.nombre_completo, value: c.id, checked: bus.chofer_id === c.id }));
    inputs.unshift({ type: 'radio' as const, label: 'Sin chofer', value: '', checked: !bus.chofer_id });
    const alert = await this.alertCtrl.create({ cssClass: 'buxi-alert', header: `Chofer de ${bus.placa}`, inputs, buttons: [{ text: 'Cancelar', role: 'cancel' }, { text: 'Asignar', handler: async (v) => { await this.admin.updateBus(bus.id, { chofer_id: v || null }); await this.loadData(); } }] });
    await alert.present();
  }

  async deleteBus(bus: Bus) {
    const alert = await this.alertCtrl.create({ cssClass: 'buxi-alert', header: 'Eliminar bus', message: `¿Eliminar ${bus.placa}?`, buttons: [{ text: 'Cancelar', role: 'cancel' }, { text: 'Eliminar', role: 'destructive', handler: async () => { await this.admin.deleteBus(bus.id); await this.loadData(); } }] });
    await alert.present();
  }

  // ---- CHOFERES ----
  // El error real de Supabase ("Password should contain at least one
  // character of each: ...") queda en inglés, se pierde en un toast y el
  // diálogo se cerraba igual aunque fallara — la empresa se quedaba sin
  // saber por qué "no dejaba" crear el chofer. Ahora se explica el
  // requisito de entrada, se valida antes de llamar a la red, y si falla
  // el diálogo queda abierto (con lo ya escrito) en vez de perderlo.
  private traducirErrorAuth(msg?: string): string {
    if (!msg) return 'Error creando la cuenta';
    if (msg.includes('Password should contain at least one character of each')) {
      return 'La contraseña necesita mayúscula, minúscula y número';
    }
    if (msg.includes('Password should be at least')) {
      return 'La contraseña es muy corta';
    }
    if (msg.includes('already registered') || msg.includes('already exists')) {
      return 'Ya existe una cuenta con ese correo';
    }
    if (msg.includes('Unable to validate email') || msg.includes('invalid format')) {
      return 'El correo no es válido';
    }
    if (msg.includes('row-level security policy')) {
      return 'Sin permiso todavía para esta acción';
    }
    return msg;
  }

  async addChofer() {
    const alert = await this.alertCtrl.create({ cssClass: 'buxi-alert',
      header: 'Nuevo chofer',
      message: 'La contraseña temporal debe tener al menos 8 caracteres, con mayúscula, minúscula y número.',
      inputs: [
        { name: 'nombre', placeholder: 'Nombre completo', type: 'text' },
        { name: 'email', placeholder: 'Correo', type: 'email' },
        { name: 'password', placeholder: 'Contraseña temporal', type: 'password' },
      ],
      buttons: [{ text: 'Cancelar', role: 'cancel' }, { text: 'Crear', handler: async (d) => {
        if (!d.nombre || !d.email || !d.password) return false;
        if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(d.password)) {
          this.showToast('La contraseña necesita mayúscula, minúscula, número y al menos 8 caracteres', 'danger');
          return false;
        }
        try {
          await this.admin.createChofer(d.email, d.password, d.nombre, this.profile!.empresa_id!);
          await this.loadData();
          this.showToast('Chofer creado');
          return true;
        } catch (e: any) {
          this.showToast(this.traducirErrorAuth(e?.message), 'danger');
          return false;
        }
      }}],
    });
    await alert.present();
  }

  async editChofer(c: UserProfile) {
    const alert = await this.alertCtrl.create({ cssClass: 'buxi-alert',
      header: 'Editar chofer',
      inputs: [
        { name: 'nombre', placeholder: 'Nombre completo', type: 'text', value: c.nombre_completo },
        { name: 'telefono', placeholder: 'Teléfono', type: 'tel', value: c.telefono || '' },
      ],
      buttons: [{ text: 'Cancelar', role: 'cancel' }, { text: 'Guardar', handler: async (d) => {
        if (!d.nombre) return false;
        try {
          await this.admin.updateChofer(c.id, { nombre_completo: d.nombre, telefono: d.telefono || null });
          await this.loadData();
          this.showToast('Chofer actualizado');
        } catch (e: any) { this.showToast(e?.message || 'Error', 'danger'); }
        return true;
      }}],
    });
    await alert.present();
  }

  async toggleChoferEstado(c: UserProfile) {
    const nuevo = c.estado === 'activo' ? 'inactivo' : 'activo';
    try {
      await this.admin.updateChofer(c.id, { estado: nuevo });
      await this.loadData();
      this.showToast(nuevo === 'activo' ? 'Chofer activado' : 'Chofer desactivado');
    } catch (e: any) { this.showToast(e?.message || 'Error', 'danger'); }
  }

  async resetChoferPassword(c: UserProfile) {
    const alert = await this.alertCtrl.create({ cssClass: 'buxi-alert',
      header: `Nueva contraseña para ${c.nombre_completo}`,
      inputs: [{ name: 'password', placeholder: 'Contraseña nueva (mín. 6 caracteres)', type: 'password' }],
      buttons: [{ text: 'Cancelar', role: 'cancel' }, { text: 'Guardar', handler: async (d) => {
        if (!d.password || d.password.length < 6) return false;
        try {
          await this.admin.resetChoferPassword(c.id, d.password);
          this.showToast('Contraseña actualizada');
        } catch (e: any) { this.showToast(e?.message || 'Error', 'danger'); }
        return true;
      }}],
    });
    await alert.present();
  }

  async mensajeChofer(c: UserProfile) {
    if (!this.profile?.empresa_id) return;
    const alert = await this.alertCtrl.create({ cssClass: 'buxi-alert',
      header: `Mensaje para ${c.nombre_completo}`,
      inputs: [{ name: 'mensaje', type: 'textarea', placeholder: 'Escribí el mensaje...' }],
      buttons: [{ text: 'Cancelar', role: 'cancel' }, { text: 'Enviar', handler: async (d) => {
        if (!d.mensaje?.trim()) return false;
        try {
          await this.admin.enviarMensajeChofer(c.id, this.profile!.empresa_id!, this.profile!.id, d.mensaje.trim());
          this.showToast('Mensaje enviado');
        } catch (e: any) { this.showToast(e?.message || 'Error', 'danger'); }
        return true;
      }}],
    });
    await alert.present();
  }

  async deleteChofer(c: UserProfile) {
    const alert = await this.alertCtrl.create({ cssClass: 'buxi-alert',
      header: 'Eliminar chofer',
      message: `¿Eliminar a "${c.nombre_completo}"? Esto borra su cuenta por completo y no se puede deshacer.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Eliminar', role: 'destructive', handler: async () => {
          try {
            await this.admin.deleteChofer(c.id);
            await this.loadData();
            this.showToast('Chofer eliminado');
          } catch (e: any) { this.showToast(e?.message || 'Error', 'danger'); }
        }},
      ],
    });
    await alert.present();
  }

  // ---- MI EQUIPO ----
  esMiPropiaCuenta(c: UserProfile): boolean {
    return c.id === this.profile?.id;
  }

  async addEquipoMiembro() {
    const alert = await this.alertCtrl.create({ cssClass: 'buxi-alert',
      header: 'Agregar administrador',
      message: 'Va a tener el mismo acceso completo al panel que vos. La contraseña temporal debe tener al menos 8 caracteres, con mayúscula, minúscula y número.',
      inputs: [
        { name: 'nombre', placeholder: 'Nombre completo', type: 'text' },
        { name: 'email', placeholder: 'Correo', type: 'email' },
        { name: 'password', placeholder: 'Contraseña temporal', type: 'password' },
      ],
      buttons: [{ text: 'Cancelar', role: 'cancel' }, { text: 'Crear', handler: async (d) => {
        if (!d.nombre || !d.email || !d.password) return false;
        if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(d.password)) {
          this.showToast('La contraseña necesita mayúscula, minúscula, número y al menos 8 caracteres', 'danger');
          return false;
        }
        try {
          await this.admin.createEquipoMiembro(d.email, d.password, d.nombre, this.profile!.empresa_id!);
          await this.loadData();
          this.showToast('Administrador agregado');
          return true;
        } catch (e: any) {
          this.showToast(this.traducirErrorAuth(e?.message), 'danger');
          return false;
        }
      }}],
    });
    await alert.present();
  }

  async editEquipoMiembro(c: UserProfile) {
    const alert = await this.alertCtrl.create({ cssClass: 'buxi-alert',
      header: 'Editar administrador',
      inputs: [
        { name: 'nombre', placeholder: 'Nombre completo', type: 'text', value: c.nombre_completo },
        { name: 'telefono', placeholder: 'Teléfono', type: 'tel', value: c.telefono || '' },
      ],
      buttons: [{ text: 'Cancelar', role: 'cancel' }, { text: 'Guardar', handler: async (d) => {
        if (!d.nombre) return false;
        try {
          await this.admin.updateEquipoMiembro(c.id, { nombre_completo: d.nombre, telefono: d.telefono || null });
          await this.loadData();
          this.showToast('Administrador actualizado');
        } catch (e: any) { this.showToast(e?.message || 'Error', 'danger'); }
        return true;
      }}],
    });
    await alert.present();
  }

  async resetEquipoPassword(c: UserProfile) {
    const alert = await this.alertCtrl.create({ cssClass: 'buxi-alert',
      header: `Nueva contraseña para ${c.nombre_completo}`,
      inputs: [{ name: 'password', placeholder: 'Contraseña nueva (mín. 6 caracteres)', type: 'password' }],
      buttons: [{ text: 'Cancelar', role: 'cancel' }, { text: 'Guardar', handler: async (d) => {
        if (!d.password || d.password.length < 6) return false;
        try {
          await this.admin.resetEquipoPassword(c.id, d.password);
          this.showToast('Contraseña actualizada');
        } catch (e: any) { this.showToast(e?.message || 'Error', 'danger'); }
        return true;
      }}],
    });
    await alert.present();
  }

  async deleteEquipoMiembro(c: UserProfile) {
    const alert = await this.alertCtrl.create({ cssClass: 'buxi-alert',
      header: 'Quitar administrador',
      message: `¿Quitarle el acceso a "${c.nombre_completo}"? Esto borra su cuenta por completo y no se puede deshacer.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Quitar acceso', role: 'destructive', handler: async () => {
          try {
            await this.admin.deleteEquipoMiembro(c.id);
            await this.loadData();
            this.showToast('Administrador eliminado');
          } catch (e: any) { this.showToast(e?.message || 'Error', 'danger'); }
        }},
      ],
    });
    await alert.present();
  }

  async onLogout() { await this.supabase.signOut(); this.router.navigate(['/auth/login'], { replaceUrl: true }); }
  private async showToast(m: string, c = 'success') { const t = await this.toastCtrl.create({ message: m, duration: 2000, color: c, position: 'top' }); await t.present(); }

  // Todo lo que el panel muestra y puede cambiar mientras se mira: una
  // emergencia del boton de panico, un boleto escaneado, un chofer que la
  // empresa acaba de crear en otra pestana.
  private iniciarDatosEnVivo() {
    if (this.liveChannel) return;
    const sb = supabaseClient();
    this.liveChannel = suscribirCambios(
      sb.channel('emp-datos'),
      ['reportes_bugs', 'boletos', 'buses', 'rutas', 'paradas', 'viajes',
       'profiles', 'horarios', 'horario_salidas', 'mensajes_chofer',
       'solicitudes_plan', 'facturas', 'suscripciones', 'avisos_sistema',
       'empresas', 'calificaciones', 'notificaciones_empresa'],
      () => {
        if (!this.profile?.empresa_id) return;
        this.loadData().catch(e => logError('Empresa: refresco en vivo', e));
      },
    ).subscribe();
  }

  ngOnDestroy() {
    if (this.staleCheckInterval) clearInterval(this.staleCheckInterval);
    if (this.relojTimer) clearInterval(this.relojTimer);
    if (this.liveChannel) supabaseClient().removeChannel(this.liveChannel);
    if (this.liveMap) this.liveMap.remove();
    if (this.realtimeChannel) {
      supabaseClient().removeChannel(this.realtimeChannel);
    }
  }
}
