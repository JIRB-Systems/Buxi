// Próxima salida según el horario cargado por la empresa (horario_salidas).
//
// Es lo que se muestra cuando ningún bus está transmitiendo: no es una
// llegada en vivo, y la pantalla tiene que decirlo ("según horario").

export type DiaHorario = 'lunes_viernes' | 'sabado' | 'domingo';

export interface SalidaHorario {
  dia: DiaHorario | string;
  hora: string; // "HH:MM" o "HH:MM:SS"
}

export interface ProximaSalida {
  hora: string;        // "HH:MM:SS", como viene de la base
  diasDespues: number; // 0 hoy, 1 mañana...
  minutos: number;     // desde ahora
}

export function diaHorario(fecha: Date): DiaHorario {
  const d = fecha.getDay(); // 0 domingo, 6 sábado
  return d === 0 ? 'domingo' : d === 6 ? 'sabado' : 'lunes_viernes';
}

function aMinutos(hora: string): number {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + (m || 0);
}

// Busca la próxima salida desde `ahora`, mirando hasta una semana adelante
// (una ruta puede no tener servicio el domingo). Antes, pasadas todas las de
// hoy, se mostraba la primera de HOY como si fuera la próxima.
export function proximaSalida(salidas: SalidaHorario[], ahora = new Date()): ProximaSalida | null {
  if (!salidas.length) return null;
  const minutosAhora = ahora.getHours() * 60 + ahora.getMinutes();
  for (let d = 0; d < 7; d++) {
    const fecha = new Date(ahora);
    fecha.setDate(ahora.getDate() + d);
    const dia = diaHorario(fecha);
    const delDia = salidas
      .filter(s => s.dia === dia)
      .map(s => s.hora)
      .sort((a, b) => aMinutos(a) - aMinutos(b));
    const hora = d === 0 ? delDia.find(h => aMinutos(h) >= minutosAhora) : delDia[0];
    if (hora) {
      return { hora, diasDespues: d, minutos: d * 1440 + aMinutos(hora) - minutosAhora };
    }
  }
  return null;
}

// "14:30:00" → "2:30 p. m." (como se escribe en Costa Rica).
export function horaCorta(hora: string): string {
  const [h, m] = hora.split(':').map(Number);
  const sufijo = h < 12 ? 'a. m.' : 'p. m.';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m || 0).padStart(2, '0')} ${sufijo}`;
}

// "Sale a las 2:30 p. m.", "Sale mañana a las 5:00 a. m.", "Sale en 7 min".
export function salidaTexto(s: ProximaSalida): string {
  if (s.diasDespues === 0 && s.minutos < 60) return s.minutos <= 0 ? 'Sale ahora' : `Sale en ${s.minutos} min`;
  if (s.diasDespues === 0) return `Sale a las ${horaCorta(s.hora)}`;
  if (s.diasDespues === 1) return `Sale mañana a las ${horaCorta(s.hora)}`;
  return `Próxima salida en ${s.diasDespues} días, ${horaCorta(s.hora)}`;
}
