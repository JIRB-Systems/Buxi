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
  logoFile: File | null = null;
  logoPreview: string | null = null;

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

  onLogoSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      this.logoFile = input.files[0];
      const reader = new FileReader();
      reader.onload = (e) => { this.logoPreview = e.target?.result as string; };
      reader.readAsDataURL(this.logoFile);
    }
  }

  removeLogo() {
    this.logoFile = null;
    this.logoPreview = null;
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
      let logoUrl = null;

      if (this.logoFile) {
        const ext = this.logoFile.name.split('.').pop();
        const fileName = `solicitudes/${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from('logos')
          .upload(fileName, this.logoFile, { contentType: this.logoFile.type });

        if (!uploadError) {
          const { data: urlData } = supabase.storage.from('logos').getPublicUrl(fileName);
          logoUrl = urlData.publicUrl;
        }
      }

      const insertData = { ...this.form.value, logo_url: logoUrl };
      const { error } = await supabase.from('solicitudes_empresa').insert(insertData);
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
