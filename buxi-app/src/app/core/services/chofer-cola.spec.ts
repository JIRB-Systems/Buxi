import { ChoferService } from './chofer.service';

// Cola sin señal de pánico e incidentes: sin red se guarda y se reenvía;
// un rechazo de la base no se encola (reintentarlo fallaría igual).
describe('ChoferService · cola de reportes sin señal', () => {
  let service: ChoferService;
  let respuestas: Array<{ error: any }>;
  let insertados: any[];

  beforeEach(() => {
    localStorage.removeItem('buxi-cola-reportes');
    service = new ChoferService();
    respuestas = [];
    insertados = [];
    (service as any).supabase = {
      from: () => ({
        insert: async (fila: any) => {
          const r = respuestas.shift() ?? { error: null };
          if (!r.error) insertados.push(fila);
          return r;
        },
      }),
    };
  });

  afterEach(() => localStorage.removeItem('buxi-cola-reportes'));

  it('sin red encola el reporte y lo marca con la hora', async () => {
    respuestas.push({ error: { message: 'Failed to fetch' } });
    const r = await service.createReporteConCola('e1', 'u1', 'Emergencia', 'Botón de pánico');
    expect(r).toBe('encolado');
    expect(service.pendientesEnCola()).toBe(1);
    const cola = JSON.parse(localStorage.getItem('buxi-cola-reportes')!);
    expect(cola[0].descripcion).toContain('Registrado sin señal');
  });

  it('con red lo envía directo y no deja nada pendiente', async () => {
    const r = await service.createReporteConCola('e1', 'u1', 'Atraso', 'detalle');
    expect(r).toBe('enviado');
    expect(service.pendientesEnCola()).toBe(0);
    expect(insertados.length).toBe(1);
  });

  it('si la base lo rechaza lanza y no lo encola', async () => {
    respuestas.push({ error: { code: '42501', message: 'permiso denegado' } });
    await expectAsync(service.createReporteConCola('e1', 'u1', 'Atraso', 'x')).toBeRejected();
    expect(service.pendientesEnCola()).toBe(0);
  });

  it('al volver la red vacía la cola y conserva lo que sigue sin red', async () => {
    respuestas.push({ error: { message: 'Failed to fetch' } }, { error: { message: 'Failed to fetch' } });
    await service.createReporteConCola('e1', 'u1', 'Emergencia', 'uno');
    await service.createReporteConCola('e1', 'u1', 'Atraso', 'dos');
    expect(service.pendientesEnCola()).toBe(2);

    // Primer reintento: uno sale, el otro sigue sin red.
    respuestas.push({ error: null }, { error: { message: 'Failed to fetch' } });
    expect(await service.vaciarColaReportes()).toBe(1);
    expect(service.pendientesEnCola()).toBe(1);

    expect(await service.vaciarColaReportes()).toBe(1);
    expect(service.pendientesEnCola()).toBe(0);
    expect(insertados.map(f => f.titulo)).toEqual(['Emergencia', 'Atraso']);
  });

  it('con la cola vacía no hace ningún pedido', async () => {
    expect(await service.vaciarColaReportes()).toBe(0);
    expect(insertados.length).toBe(0);
  });
});
