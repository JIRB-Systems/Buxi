import { Component, OnInit, OnDestroy } from '@angular/core';
import { supabaseClient } from '../../../core/supabase-client';
import { Router } from '@angular/router';
import { AlertController, LoadingController, ModalController, ToastController } from '@ionic/angular';
import * as maplibregl from 'maplibre-gl';
import { RealtimeChannel } from '@supabase/supabase-js';
import { environment } from '../../../../environments/environment';
import { SupabaseService } from '../../../core/services/supabase.service';
import { AdminEmpresaService } from '../../../core/services/admin-empresa.service';
import { FeaturesService } from '../../../core/services/features.service';
import { UserProfile } from '../../../core/models/user-profile.model';
import { Bus, Ruta, Parada, BusLocation, Empresa } from '../../../core/models/transport.model';
import { ReporteBug, AvisoSistema, Plan, Suscripcion, SolicitudPlan, Factura, Viaje } from '../../../core/models/features.model';
import { RutaFormComponent } from './ruta-form.component';
import { HorariosFormComponent } from './horarios-form.component';
import { ReporteFormComponent } from './reporte-form.component';
import { createMap, htmlMarkerEl, animateMarkerTo } from '../../../core/utils/maplibre';
import { descargarFacturaPDF } from '../../../core/utils/factura-pdf';

@Component({
  selector: 'app-empresa-dashboard',
  templateUrl: './dashboard.page.html',
  styleUrls: ['./dashboard.page.scss'],
  standalone: false,
})
export class EmpresaDashboardPage implements OnInit, OnDestroy {
  profile: UserProfile | null = null;
  activeTab = 'inicio';
  loading = true;
  sidebarOpen = true;
  empresaNombre = '';

  menuItems = [
    { id: 'inicio', icon: 'home-outline', label: 'Inicio' },
    { id: 'emergencias', icon: 'alert-circle-outline', label: 'Emergencias' },
    { id: 'rutas', icon: 'git-branch-outline', label: 'Mis rutas' },
    { id: 'horarios', icon: 'time-outline', label: 'Horarios' },
    { id: 'buses', icon: 'bus-outline', label: 'Buses' },
    { id: 'choferes', icon: 'people-outline', label: 'Choferes' },
    { id: 'mapa', icon: 'location-outline', label: 'Seguimiento en vivo' },
    { id: 'avisos', icon: 'megaphone-outline', label: 'Avisos' },
    { id: 'reportes', icon: 'bug-outline', label: 'Reportes' },
    { id: 'planes', icon: 'card-outline', label: 'Planes' },
    { id: 'facturas', icon: 'receipt-outline', label: 'Facturas' },
  ];

  stats = { buses: 0, rutas: 0, choferes: 0, busesEnRuta: 0 };
  rutas: Ruta[] = [];
  buses: Bus[] = [];
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
  // Fuentes/capas de las líneas de ruta y markers de paradas dibujados sobre
  // el mapa: se limpian a mano en cada redibujo porque MapLibre no tiene un
  // grupo tipo L.LayerGroup que los saque a todos de una.
  private rutaSourceIds: string[] = [];
  private rutaLayerIds: string[] = [];
  private rutaMarkers: maplibregl.Marker[] = [];
  private emergencyMarkers: maplibregl.Marker[] = [];
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
  ) {}

  async ngOnInit() {
    try {
      this.profile = await this.supabase.getProfile();
      if (this.profile?.empresa_id) {
        await this.loadData();
      }
    } catch {} finally {
      this.loading = false;
      setTimeout(() => this.initLiveMap(), 150);
    }
  }

  async loadData() {
    if (!this.profile?.empresa_id) return;
    const eid = this.profile.empresa_id;
    const [stats, rutas, buses, choferes, anomalias, reportes, emergencias, avisos, planes, miSuscripcion, solicitudPlanPendiente, facturas, empresa, viajesRecientes] = await Promise.all([
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
    this.viajesRecientes = viajesRecientes;
  }

  // ---- FACTURAS ----
  descargarFactura(f: Factura) {
    descargarFacturaPDF(f);
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
        { name: 'logo_url', placeholder: 'URL del logo (opcional)', type: 'url', value: e.logo_url || '' },
      ],
      buttons: [{ text: 'Cancelar', role: 'cancel' }, { text: 'Guardar', handler: async (d) => {
        if (!d.nombre?.trim()) return false;
        try {
          await this.admin.updateEmpresa(e.id, {
            nombre: d.nombre.trim(),
            cedula_juridica: d.cedula_juridica?.trim() || null,
            telefono: d.telefono?.trim() || null,
            email: d.email?.trim() || null,
            logo_url: d.logo_url?.trim() || null,
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

  async resolverEmergencia(r: ReporteBug) {
    try {
      await this.admin.resolverEmergencia(r.id);
      r.estado = 'resuelto';
      this.showToast('Marcada como resuelta');
    } catch (e: any) {
      this.showToast(e?.message || 'No se pudo actualizar', 'danger');
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
  getReporteEstadoColor(e: string) { return { pendiente: '#ff9800', en_revision: '#2196f3', resuelto: '#00c853' }[e] || '#9aa5b4'; }
  getAvisoColor(t: string) { return { info: '#2196f3', advertencia: '#ff9800', urgente: '#f44336' }[t] || '#2196f3'; }
  getAvisoIcon(t: string) { return { info: 'information-circle-outline', advertencia: 'warning-outline', urgente: 'alert-circle-outline' }[t] || 'information-circle-outline'; }

  async dismissAnomalia(loc: BusLocation) {
    try {
      await this.admin.dismissAnomaly(loc.id);
      this.anomalias = this.anomalias.filter(a => a.id !== loc.id);
    } catch { this.showToast('Error al descartar la alerta', 'danger'); }
  }

  switchTab(tab: string) {
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
    this.drawEmergencyMarkers();

    // Subscribe to realtime
    if (!this.realtimeChannel) {
      const sb = supabaseClient();
      this.realtimeChannel = sb.channel('emp-live')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bus_locations' }, (payload) => {
          const loc = payload.new as BusLocation;
          this.updateMapMarker(loc.bus_id, loc.latitud, loc.longitud, loc.timestamp);
        })
        .subscribe();
    }

    if (!this.staleCheckInterval) this.startStaleBusWatcher();

    if (this.editingRuta) {
      this.mapClickHandler = (e) => this.onMapClickAddParada(e);
      this.liveMap.on('click', this.mapClickHandler);
      this.drawEditingRutaPath();
    } else {
      this.drawAllRutaPaths();
    }

    // El fitBounds de las emergencias tiene que calcularse DESPUÉS del
    // resize(), no antes: el mapa recién se creó y su contenedor puede no
    // tener todavía el tamaño final (la pestaña/layout se está acomodando),
    // así que un fitBounds inmediato calcula la cámara contra un tamaño
    // equivocado -- por eso una emergencia terminaba mostrándose fuera del
    // mapa, montada sobre la barra superior en vez de encuadrada adentro.
    setTimeout(() => {
      this.liveMap?.resize();
      if (!focus) this.fitEmergencyBounds();
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
  private async drawAllRutaPaths() {
    const activas = this.rutas.filter(r => r.estado === 'activa');
    const results = await Promise.all(activas.map(async r => {
      const paradas = await this.admin.getParadas(r.id);
      return { ruta: r, paradas };
    }));

    if (!this.liveMap) return;
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
        const html = isTerminal
          ? `<div class="ruta-stop-terminal" style="background:${color}"></div><div class="ruta-stop-label">${p.nombre}</div>`
          : `<div class="ruta-stop-dot" style="background:${color}"></div>`;
        const el = htmlMarkerEl('ruta-stop-marker', html);
        const m = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat([p.longitud, p.latitud])
          .addTo(this.liveMap!);
        this.rutaMarkers.push(m);
      });
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
      const html = `<div class="ruta-point-dot" style="background:${color}">${i + 1}</div><div class="ruta-point-label">${p.nombre}</div>`;
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
  private drawEmergencyMarkers() {
    if (!this.liveMap) return;
    this.emergencyMarkers.forEach(m => m.remove());
    this.emergencyMarkers = [];

    const pendientes = this.emergencias.filter(e => e.estado === 'pendiente');
    for (const em of pendientes) {
      const coords = this.getEmergenciaCoords(em);
      if (!coords) continue;
      const nombre = em.autor?.nombre_completo || 'Chofer';
      const el = htmlMarkerEl('emp-emergency-marker', this.emergencyMarkerHtml(nombre));
      el.addEventListener('click', () => this.switchTab('emergencias'));
      // 'center': el marcador es un círculo sin punta, no un pin con punta
      // hacia abajo -- con anchor 'bottom' el círculo quedaba flotando ~15px
      // arriba de la coordenada real, como si no marcara el punto exacto.
      // Mismo anchor que usan los buses y las paradas en este mismo mapa.
      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([coords[1], coords[0]])
        .addTo(this.liveMap);
      this.emergencyMarkers.push(marker);
    }
  }

  // Separado de drawEmergencyMarkers a propósito: tiene que correr DESPUÉS
  // de liveMap.resize() (ver initLiveMap), cuando el contenedor ya tiene su
  // tamaño real. Llamado antes, fitBounds calculaba la cámara contra un
  // contenedor angosto/alto equivocado y una emergencia terminaba
  // renderizada fuera del recuadro del mapa, montada sobre la barra
  // superior de la página.
  private fitEmergencyBounds() {
    if (!this.liveMap) return;
    const coordsList = this.emergencias
      .filter(e => e.estado === 'pendiente')
      .map(e => this.getEmergenciaCoords(e))
      .filter((c): c is [number, number] => !!c);
    if (coordsList.length === 0) return;

    // fitBounds() no calcula bien el encuadre con el mapa inclinado en 3D
    // (pitch 50): la cámara se quedaba en el centro por defecto sin moverse
    // nunca. En vez de pelear con eso, se arma la cámara a mano: centro =
    // punto medio de las emergencias, zoom aproximado según qué tan
    // separadas están entre sí.
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

    this.liveMap.jumpTo({ center, zoom });
  }

  private emergencyMarkerHtml(nombre: string): string {
    return `<div class="emp-emergency-pulse"></div><div class="emp-emergency-icon">!</div><div class="emp-emergency-label">${nombre} · Emergencia</div>`;
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
      await this.admin.updateRuta(r.id, { nombre: data.nombre, color: data.color, precio: data.precio ?? null });
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
    if (!msg) return 'Error creando el chofer';
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

  getBusStatus(e: string) { return { activo: 'Activo', inactivo: 'Inactivo', en_ruta: 'En ruta', mantenimiento: 'Mant.' }[e] || e; }
  getBusColor(e: string) { return { activo: '#00c853', inactivo: '#9aa5b4', en_ruta: '#2196f3', mantenimiento: '#ff9800' }[e] || '#9aa5b4'; }

  async onLogout() { await this.supabase.signOut(); this.router.navigate(['/auth/login'], { replaceUrl: true }); }
  private async showToast(m: string, c = 'success') { const t = await this.toastCtrl.create({ message: m, duration: 2000, color: c, position: 'top' }); await t.present(); }

  ngOnDestroy() {
    if (this.staleCheckInterval) clearInterval(this.staleCheckInterval);
    if (this.liveMap) this.liveMap.remove();
    if (this.realtimeChannel) {
      supabaseClient().removeChannel(this.realtimeChannel);
    }
  }
}
