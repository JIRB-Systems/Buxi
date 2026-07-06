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
  private origenTimeout: any;

  destinoQuery = '';
  destinoSuggestions: PlaceSuggestion[] = [];
  destinoSelected: PlaceSuggestion | null = null;
  private destinoTimeout: any;

  constructor(private modalCtrl: ModalController, private features: FeaturesService) {}

  onOrigenInput() {
    this.origenSelected = null;
    clearTimeout(this.origenTimeout);
    this.origenTimeout = setTimeout(async () => {
      this.origenSuggestions = await this.features.searchPlaces(this.origenQuery);
    }, 350);
  }

  onDestinoInput() {
    this.destinoSelected = null;
    clearTimeout(this.destinoTimeout);
    this.destinoTimeout = setTimeout(async () => {
      this.destinoSuggestions = await this.features.searchPlaces(this.destinoQuery);
    }, 350);
  }

  pickOrigen(s: PlaceSuggestion) {
    this.origenSelected = s;
    this.origenQuery = s.label;
    this.origenSuggestions = [];
  }

  pickDestino(s: PlaceSuggestion) {
    this.destinoSelected = s;
    this.destinoQuery = s.label;
    this.destinoSuggestions = [];
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
