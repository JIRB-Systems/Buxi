import { AfterViewInit, Component, ElementRef, NgZone, OnDestroy, ViewChild } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { LoadingController, ToastController } from '@ionic/angular';
import { environment } from '../../../../environments/environment';

// Lo mínimo de la API de Cloudflare Turnstile que se usa acá.
interface Turnstile {
  render(el: HTMLElement, opciones: Record<string, unknown>): string;
  reset(id?: string): void;
  remove(id?: string): void;
}

declare global {
  interface Window { turnstile?: Turnstile; }
}

const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const LOGO_MAX = 2 * 1024 * 1024;
const LOGO_TIPOS = ['image/png', 'image/jpeg', 'image/webp'];

// El formulario va a la función solicitud-empresa y no directo a la tabla: la
// función es la que aplica el captcha, el límite por IP y la validación. Ver
// supabase/functions/solicitud-empresa/index.ts.
@Component({
  selector: 'app-empresa-request',
  templateUrl: './empresa-request.page.html',
  styleUrls: ['./empresa-request.page.scss'],
  standalone: false,
})
export class EmpresaRequestPage implements AfterViewInit, OnDestroy {
  @ViewChild('captcha') captchaEl?: ElementRef<HTMLElement>;

  form: FormGroup;
  submitted = false;
  enviando = false;
  logoFile: File | null = null;
  logoPreview: string | null = null;
  logoError: string | null = null;

  // Error que devolvió el servidor para un campo puntual.
  errorServidor: { campo: string; error: string } | null = null;

  // Trampa para bots: un campo invisible que una persona nunca llena.
  trampa = '';

  readonly usaCaptcha = !!environment.turnstileSiteKey;
  captchaToken: string | null = null;
  captchaError = false;
  private captchaId: string | null = null;

  // Cuánto estuvo abierto el formulario. performance.now() y no la hora:
  // no depende de que el reloj del teléfono esté bien puesto.
  private readonly abiertoEn = performance.now();

  constructor(
    private fb: FormBuilder,
    private router: Router,
    private loadingCtrl: LoadingController,
    private toastCtrl: ToastController,
    private zone: NgZone,
  ) {
    this.form = this.fb.group({
      nombre_empresa: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(120)]],
      cedula_juridica: ['', [Validators.maxLength(20), Validators.pattern(/^[\d-]*$/)]],
      nombre_contacto: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(100)]],
      email: ['', [Validators.required, Validators.email, Validators.maxLength(254)]],
      telefono: ['', [Validators.required, Validators.pattern(/^[+\d\s()-]{8,25}$/)]],
      mensaje: ['', [Validators.maxLength(1000)]],
    });
    // Cuando la persona corrige el campo, el error del servidor se va.
    this.form.valueChanges.subscribe(() => { this.errorServidor = null; });
  }

  ngAfterViewInit() {
    if (this.usaCaptcha) this.cargarCaptcha();
  }

  ngOnDestroy() {
    if (this.captchaId && window.turnstile) window.turnstile.remove(this.captchaId);
  }

  // ---- Captcha ----
  private cargarCaptcha() {
    if (window.turnstile) { this.dibujarCaptcha(); return; }
    let script = document.querySelector<HTMLScriptElement>(`script[src="${TURNSTILE_SCRIPT}"]`);
    if (!script) {
      script = document.createElement('script');
      script.src = TURNSTILE_SCRIPT;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
    script.addEventListener('load', () => this.dibujarCaptcha());
    script.addEventListener('error', () => this.zone.run(() => { this.captchaError = true; }));
  }

  private dibujarCaptcha() {
    const el = this.captchaEl?.nativeElement;
    if (!el || !window.turnstile || this.captchaId) return;
    this.captchaId = window.turnstile.render(el, {
      sitekey: environment.turnstileSiteKey,
      theme: 'dark',
      language: 'es',
      // Los callbacks llegan desde fuera de Angular.
      callback: (token: string) => this.zone.run(() => { this.captchaToken = token; this.captchaError = false; }),
      'expired-callback': () => this.zone.run(() => { this.captchaToken = null; }),
      'error-callback': () => this.zone.run(() => { this.captchaToken = null; this.captchaError = true; }),
    });
  }

  // Un token sirve una sola vez: después de un intento, se pide otro.
  private reiniciarCaptcha() {
    this.captchaToken = null;
    if (this.captchaId && window.turnstile) window.turnstile.reset(this.captchaId);
  }

  get puedeEnviar(): boolean {
    return !this.enviando && (!this.usaCaptcha || !!this.captchaToken);
  }

  // ---- Logo ----
  onLogoSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const archivo = input.files?.[0];
    input.value = '';
    if (!archivo) return;
    this.logoError = null;
    if (!LOGO_TIPOS.includes(archivo.type)) {
      this.logoError = 'El logo tiene que ser PNG, JPG o WebP.';
      return;
    }
    if (archivo.size > LOGO_MAX) {
      this.logoError = 'El logo puede pesar hasta 2 MB.';
      return;
    }
    this.logoFile = archivo;
    const reader = new FileReader();
    reader.onload = (e) => { this.logoPreview = e.target?.result as string; };
    reader.readAsDataURL(archivo);
  }

  removeLogo() {
    this.logoFile = null;
    this.logoPreview = null;
    this.logoError = null;
  }

  errorDe(campo: string): string | null {
    return this.errorServidor?.campo === campo ? this.errorServidor.error : null;
  }

  // ---- Envío ----
  async onSubmit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    if (!this.puedeEnviar) return;

    this.enviando = true;
    this.errorServidor = null;
    const loading = await this.loadingCtrl.create({ message: 'Enviando solicitud...' });
    await loading.present();

    const datos = new FormData();
    for (const [campo, valor] of Object.entries(this.form.value)) {
      datos.append(campo, String(valor ?? '').trim());
    }
    datos.append('sitio_web', this.trampa);
    datos.append('tiempo_ms', String(Math.round(performance.now() - this.abiertoEn)));
    if (this.captchaToken) datos.append('cf-turnstile-response', this.captchaToken);
    if (this.logoFile) datos.append('logo', this.logoFile);

    try {
      const res = await fetch(`${environment.supabaseUrl}/functions/v1/solicitud-empresa`, {
        method: 'POST',
        body: datos,
      });
      const cuerpo = await res.json().catch(() => ({}));

      if (res.ok && cuerpo?.ok) {
        this.submitted = true;
        return;
      }

      const mensaje = cuerpo?.error || 'No pudimos enviar la solicitud. Intentá de nuevo.';
      if (cuerpo?.campo && cuerpo.campo !== 'captcha') {
        this.errorServidor = { campo: cuerpo.campo, error: mensaje };
      }
      await this.aviso(mensaje);
      this.reiniciarCaptcha();
    } catch {
      await this.aviso('No hay conexión. Revisá tu internet e intentá de nuevo.');
      this.reiniciarCaptcha();
    } finally {
      this.enviando = false;
      await loading.dismiss();
    }
  }

  private async aviso(message: string) {
    const toast = await this.toastCtrl.create({ message, duration: 4000, color: 'danger', position: 'top' });
    await toast.present();
  }

  backToLogin() {
    this.router.navigate(['/auth/login'], { replaceUrl: true });
  }
}
