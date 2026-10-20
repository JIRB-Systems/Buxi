import { nombreCortoLugar } from './lugar';

describe('nombreCortoLugar', () => {
  it('se queda con el nombre de la terminal', () => {
    expect(nombreCortoLugar(
      'Terminal de Buses de Liberia, Calle 12, Los Ángeles, Liberia, Guanacaste, 50101, Costa Rica'
    )).toBe('Terminal de Buses de Liberia');

    expect(nombreCortoLugar(
      'Terminal Pulmitan de Liberia, Avenida 5 Presbítero Fernando González, Liberia, Guanacaste, Costa Rica'
    )).toBe('Terminal Pulmitan de Liberia');
  });

  it('deja igual lo que ya viene corto', () => {
    expect(nombreCortoLugar('Cartago')).toBe('Cartago');
    expect(nombreCortoLugar('San José, Costa Rica')).toBe('San José');
  });

  it('a un nombre genérico le agrega de dónde es', () => {
    expect(nombreCortoLugar('Parada de buses, Calle 2, Paraíso, Cartago, Costa Rica'))
      .toBe('Parada de buses, Paraíso');
    expect(nombreCortoLugar('Terminal, Avenida Central, Alajuela, Costa Rica'))
      .toBe('Terminal, Alajuela');
    // Con el tope por defecto el contexto no entra entero, y se corta por
    // palabra: igual queda claro que no es la terminal de cualquier pueblo.
    expect(nombreCortoLugar('Terminal de Buses Municipal, Avenida 5, Corazón de Jesús, La Cruz, Guanacaste, 51001, Costa Rica'))
      .toBe('Terminal de Buses Municipal, Corazón de…');
    expect(nombreCortoLugar('Terminal de Buses Municipal, Avenida 5, Corazón de Jesús, La Cruz, Guanacaste, 51001, Costa Rica', 60))
      .toBe('Terminal de Buses Municipal, Corazón de Jesús');
  });

  it('no agrega contexto cuando el nombre ya dice cuál es', () => {
    expect(nombreCortoLugar('Terminal La Cruz, Carretera Interamericana Norte, Peñas Blancas, La Cruz, Guanacaste, Costa Rica'))
      .toBe('Terminal La Cruz');
    expect(nombreCortoLugar('Terminal Pulmitan, 0095, Calle 24, Merced, San José, Costa Rica'))
      .toBe('Terminal Pulmitan');
  });

  it('a un número de portal le pega la calle', () => {
    expect(nombreCortoLugar('12, Calle 5, Heredia, Costa Rica')).toBe('12 Calle 5');
  });

  it('corta por palabra cuando es larguísimo', () => {
    const largo = nombreCortoLugar('Terminal Municipal de Autobuses del Caribe Sur de Limón Centro, Limón, Costa Rica');
    expect(largo.length).toBeLessThanOrEqual(43);
    expect(largo.endsWith('…')).toBeTrue();
    expect(largo).not.toContain('  ');
  });

  it('aguanta vacío y nulo', () => {
    expect(nombreCortoLugar('')).toBe('');
    expect(nombreCortoLugar(null)).toBe('');
    expect(nombreCortoLugar(undefined)).toBe('');
  });

  it('quita el código postal y el país aunque no haya nombre propio', () => {
    expect(nombreCortoLugar('Bagaces, Guanacaste, 50501, Costa Rica')).toBe('Bagaces');
  });
});
