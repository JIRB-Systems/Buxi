import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { LoadingController, ToastController } from '@ionic/angular';
import { createClient } from '@supabase/supabase-js';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-empresa-request',
  templateUrl: './empresa-request.page.html',
  styleUrls: ['./empresa-request.page.scss'],
  standalone: false,
})
export class EmpresaRequestPage {
  form: FormGroup;
  submitted = false;

  constructor(
    private fb: FormBuilder,
    private router: Router,
    private loadingCtrl: LoadingController,
    private toastCtrl: ToastController,
  ) {
    this.form = this.fb.group({
      nombre_empresa: ['', [Validators.required]],
      cedula_juridica: [''],
      nombre_contacto: ['', [Validators.required]],
      email: ['', [Validators.required, Validators.email]],
      telefono: ['', [Validators.required]],
      mensaje: [''],
    });
  }

  async onSubmit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const loading = await this.loadingCtrl.create({ message: 'Enviando solicitud...' });
    await loading.present();

    try {
      const supabase = createClient(environment.supabaseUrl, environment.supabaseAnonKey);
      const { error } = await supabase.from('solicitudes_empresa').insert(this.form.value);
      if (error) throw error;
      this.submitted = true;
    } catch {
      const toast = await this.toastCtrl.create({
        message: 'Error al enviar. Intenta de nuevo.',
        duration: 3000, color: 'danger', position: 'top',
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
