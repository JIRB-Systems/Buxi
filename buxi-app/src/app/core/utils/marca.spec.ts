import { contraste, insigniaRutaHtml, rutaCorta, tintaSobre } from './marca';

describe('marca: rutaCorta', () => {
  it('abrevia San José y une los extremos con un punto medio', () => {
    expect(rutaCorta('San José – Cartago')).toBe('SJ · Cartago');
    expect(rutaCorta('San José - Cartago')).toBe('SJ · Cartago');
    expect(rutaCorta('Cartago – Paraíso')).toBe('Cartago · Paraíso');
  });

  it('saca lo que va entre paréntesis', () => {
    expect(rutaCorta('San José – Alajuela (por pista)')).toBe('SJ · Alajuela');
  });

  it('con más de dos tramos se queda con el primero y el último', () => {
    expect(rutaCorta('Heredia – Barva – San José de la Montaña')).toBe('Heredia · SJ de la Montaña');
  });

  it('da vuelta el nombre para un bus que va de regreso', () => {
    expect(rutaCorta('San José – Cartago', true)).toBe('Cartago · SJ');
  });

  it('un nombre sin tramos queda igual, y no rompe con vacíos', () => {
    expect(rutaCorta('Ruta 5')).toBe('Ruta 5');
    expect(rutaCorta('')).toBe('');
    expect(rutaCorta(null)).toBe('');
    // Un guion dentro de una palabra no es un separador.
    expect(rutaCorta('Pérez Zeledón-Centro')).toBe('Pérez Zeledón-Centro');
  });
});

describe('marca: tintaSobre', () => {
  it('elige la tinta que más contraste da', () => {
    expect(tintaSobre('#00c853')).toBe('#04101f'); // verde: texto oscuro
    expect(tintaSobre('#ffc107')).toBe('#04101f'); // amarillo: texto oscuro
    expect(tintaSobre('#0a1628')).toBe('#ffffff'); // marino: texto claro
    expect(tintaSobre('#b45cff')).toBe('#04101f');
  });

  it('el texto elegido pasa 4,5:1 sobre los colores de ruta habituales', () => {
    for (const c of ['#00c853', '#2f8bff', '#ff7a1a', '#b45cff', '#ffc107', '#f44336', '#0a1628', '#7b1fa2']) {
      expect(contraste(c, tintaSobre(c))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('un color inválido no se usa', () => {
    expect(tintaSobre('red;background:url(x)')).toBe(tintaSobre('#8292aa'));
    expect(tintaSobre(null)).toBe(tintaSobre('#8292aa'));
  });
});

describe('marca: insigniaRutaHtml', () => {
  it('escapa el nombre y descarta colores que no son hex', () => {
    const html = insigniaRutaHtml('<img src=x onerror=alert(1)> – Cartago', 'red;x:y');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    expect(html).toContain('--ruta:#8292aa');
  });
});
