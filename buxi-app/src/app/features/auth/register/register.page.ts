import { Component } from '@angular/core';
import { AbstractControl, FormBuilder, FormGroup, ValidationErrors, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { LoadingController, ToastController } from '@ionic/angular';
import { SupabaseService } from '../../../core/services/supabase.service';

@Component({
  selector: 'app-register',
  templateUrl: './register.page.html',
  styleUrls: ['./register.page.scss'],
  standalone: false,
})
export class RegisterPage {
  registerForm: FormGroup;
  showPassword = false;
  showConfirmPassword = false;
  acceptTerms = false;

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
      telefono: [''],
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
          message: 'Debes aceptar los términos y condiciones',
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

      await this.supabase.signUp(email, password, {
        nombre_completo,
        telefono: telefono || undefined,
        provincia: provincia || undefined,
      });

      const toast = await this.toastCtrl.create({
        message: 'Cuenta creada exitosamente. Revisa tu correo para confirmar.',
        duration: 4000,
        color: 'success',
        position: 'top',
      });
      await toast.present();

      this.router.navigate(['/auth/login'], { replaceUrl: true });
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

  private getErrorMessage(error: any): string {
    if (error?.message?.includes('already registered')) {
      return 'Este correo ya está registrado';
    }
    return 'Error al crear la cuenta. Intenta de nuevo.';
  }
}
