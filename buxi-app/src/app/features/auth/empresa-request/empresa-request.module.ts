import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { RouterModule } from '@angular/router';
import { AuthShellComponent } from '../../../shared/auth-shell/auth-shell.component';
import { EmpresaRequestPage } from './empresa-request.page';

@NgModule({
  declarations: [EmpresaRequestPage],
  imports: [
    CommonModule,
    ReactiveFormsModule,
    IonicModule,
    AuthShellComponent,
    RouterModule.forChild([{ path: '', component: EmpresaRequestPage }]),
  ],
})
export class EmpresaRequestPageModule {}
