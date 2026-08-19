import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { RouterModule } from '@angular/router';
import { ChoferHomePage } from './chofer-home.page';

@NgModule({
  declarations: [ChoferHomePage],
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    RouterModule.forChild([{ path: '', component: ChoferHomePage }]),
  ],
})
export class ChoferHomePageModule {}
