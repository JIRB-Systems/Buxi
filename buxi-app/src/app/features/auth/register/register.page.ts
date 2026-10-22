import { Component, OnDestroy } from '@angular/core';
import { AbstractControl, FormBuilder, FormGroup, ValidationErrors, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { LoadingController, ToastController } from '@ionic/angular';
import { SupabaseService } from '../../../core/services/supabase.service';
import { normalizarTelefono } from '../../../core/utils/telefono';

// Opcional: vacío vale; si escribió algo, tiene que ser un número de CR.
function telefonoCR(control: AbstractControl): ValidationErrors | null {
  const v = (control.value || '').trim();
  return !v || normalizarTelefono(v) ? null : { telefono: true };
}

@Component({
  selector: 'app-register',
  templateUrl: './register.page.html',
  styleUrls: ['./register.page.scss'],
  standalone: false,
})
export class RegisterPage implements OnDestroy {
  registerForm: FormGroup;
  showPassword = false;
  showConfirmPassword = false;
  acceptTerms = false;

  // Después de crear la cuenta: a qué correo mandamos el enlace y cuántos
  // segundos faltan para poder pedirlo de nuevo.
  enviadoA: string | null = null;
  reenvioEn = 0;
  private reloj: any;

  provincias = [
    'San José', 'Alajuela', 'Cartago', 'Heredia',
    'Guanacaste', 'Puntarenas', 'Limón',
  ];

  constructor(
    private fb: FormBuilder,
    private supabase: SupabaseService,
    private router: Router,
    private loadingCtrl: LoadingController,
    private toastCtrl: ToastController,
  ) {
    this.registerForm = this.fb.group({
      nombre_completo: ['', [Validators.required, Validators.minLength(3)]],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      confirmPassword: ['', [Validators.required]],
      telefono: ['', [telefonoCR]],
      provincia: [''],
    }, { validators: this.passwordMatchValidator });
  }

  private passwordMatchValidator(control: AbstractControl): ValidationErrors | null {
    const password = control.get('password')?.value;
    const confirmPassword = control.get('confirmPassword')?.value;
    if (password && confirmPassword && password !== confirmPassword) {
      return { passwordMismatch: true };
    }
    return null;
  }

  togglePassword() {
    this.showPassword = !this.showPassword;
  }

  toggleConfirmPassword() {
    this.showConfirmPassword = !this.showConfirmPassword;
  }

  async onRegister() {
    if (this.registerForm.invalid || !this.acceptTerms) {
      this.registerForm.markAllAsTouched();
      if (!this.acceptTerms) {
        const toast = await this.toastCtrl.create({
          message: 'Tenés que aceptar los términos y condiciones',
          duration: 3000,
          color: 'warning',
          position: 'top',
        });
        await toast.present();
      }
      return;
    }

    const loading = await this.loadingCtrl.create({ message: 'Creando cuenta...' });
    await loading.present();

    try {
      const { nombre_completo, email, password, telefono, provincia } = this.registerForm.value;

      const data = await this.supabase.signUp(email.trim(), password, {
        nombre_completo,
        telefono: normalizarTelefono(telefono) || undefined,
        provincia: provincia || undefined,
      });

      // Con un correo que ya tiene cuenta, Supabase no da error (así nadie
      // puede averiguar qué correos están registrados): devuelve un usuario
      // sin identidades y no manda nada.
      if (data.user && !data.user.identities?.length) {
        throw new Error('already registered');
      }
      // Sin confirmación de correo activada, la cuenta ya viene con sesión.
      if (data.session) {
        this.router.navigate(['/'], { replaceUrl: true });
        return;
      }
      this.enviadoA = email.trim();
      this.esperarReenvio();
    } catch (error: any) {
      const toast = await this.toastCtrl.create({
        message: this.getErrorMessage(error),
        duration: 3000,
        color: 'danger',
        position: 'top',
      });
      await toast.present();
    } finally {
      await loading.dismiss();
    }
  }

  // ---- "Revisá tu correo" ----
  async reenviar() {
    if (!this.enviadoA || this.reenvioEn > 0) return;
    try {
      await this.supabase.reenviarConfirmacion(this.enviadoA);
      await this.aviso('Te lo mandamos de nuevo', 'success');
      this.esperarReenvio();
    } catch (e: any) {
      await this.aviso(/rate|seconds/i.test(e?.message || '')
        ? 'Esperá un momento antes de pedirlo otra vez'
        : 'No se pudo reenviar. Probá de nuevo.', 'danger');
    }
  }

  // Supabase no deja pedir otro correo antes de un minuto.
  private esperarReenvio() {
    clearInterval(this.reloj);
    this.reenvioEn = 60;
    this.reloj = setInterval(() => {
      this.reenvioEn--;
      if (this.reenvioEn <= 0) clearInterval(this.reloj);
    }, 1000);
  }

  ngOnDestroy() {
    clearInterval(this.reloj);
  }

  irALogin() {
    this.router.navigate(['/auth/login'], { replaceUrl: true });
  }

  private async aviso(message: string, color: string) {
    const toast = await this.toastCtrl.create({ message, duration: 3000, color, position: 'top' });
    await toast.present();
  }

  private getErrorMessage(error: any): string {
    if (error?.message?.includes('already registered')) {
      return 'Este correo ya tiene una cuenta. Iniciá sesión o recuperá tu contraseña.';
    }
    return 'Error al crear la cuenta. Intentá de nuevo.';
  }
}
