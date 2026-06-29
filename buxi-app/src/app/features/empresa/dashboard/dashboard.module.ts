import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { RouterModule } from '@angular/router';
import { EmpresaDashboardPage } from './dashboard.page';

@NgModule({
  declarations: [EmpresaDashboardPage],
  imports: [
    CommonModule,
    IonicModule,
    RouterModule.forChild([{ path: '', component: EmpresaDashboardPage }]),
  ],
})
export class EmpresaDashboardPageModule {}
