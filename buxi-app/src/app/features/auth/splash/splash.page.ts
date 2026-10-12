import { AfterViewInit, Component, ElementRef, OnDestroy, QueryList, ViewChild, ViewChildren } from '@angular/core';
import { Router } from '@angular/router';
import { SupabaseService } from '../../../core/services/supabase.service';
import { FeaturesService } from '../../../core/services/features.service';
import { logError } from '../../../core/utils/log';
import { Anuncio } from '../../../core/models/features.model';

// Duracion total de la intro; la navegacion espera a que termine.
const INTRO_MS = 2800;
// Tiempo minimo antes de poder saltar el anuncio de apertura, y limite
// maximo por si el usuario no toca nada — nunca deja atrapada la app en
// un anuncio.
const SPONSOR_SKIP_MS = 2000;
const SPONSOR_MAX_MS = 6000;

@Component({
  selector: 'app-splash',
  templateUrl: './splash.page.html',
  styleUrls: ['./splash.page.scss'],
  standalone: false,
})
export class SplashPage implements AfterViewInit, OnDestroy {
  @ViewChildren('franja') franjaRefs!: QueryList<ElementRef<SVGPathElement>>;
  @ViewChild('panza') panzaRef!: ElementRef<SVGPathElement>;
  @ViewChild('halo') haloRef!: ElementRef<HTMLDivElement>;
  @ViewChild('tagline') taglineRef!: ElementRef<HTMLDivElement>;
  @ViewChildren('letter') letterRefs!: QueryList<ElementRef<SVGGraphicsElement>>;

  private raf: number | null = null;
  private pendingTarget: string[] = ['/auth/login'];
  private skipTimeout: any = null;
  private autoNavTimeout: any = null;

  // Anuncio de apertura: solo pasajeros lo ven, y solo una vez, justo acá,
  // antes de entrar al mapa — nunca interrumpe una sesión ya en curso.
  sponsorAd: Anuncio | null = null;
  canSkipSponsor = false;

  constructor(
    private router: Router,
    private supabase: SupabaseService,
    private features: FeaturesService,
  ) {}

  ngAfterViewInit() {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduce) this.playIntro();

    setTimeout(async () => {
      const session = await this.supabase.getSessionAsync();
      let isPasajero = false;

      if (session) {
        this.pendingTarget = ['/passenger/map'];
        try {
          const profile = await this.supabase.getProfile();
          if (profile) {
            this.pendingTarget = this.supabase.homeRouteForRole(profile.rol);
            isPasajero = profile.rol === 'pasajero';
          }
        } catch (e) {
          // Sin perfil no se sabe el rol, y caer al mapa del pasajero por
          // defecto era entrar derecho al ciclo de guards. El login es la única
          // pantalla que se puede pintar sin saber quién es el usuario.
          logError('Splash: hay sesión pero el perfil no se pudo leer', e);
          this.pendingTarget = ['/auth/login'];
        }
      } else {
        this.pendingTarget = ['/auth/login'];
      }

      if (isPasajero) {
        try {
          const ad = await this.features.getAnuncio('apertura');
          if (ad) {
            this.showSponsor(ad);
            return;
          }
        } catch {}
      }
      this.router.navigate(this.pendingTarget, { replaceUrl: true });
    }, reduce ? 1200 : INTRO_MS);
  }

  private showSponsor(ad: Anuncio) {
    this.sponsorAd = ad;
    this.canSkipSponsor = false;
    this.skipTimeout = setTimeout(() => { this.canSkipSponsor = true; }, SPONSOR_SKIP_MS);
    this.autoNavTimeout = setTimeout(() => this.continueFromSponsor(), SPONSOR_MAX_MS);
  }

  // El botón de saltar llama acá; el timeout de seguridad de
  // SPONSOR_MAX_MS también, directo, sin pasar por el chequeo de
  // canSkipSponsor (ese solo bloquea el toque manual antes de tiempo).
  skipSponsor() {
    if (!this.canSkipSponsor) return;
    this.continueFromSponsor();
  }

  private continueFromSponsor() {
    clearTimeout(this.skipTimeout);
    clearTimeout(this.autoNavTimeout);
    this.router.navigate(this.pendingTarget, { replaceUrl: true });
  }

  ngOnDestroy() {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    clearTimeout(this.skipTimeout);
    clearTimeout(this.autoNavTimeout);
  }

  // Las tres franjas del asta entran desde la izquierda, una tras otra, como
  // líneas de velocidad; la panza cierra la B; el nombre sube letra por letra.
  // Timeline única con rAF para que las cuatro fases compartan un solo reloj.
  private playIntro() {
    const franjas = this.franjaRefs.map(r => r.nativeElement);
    const panza = this.panzaRef.nativeElement;
    const halo = this.haloRef.nativeElement;
    const tagline = this.taglineRef.nativeElement;
    const letters = this.letterRefs.map(r => r.nativeElement);

    // Las distancias de las piezas del logo van en unidades de su viewBox.
    const FR_START = 220, FR_STAG = 120, FR_DUR = 380, FR_DESDE = 70;
    const PZ_START = FR_START + 2 * FR_STAG + FR_DUR - 180, PZ_DUR = 460, PZ_DESDE = 22;
    const LET_START = PZ_START + PZ_DUR - 160, LET_STAG = 95, LET_DUR = 470, LET_DESDE = 16;
    const TAG_START = LET_START + letters.length * LET_STAG + 140, TAG_DUR = 600;
    const END = TAG_START + TAG_DUR;

    const clamp01 = (x: number) => x < 0 ? 0 : x > 1 ? 1 : x;
    const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);
    const easeOutBack = (x: number) => { const c = 1.4; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };

    const t0 = performance.now();
    const frame = (now: number) => {
      const t = now - t0;

      franjas.forEach((el, i) => {
        const lineal = clamp01((t - (FR_START + i * FR_STAG)) / FR_DUR);
        el.style.opacity = String(clamp01(lineal * 2.5));
        el.style.transform = `translateX(${-FR_DESDE * (1 - easeOutCubic(lineal))}px)`;
      });

      const pl = clamp01((t - PZ_START) / PZ_DUR);
      panza.style.opacity = String(clamp01(pl * 2.2));
      panza.style.transform = `translateX(${-PZ_DESDE * (1 - easeOutBack(pl))}px)`;

      halo.style.opacity = String(0.42 * easeOutCubic(clamp01((t - FR_START) / 900)));

      letters.forEach((el, i) => {
        const lp = easeOutCubic(clamp01((t - (LET_START + i * LET_STAG)) / LET_DUR));
        el.style.opacity = String(lp);
        el.style.transform = `translateY(${LET_DESDE * (1 - lp)}px)`;
      });

      const tp = easeOutCubic(clamp01((t - TAG_START) / TAG_DUR));
      tagline.style.opacity = String(tp);
      tagline.style.transform = `translateY(${8 * (1 - tp)}px)`;

      if (t < END) {
        this.raf = requestAnimationFrame(frame);
      } else {
        this.raf = null;
      }
    };
    this.raf = requestAnimationFrame(frame);
  }
}
