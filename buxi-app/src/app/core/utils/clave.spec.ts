import { claveValida, generarClaveTemporal } from './clave';

describe('generarClaveTemporal', () => {
  it('cumple la regla de la app', () => {
    for (let i = 0; i < 200; i++) expect(claveValida(generarClaveTemporal())).toBeTrue();
  });

  it('respeta el largo pedido y nunca baja de 8', () => {
    expect(generarClaveTemporal(20).length).toBe(20);
    expect(generarClaveTemporal(3).length).toBe(8);
  });

  it('no repite la misma clave', () => {
    const vistas = new Set(Array.from({ length: 100 }, () => generarClaveTemporal()));
    expect(vistas.size).toBe(100);
  });

  it('evita los caracteres que se confunden al dictarlos', () => {
    for (let i = 0; i < 100; i++) expect(generarClaveTemporal()).not.toMatch(/[0O1lI]/);
  });
});

describe('claveValida', () => {
  it('pide mayúscula, minúscula, número y 8 caracteres', () => {
    expect(claveValida('Abcdefg1')).toBeTrue();
    expect(claveValida('abcdefg1')).toBeFalse();
    expect(claveValida('ABCDEFG1')).toBeFalse();
    expect(claveValida('Abcdefgh')).toBeFalse();
    expect(claveValida('Abc1')).toBeFalse();
    expect(claveValida('')).toBeFalse();
    expect(claveValida(null)).toBeFalse();
  });
});
