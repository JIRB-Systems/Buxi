import { Component, OnDestroy, OnInit } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { supabaseClient } from '../../core/supabase-client';
import { TarifaAresep } from '../../core/models/transport.model';
import { tarifaAdultoMayorTexto, tituloAresep } from '../../core/utils/aresep';
import { logError } from '../../core/utils/log';

interface Plan {
  id: string;
  nombre: string;
  max_buses: number;
  max_rutas: number;
  gps_intervalo_seg: number;
  descripcion: string | null;
}

// Página pública para empresas de transporte: qué es Buxci para ellas y cómo
// asociarse. Se ve sin cuenta. Todo lo que muestra es real: los planes salen
// de la tabla `planes` y la búsqueda de tarifas de los datos de ARESEP.
@Component({
  selector: 'app-empresas',
  templateUrl: './empresas.page.html',
  styleUrls: ['./empresas.page.scss'],
  standalone: false,
})
export class EmpresasPage implements OnInit, OnDestroy {
  private supabase = supabaseClient();

  planes: Plan[] = [];
  readonly tituloAresep = tituloAresep;
  readonly tarifaAM = tarifaAdultoMayorTexto;

  // ---- "Probá con tu ruta" ----
  rutaQuery = '';
  tarifas: TarifaAresep[] = [];
  buscando = false;
  sinResultados = false;
  private espera: any;

  // Las preguntas de siempre, abiertas de a una.
  faqAbierta: number | null = 0;
  readonly faq = [
    {
      q: '¿Tengo que comprar GPS o equipos para los buses?',
      a: 'No. El GPS es el teléfono del chofer con la app de Buxci abierta: manda la posición del bus cada pocos segundos mientras hace el viaje.',
    },
    {
      q: '¿Mis pasajeros tienen que crear una cuenta?',
      a: 'No. Cualquiera ve tus rutas, horarios, tarifas y buses en vivo sin registrarse. La cuenta es para guardar favoritos, recibir tus avisos en el teléfono y comprar boletos.',
    },
    {
      q: '¿De dónde salen las tarifas?',
      a: 'De los datos abiertos de ARESEP. Enlazás cada ruta con su tramo oficial y el precio se actualiza solo cuando ARESEP lo cambia, con la tarifa de adulto mayor incluida.',
    },
    {
      q: '¿Puedo aparecer en Google Maps?',
      a: 'Sí. Buxci arma tus rutas, paradas, horarios y buses en vivo en GTFS, el formato que usan Google Maps, Moovit y Transit. Desde tu panel copiás los enlaces y postulás a tu empresa.',
    },
    {
      q: '¿Quién ve dónde están mis buses?',
      a: 'Tus pasajeros ven la posición actual de los buses que están en servicio, como en cualquier app de transporte. El historial de recorridos y los datos de tus choferes son solo para tu empresa.',
    },
  ];

  constructor(private title: Title, private meta: Meta) {}

  async ngOnInit() {
    this.title.setTitle('Buxci para empresas de bus · Costa Rica');
    this.meta.updateTag({
      name: 'description',
      content: 'GPS desde el teléfono del chofer, panel de flota y una app donde tus pasajeros ven llegar el bus. Tarifas oficiales de ARESEP y publicación en Google Maps.',
    });
    try {
      const { data, error } = await this.supabase.from('planes')
        .select('id, nombre, max_buses, max_rutas, gps_intervalo_seg, descripcion')
        .eq('activo', true).order('max_buses');
      if (error) throw error;
      this.planes = (data || []) as Plan[];
    } catch (e) {
      logError('cargar planes en /empresas', e);
    }
  }

  ngOnDestroy() {
    clearTimeout(this.espera);
    this.title.setTitle('Buxci');
  }

  onRuta() {
    clearTimeout(this.espera);
    this.sinResultados = false;
    const q = this.rutaQuery.replace(/[,()%*\\]/g, ' ').replace(/\s+/g, ' ').trim();
    if (q.length < 2) { this.tarifas = []; return; }
    this.buscando = true;
    this.espera = setTimeout(async () => {
      try {
        const { data, error } = await this.supabase.from('tarifas_aresep')
          .select('*').eq('vigente', true)
          .or(`codigo_ruta.ilike.${q},nombre_ruta.ilike.%${q}%,nombre_fraccionamiento.ilike.%${q}%`)
          .order('codigo_ruta').order('tarifa_regular', { ascending: false })
          .limit(6);
        if (error) throw error;
        this.tarifas = (data || []) as TarifaAresep[];
        this.sinResultados = this.tarifas.length === 0;
      } catch (e) {
        logError('buscar tarifa en /empresas', e);
        this.tarifas = [];
        this.sinResultados = true;
      } finally {
        this.buscando = false;
      }
    }, 300);
  }

  // "3-101-364538:TRANSPORTES LIBERIANOS DEL NORTE, S.A./…" → los nombres.
  operadores(t: TarifaAresep): string {
    return (t.operadores || '').split('/')
      .map(o => o.split(':').slice(1).join(':').trim())
      .filter(Boolean)
      .map(n => tituloAresep(n).replace(/\bS\. ?A\.?$/i, 'S.A.'))
      .join(', ');
  }

  intervalo(seg: number): string {
    return `cada ${seg} s`;
  }

  limite(n: number, cosa: string): string {
    return n >= 999 ? `${cosa} sin límite` : `Hasta ${n} ${cosa}`;
  }
}
