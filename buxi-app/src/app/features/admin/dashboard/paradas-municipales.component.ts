import { AfterViewInit, Component, ElementRef, NgZone, OnDestroy, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AlertController, IonicModule, ToastController } from '@ionic/angular';
import * as maplibregl from 'maplibre-gl';
import {
  CAPAS_PARADAS_MUNICIPALES, CAPAS_TERMINALES_MAPA, createMap, htmlMarkerEl,
  paradasDelMapaBase, paradasMunicipalesPropias, soloParadasBuxci,
} from '../../../core/utils/maplibre';
import { ParadaMunicipal, ParadasMunicipalesService, TipoParadaMunicipal } from '../../../core/services/paradas-municipales.service';
import { FeaturesService } from '../../../core/services/features.service';
import { logError } from '../../../core/utils/log';

// Lo que se está editando: una parada nueva, una corrección de una parada de
// OpenStreetMap (osm_id) o una de las ya cargadas por JIRB (id).
interface Edicion {
  id: string | null;
  nombre: string;
  tipo: TipoParadaMunicipal;
  latitud: number;
  longitud: number;
  osm_id: number | null;
  oculta: boolean;
  // El nombre que trae OpenStreetMap, para mostrar qué se está corrigiendo.
  nombreOsm: string | null;
}

// Panel JIRB → Paradas municipales. Solo JIRB pone o cambia nombres de
// paradas: la tabla paradas_municipales solo le deja escribir a admin_jirb
// (20261109160000). El mapa del pasajero dibuja estas igual que las de
// OpenStreetMap: paradas en ámbar y terminales en azul.
@Component({
  selector: 'bx-paradas-municipales',
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule],
  templateUrl: './paradas-municipales.component.html',
  styleUrls: ['./paradas-municipales.component.scss'],
})
export class ParadasMunicipalesComponent implements AfterViewInit, OnDestroy {
  private readonly srv = inject(ParadasMunicipalesService);
  private readonly features = inject(FeaturesService);
  private readonly toastCtrl = inject(ToastController);
  private readonly alertCtrl = inject(AlertController);
  private readonly zone = inject(NgZone);

  @ViewChild('mapa') mapaEl!: ElementRef<HTMLDivElement>;
  private map: maplibregl.Map | null = null;
  private marcador: maplibregl.Marker | null = null;
  private destruido = false;

  paradas: ParadaMunicipal[] = [];
  cargando = true;
  filtro = '';
  edicion: Edicion | null = null;
  guardando = false;
  busqueda = '';
  buscando = false;

  get paradasFiltradas(): ParadaMunicipal[] {
    const q = this.filtro.trim().toLowerCase();
    return q ? this.paradas.filter(p => p.nombre.toLowerCase().includes(q)) : this.paradas;
  }

  get cuentas(): { nuevas: number; corregidas: number; ocultas: number } {
    return {
      nuevas: this.paradas.filter(p => !p.osm_id).length,
      corregidas: this.paradas.filter(p => p.osm_id && !p.oculta).length,
      ocultas: this.paradas.filter(p => p.oculta).length,
    };
  }

  async ngAfterViewInit() {
    await this.cargar();
    if (this.destruido) return;
    this.map = await createMap({
      container: this.mapaEl.nativeElement,
      center: [-84.0907, 9.9281],
      zoom: 8,
      style: 'streets-v2-dark',
      // Vive en una página con scroll: la rueda baja la página, no hace zoom.
      cooperativeGestures: true,
    });
    if (this.destruido) { try { this.map.remove(); } catch {} return; }
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    try { soloParadasBuxci(this.map); } catch {}
    try { paradasDelMapaBase(this.map, true); } catch {}
    this.dibujar();
    this.map.on('click', (e) => this.zone.run(() => this.alTocar(e)));
    const capas = () => [...CAPAS_TERMINALES_MAPA, ...CAPAS_PARADAS_MUNICIPALES].filter(id => this.map?.getLayer(id));
    this.map.on('mousemove', (e) => {
      if (!this.map) return;
      const hay = this.map.queryRenderedFeatures(e.point, { layers: capas() }).length > 0;
      this.map.getCanvas().style.cursor = hay ? 'pointer' : 'crosshair';
    });
  }

  ngOnDestroy() {
    this.destruido = true;
    this.marcador?.remove();
    try { this.map?.remove(); } catch {}
  }

  private async cargar() {
    this.cargando = true;
    try {
      this.paradas = await this.srv.listar();
    } catch (e) {
      logError('JIRB: cargar paradas municipales', e);
      this.paradas = [];
      await this.toast('No se pudieron cargar las paradas municipales', 'danger');
    } finally {
      this.cargando = false;
    }
  }

  private dibujar() {
    if (!this.map) return;
    try { paradasMunicipalesPropias(this.map, true, this.paradas); } catch {}
  }

  // Tocar el mapa: una parada (de JIRB o de OpenStreetMap) se edita; un lugar
  // vacío es una parada nueva ahí, o mueve la que se está editando.
  private alTocar(e: maplibregl.MapMouseEvent) {
    if (!this.map) return;
    const caja: [maplibregl.PointLike, maplibregl.PointLike] = [[e.point.x - 8, e.point.y - 8], [e.point.x + 8, e.point.y + 8]];
    const capas = [...CAPAS_TERMINALES_MAPA, ...CAPAS_PARADAS_MUNICIPALES].filter(id => this.map!.getLayer(id));
    const f = capas.length ? this.map.queryRenderedFeatures(caja, { layers: capas })[0] : undefined;

    if (f && f.geometry.type === 'Point') {
      const [lng, lat] = (f.geometry as any).coordinates as [number, number];
      if (f.layer.id.startsWith('buxci-propias')) {
        const p = this.paradas.find(x => x.id === f.properties?.['pid']);
        if (p) this.editar(p, false);
        return;
      }
      // De OpenStreetMap: si ya tiene corrección, se edita esa.
      const osmId = Number(f.id);
      const ya = this.paradas.find(x => Number(x.osm_id) === osmId);
      if (ya) { this.editar(ya, false); return; }
      const nombreOsm = String(f.properties?.['name'] || '');
      this.edicion = {
        id: null, nombre: nombreOsm, tipo: f.properties?.['subclass'] === 'bus_station' ? 'terminal' : 'parada',
        latitud: lat, longitud: lng, osm_id: Number.isFinite(osmId) ? osmId : null, oculta: false, nombreOsm,
      };
      this.ponerMarcador();
      return;
    }

    if (this.edicion) {
      this.edicion.latitud = e.lngLat.lat;
      this.edicion.longitud = e.lngLat.lng;
    } else {
      this.edicion = { id: null, nombre: '', tipo: 'parada', latitud: e.lngLat.lat, longitud: e.lngLat.lng, osm_id: null, oculta: false, nombreOsm: null };
    }
    this.ponerMarcador();
  }

  editar(p: ParadaMunicipal, volar = true) {
    this.edicion = {
      id: p.id, nombre: p.nombre, tipo: p.tipo, latitud: p.latitud, longitud: p.longitud,
      osm_id: p.osm_id, oculta: p.oculta, nombreOsm: null,
    };
    this.ponerMarcador();
    if (volar) this.map?.flyTo({ center: [p.longitud, p.latitud], zoom: 17, duration: 800 });
  }

  // El pin de lo que se está editando. Se puede arrastrar para afinar el punto.
  private ponerMarcador() {
    const ed = this.edicion;
    if (!this.map || !ed) return;
    if (!this.marcador) {
      const el = htmlMarkerEl('pm-pin', '<div class="pm-pin"></div>');
      this.marcador = new maplibregl.Marker({ element: el, anchor: 'bottom', draggable: true })
        .setLngLat([ed.longitud, ed.latitud])
        .addTo(this.map);
      this.marcador.on('dragend', () => this.zone.run(() => {
        const ll = this.marcador!.getLngLat();
        if (this.edicion) { this.edicion.latitud = ll.lat; this.edicion.longitud = ll.lng; }
      }));
    } else {
      this.marcador.setLngLat([ed.longitud, ed.latitud]);
    }
  }

  cancelar() {
    this.edicion = null;
    this.marcador?.remove();
    this.marcador = null;
  }

  async guardar() {
    const ed = this.edicion;
    if (!ed || this.guardando) return;
    const nombre = ed.nombre.trim() || (ed.tipo === 'terminal' ? 'Terminal de buses' : 'Parada de bus');
    if (nombre.length > 80) { await this.toast('El nombre puede tener hasta 80 letras', 'warning'); return; }
    this.guardando = true;
    try {
      const datos = { nombre, tipo: ed.tipo, latitud: ed.latitud, longitud: ed.longitud, osm_id: ed.osm_id, oculta: false };
      if (ed.id) await this.srv.actualizar(ed.id, datos);
      else await this.srv.crear(datos);
      await this.toast(ed.osm_id ? 'Parada corregida' : 'Parada guardada');
      await this.trasCambio();
    } catch (e: any) {
      logError('JIRB: guardar parada municipal', e);
      await this.toast(e?.message?.includes('Sin permiso') ? e.message : 'No se pudo guardar la parada', 'danger');
    } finally {
      this.guardando = false;
    }
  }

  // Una parada de OpenStreetMap que no existe: se esconde del mapa.
  async esconder() {
    const ed = this.edicion;
    if (!ed?.osm_id || this.guardando) return;
    this.guardando = true;
    try {
      const datos = {
        nombre: (ed.nombreOsm || ed.nombre || 'Parada de bus').trim().slice(0, 80) || 'Parada de bus',
        tipo: ed.tipo, latitud: ed.latitud, longitud: ed.longitud, osm_id: ed.osm_id, oculta: true,
      };
      if (ed.id) await this.srv.actualizar(ed.id, { oculta: true });
      else await this.srv.crear(datos);
      await this.toast('Parada escondida del mapa');
      await this.trasCambio();
    } catch (e) {
      logError('JIRB: esconder parada', e);
      await this.toast('No se pudo esconder la parada', 'danger');
    } finally {
      this.guardando = false;
    }
  }

  async borrar(p?: ParadaMunicipal) {
    const id = p?.id ?? this.edicion?.id;
    if (!id) return;
    const fila = p ?? this.paradas.find(x => x.id === id);
    const alert = await this.alertCtrl.create({
      cssClass: 'buxi-alert',
      header: fila?.osm_id ? 'Quitar la corrección' : 'Borrar la parada',
      message: fila?.osm_id
        ? 'La parada vuelve a verse como la tiene OpenStreetMap.'
        : `"${fila?.nombre}" deja de verse en el mapa de los pasajeros.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel', cssClass: 'ba-cancel' },
        {
          text: fila?.osm_id ? 'Quitar' : 'Borrar', role: 'destructive', cssClass: 'ba-danger',
          handler: async () => {
            try {
              await this.srv.borrar(id);
              await this.toast(fila?.osm_id ? 'Corrección quitada' : 'Parada borrada');
              await this.trasCambio();
            } catch (e) {
              logError('JIRB: borrar parada municipal', e);
              await this.toast('No se pudo borrar', 'danger');
            }
          },
        },
      ],
    });
    await alert.present();
  }

  private async trasCambio() {
    this.cancelar();
    await this.cargar();
    this.dibujar();
  }

  async buscar() {
    const q = this.busqueda.trim();
    if (q.length < 2 || !this.map) return;
    this.buscando = true;
    try {
      const r = await this.features.searchPlaces(q);
      if (!r.length) { await this.toast('No encontré ese lugar', 'warning'); return; }
      this.map.flyTo({ center: [r[0].lng, r[0].lat], zoom: 16.5, duration: 900 });
    } catch {
      await this.toast('No se pudo buscar', 'danger');
    } finally {
      this.buscando = false;
    }
  }

  etiqueta(p: ParadaMunicipal): string {
    if (p.oculta) return 'Escondida';
    return p.osm_id ? 'Corrige OSM' : 'Nueva';
  }

  private async toast(message: string, color = 'success') {
    const t = await this.toastCtrl.create({ message, duration: 2200, color, position: 'top' });
    await t.present();
  }
}
