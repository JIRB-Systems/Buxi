import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { RouterModule } from '@angular/router';
import { ChoferHomePage } from './chofer-home.page';
import { PlacaComponent, RutaInsigniaComponent } from '../../../shared/transporte/transporte';

@NgModule({
  declarations: [ChoferHomePage],
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    RouterModule.forChild([{ path: '', component: ChoferHomePage }]),
    RutaInsigniaComponent,
    PlacaComponent,
  ],
})
export class ChoferHomePageModule {}
