import { AfterViewInit, Component, ElementRef, OnDestroy, QueryList, ViewChild, ViewChildren } from '@angular/core';
import { Router } from '@angular/router';
import { SupabaseService } from '../../../core/services/supabase.service';
import { FeaturesService } from '../../../core/services/features.service';
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
  @ViewChild('shaft') shaftRef!: ElementRef<SVGPathElement>;
  @ViewChild('head') headRef!: ElementRef<SVGPolygonElement>;
  @ViewChild('dot') dotRef!: ElementRef<SVGCircleElement>;
  @ViewChild('halo') haloRef!: ElementRef<HTMLDivElement>;
  @ViewChild('tagline') taglineRef!: ElementRef<HTMLDivElement>;
  @ViewChildren('letter') letterRefs!: QueryList<ElementRef<HTMLSpanElement>>;

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
        } catch {}
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

  // El punto de luz recorre la linea trazandola (como un bus dejando su ruta
  // en el mapa), se funde en la punta de flecha, y el wordmark sube letra
  // por letra. Timeline unica con rAF en vez de keyframes CSS porque el punto
  // necesita seguir la geometria real del path (getPointAtLength).
  private playIntro() {
    const shaft = this.shaftRef.nativeElement;
    const head = this.headRef.nativeElement;
    const dot = this.dotRef.nativeElement;
    const halo = this.haloRef.nativeElement;
    const tagline = this.taglineRef.nativeElement;
    const letters = this.letterRefs.map(r => r.nativeElement);

    const LEN = shaft.getTotalLength();
    shaft.style.strokeDasharray = String(LEN);
    shaft.style.strokeDashoffset = String(LEN);

    const SHAFT_START = 260, SHAFT_DUR = 880;
    const HEAD_START = SHAFT_START + SHAFT_DUR - 40, HEAD_DUR = 300;
    const LET_START = HEAD_START + HEAD_DUR - 60, LET_STAG = 95, LET_DUR = 470;
    const TAG_START = LET_START + letters.length * LET_STAG + 140, TAG_DUR = 600;
    const END = TAG_START + TAG_DUR;

    const clamp01 = (x: number) => x < 0 ? 0 : x > 1 ? 1 : x;
    const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);
    const easeOutBack = (x: number) => { const c = 1.9; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };

    const t0 = performance.now();
    const frame = (now: number) => {
      const t = now - t0;

      const sp = easeOutCubic(clamp01((t - SHAFT_START) / SHAFT_DUR));
      shaft.style.strokeDashoffset = String(LEN * (1 - sp));
      if (t >= SHAFT_START && sp < 1) {
        const pt = shaft.getPointAtLength(sp * LEN);
        dot.setAttribute('cx', String(pt.x));
        dot.setAttribute('cy', String(pt.y));
        dot.style.opacity = '1';
      } else if (sp >= 1) {
        const f = clamp01((t - (SHAFT_START + SHAFT_DUR)) / 220);
        dot.style.opacity = String(1 - f);
      }

      const hp = easeOutBack(clamp01((t - HEAD_START) / HEAD_DUR));
      head.style.transform = `scaleX(${Math.max(0, hp)})`;

      halo.style.opacity = String(0.42 * easeOutCubic(clamp01((t - SHAFT_START) / 900)));

      letters.forEach((el, i) => {
        const lp = easeOutCubic(clamp01((t - (LET_START + i * LET_STAG)) / LET_DUR));
        el.style.opacity = String(lp);
        el.style.transform = `translateY(${22 * (1 - lp)}px)`;
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
