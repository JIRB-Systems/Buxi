import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { MapPage } from './map.page';
import { PlacaComponent, RutaInsigniaComponent } from '../../../shared/transporte/transporte';

@NgModule({
  declarations: [MapPage],
  imports: [
    CommonModule,
    IonicModule,
    FormsModule,
    RouterModule.forChild([{ path: '', component: MapPage }]),
    RutaInsigniaComponent,
    PlacaComponent,
  ],
})
export class MapPageModule {}
