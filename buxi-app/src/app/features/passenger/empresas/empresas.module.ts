import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { RouterModule } from '@angular/router';
import { EmpresasPage } from './empresas.page';

@NgModule({
  declarations: [EmpresasPage],
  imports: [
    CommonModule,
    IonicModule,
    RouterModule.forChild([{ path: '', component: EmpresasPage }]),
  ],
})
export class EmpresasPageModule {}
