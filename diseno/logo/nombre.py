"""Nombre «Buxci» en trazos, y las piezas de la app que lo usan.

La marca se llamó Buxi, después Buxmap y desde octubre de 2026 Buxci. Con la
i al final vuelve el punto verde del primer logo: el mismo punto que en la app
marca lo que está en vivo. Mismas métricas que los nombres anteriores (Manrope
ExtraBold, mayúsculas de 76, tracking -0.012) para que encaje en los mismos
lugares sin tocar proporciones.

Uso: python nombre.py <manrope.woff2> <carpeta de salida>
"""
import os
import sys

import construir as c

fuente_ruta, salida = sys.argv[1], sys.argv[2]
os.makedirs(salida, exist_ok=True)
negra = c.Fuente(fuente_ruta, 800)

NOMBRE = "Buxci"
PALABRA = "Buxcı"  # la i sin punto: el punto va aparte, en verde
# Pares corregidos a ojo, en milésimas de em. La x y la u dejan mucho aire en
# Manrope; la c y la i ya quedan parejas.
AJUSTES = {"Bu": -6, "ux": -14, "xc": -10, "cı": -4}
TRACK = -0.012


def letras(alto_cap, x, y):
    """Cada letra por separado (para animarlas), el punto de la i y el ancho total."""
    escala = alto_cap / negra.cap
    out, cur = [], x
    for i, ch in enumerate(PALABRA):
        nombre = "dotlessi" if ch == "ı" else negra.cmap[ord(ch)]
        out.append((ch, negra.glifo(nombre, escala, cur, y), cur))
        avance = negra.gs[nombre].width + TRACK * negra.upm + AJUSTES.get(PALABRA[i:i + 2], 0) * negra.upm / 1000
        cur += avance * escala
    ancho = cur - x - TRACK * negra.upm * escala
    x0, _, x1, _ = negra.caja("dotlessi")
    r = (x1 - x0) * escala * 0.62
    punto = (out[-1][2] + (x0 + x1) / 2 * escala, y - alto_cap + r * 0.86, r)
    return out, punto, ancho


def escribir(nombre, contenido):
    with open(os.path.join(salida, nombre), "w", encoding="utf-8", newline="\n") as fh:
        fh.write(contenido)
    print(nombre, len(contenido), "bytes")


f = c.fmt


def circulo(punto, color=None):
    px, py, pr = punto
    relleno = f' fill="{color}"' if color else ''
    return f'<circle cx="{f(px)}" cy="{f(py)}" r="{f(pr)}"{relleno}/>'


# ---- Marca (la misma B; cambia solo el título accesible) ----
escribir("buxci-mark.svg", c.svg(c.ANCHO_MARCA, c.ALTO, c.marca_svg(), titulo=NOMBRE))

# ---- Nombre suelto ----
CAP, MARGEN = 76, 2
ls, punto, ancho = letras(CAP, 0, CAP + MARGEN)
alto = CAP + 2 * MARGEN
for archivo, color in (("buxci-nombre.svg", c.BLANCO), ("buxci-nombre-marino.svg", c.MARINO)):
    cuerpo = f'<path fill="{color}" d="{"".join(d for _, d, _ in ls)}"/>' + circulo(punto, c.VERDE)
    escribir(archivo, c.svg(ancho, alto, cuerpo, titulo=NOMBRE))
print("alto/ancho:", round(alto / ancho, 4))

# ---- Pantalla de arranque: una letra por elemento, para animarlas ----
piezas = []
for ch, d, _ in ls:
    if ch == "ı":
        piezas.append(f'        <g #letter><path d="{d}" /><circle class="punto" cx="{f(punto[0])}" cy="{f(punto[1])}" r="{f(punto[2])}" /></g>')
    else:
        piezas.append(f'        <path #letter d="{d}" />')
escribir("_arranque-nombre.html", f"""      <svg class="wordmark" viewBox="0 0 {f(ancho)} {alto}" role="img" aria-label="{NOMBRE}">
{chr(10).join(piezas)}
      </svg>
""")

# ---- Pantalla de arranque nativa: marca sobre el nombre, centrados sobre marino ----
L2 = 2732
cap_v, esc_m = 64, 1.3
_, _, ancho3 = letras(cap_v, 0, 0)
ancho_bloque = max(ancho3, c.ANCHO_MARCA * esc_m)
alto_m = c.ALTO * esc_m
alto_bloque = alto_m + 34 + cap_v
k = L2 * 0.2 / ancho_bloque
ox, oy = (L2 - ancho_bloque * k) / 2, (L2 - alto_bloque * k) / 2
ls3, punto3, _ = letras(cap_v, (ancho_bloque - ancho3) / 2, alto_bloque)
xm = (ancho_bloque - c.ANCHO_MARCA * esc_m) / 2 - c.K * c.ALTO * esc_m * 0.12
cuerpo = (f'<g transform="translate({f(ox)} {f(oy)}) scale({f(k)})">' + c.marca_svg(c.AZUL, c.VERDE, xm, 0, esc_m)
          + f'<path fill="#fff" d="{"".join(d for _, d, _ in ls3)}"/>' + circulo(punto3, c.VERDE) + '</g>')
escribir("_splash.svg", c.svg(L2, L2, cuerpo, fondo=c.MARINO, titulo=NOMBRE))
