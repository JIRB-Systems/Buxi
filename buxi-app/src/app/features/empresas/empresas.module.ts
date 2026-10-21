import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { RouterModule } from '@angular/router';
import { TRANSPORTE } from '../../shared/transporte/transporte';
import { EmpresasPage } from './empresas.page';

@NgModule({
  declarations: [EmpresasPage],
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    ...TRANSPORTE,
    RouterModule.forChild([{ path: '', component: EmpresasPage }]),
  ],
})
export class EmpresasPageModule {}
