"""Nombre «Buxmap» en trazos, y las piezas de la app que lo usan.

El nombre va en un solo color: la B del logo ya lleva el azul y el verde, y el
punto verde de la i de «Buxi» no tiene dónde ir en «Buxmap». Mismas métricas que
el nombre anterior (Manrope ExtraBold, mayúsculas de 76, tracking -0.012) para
que encaje en los mismos lugares sin tocar proporciones.

Uso: python nombre.py <manrope.woff2> <carpeta de salida>
"""
import os
import sys

import construir as c

fuente_ruta, salida = sys.argv[1], sys.argv[2]
os.makedirs(salida, exist_ok=True)
negra = c.Fuente(fuente_ruta, 800)

PALABRA = "Buxmap"
# Pares corregidos a ojo, en milésimas de em. La x y la u dejan mucho aire en
# Manrope; m-a-p ya quedan parejas.
AJUSTES = {"Bu": -6, "ux": -14, "xm": -10}
TRACK = -0.012


def letras(alto_cap, x, y):
    """Cada letra por separado (para animarlas) y el ancho total."""
    escala = alto_cap / negra.cap
    out, cur = [], x
    for i, ch in enumerate(PALABRA):
        nombre = negra.cmap[ord(ch)]
        out.append((ch, negra.glifo(nombre, escala, cur, y)))
        avance = negra.gs[nombre].width + TRACK * negra.upm + AJUSTES.get(PALABRA[i:i + 2], 0) * negra.upm / 1000
        cur += avance * escala
    return out, cur - x - TRACK * negra.upm * escala


def escribir(nombre, contenido):
    with open(os.path.join(salida, nombre), "w", encoding="utf-8", newline="\n") as fh:
        fh.write(contenido)
    print(nombre, len(contenido), "bytes")


f = c.fmt

# ---- Marca (la misma B; cambia solo el título accesible) ----
escribir("buxmap-mark.svg", c.svg(c.ANCHO_MARCA, c.ALTO, c.marca_svg(), titulo="Buxmap"))

# ---- Nombre suelto ----
# La p baja de la línea base: el lienzo deja lugar al descendente para que no
# se corte, y la línea base queda donde estaba la de «Buxi».
CAP, MARGEN = 76, 2
DESC = round(-negra.f["OS/2"].sTypoDescender * CAP / negra.cap * 0.92)
ls, ancho = letras(CAP, 0, CAP + MARGEN)
alto = CAP + 2 * MARGEN + DESC
for archivo, color in (("buxmap-nombre.svg", c.BLANCO), ("buxmap-nombre-marino.svg", c.MARINO)):
    escribir(archivo, c.svg(ancho, alto, f'<path fill="{color}" d="{"".join(d for _, d in ls)}"/>', titulo="Buxmap"))
print("alto/ancho:", round(alto / ancho, 4), "· descendente:", DESC)

# ---- Pantalla de arranque: una letra por elemento, para animarlas ----
piezas = "\n".join(f'        <path #letter d="{d}" />' for _, d in ls)
escribir("_arranque-nombre.html", f"""      <svg class="wordmark" viewBox="0 0 {f(ancho)} {alto}" role="img" aria-label="Buxmap">
{piezas}
      </svg>
""")

# ---- Pantalla de arranque nativa: marca sobre el nombre, centrados sobre marino ----
L2 = 2732
cap_v, esc_m = 64, 1.3
ls3, ancho3 = letras(cap_v, 0, 0)
ancho_bloque = max(ancho3, c.ANCHO_MARCA * esc_m)
alto_m = c.ALTO * esc_m
alto_bloque = alto_m + 34 + cap_v
k = L2 * 0.2 / ancho_bloque
ox, oy = (L2 - ancho_bloque * k) / 2, (L2 - alto_bloque * k) / 2
ls3, _ = letras(cap_v, (ancho_bloque - ancho3) / 2, alto_bloque)
xm = (ancho_bloque - c.ANCHO_MARCA * esc_m) / 2 - c.K * c.ALTO * esc_m * 0.12
cuerpo = (f'<g transform="translate({f(ox)} {f(oy)}) scale({f(k)})">' + c.marca_svg(c.AZUL, c.VERDE, xm, 0, esc_m)
          + f'<path fill="#fff" d="{"".join(d for _, d in ls3)}"/></g>')
escribir("_splash.svg", c.svg(L2, L2, cuerpo, fondo=c.MARINO, titulo="Buxmap"))
