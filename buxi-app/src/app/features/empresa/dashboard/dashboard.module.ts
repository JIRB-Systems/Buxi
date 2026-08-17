import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { RouterModule } from '@angular/router';
import { EmpresaDashboardPage } from './dashboard.page';
import { RutaFormComponent } from './ruta-form.component';
import { ReporteFormComponent } from './reporte-form.component';

@NgModule({
  declarations: [EmpresaDashboardPage, RutaFormComponent, ReporteFormComponent],
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    RouterModule.forChild([{ path: '', component: EmpresaDashboardPage }]),
  ],
})
export class EmpresaDashboardPageModule {}
