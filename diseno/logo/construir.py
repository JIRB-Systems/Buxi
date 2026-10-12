"""Construye el logo de Buxi a partir de su geometría.

Uso: python construir.py <manrope.woff2> <carpeta de salida>

La marca sale de cinco números (ver MARCA). El nombre es Manrope ExtraBold
convertida a trazos, así que los SVG no dependen de tener la fuente instalada.
"""
import math
import os
import sys

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

AZUL = "#2f8bff"
VERDE = "#00c853"
MARINO = "#0a1628"
BLANCO = "#ffffff"
GRIS = "#8292aa"

# ---------------------------------------------------------------- marca
MARCA = dict(
    t=28,      # grosor de cada barra
    g=18,      # hueco entre barras (los contadores de la B)
    asta=28,   # ancho del asta
    corte=6,   # franjas del asta: el corte entre una y otra
    largo=28,  # tramo recto de la barra superior antes de la curva
    extra=8,   # cuánto más sale la panza de abajo
    angulo=12, # inclinación, en grados
)
ALTO = 3 * MARCA["t"] + 2 * MARCA["g"]  # 120
K = math.tan(math.radians(MARCA["angulo"]))


def inclinar(x, y):
    """La base se queda en su sitio; lo de arriba se corre a la derecha."""
    return x + K * (ALTO - y), y


def fmt(v):
    s = f"{v:.2f}".rstrip("0").rstrip(".")
    return "0" if s == "-0" else s


def P(x, y):
    x, y = inclinar(x, y)
    return f"{fmt(x)} {fmt(y)}"


def arco(cx, cy, r, a0, a1):
    """Arco de círculo como curvas de Bézier (tramos de 90° o menos), ya inclinado."""
    partes = max(1, math.ceil(abs(a1 - a0) / 90 - 1e-9))
    paso = math.radians((a1 - a0) / partes)
    k = 4 / 3 * math.tan(paso / 4)
    out = []
    a = math.radians(a0)
    for _ in range(partes):
        b = a + paso
        x0, y0 = cx + r * math.cos(a), cy + r * math.sin(a)
        x3, y3 = cx + r * math.cos(b), cy + r * math.sin(b)
        x1, y1 = x0 - k * r * math.sin(a), y0 + k * r * math.cos(a)
        x2, y2 = x3 + k * r * math.sin(b), y3 - k * r * math.cos(b)
        out.append(f"C{P(x1, y1)} {P(x2, y2)} {P(x3, y3)}")
        a = b
    return "".join(out)


def marca_trazos(solapa=0.6):
    """Devuelve (asta, panza) como datos de path, y el ancho total."""
    t, g, asta = MARCA["t"], MARCA["g"], MARCA["asta"]
    ro, ri = (t + g) / 2 + t / 2, (t + g) / 2 - t / 2  # radios exterior e interior
    c1 = (asta + MARCA["largo"], t + g / 2)                       # centro de la panza de arriba
    c2 = (asta + MARCA["largo"] + MARCA["extra"], 2 * t + g + g / 2)  # y de la de abajo

    # Cintura: donde se cruzan los dos círculos exteriores.
    dx, dy = c2[0] - c1[0], c2[1] - c1[1]
    d = math.hypot(dx, dy)
    mx, my = (c1[0] + c2[0]) / 2, (c1[1] + c2[1]) / 2
    h = math.sqrt(ro * ro - (d / 2) ** 2)
    px, py = mx + h * dy / d, my - h * dx / d
    a1 = math.degrees(math.atan2(py - c1[1], px - c1[0]))
    a2 = math.degrees(math.atan2(py - c2[1], px - c2[0]))

    x0 = asta - solapa  # la panza pisa un pelo el asta para que no quede una línea de fondo entre los dos colores
    y = [0, t, t + g, 2 * t + g, 2 * (t + g), ALTO]
    panza = (
        f"M{P(x0, y[0])}L{P(c1[0], y[0])}"
        + arco(c1[0], c1[1], ro, -90, a1)
        + arco(c2[0], c2[1], ro, a2, 90)
        + f"L{P(x0, y[5])}L{P(x0, y[4])}"
        + f"L{P(c2[0], y[4])}" + arco(c2[0], c2[1], ri, 90, -90) + f"L{P(x0, y[3])}"
        + f"L{P(x0, y[2])}"
        + f"L{P(c1[0], y[2])}" + arco(c1[0], c1[1], ri, 90, -90) + f"L{P(x0, y[1])}"
        + "Z"
    )

    # Los cortes del asta van centrados en los huecos de la B: cada franja es
    # la continuación de una barra, y el corte, la de un hueco.
    c = MARCA["corte"]
    bordes = [0, c1[1] - c / 2, c1[1] + c / 2, c2[1] - c / 2, c2[1] + c / 2, ALTO]
    asta_d = ""
    for i in range(3):
        ya, yb = bordes[2 * i], bordes[2 * i + 1]
        asta_d += f"M{P(0, ya)}L{P(asta, ya)}L{P(asta, yb)}L{P(0, yb)}Z"

    ancho = max(inclinar(c1[0] + ro, c1[1])[0], inclinar(c2[0] + ro, c2[1])[0])
    return asta_d, panza, ancho


ASTA_D, PANZA_D, ANCHO_MARCA = marca_trazos()


def marca_svg(color_asta=AZUL, color_panza=VERDE, x=0, y=0, escala=1):
    tr = f' transform="translate({fmt(x)} {fmt(y)}) scale({fmt(escala)})"' if (x or y or escala != 1) else ""
    return (f'<g{tr}><path fill="{color_asta}" d="{ASTA_D}"/>'
            f'<path fill="{color_panza}" d="{PANZA_D}"/></g>')


# ---------------------------------------------------------------- texto
class Fuente:
    def __init__(self, ruta, peso):
        f = TTFont(ruta)
        self.f = instancer.instantiateVariableFont(f, {"wght": peso})
        self.cmap = self.f.getBestCmap()
        self.gs = self.f.getGlyphSet()
        self.upm = self.f["head"].unitsPerEm
        self.cap = self.f["OS/2"].sCapHeight
        self.xh = self.f["OS/2"].sxHeight

    def glifo(self, nombre, escala, x, y):
        pen = SVGPathPen(self.gs, ntos=lambda v: fmt(v))
        self.gs[nombre].draw(TransformPen(pen, (escala, 0, 0, -escala, x, y)))
        return pen.getCommands()

    def texto(self, cadena, alto_cap, x, y, tracking=0.0, ajustes=None):
        """Devuelve (path, ancho). `y` es la línea base. `ajustes` corrige pares a ojo, en milésimas de em."""
        escala = alto_cap / self.cap
        ajustes = ajustes or {}
        d, cur = "", x
        for i, ch in enumerate(cadena):
            nombre = "dotlessi" if ch == "ı" and "dotlessi" in self.gs else self.cmap[ord(ch)]
            d += self.glifo(nombre, escala, cur, y)
            avance = self.gs[nombre].width + tracking * self.upm
            avance += ajustes.get(cadena[i:i + 2], 0) * self.upm / 1000
            cur += avance * escala
        return d, cur - x - tracking * self.upm * escala

    def caja(self, nombre):
        from fontTools.pens.boundsPen import BoundsPen
        bp = BoundsPen(self.gs)
        self.gs[nombre].draw(bp)
        return bp.bounds


def nombre_svg(fuente, alto_cap, x, y, color, color_punto=VERDE):
    """«Buxi» con el punto de la i en verde: el mismo punto que en la app marca lo que está en vivo."""
    ajustes = {"Bu": -6, "ux": -14, "xı": -8}
    d, ancho = fuente.texto("Buxı", alto_cap, x, y, tracking=-0.012, ajustes=ajustes)
    escala = alto_cap / fuente.cap
    # Posición de la i dentro de la palabra
    cur = x
    for i, ch in enumerate("Bux"):
        n = fuente.cmap[ord(ch)]
        cur += (fuente.gs[n].width - 0.012 * fuente.upm + ajustes.get("Buxı"[i:i + 2], 0) * fuente.upm / 1000) * escala
    x0, _, x1, _ = fuente.caja("dotlessi")
    cx = cur + (x0 + x1) / 2 * escala
    asta = (x1 - x0) * escala
    r = asta * 0.62
    # Centro del punto: a la altura de las mayúsculas, para que la palabra cierre en una línea.
    cy = y - alto_cap + r * 0.86
    punto = f'<circle cx="{fmt(cx)}" cy="{fmt(cy)}" r="{fmt(r)}" fill="{color_punto}"/>'
    return f'<path fill="{color}" d="{d}"/>{punto}', ancho


def svg(ancho, alto, cuerpo, fondo=None, radio=0, titulo="Buxi"):
    f = f'<rect width="{fmt(ancho)}" height="{fmt(alto)}" rx="{fmt(radio)}" fill="{fondo}"/>' if fondo else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {fmt(ancho)} {fmt(alto)}" '
            f'role="img" aria-label="{titulo}"><title>{titulo}</title>{f}{cuerpo}</svg>\n')


def construir(ruta_fuente, salida):
    os.makedirs(salida, exist_ok=True)
    negra = Fuente(ruta_fuente, 800)
    media = Fuente(ruta_fuente, 600)
    archivos = {}

    # --- Marca sola ---
    for nombre, (ca, cp) in {
        "buxi-marca": (AZUL, VERDE),
        "buxi-marca-blanco": (BLANCO, BLANCO),
        "buxi-marca-marino": (MARINO, MARINO),
    }.items():
        archivos[nombre] = svg(ANCHO_MARCA, ALTO, marca_svg(ca, cp))

    # --- Horizontal ---
    cap = 76                       # altura de las mayúsculas del nombre
    sep = MARCA["t"]               # separación marca-nombre = un grosor de barra
    base = (ALTO + cap) / 2        # el nombre va centrado con la marca
    for nombre, (color, ca, cp, cpunto) in {
        "buxi-logo-horizontal": (BLANCO, AZUL, VERDE, VERDE),            # sobre oscuro
        "buxi-logo-horizontal-claro": (MARINO, AZUL, VERDE, VERDE),      # sobre claro
        "buxi-logo-horizontal-blanco": (BLANCO, BLANCO, BLANCO, BLANCO), # una tinta
        "buxi-logo-horizontal-marino": (MARINO, MARINO, MARINO, MARINO),
    }.items():
        texto, ancho_t = nombre_svg(negra, cap, ANCHO_MARCA + sep, base, color, cpunto)
        archivos[nombre] = svg(ANCHO_MARCA + sep + ancho_t, ALTO, marca_svg(ca, cp) + texto)

    # --- Vertical con lema ---
    cap_v, esc_m = 64, 1.3
    texto, ancho_t = nombre_svg(negra, cap_v, 0, 0, BLANCO)
    lema_d, ancho_l = media.texto("Tus buses en tiempo real", 15, 0, 0, tracking=0.06)
    ancho = max(ancho_t, ancho_l, ANCHO_MARCA * esc_m)
    alto_m = ALTO * esc_m
    y_nombre = alto_m + 34 + cap_v
    y_lema = y_nombre + 40
    for nombre, (color, ca, cp, clema) in {
        "buxi-logo-vertical": (BLANCO, AZUL, VERDE, GRIS),
        "buxi-logo-vertical-claro": (MARINO, AZUL, VERDE, "#5d6c84"),
    }.items():
        texto, _ = nombre_svg(negra, cap_v, (ancho - ancho_t) / 2, y_nombre, color)
        lema_d, _ = media.texto("Tus buses en tiempo real", 15, (ancho - ancho_l) / 2, y_lema, tracking=0.06)
        # La marca se centra por su masa, no por su caja: la inclinación la carga a la derecha.
        xm = (ancho - ANCHO_MARCA * esc_m) / 2 - K * ALTO * esc_m * 0.12
        cuerpo = marca_svg(ca, cp, xm, 0, esc_m) + texto + f'<path fill="{clema}" d="{lema_d}"/>'
        archivos[nombre] = svg(ancho, y_lema + 6, cuerpo)

    # --- Ícono de app (1024, esquinas a cargo del sistema) y favicon ---
    lado = 1024
    esc = lado * 0.5 / ALTO
    xm = (lado - ANCHO_MARCA * esc) / 2 - K * ALTO * esc * 0.06
    ym = (lado - ALTO * esc) / 2
    archivos["buxi-icono-app"] = svg(lado, lado, marca_svg(AZUL, VERDE, xm, ym, esc), fondo=MARINO)
    archivos["buxi-icono-app-redondeado"] = svg(lado, lado, marca_svg(AZUL, VERDE, xm, ym, esc), fondo=MARINO, radio=lado * 0.225)
    lado_f = 64
    esc = lado_f * 0.62 / ALTO
    xm = (lado_f - ANCHO_MARCA * esc) / 2 - K * ALTO * esc * 0.06
    archivos["favicon"] = svg(lado_f, lado_f, marca_svg(AZUL, VERDE, xm, (lado_f - ALTO * esc) / 2, esc), fondo=MARINO, radio=14)

    for nombre, contenido in archivos.items():
        with open(os.path.join(salida, nombre + ".svg"), "w", encoding="utf-8", newline="\n") as fh:
            fh.write(contenido)
    return archivos


if __name__ == "__main__":
    arch = construir(sys.argv[1], sys.argv[2])
    for n, c in arch.items():
        print(f"{n}.svg  {len(c)} bytes")
    print("ancho de la marca:", round(ANCHO_MARCA, 2), "alto:", ALTO)
