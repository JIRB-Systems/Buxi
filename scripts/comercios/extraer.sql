-- Los comercios de Costa Rica de la última versión de Overture Maps.
--
-- La corre .github/workflows/comercios-mapa.yml con el CLI de DuckDB, que
-- lee los Parquet públicos de Overture directo de S3 (sin bajarlos enteros:
-- solo las filas dentro del recuadro de Costa Rica).
-- __RELEASE__ lo reemplaza el workflow por la carpeta de la versión
-- ("2026-10-22.0/").
--
-- Los lugares son puntos: el centro es la misma esquina del recuadro, así
-- que no hace falta la extensión espacial para sacar la coordenada.

INSTALL httpfs;
LOAD httpfs;
SET s3_region = 'us-west-2';

COPY (
  SELECT
    id,
    names.primary                 AS nombre,
    basic_category                AS basica,
    taxonomy.primary              AS primaria,
    taxonomy.hierarchy            AS jerarquia,
    confidence                    AS confianza,
    operating_status              AS estado,
    bbox.xmin                     AS lon,
    bbox.ymin                     AS lat
  FROM read_parquet('s3://overturemaps-us-west-2/release/__RELEASE__theme=places/type=place/*', hive_partitioning = 1)
  WHERE bbox.xmin >= -85.95 AND bbox.xmax <= -82.55
    AND bbox.ymin >= 8.03  AND bbox.ymax <= 11.22
    -- El recuadro toca el sur de Nicaragua y el oeste de Panamá: fuera los
    -- que tienen dirección de otro país. Los que no tienen dirección quedan.
    AND coalesce(addresses[1].country, 'CR') = 'CR'
    AND names.primary IS NOT NULL
) TO 'comercios-cr.json' (FORMAT JSON, ARRAY true);
