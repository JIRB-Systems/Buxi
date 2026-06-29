import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { RouterModule } from '@angular/router';
import { RegisterPage } from './register.page';

@NgModule({
  declarations: [RegisterPage],
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    IonicModule,
    RouterModule.forChild([{ path: '', component: RegisterPage }]),
  ],
})
export class RegisterPageModule {}
