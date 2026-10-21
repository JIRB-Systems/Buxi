import { Component, Input, OnInit } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { AdminJirbService } from '../../../core/services/admin-jirb.service';
import { Anuncio } from '../../../core/models/features.model';

// Lo mismo que acepta el balde `anuncios` en Storage (migración
// 20261021044746). Acá se avisa antes de subir, con un mensaje claro, en vez
// del error genérico que devolvería Storage.
const MEDIA_TIPOS = ['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/webm'];
const IMAGEN_MAX_MB = 5;
const VIDEO_MAX_MB = 25;

@Component({
  selector: 'app-anuncio-form',
  templateUrl: './anuncio-form.component.html',
  styleUrls: ['./anuncio-form.component.scss'],
  standalone: false,
})
export class AnuncioFormComponent implements OnInit {
  @Input() anuncio?: Anuncio;

  tipoEspacio: 'apertura' | 'lista' = 'apertura';
  titulo = '';
  descripcion = '';
  linkUrl = '';
  animacion: 'ninguna' | 'fade' | 'slide' | 'zoom' | 'pulso' = 'fade';
  fechaInicio = new Date().toISOString().slice(0, 10);
  fechaFin = '';

  mediaFile: File | null = null;
  mediaPreviewUrl: string | null = null;
  mediaTipo: 'imagen' | 'video' = 'imagen';
  existingMediaUrl: string | null = null;
  mediaError: string | null = null;

  uploading = false;

  constructor(private modalCtrl: ModalController, private admin: AdminJirbService) {}

  ngOnInit() {
    if (this.anuncio) {
      this.tipoEspacio = this.anuncio.tipo_espacio;
      this.titulo = this.anuncio.titulo;
      this.descripcion = this.anuncio.descripcion || '';
      this.linkUrl = this.anuncio.link_url || '';
      this.animacion = this.anuncio.animacion;
      this.fechaInicio = this.anuncio.fecha_inicio.slice(0, 10);
      this.fechaFin = this.anuncio.fecha_fin ? this.anuncio.fecha_fin.slice(0, 10) : '';
      this.mediaTipo = this.anuncio.media_tipo;
      this.existingMediaUrl = this.anuncio.media_url;
      this.mediaPreviewUrl = this.anuncio.media_url;
    }
  }

  get isEdit(): boolean {
    return !!this.anuncio;
  }

  get canSave(): boolean {
    return !!this.titulo.trim() && (!!this.mediaFile || !!this.existingMediaUrl);
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    this.mediaError = null;
    if (!MEDIA_TIPOS.includes(file.type)) {
      this.mediaError = 'El archivo tiene que ser JPG, PNG, WebP, MP4 o WebM.';
      return;
    }
    const esVideo = file.type.startsWith('video/');
    const maxMb = esVideo ? VIDEO_MAX_MB : IMAGEN_MAX_MB;
    if (file.size > maxMb * 1024 * 1024) {
      this.mediaError = `${esVideo ? 'El video' : 'La imagen'} puede pesar hasta ${maxMb} MB.`;
      return;
    }

    this.mediaFile = file;
    this.mediaTipo = file.type.startsWith('video/') ? 'video' : 'imagen';
    if (this.mediaPreviewUrl && this.mediaPreviewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(this.mediaPreviewUrl);
    }
    this.mediaPreviewUrl = URL.createObjectURL(file);
  }

  removeMedia() {
    this.mediaFile = null;
    this.existingMediaUrl = null;
    this.mediaPreviewUrl = null;
  }

  // La app fuerza --keyboard-offset: 0px en toda la ion-content (ver
  // global.scss), así que Ionic no achica el contenido cuando se abre el
  // teclado: el botón fijo del footer queda tapado detrás y no hay scroll
  // que lo revele. Cerramos el teclado apenas el usuario empieza a
  // scrollear para liberar esa parte de la pantalla.
  onFormScroll() {
    const active = document.activeElement as HTMLElement | null;
    if (active && active.tagName !== 'BODY' && typeof active.blur === 'function') {
      active.blur();
    }
  }

  // Los <input type="date"> nativos, cuando tienen foco, le roban la rueda
  // del mouse al navegador: en vez de scrollear la página cambian la fecha.
  // Desenfocar apenas se detecta la rueda evita que el input se quede con
  // el evento — el scroll de la página sigue de largo normalmente.
  blurTarget(event: Event) {
    (event.target as HTMLElement).blur();
  }

  cancel() {
    this.modalCtrl.dismiss(null, 'cancel');
  }

  async save() {
    if (!this.canSave || this.uploading) return;
    this.uploading = true;
    try {
      let mediaUrl = this.existingMediaUrl;
      if (this.mediaFile) {
        mediaUrl = await this.admin.uploadAnuncioMedia(this.mediaFile);
      }
      if (!mediaUrl) return;

      this.modalCtrl.dismiss({
        tipo_espacio: this.tipoEspacio,
        titulo: this.titulo.trim(),
        descripcion: this.descripcion.trim() || null,
        link_url: this.linkUrl.trim() || null,
        animacion: this.animacion,
        media_tipo: this.mediaTipo,
        media_url: mediaUrl,
        fecha_inicio: new Date(`${this.fechaInicio}T00:00:00`).toISOString(),
        fecha_fin: this.fechaFin ? new Date(`${this.fechaFin}T23:59:59`).toISOString() : null,
      }, 'confirm');
    } finally {
      this.uploading = false;
    }
  }
}
