"""Piezas del logo que usa la app: marca, nombre suelto, bloque de la pantalla de arranque y fuentes de íconos nativos.

Uso: python app.py <manrope.woff2> <carpeta de salida>
"""
import os
import sys

import construir as c

fuente_ruta, salida = sys.argv[1], sys.argv[2]
os.makedirs(salida, exist_ok=True)
negra = c.Fuente(fuente_ruta, 800)
media = c.Fuente(fuente_ruta, 600)

AJUSTES = {"Bu": -6, "ux": -14, "xı": -8}
TRACK = -0.012


def letras(alto_cap, x, y):
    """Cada letra de «Buxi» por separado, más el punto. Misma métrica que el logo."""
    escala = alto_cap / negra.cap
    out, cur = [], x
    palabra = "Buxı"
    for i, ch in enumerate(palabra):
        nombre = "dotlessi" if ch == "ı" else negra.cmap[ord(ch)]
        out.append((ch, negra.glifo(nombre, escala, cur, y), cur))
        cur += (negra.gs[nombre].width + TRACK * negra.upm + AJUSTES.get(palabra[i:i + 2], 0) * negra.upm / 1000) * escala
    ancho = cur - x - TRACK * negra.upm * escala
    x0, _, x1, _ = negra.caja("dotlessi")
    xi = out[-1][2]
    r = (x1 - x0) * escala * 0.62
    punto = (xi + (x0 + x1) / 2 * escala, y - alto_cap + r * 0.86, r)
    return out, punto, ancho


def escribir(nombre, contenido):
    with open(os.path.join(salida, nombre), "w", encoding="utf-8", newline="\n") as fh:
        fh.write(contenido)
    print(nombre, len(contenido), "bytes")


f = c.fmt

# ---- Marca ----
escribir("buxi-mark.svg", c.svg(c.ANCHO_MARCA, c.ALTO, c.marca_svg()))

# ---- Nombre suelto (para ir al lado de la marca) ----
CAP, MARGEN = 76, 2
ls, (px, py, pr), ancho = letras(CAP, 0, CAP + MARGEN)
for archivo, color in (("buxi-nombre.svg", c.BLANCO), ("buxi-nombre-marino.svg", c.MARINO)):
    cuerpo = f'<path fill="{color}" d="{"".join(d for _, d, _ in ls)}"/><circle cx="{f(px)}" cy="{f(py)}" r="{f(pr)}" fill="{c.VERDE}"/>'
    escribir(archivo, c.svg(ancho, CAP + 2 * MARGEN, cuerpo))
print("proporción del nombre (alto/ancho):", round((CAP + 2 * MARGEN) / ancho, 4), "· alto del nombre respecto a la marca:", round((CAP + 2 * MARGEN) / c.ALTO, 4))

# ---- Bloque de la pantalla de arranque: cada pieza por separado, para animarla ----
alto_franjas = []
t, g = c.MARCA["t"], c.MARCA["g"]
corte = c.MARCA["corte"]
c1y, c2y = t + g / 2, 2 * t + g + g / 2
bordes = [0, c1y - corte / 2, c1y + corte / 2, c2y - corte / 2, c2y + corte / 2, c.ALTO]
asta = c.MARCA["asta"]
franjas = []
for i in range(3):
    ya, yb = bordes[2 * i], bordes[2 * i + 1]
    franjas.append(f'M{c.P(0, ya)}L{c.P(asta, ya)}L{c.P(asta, yb)}L{c.P(0, yb)}Z')
marca_anim = "\n".join(f'        <path class="franja" #franja d="{d}" />' for d in franjas)
marca_anim += f'\n        <path class="panza" #panza d="{c.PANZA_D}" />'
ls2, (px2, py2, pr2), ancho2 = letras(CAP, 0, CAP + MARGEN)
nombre_anim = ""
for ch, d, _ in ls2:
    if ch == "ı":
        nombre_anim += f'        <g #letter><path d="{d}" /><circle class="punto" cx="{f(px2)}" cy="{f(py2)}" r="{f(pr2)}" /></g>\n'
    else:
        nombre_anim += f'        <path #letter d="{d}" />\n'
escribir("_arranque.html", f"""      <svg class="mark" viewBox="0 0 {f(c.ANCHO_MARCA)} {c.ALTO}" aria-hidden="true">
{marca_anim}
      </svg>

      <svg class="wordmark" viewBox="0 0 {f(ancho2)} {CAP + 2 * MARGEN}" role="img" aria-label="Buxi">
{nombre_anim.rstrip()}
      </svg>
""")

# ---- Fuentes para los íconos nativos (@capacitor/assets) ----
LADO = 1024


def centrada(prop_alto, fondo=None, lado=LADO):
    esc = lado * prop_alto / c.ALTO
    # Centrada por su masa: la inclinación carga la figura hacia la derecha.
    xm = (lado - c.ANCHO_MARCA * esc) / 2 - c.K * c.ALTO * esc * 0.06
    ym = (lado - c.ALTO * esc) / 2
    return c.svg(lado, lado, c.marca_svg(c.AZUL, c.VERDE, xm, ym, esc), fondo=fondo)


escribir("_icon-only.svg", centrada(0.5, c.MARINO))
# Android recorta el ícono adaptable a un círculo de ~61 % del lienzo: la marca va holgada dentro.
escribir("_icon-foreground.svg", centrada(0.36))
escribir("_icon-background.svg", c.svg(LADO, LADO, "", fondo=c.MARINO))

# Pantalla de arranque nativa: logo vertical centrado sobre marino.
L2 = 2732
cap_v, esc_m = 64, 1.3
ls3, (px3, py3, pr3), ancho3 = letras(cap_v, 0, 0)
ancho_bloque = max(ancho3, c.ANCHO_MARCA * esc_m)
alto_m = c.ALTO * esc_m
alto_bloque = alto_m + 34 + cap_v
k = L2 * 0.2 / ancho_bloque
ox, oy = (L2 - ancho_bloque * k) / 2, (L2 - alto_bloque * k) / 2
ls3, (px3, py3, pr3), _ = letras(cap_v, (ancho_bloque - ancho3) / 2, alto_bloque)
xm = (ancho_bloque - c.ANCHO_MARCA * esc_m) / 2 - c.K * c.ALTO * esc_m * 0.12
cuerpo = (f'<g transform="translate({f(ox)} {f(oy)}) scale({f(k)})">' + c.marca_svg(c.AZUL, c.VERDE, xm, 0, esc_m)
          + f'<path fill="#fff" d="{"".join(d for _, d, _ in ls3)}"/><circle cx="{f(px3)}" cy="{f(py3)}" r="{f(pr3)}" fill="{c.VERDE}"/></g>')
escribir("_splash.svg", c.svg(L2, L2, cuerpo, fondo=c.MARINO))

# Favicon
lado_f = 64
esc = lado_f * 0.62 / c.ALTO
xm = (lado_f - c.ANCHO_MARCA * esc) / 2 - c.K * c.ALTO * esc * 0.06
escribir("_favicon.svg", c.svg(lado_f, lado_f, c.marca_svg(c.AZUL, c.VERDE, xm, (lado_f - c.ALTO * esc) / 2, esc), fondo=c.MARINO, radio=14))
