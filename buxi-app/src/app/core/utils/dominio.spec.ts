import { esPortada, quedaEnPortada } from './dominio';

describe('dominio', () => {
  it('reconoce la portada con y sin www', () => {
    expect(esPortada('buxci.com')).toBeTrue();
    expect(esPortada('www.buxci.com')).toBeTrue();
    expect(esPortada('app.buxci.com')).toBeFalse();
    expect(esPortada('localhost')).toBeFalse();
  });

  it('deja en la portada solo sus páginas', () => {
    expect(quedaEnPortada('/')).toBeTrue();
    expect(quedaEnPortada('/empresas')).toBeTrue();
    expect(quedaEnPortada('/empresas/')).toBeTrue();
    expect(quedaEnPortada('/legal/terms?x=1')).toBeTrue();
    expect(quedaEnPortada('/auth/login')).toBeFalse();
    expect(quedaEnPortada('/passenger/map?bus=b1')).toBeFalse();
    expect(quedaEnPortada('/splash')).toBeFalse();
  });
});
