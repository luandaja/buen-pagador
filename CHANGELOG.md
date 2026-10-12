# Changelog

## [1.4.0](https://github.com/luandaja/buen-pagador/compare/v1.3.0...v1.4.0) (2026-10-12)


### Features

* guardar boletas sin asignar todo, cantidades editables y lupa de la boleta ([fa94285](https://github.com/luandaja/buen-pagador/commit/fa94285024a9baf0a0f5b97409707fc23a5a1616))
* save receipts with items to assign later, editable quantities and a receipt lens ([3d96241](https://github.com/luandaja/buen-pagador/commit/3d96241b9bff0a9ec67af92ba8d416c4cf3f515a))

## [1.3.0](https://github.com/luandaja/buen-pagador/compare/v1.2.0...v1.3.0) (2026-10-12)


### Features

* foto de la boleta con la línea de cada ítem marcada ([d3a0b79](https://github.com/luandaja/buen-pagador/commit/d3a0b79355b8c49825c1dfc577ecd62a15899bab))
* show the receipt photo and highlight each item's line ([17e7e91](https://github.com/luandaja/buen-pagador/commit/17e7e910c1675eda2c3282907f33f8960d742dad))

## [1.2.0](https://github.com/luandaja/buen-pagador/compare/v0.1.0...v1.2.0) (2026-10-12)


### Features

* collaborative groups with encrypted per-item sync ([f2a7dc9](https://github.com/luandaja/buen-pagador/commit/f2a7dc9452bafcf97561c43ee2c7a70dcb2843e6))
* harmonious color palettes per group ([a9eaa49](https://github.com/luandaja/buen-pagador/commit/a9eaa49db9c124f0b568b1614d70b8f008ba7bd8))
* itemized receipts read by AI, payment details, previews and link lifetime ([62d1a0a](https://github.com/luandaja/buen-pagador/commit/62d1a0a4c000cd95860ba45c7b5b47d628b39518))
* notes and receipt photos for expenses ([34da8d3](https://github.com/luandaja/buen-pagador/commit/34da8d3173ad59a69f6c31d42aa02f5f97125aa3))
* shareable text summary and general-purpose copy ([0d7411e](https://github.com/luandaja/buen-pagador/commit/0d7411e4cffdc5a7c0aa2cc0edf563daf2127438))
* split expenses for trips and outings (/cuenta) ([eb2e2f5](https://github.com/luandaja/buen-pagador/commit/eb2e2f51e46c8899f00861c2536f1796d1d3c8b0))
* v0.2.0 foundations — Preact 11 and versioning ([eca08e2](https://github.com/luandaja/buen-pagador/commit/eca08e29ad34e19cb0dd17a1753bb503b237e55c))
* v0.4.0 — cuentas colaborativas con sync cifrado ([5a9f099](https://github.com/luandaja/buen-pagador/commit/5a9f099f3eeac2a5b26855620e4cb20fa073aab2))
* v0.5.0 — notas y fotos de boletas ([526291a](https://github.com/luandaja/buen-pagador/commit/526291ae9815b945068d9d415c40ba7c67cd4ee1))
* v1.0.0 — resumen para compartir y copy generalista ([aca6ce6](https://github.com/luandaja/buen-pagador/commit/aca6ce6d8192812cb969daa0e7bdb1fe64a9ffce))
* v1.1.0 — paletas de color armoniosas ([960b4dd](https://github.com/luandaja/buen-pagador/commit/960b4dd575607ccfd4b4689686c6d49bcf40d197))
* v1.2.0 — boletas por ítems con IA, datos de pago, vista previa y vida del link ([5ca4826](https://github.com/luandaja/buen-pagador/commit/5ca4826ec665dfcd857ac7a08ccff2e7a66f853c))
* versioning foundations ([f288bd8](https://github.com/luandaja/buen-pagador/commit/f288bd8eb00bfb077b425ff8c94143473e3d82f3))


### Bug Fixes

* load Tesseract from the CDN on demand ([c5a2ba9](https://github.com/luandaja/buen-pagador/commit/c5a2ba99a0213303c8d37194bee60a285aeccbd7))
* save group edits in the same tick ([8d08226](https://github.com/luandaja/buen-pagador/commit/8d08226f1f5e5341885c5cf6a337fd1bac4fa113))


### Miscellaneous Chores

* release 1.2.0 ([e102380](https://github.com/luandaja/buen-pagador/commit/e1023809f96feda64904eadf973f68aa56101ecb))

## 0.1.0

Primera versión: El Buen Pagador para la cancha.

- Sube la foto del equipo, detecta las caras y les pone un emoji hasta que paguen.
- Marca quién pagó, calcula la cuota y lo que falta cobrar.
- Historial de partidos en el dispositivo.
- Exporta una imagen o comparte un link de solo lectura cifrado de punta a punta.
- Datos de pago (nota y QR) en el link compartido.
