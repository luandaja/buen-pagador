# Roadmap

De "¿quién pagó la cancha?" a dividir cualquier cuenta (un viaje, una cena, un regalo), sin perder lo que lo hace simple: **pagó / no pagó**.

## Principios

- Pocos campos. Lo opcional se esconde hasta que se necesita.
- Local-first y cifrado de punta a punta: el servidor solo guarda ciphertext.
- Mientras menos JS, mejor. Nada de face-api fuera de la pantalla de la foto.
- Lógica en funciones puras con tests; componentes delgados. CI exige tests y CRAP < 10.

## Decisiones técnicas

| Tema | Decisión | Por qué |
|---|---|---|
| UI nueva | Preact 11 + signals, montado con `render()` desde un `<script>` (sin `@astrojs/preact`) | ~8 KB gz, el stack más AI-friendly, JSX nativo de Vite, sin Babel. Con E2E no hay nada que renderizar en el servidor. |
| UI existente (cancha) | Se queda en TS vanilla; se migra solo si se toca | Migración incremental |
| Descartados | htmx, Datastar (server-driven, incompatibles con E2E), Alpine (lógica fuera de TS y del gate CRAP), Svelte, Lit | Dictamen del comité técnico |
| Edición concurrente | Un campo cifrado por ítem en un HASH de Redis + `PATCH` | Dos personas agregando gastos no se pisan, sin CRDT ni websockets |
| Evidencia | v1: nota de texto compartida + foto solo local. v2: Vercel Blob cifrado | Nada de binarios en Redis |
| Dependencias | Última versión mayor de las dependencias principales | Si una integración se atrasa, se usa la librería directo |

## Modelo de datos

```ts
interface Person  { id: string; name: string; emoji: string; settled: number } // monto ya pagado
interface Expense { id: string; what: string; amount: number; by?: string; for?: string[]; note?: string }
interface Trip    { title: string; emoji: string; currency: string; rounding: number }
```

Lo que debe cada persona = su parte de cada gasto − lo que adelantó (`by`). "Pagó" guarda `settled`; si luego entra un gasto, se muestra "pagó S/120, debe S/30 más". La foto con caras es solo una forma rápida de crear `Person[]`.

**No hacer:** pagó por gasto × persona, optimización de transferencias, cuentas de usuario, CRDT/websockets, binarios en Redis.

## Versiones

| Versión | Contenido |
|---|---|
| v0.1.0 | Cancha: foto, caras, pagó / no pagó, link compartido |
| v0.2.0 | Fundaciones: Preact 11, release-please + CHANGELOG, versión en el footer, `schemaVersion` en datos locales y compartidos, presupuesto de JS en CI |
| v0.3.0 | Gastos (local): página de viaje, personas, gastos, saldos, toggle pagó, **emoji del grupo personalizable** (🏀 por defecto en Cancha) |
| v0.4.0 | Colaborativo: ítems cifrados por gasto, cualquiera con el link de edición agrega gastos |
| v0.5.0 | Evidencia: nota compartida, foto de boleta local |
| v1.0.0 | Pulido, copy generalista, exportar resumen |
| v1.1.0 | Paletas de color curadas (5–6, contraste AA) vía `data-palette` sobre los tokens CSS |
| v2.0.0 | Multimoneda, boletas compartidas en Vercel Blob cifrado |

## Versionamiento

- **App:** SemVer con Conventional Commits; release-please genera CHANGELOG, tags y GitHub Releases.
- **Datos locales:** versión de IndexedDB con migraciones probadas.
- **Payload compartido:** `schemaVersion` dentro del JSON cifrado; los links viejos se siguen leyendo hasta que expiran.
