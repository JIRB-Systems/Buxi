import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { IonicModule } from '@ionic/angular';

// Marco común de las pantallas sin sesión (entrar, crear cuenta, recuperar
// contraseña, solicitud de empresa).
//
// En el teléfono es una sola columna. En escritorio suma a la izquierda un
// panel de marca: antes, en una pantalla grande, estas páginas eran la
// columna del teléfono centrada en un lienzo vacío.
@Component({
  selector: 'app-auth-shell',
  templateUrl: './auth-shell.component.html',
  styleUrls: ['./auth-shell.component.scss'],
  standalone: true,
  imports: [CommonModule, RouterModule, IonicModule],
})
export class AuthShellComponent {
  // Ruta a la que vuelve la flecha. Sin valor no se muestra (pantalla de entrada).
  @Input() back: string | null = null;
}
