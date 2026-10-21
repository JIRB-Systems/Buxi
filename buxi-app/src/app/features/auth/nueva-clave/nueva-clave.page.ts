import { Component, OnInit } from '@angular/core';
import { AbstractControl, FormBuilder, FormGroup, ValidationErrors, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { LoadingController, ToastController } from '@ionic/angular';
import { SupabaseService } from '../../../core/services/supabase.service';
import { claveValida, REGLA_CLAVE } from '../../../core/utils/clave';
import { logError } from '../../../core/utils/log';

// Adonde llega el enlace del correo de "olvidé mi contraseña". El enlace ya
// inició sesión; acá se elige la contraseña nueva y recién después se entra.
//
// Sin sesión significa que el enlace venció o ya se usó (Supabase vuelve con
// #error_code=otp_expired): se ofrece pedir otro.
@Component({
  selector: 'app-nueva-clave',
  templateUrl: './nueva-clave.page.html',
  styleUrls: ['./nueva-clave.page.scss'],
  standalone: false,
})
export class NuevaClavePage implements OnInit {
  estado: 'cargando' | 'form' | 'vencido' | 'listo' = 'cargando';
  form: FormGroup;
  showPassword = false;
  readonly regla = REGLA_CLAVE;
  private destino: string[] = ['/passenger/map'];

  constructor(
    private fb: FormBuilder,
    private supabase: SupabaseService,
    private router: Router,
    private loadingCtrl: LoadingController,
    private toastCtrl: ToastController,
  ) {
    this.form = this.fb.group({
      password: ['', [Validators.required, Validators.maxLength(72), claveSegura]],
      confirmar: ['', [Validators.required]],
    }, { validators: coinciden });
  }

  async ngOnInit() {
    // getSession espera a que Supabase termine de leer el enlace de la URL.
    const session = await this.supabase.getSessionAsync();
    this.estado = session ? 'form' : 'vencido';
  }

  togglePassword() {
    this.showPassword = !this.showPassword;
  }

  campoMal(nombre: string): boolean {
    const c = this.form.get(nombre);
    return !!c && c.touched && c.invalid;
  }

  get noCoinciden(): boolean {
    return !!this.form.get('confirmar')?.touched && this.form.hasError('noCoinciden');
  }

  async onSubmit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const loading = await this.loadingCtrl.create({ message: 'Guardando...' });
    await loading.present();
    try {
      await this.supabase.actualizarClave(this.form.value.password);
      try {
        const profile = await this.supabase.getProfile();
        if (profile) this.destino = this.supabase.homeRouteForRole(profile.rol);
      } catch (e) {
        logError('NuevaClave: la clave se guardó pero el perfil no se pudo leer', e);
      }
      this.estado = 'listo';
    } catch (e: any) {
      await this.aviso(mensajeDeError(e));
    } finally {
      await loading.dismiss();
    }
  }

  entrar() {
    this.router.navigate(this.destino, { replaceUrl: true });
  }

  pedirOtro() {
    this.router.navigate(['/auth/forgot-password'], { replaceUrl: true });
  }

  private async aviso(message: string) {
    const toast = await this.toastCtrl.create({ message, duration: 4000, color: 'danger', position: 'top' });
    await toast.present();
  }
}

function claveSegura(c: AbstractControl): ValidationErrors | null {
  return !c.value || claveValida(c.value) ? null : { debil: true };
}

function coinciden(g: AbstractControl): ValidationErrors | null {
  return g.get('password')?.value === g.get('confirmar')?.value ? null : { noCoinciden: true };
}

function mensajeDeError(e: any): string {
  const codigo = e?.code || '';
  if (codigo === 'same_password') return 'Esa es tu contraseña actual. Elegí una distinta.';
  if (codigo === 'weak_password') return 'Esa contraseña es muy fácil de adivinar. Probá con otra.';
  if (codigo === 'session_expired' || codigo === 'session_not_found') {
    return 'El enlace venció. Pedí uno nuevo desde "¿Olvidaste tu contraseña?".';
  }
  return 'No pudimos guardar la contraseña. Intentá de nuevo.';
}
