import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { MapPage } from './map.page';
import { PlacaComponent, RutaInsigniaComponent } from '../../../shared/transporte/transporte';
import { ArrastreHojaDirective } from '../../../shared/arrastre-hoja.directive';

@NgModule({
  declarations: [MapPage],
  imports: [
    CommonModule,
    IonicModule,
    FormsModule,
    RouterModule.forChild([{ path: '', component: MapPage }]),
    RutaInsigniaComponent,
    ArrastreHojaDirective,
    PlacaComponent,
  ],
})
export class MapPageModule {}
