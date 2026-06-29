import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { LoadingController, ToastController } from '@ionic/angular';
import { SupabaseService } from '../../../core/services/supabase.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  standalone: false,
})
export class LoginPage {
  loginForm: FormGroup;
  showPassword = false;
  rememberMe = false;

  constructor(
    private fb: FormBuilder,
    private supabase: SupabaseService,
    private router: Router,
    private loadingCtrl: LoadingController,
    private toastCtrl: ToastController,
  ) {
    this.loginForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
    });
  }

  togglePassword() {
    this.showPassword = !this.showPassword;
  }

  async onLogin() {
    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      return;
    }

    const loading = await this.loadingCtrl.create({ message: 'Iniciando sesión...' });
    await loading.present();

    try {
      const { email, password } = this.loginForm.value;
      await this.supabase.signIn(email, password);

      const profile = await this.supabase.getProfile();
      if (profile) {
        this.navigateByRole(profile.rol);
      } else {
        this.router.navigate(['/passenger/home'], { replaceUrl: true });
      }
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

  async onGoogleLogin() {
    try {
      await this.supabase.signInWithGoogle();
    } catch (error: any) {
      const toast = await this.toastCtrl.create({
        message: 'Error al iniciar con Google',
        duration: 3000,
        color: 'danger',
        position: 'top',
      });
      await toast.present();
    }
  }

  async onFacebookLogin() {
    try {
      await this.supabase.signInWithFacebook();
    } catch (error: any) {
      const toast = await this.toastCtrl.create({
        message: 'Error al iniciar con Facebook',
        duration: 3000,
        color: 'danger',
        position: 'top',
      });
      await toast.present();
    }
  }

  private navigateByRole(rol: string) {
    switch (rol) {
      case 'chofer':
        this.router.navigate(['/chofer/home'], { replaceUrl: true });
        break;
      case 'admin_empresa':
        this.router.navigate(['/empresa/dashboard'], { replaceUrl: true });
        break;
      case 'admin_jirb':
        this.router.navigate(['/admin/dashboard'], { replaceUrl: true });
        break;
      default:
        this.router.navigate(['/passenger/home'], { replaceUrl: true });
    }
  }

  private getErrorMessage(error: any): string {
    if (error?.message?.includes('Invalid login credentials')) {
      return 'Correo o contraseña incorrectos';
    }
    if (error?.message?.includes('Email not confirmed')) {
      return 'Debes confirmar tu correo electrónico';
    }
    return 'Error al iniciar sesión. Intenta de nuevo.';
  }
}
