# Logo de Buxi

Una B en movimiento: el asta son tres franjas (carriles, líneas de velocidad) y el punto de la «i» es el mismo punto verde que en la app marca lo que está en vivo.

Parte de los tres bocetos generados con IA de octubre de 2026. Se tomó la idea del primero y se redibujó con geometría exacta: sin brillos, sin sombreado de falso 3D, sin degradados.

## Archivos

| Archivo | Para qué |
|---|---|
| `buxi-logo-horizontal.svg` | Uso principal, sobre fondo oscuro |
| `buxi-logo-horizontal-claro.svg` | Sobre fondo claro |
| `buxi-logo-horizontal-blanco.svg` / `-marino.svg` | Una sola tinta (sobre foto, sobre color, impresión a un color) |
| `buxi-logo-vertical.svg` / `-claro.svg` | Con el lema, para portadas y espacios cuadrados |
| `buxi-marca.svg` / `-blanco.svg` / `-marino.svg` | La B sola, cuando el nombre ya está cerca o no cabe |
| `buxi-icono-app.svg` | Ícono de la app, cuadrado completo (el sistema recorta las esquinas) |
| `buxi-icono-app-redondeado.svg` | El mismo con esquinas, para maquetas y web |
| `favicon.svg` | Pestaña del navegador |
| `png/` | Las mismas piezas ya exportadas |

Los SVG no dependen de ninguna fuente: el nombre está convertido a trazos.

## Reglas

- **Colores:** azul `#2f8bff` (asta), verde `#00c853` (panza y punto), marino `#0a1628` (fondo o texto), blanco. Ninguno más.
- **Aire:** alrededor del logo, al menos el grosor de una barra de la B.
- **Tamaño mínimo:** logo horizontal 72 px de ancho; por debajo, la marca sola (hasta 16 px).
- **No:** degradados, sombras, brillos, contornos, girarlo, cambiar la inclinación, recolorear las piezas por separado, ni escribir el nombre en otra tipografía.

## Cómo está construido

Todo sale de `construir.py`. La marca depende de cinco números (grosor de barra, hueco, ancho del asta, corte y ángulo); el nombre es Manrope ExtraBold, la tipografía de la app.

```
pip install fonttools brotli
python construir.py ../../buxi-app/src/assets/fonts/manrope-latin-var.woff2 .
```

Para cambiar una proporción se toca el número en `MARCA` y se regenera todo; no se edita un SVG a mano.

## En la app

`app.py` genera las piezas que usa la app (mismo comando, cambiando el script): la marca y el nombre de `buxi-app/src/assets/brand/`, el bloque de la pantalla de arranque y las fuentes de los íconos nativos.

- **En pantalla:** la marca y el nombre son dos imágenes dentro de `.bx-lockup` (ver `global.scss`). El nombre mide dos tercios del alto de la marca.
- **Ícono instalable de Android:** la carpeta `android/` se genera en cada máquina y no está en el repositorio, así que el ícono se regenera al compilar. Las fuentes están en `buxi-app/resources/`. Después de `npx cap add android` o `npx cap sync`:

  ```
  cd buxi-app
  npm run iconos
  ```

  Eso escribe los `mipmap-*` y la pantalla de arranque nativa. `icon-foreground.png` deja la marca dentro de la zona segura del ícono adaptable, que Android recorta a un círculo.

