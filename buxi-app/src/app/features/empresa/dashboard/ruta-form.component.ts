import { Component } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { FeaturesService } from '../../../core/services/features.service';

interface PlaceSuggestion { label: string; lat: number; lng: number; }

@Component({
  selector: 'app-ruta-form',
  templateUrl: './ruta-form.component.html',
  styleUrls: ['./ruta-form.component.scss'],
  standalone: false,
})
export class RutaFormComponent {
  nombre = '';
  color = '#00c853';

  origenQuery = '';
  origenSuggestions: PlaceSuggestion[] = [];
  origenSelected: PlaceSuggestion | null = null;
  origenSearching = false;
  origenError = false;
  private origenTimeout: any;

  destinoQuery = '';
  destinoSuggestions: PlaceSuggestion[] = [];
  destinoSelected: PlaceSuggestion | null = null;
  destinoSearching = false;
  destinoError = false;
  private destinoTimeout: any;

  constructor(private modalCtrl: ModalController, private features: FeaturesService) {}

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

  pickOrigen(s: PlaceSuggestion) {
    this.origenSelected = s;
    this.origenQuery = s.label;
    this.origenSuggestions = [];
    this.origenError = false;
  }

  pickDestino(s: PlaceSuggestion) {
    this.destinoSelected = s;
    this.destinoQuery = s.label;
    this.destinoSuggestions = [];
    this.destinoError = false;
  }

  get canCreate(): boolean {
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
      origen: this.origenSelected,
      destino: this.destinoSelected,
    }, 'confirm');
  }
}
