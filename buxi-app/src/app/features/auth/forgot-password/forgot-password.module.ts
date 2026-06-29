import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { RouterModule } from '@angular/router';
import { ForgotPasswordPage } from './forgot-password.page';

@NgModule({
  declarations: [ForgotPasswordPage],
  imports: [
    CommonModule,
    ReactiveFormsModule,
    IonicModule,
    RouterModule.forChild([{ path: '', component: ForgotPasswordPage }]),
  ],
})
export class ForgotPasswordPageModule {}
