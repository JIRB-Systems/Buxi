import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { RouterModule } from '@angular/router';
import { AuthShellComponent } from '../../../shared/auth-shell/auth-shell.component';
import { AccesoPausadoPage } from './acceso-pausado.page';

@NgModule({
  declarations: [AccesoPausadoPage],
  imports: [
    CommonModule,
    IonicModule,
    AuthShellComponent,
    RouterModule.forChild([{ path: '', component: AccesoPausadoPage }]),
  ],
})
export class AccesoPausadoPageModule {}
