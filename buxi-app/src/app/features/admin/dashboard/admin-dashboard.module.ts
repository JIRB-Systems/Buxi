import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { RouterModule } from '@angular/router';
import { AdminDashboardPage } from './admin-dashboard.page';
import { AvisoFormComponent } from './aviso-form.component';
import { ResponderReporteComponent } from './responder-reporte.component';

@NgModule({
  declarations: [AdminDashboardPage, AvisoFormComponent, ResponderReporteComponent],
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    RouterModule.forChild([{ path: '', component: AdminDashboardPage }]),
  ],
})
export class AdminDashboardPageModule {}
