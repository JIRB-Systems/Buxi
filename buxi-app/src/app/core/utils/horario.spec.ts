import { diaHorario, horaCorta, proximaSalida, salidaTexto, SalidaHorario } from './horario';

// Martes 21 de octubre de 2026.
const martes = (h: number, m = 0) => new Date(2026, 9, 21, h, m);

const salidas: SalidaHorario[] = [
  { dia: 'lunes_viernes', hora: '05:00:00' },
  { dia: 'lunes_viernes', hora: '12:30:00' },
  { dia: 'lunes_viernes', hora: '18:00:00' },
  { dia: 'sabado', hora: '07:00:00' },
];

describe('diaHorario', () => {
  it('agrupa lunes a viernes y separa sábado y domingo', () => {
    expect(diaHorario(new Date(2026, 9, 19))).toBe('lunes_viernes');
    expect(diaHorario(new Date(2026, 9, 24))).toBe('sabado');
    expect(diaHorario(new Date(2026, 9, 25))).toBe('domingo');
  });
});

describe('proximaSalida', () => {
  it('da la siguiente de hoy y cuántos minutos faltan', () => {
    expect(proximaSalida(salidas, martes(12, 10))).toEqual({ hora: '12:30:00', diasDespues: 0, minutos: 20 });
  });

  it('pasadas las de hoy, da la primera de mañana (no la primera de hoy)', () => {
    expect(proximaSalida(salidas, martes(19))).toEqual({ hora: '05:00:00', diasDespues: 1, minutos: 600 });
  });

  it('salta los días sin servicio', () => {
    // Sábado 20:00: no hay más el sábado ni el domingo; la próxima es el lunes.
    const r = proximaSalida(salidas, new Date(2026, 9, 24, 20, 0));
    expect(r?.diasDespues).toBe(2);
    expect(r?.hora).toBe('05:00:00');
  });

  it('sin horario no inventa nada', () => {
    expect(proximaSalida([], martes(10))).toBeNull();
  });
});

describe('textos', () => {
  it('escribe la hora a la tica', () => {
    expect(horaCorta('14:30:00')).toBe('2:30 p. m.');
    expect(horaCorta('00:05')).toBe('12:05 a. m.');
    expect(horaCorta('12:00:00')).toBe('12:00 p. m.');
  });

  it('dice la salida según cuánto falta', () => {
    expect(salidaTexto({ hora: '12:30:00', diasDespues: 0, minutos: 20 })).toBe('Sale en 20 min');
    expect(salidaTexto({ hora: '18:00:00', diasDespues: 0, minutos: 300 })).toBe('Sale a las 6:00 p. m.');
    expect(salidaTexto({ hora: '05:00:00', diasDespues: 1, minutos: 600 })).toBe('Sale mañana a las 5:00 a. m.');
  });
});
