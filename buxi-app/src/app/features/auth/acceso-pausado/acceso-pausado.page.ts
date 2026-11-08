import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { SupabaseService } from '../../../core/services/supabase.service';
import { logError } from '../../../core/utils/log';

// A donde llega el personal de una empresa cuando su cuenta o su empresa están
// pausadas. La base ya les niega todo (get_my_role devuelve null); sin esta
// pantalla veían el panel vacío sin saber por qué.
@Component({
  selector: 'app-acceso-pausado',
  templateUrl: './acceso-pausado.page.html',
  standalone: false,
})
export class AccesoPausadoPage implements OnInit {
  motivo: 'empresa' | 'perfil' | 'cargando' = 'cargando';
  empresa: string | null = null;
  saliendo = false;

  constructor(private supabase: SupabaseService, private router: Router) {}

  async ngOnInit() {
    try {
      const a = await this.supabase.miAcceso();
      if (a && a.perfil_activo && a.empresa_activa) {
        // Ya está todo en orden (por ejemplo, la reactivaron): a su pantalla.
        const p = await this.supabase.getProfile();
        this.router.navigate(p ? this.supabase.homeRouteForRole(p.rol) : ['/auth/login'], { replaceUrl: true });
        return;
      }
      this.empresa = a?.empresa ?? null;
      this.motivo = a && !a.perfil_activo ? 'perfil' : 'empresa';
    } catch (e) {
      logError('acceso pausado: leer el estado', e);
      this.motivo = 'empresa';
    }
  }

  async salir() {
    this.saliendo = true;
    try { await this.supabase.signOut(); } catch (e) { logError('acceso pausado: cerrar sesión', e); }
    this.router.navigate(['/auth/login'], { replaceUrl: true });
  }
}
