-- Respaldo de los nombres de parada, origen y destino ANTES de acortarlos
-- (20 oct 2026). Eran la dirección entera que devuelve el geocodificador.
-- Para deshacer la limpieza, ejecutar este archivo tal cual.

update paradas set nombre = 'Bagaces, Guanacaste, 50401, Costa Rica' where id = '03396a65-ca9b-4645-848a-ffc9df3dfad4';
update paradas set nombre = 'Terminal Pulmitan de Liberia, Avenida 5 Presbítero Fernando González Saborío, Los Ángeles, Liberia, Guanacaste, 50101, Costa Rica' where id = '8c05b7a1-cb13-4606-a499-71e659a39db9';
update paradas set nombre = 'Terminal La Cruz, Carretera Interamericana Norte, Peñas Blancas, La Cruz, Guanacaste, 51001, Costa Rica' where id = 'b10296e7-ee4a-426d-90c5-bb1064eb833d';
update paradas set nombre = 'Terminal Pulmitan, 0095, Calle 24 Ricardo Rojas Vincenzi, México, Merced, San José, Área Metropolitana de San José, San José, 10102, Costa Rica' where id = 'bddcd5ad-c3bc-42dd-8adf-1159a88cba61';
update paradas set nombre = 'Terminal de Buses de Liberia, Calle 12, Los Ángeles, Liberia, Guanacaste, 50101, Costa Rica' where id = 'c69e0429-79be-421a-a476-d01e28417542';
update paradas set nombre = 'Terminal de Buses Municipal, Avenida 5, Corazón de Jesús, La Cruz, Guanacaste, 51001, Costa Rica' where id = 'cf804671-7a21-424d-ba45-8070ec787b85';
update paradas set nombre = 'Terminal de Buses de Liberia, Calle 12, Los Ángeles, Liberia, Guanacaste, 50101, Costa Rica' where id = 'd28023d0-f341-4bdb-885b-1f3cf1474e55';

update rutas set destino = 'Terminal de Buses Municipal, Avenida 5, Corazón de Jesús, La Cruz, Guanacaste, 51001, Costa Rica' where id = '4c9aa2e6-ac10-4e39-8ff8-099e3bf71391';
update rutas set destino = 'Terminal La Cruz, Carretera Interamericana Norte, Peñas Blancas, La Cruz, Guanacaste, 51001, Costa Rica' where id = '54afdad1-322f-45a6-bc33-9be81f111917';
update rutas set destino = 'Bagaces, Guanacaste, 50401, Costa Rica' where id = '63e9ed1b-bd0e-4c50-a1a9-7a86bd26f088';
update rutas set destino = 'Terminal Pulmitan, 0095, Calle 24 Ricardo Rojas Vincenzi, México, Merced, San José, Área Metropolitana de San José, San José, 10102, Costa Rica' where id = 'b1bf5ef2-a236-4fef-a6f8-63a98c7e5275';

update rutas set origen = 'Terminal de Buses de Liberia, Calle 12, Los Ángeles, Liberia, Guanacaste, 50101, Costa Rica' where id = '54afdad1-322f-45a6-bc33-9be81f111917';
update rutas set origen = 'Terminal de Buses de Liberia, Calle 12, Los Ángeles, Liberia, Guanacaste, 50101, Costa Rica' where id = '63e9ed1b-bd0e-4c50-a1a9-7a86bd26f088';
update rutas set origen = 'Terminal Pulmitan de Liberia, Avenida 5 Presbítero Fernando González Saborío, Los Ángeles, Liberia, Guanacaste, 50101, Costa Rica' where id = 'b1bf5ef2-a236-4fef-a6f8-63a98c7e5275';
