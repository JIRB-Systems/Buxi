import { tarifaAdultoMayorTexto, tituloAresep } from './aresep';

describe('tituloAresep', () => {
  it('pasa las mayúsculas de ARESEP a título y separa los tramos', () => {
    expect(tituloAresep('LIBERIA-LA CRUZ')).toBe('Liberia – La Cruz');
    expect(tituloAresep('LIBERIA-LA CRUZ-PEÑAS BLANCAS')).toBe('Liberia – La Cruz – Peñas Blancas');
  });

  it('deja en minúscula los conectores dentro de un tramo', () => {
    expect(tituloAresep('URBANO DE LIBERIA-SAN ROQUE')).toBe('Urbano de Liberia – San Roque');
    expect(tituloAresep('AEROPUERTO DANIEL ODUBER QUIRÓS')).toBe('Aeropuerto Daniel Oduber Quirós');
  });

  it('pone las tildes que ARESEP omite en nombres de lugar', () => {
    expect(tituloAresep('SAN JOSE-LIMON')).toBe('San José – Limón');
    expect(tituloAresep('TARIFA MINIMA')).toBe('Tarifa Mínima');
    expect(tituloAresep('SAN JOSÉ')).toBe('San José');
  });

  it('respeta las siglas', () => {
    expect(tituloAresep('SAN PEDRO-UCR')).toBe('San Pedro – UCR');
  });

  it('tolera espacios alrededor del guion, saltos de línea y vacíos', () => {
    expect(tituloAresep('  DESAMPARADOS - MORAVIA\n')).toBe('Desamparados – Moravia');
    expect(tituloAresep('')).toBe('');
    expect(tituloAresep(null)).toBe('');
  });
});

describe('tarifaAdultoMayorTexto', () => {
  it('dice Gratis cuando la tarifa es cero', () => {
    expect(tarifaAdultoMayorTexto(0)).toBe('Gratis');
  });

  it('formatea los colones sin decimales', () => {
    expect(tarifaAdultoMayorTexto(1250)).toBe('₡1250'.replace('1250', (1250).toLocaleString('es-CR')));
  });

  it('marca la falta de dato', () => {
    expect(tarifaAdultoMayorTexto(null)).toBe('—');
  });
});
