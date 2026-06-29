import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { RouterModule } from '@angular/router';
import { PassengerHomePage } from './home.page';

@NgModule({
  declarations: [PassengerHomePage],
  imports: [
    CommonModule,
    IonicModule,
    RouterModule.forChild([{ path: '', component: PassengerHomePage }]),
  ],
})
export class PassengerHomePageModule {}
