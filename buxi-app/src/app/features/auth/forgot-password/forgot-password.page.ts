import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { LoadingController, ToastController } from '@ionic/angular';
import { SupabaseService } from '../../../core/services/supabase.service';

@Component({
  selector: 'app-forgot-password',
  templateUrl: './forgot-password.page.html',
  styleUrls: ['./forgot-password.page.scss'],
  standalone: false,
})
export class ForgotPasswordPage {
  forgotForm: FormGroup;
  emailSent = false;

  constructor(
    private fb: FormBuilder,
    private supabase: SupabaseService,
    private router: Router,
    private loadingCtrl: LoadingController,
    private toastCtrl: ToastController,
  ) {
    this.forgotForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
    });
  }

  async onSubmit() {
    if (this.forgotForm.invalid) {
      this.forgotForm.markAllAsTouched();
      return;
    }

    const loading = await this.loadingCtrl.create({ message: 'Enviando enlace...' });
    await loading.present();

    try {
      await this.supabase.resetPassword(this.forgotForm.value.email);
      this.emailSent = true;
    } catch (error: any) {
      const toast = await this.toastCtrl.create({
        message: 'Error al enviar el enlace. Intenta de nuevo.',
        duration: 3000,
        color: 'danger',
        position: 'top',
      });
      await toast.present();
    } finally {
      await loading.dismiss();
    }
  }

  backToLogin() {
    this.router.navigate(['/auth/login'], { replaceUrl: true });
  }
}
