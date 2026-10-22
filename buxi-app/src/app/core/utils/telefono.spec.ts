import { normalizarTelefono } from './telefono';

describe('normalizarTelefono', () => {
  it('acepta las formas comunes de un número de CR', () => {
    expect(normalizarTelefono('88887777')).toBe('8888-7777');
    expect(normalizarTelefono('8888-7777')).toBe('8888-7777');
    expect(normalizarTelefono('+506 8888 7777')).toBe('8888-7777');
    expect(normalizarTelefono('(506) 2222-3333')).toBe('2222-3333');
  });

  it('rechaza lo que no es un número de CR', () => {
    expect(normalizarTelefono('')).toBeNull();
    expect(normalizarTelefono('8888777')).toBeNull();
    expect(normalizarTelefono('888877776')).toBeNull();
    expect(normalizarTelefono('1888-7777')).toBeNull();
    expect(normalizarTelefono('+1 305 555 0101')).toBeNull();
  });
});
