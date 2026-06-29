import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { RouterModule } from '@angular/router';
import { SplashPage } from './splash.page';

@NgModule({
  declarations: [SplashPage],
  imports: [
    CommonModule,
    IonicModule,
    RouterModule.forChild([{ path: '', component: SplashPage }]),
  ],
})
export class SplashPageModule {}
