import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { RouterModule } from '@angular/router';
import { MapPage } from './map.page';

@NgModule({
  declarations: [MapPage],
  imports: [
    CommonModule,
    IonicModule,
    RouterModule.forChild([{ path: '', component: MapPage }]),
  ],
})
export class MapPageModule {}
