import { ErrorHandler, LOCALE_ID, NgModule } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeEsCR from '@angular/common/locales/es-CR';
import { BrowserModule } from '@angular/platform-browser';
import { RouteReuseStrategy } from '@angular/router';

import { IonicModule, IonicRouteStrategy } from '@ionic/angular';

import { AppComponent } from './app.component';
import { AppRoutingModule } from './app-routing.module';
import { ChunkErrorHandler } from './core/chunk-error-handler';

// Fechas y números como se escriben en Costa Rica ("20 oct 2026", "1 200"):
// sin esto los pipes de Angular salían en inglés ("Oct 20, 2026").
registerLocaleData(localeEsCR);

@NgModule({
  declarations: [AppComponent],
  imports: [BrowserModule, IonicModule.forRoot(), AppRoutingModule],
  providers: [
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    { provide: ErrorHandler, useClass: ChunkErrorHandler },
    { provide: LOCALE_ID, useValue: 'es-CR' },
  ],
  bootstrap: [AppComponent],
})
export class AppModule {}
