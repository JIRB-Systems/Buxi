import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController } from '@ionic/angular';
import { SupabaseService } from '../../../core/services/supabase.service';
import { UserProfile } from '../../../core/models/user-profile.model';

@Component({
  selector: 'app-passenger-home',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  standalone: false,
})
export class PassengerHomePage implements OnInit {
  profile: UserProfile | null = null;
  loading = true;

  constructor(
    private supabase: SupabaseService,
    private router: Router,
    private alertCtrl: AlertController,
  ) {}

  async ngOnInit() {
    try {
      this.profile = await this.supabase.getProfile();
    } catch {
      // Profile might not exist yet for OAuth users
    } finally {
      this.loading = false;
    }
  }

  async onLogout() {
    const alert = await this.alertCtrl.create({
      header: 'Cerrar sesión',
      message: '¿Estás seguro que deseas cerrar sesión?',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Cerrar sesión',
          role: 'confirm',
          handler: async () => {
            await this.supabase.signOut();
            this.router.navigate(['/auth/login'], { replaceUrl: true });
          },
        },
      ],
    });
    await alert.present();
  }
}
