import { Component, Input, OnInit } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { FeaturesService } from '../../../core/services/features.service';
import { AdminEmpresaService } from '../../../core/services/admin-empresa.service';
import { Ruta, TarifaAresep } from '../../../core/models/transport.model';
import { nombreCortoLugar } from '../../../core/utils/lugar';
import { tarifaAdultoMayorTexto, tituloAresep } from '../../../core/utils/aresep';
import { logError } from '../../../core/utils/log';

interface PlaceSuggestion { label: string; lat: number; lng: number; }

@Component({
  selector: 'app-ruta-form',
  templateUrl: './ruta-form.component.html',
  styleUrls: ['./ruta-form.component.scss'],
  standalone: false,
})
export class RutaFormComponent implements OnInit {
  // Si viene una ruta, es edición: nombre/color/precio se pueden tocar,
  // pero origen y destino no — cambiarlos significaría recalcular todo
  // el recorrido, y para eso ya existe el editor de trazado en el mapa.
  @Input() ruta?: Ruta;

  nombre = '';
  color = '#00c853';
  precio: number | null = null;
  codigoRuta = '';

  // Tramo de ARESEP enlazado. Con tramo, el precio lo fija la base (trigger
  // rutas_precio_aresep) y se actualiza solo cuando ARESEP lo cambia.
  tarifa: TarifaAresep | null = null;
  tarifaQuery = '';
  tarifaResultados: TarifaAresep[] = [];
  tarifaBuscando = false;
  tarifaError = false;
  private tarifaTimeout: any;
  readonly tituloAresep = tituloAresep;
  readonly tarifaAM = tarifaAdultoMayorTexto;

  origenQuery = '';
  origenSuggestions: PlaceSuggestion[] = [];
  origenSelected: PlaceSuggestion | null = null;
  origenSearching = false;
  origenError = false;
  private origenTimeout: any;

  origenAdding = false;

  destinoQuery = '';
  destinoSuggestions: PlaceSuggestion[] = [];
  destinoSelected: PlaceSuggestion | null = null;
  destinoSearching = false;
  destinoError = false;
  destinoAdding = false;
  private destinoTimeout: any;

  constructor(
    private modalCtrl: ModalController,
    private features: FeaturesService,
    private admin: AdminEmpresaService,
  ) {}

  get isEdit(): boolean {
    return !!this.ruta;
  }

  async ngOnInit() {
    if (this.ruta) {
      this.nombre = this.ruta.nombre;
      this.color = this.ruta.color;
      this.precio = this.ruta.precio;
      this.codigoRuta = this.ruta.codigo_ruta || '';
      if (this.ruta.aresep_fraccionamiento) {
        try {
          this.tarifa = await this.admin.getTarifaAresep(this.ruta.aresep_fraccionamiento);
        } catch (e) {
          logError('leer la tarifa ARESEP de la ruta', e);
        }
      }
    }
  }

  onTarifaInput() {
    this.tarifaError = false;
    clearTimeout(this.tarifaTimeout);
    if (this.tarifaQuery.trim().length < 2) { this.tarifaResultados = []; return; }
    this.tarifaBuscando = true;
    this.tarifaTimeout = setTimeout(async () => {
      try {
        this.tarifaResultados = await this.admin.buscarTarifasAresep(this.tarifaQuery);
        this.tarifaError = this.tarifaResultados.length === 0;
      } catch (e) {
        logError('buscar tarifas ARESEP', e);
        this.tarifaError = true;
      } finally {
        this.tarifaBuscando = false;
      }
    }, 300);
  }

  elegirTarifa(t: TarifaAresep) {
    this.tarifa = t;
    this.precio = t.tarifa_regular;
    this.codigoRuta = t.codigo_ruta;
    if (!this.nombre.trim()) this.nombre = tituloAresep(t.nombre_fraccionamiento);
    this.tarifaResultados = [];
    this.tarifaQuery = '';
  }

  // Sin tramo, el precio vuelve a ser manual (se conserva el último).
  quitarTarifa() {
    this.tarifa = null;
  }

  onOrigenInput() {
    this.origenSelected = null;
    this.origenError = false;
    clearTimeout(this.origenTimeout);
    if (this.origenQuery.trim().length < 2) { this.origenSuggestions = []; return; }
    this.origenSearching = true;
    this.origenTimeout = setTimeout(async () => {
      try {
        this.origenSuggestions = await this.features.searchPlaces(this.origenQuery);
        this.origenError = this.origenSuggestions.length === 0;
      } catch {
        this.origenError = true;
      } finally {
        this.origenSearching = false;
      }
    }, 350);
  }

  onDestinoInput() {
    this.destinoSelected = null;
    this.destinoError = false;
    clearTimeout(this.destinoTimeout);
    if (this.destinoQuery.trim().length < 2) { this.destinoSuggestions = []; return; }
    this.destinoSearching = true;
    this.destinoTimeout = setTimeout(async () => {
      try {
        this.destinoSuggestions = await this.features.searchPlaces(this.destinoQuery);
        this.destinoError = this.destinoSuggestions.length === 0;
      } catch {
        this.destinoError = true;
      } finally {
        this.destinoSearching = false;
      }
    }, 350);
  }

  // La lista muestra la dirección entera, que es lo que distingue dos lugares
  // con el mismo nombre; lo que se GUARDA es el nombre corto. Si no, la parada
  // queda llamándose "Terminal de Buses de Liberia, Calle 12, Los Ángeles,
  // Liberia, Guanacaste, 50101, Costa Rica" en todas las pantallas.
  pickOrigen(s: PlaceSuggestion) {
    this.origenSelected = { ...s, label: nombreCortoLugar(s.label) };
    this.origenQuery = this.origenSelected.label;
    this.origenSuggestions = [];
    this.origenError = false;
  }

  pickDestino(s: PlaceSuggestion) {
    this.destinoSelected = { ...s, label: nombreCortoLugar(s.label) };
    this.destinoQuery = this.destinoSelected.label;
    this.destinoSuggestions = [];
    this.destinoError = false;
  }

  async addOrigenAsNewPlace() {
    const nombre = this.origenQuery.trim();
    if (!nombre) return;
    this.origenAdding = true;
    try {
      const point = await this.features.geocode(nombre);
      if (!point) { this.origenError = true; return; }
      await this.features.addCustomPlace(nombre, point.lat, point.lng);
      this.pickOrigen({ label: nombre, lat: point.lat, lng: point.lng });
    } catch {
      this.origenError = true;
    } finally {
      this.origenAdding = false;
    }
  }

  async addDestinoAsNewPlace() {
    const nombre = this.destinoQuery.trim();
    if (!nombre) return;
    this.destinoAdding = true;
    try {
      const point = await this.features.geocode(nombre);
      if (!point) { this.destinoError = true; return; }
      await this.features.addCustomPlace(nombre, point.lat, point.lng);
      this.pickDestino({ label: nombre, lat: point.lat, lng: point.lng });
    } catch {
      this.destinoError = true;
    } finally {
      this.destinoAdding = false;
    }
  }

  get canCreate(): boolean {
    if (this.isEdit) return !!this.nombre.trim();
    return !!this.nombre.trim() && !!this.origenSelected && !!this.destinoSelected;
  }

  cancel() {
    this.modalCtrl.dismiss(null, 'cancel');
  }

  create() {
    if (!this.canCreate) return;
    this.modalCtrl.dismiss({
      nombre: this.nombre.trim(),
      color: this.color,
      precio: this.tarifa ? this.tarifa.tarifa_regular : this.precio,
      codigo_ruta: this.tarifa ? this.tarifa.codigo_ruta : (this.codigoRuta.trim() || null),
      aresep_fraccionamiento: this.tarifa?.codigo_fraccionamiento ?? null,
      origen: this.origenSelected,
      destino: this.destinoSelected,
    }, 'confirm');
  }
}
