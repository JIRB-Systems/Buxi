# Diseño — modelo 3D del bus

`bus_buxi.blend` es un bus urbano estilizado low-poly con la paleta de BUXI:
verde de marca en la carrocería, azul noche en los vidrios, gris oscuro en
faldón, puertas y equipo de techo.

| Archivo | Qué es |
|---|---|
| `bus_buxi.blend` | El modelo (Blender 5.2 LTS, motor EEVEE, luz de 3 puntos) |
| `bus3d_frente.png` | Render 3/4 frontal |
| `bus3d_cenital.png` | Render cenital ortográfico |
| `bus3d_lateral.png` | Render de perfil ortográfico |

Medidas: **11.0 × 2.55 × 3.05 m**, mirando hacia **+Y** — la misma convención
con la que el marcador del mapa apunta "arriba".

## Para qué sirve y para qué no

Sirve para landing, redes y la ficha de la tienda de apps.

**No reemplaza el marcador del mapa.** Mirá el render cenital: visto desde
arriba un bus realista es casi un rectángulo redondeado y la dirección apenas
se lee — solo la delatan el parabrisas oscuro adelante y los stops rojos atrás.
Por eso el ícono del mapa (`registrarIconoBus` en `map.page.ts`) exagera la
trompa: desde arriba el realismo no comunica rumbo, la estilización sí.

## Si vas a retomar el .blend

Esta instalación de Blender está **en español**, así que el nodo del material se
llama `"BSDF Principista"`. Buscalo por `n.type == 'BSDF_PRINCIPLED'`, nunca por
nombre, o el script se cae.

Y ojo con la mezcla de transformaciones: las cajas del modelo tienen la posición
**horneada en la malla** (`transform_apply` también aplica la ubicación en esta
versión) y quedaron con `location = (0,0,0)`, mientras que las ruedas son
cilindros que sí guardan su posición en `location`. Reasignar `location` a una
caja **suma** sobre lo horneado, y resetear todos los `location` a cero manda las
ruedas al origen. Para reposicionar algo de forma segura, medí su `bound_box` en
espacio mundo y trasladá `objeto.data` con `Matrix.Translation`.

Los PNG están optimizados con PIL (`optimize=True, compress_level=9`, RGB en vez
de RGBA); si los volvés a renderizar desde Blender van a pesar ~40% más hasta que
los pases por el mismo paso.
