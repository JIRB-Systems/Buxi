import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AlertController, LoadingController, ToastController } from '@ionic/angular';
import { SupabaseService } from '../../../core/services/supabase.service';
import { FeaturesService } from '../../../core/services/features.service';
import { UserProfile } from '../../../core/models/user-profile.model';

@Component({
  selector: 'app-profile',
  templateUrl: './profile.page.html',
  styleUrls: ['./profile.page.scss'],
  standalone: false,
})
export class ProfilePage implements OnInit {
  profile: UserProfile | null = null;
  profileForm: FormGroup;
  loading = true;
  editing = false;
  darkMode = false;
  notificationsEnabled = true;

  provincias = [
    'San José', 'Alajuela', 'Cartago', 'Heredia',
    'Guanacaste', 'Puntarenas', 'Limón',
  ];

  constructor(
    private fb: FormBuilder,
    private supabase: SupabaseService,
    private features: FeaturesService,
    private router: Router,
    private alertCtrl: AlertController,
    private loadingCtrl: LoadingController,
    private toastCtrl: ToastController,
  ) {
    this.profileForm = this.fb.group({
      nombre_completo: ['', [Validators.required, Validators.minLength(3)]],
      telefono: [''],
      provincia: [''],
    });
  }

  async ngOnInit() {
    try {
      this.profile = await this.supabase.getProfile();
      if (this.profile) {
        this.profileForm.patchValue({
          nombre_completo: this.profile.nombre_completo,
          telefono: this.profile.telefono || '',
          provincia: this.profile.provincia || '',
        });
        const prefs = await this.features.getPreferences(this.profile.id);
        if (prefs) {
          this.darkMode = prefs.dark_mode;
          this.notificationsEnabled = prefs.notifications_enabled;
          this.applyDarkMode(prefs.dark_mode);
        }
      }
    } catch {} finally {
      this.loading = false;
    }
  }

  toggleEdit() { this.editing = !this.editing; }

  async onSave() {
    if (this.profileForm.invalid) { this.profileForm.markAllAsTouched(); return; }
    const loading = await this.loadingCtrl.create({ message: 'Guardando...' });
    await loading.present();
    try {
      this.profile = await this.supabase.updateProfile(this.profileForm.value);
      this.editing = false;
      this.showToast('Perfil actualizado');
    } catch { this.showToast('Error al guardar', 'danger'); }
    finally { await loading.dismiss(); }
  }

  async toggleDarkMode() {
    this.darkMode = !this.darkMode;
    this.applyDarkMode(this.darkMode);
    if (this.profile) {
      await this.features.savePreferences(this.profile.id, { dark_mode: this.darkMode });
    }
  }

  async toggleNotifications() {
    this.notificationsEnabled = !this.notificationsEnabled;
    if (this.profile) {
      await this.features.savePreferences(this.profile.id, { notifications_enabled: this.notificationsEnabled });
    }
    this.showToast(this.notificationsEnabled ? 'Notificaciones activadas' : 'Notificaciones desactivadas');
  }

  private applyDarkMode(enabled: boolean) {
    document.body.classList.toggle('dark', enabled);
  }

  async onLogout() {
    const alert = await this.alertCtrl.create({
      header: 'Cerrar sesión',
      message: '¿Estás seguro?',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Cerrar sesión', handler: async () => {
          await this.supabase.signOut();
          this.router.navigate(['/auth/login'], { replaceUrl: true });
        }},
      ],
    });
    await alert.present();
  }

  private async showToast(msg: string, color = 'success') {
    const t = await this.toastCtrl.create({ message: msg, duration: 2000, color, position: 'top' });
    await t.present();
  }
}
