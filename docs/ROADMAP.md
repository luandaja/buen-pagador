# Roadmap

De "¿quién pagó la cancha?" a dividir cualquier cuenta (un viaje, una cena, un regalo), sin perder lo que lo hace simple: **pagó / no pagó**.

## Principios

- Pocos campos. Lo opcional se esconde hasta que se necesita.
- Local-first y cifrado de punta a punta: el servidor solo guarda ciphertext.
- Mientras menos JS, mejor: CI exige menos de 40 KB gz de JS inicial por página. Nada de face-api fuera de la pantalla de la foto.
- Lógica en funciones puras con tests; componentes delgados. CI exige tests y CRAP < 10.

## Decisiones técnicas

| Tema | Decisión | Por qué |
|---|---|---|
| UI nueva | Preact 11 + signals, montado con `render()` desde un `<script>` (sin `@astrojs/preact`) | ~8 KB gz, el stack más AI-friendly, JSX nativo de Vite, sin Babel. Con E2E no hay nada que renderizar en el servidor. |
| UI existente (cancha) | Se queda en TS vanilla; se migra solo si se toca | Migración incremental |
| Descartados | htmx, Datastar (server-driven, incompatibles con E2E), Alpine (lógica fuera de TS y del gate CRAP), Svelte, Lit | Dictamen del comité técnico |
| Edición concurrente | Un campo cifrado por ítem en un HASH de Redis + `PATCH`; merge de tres vías por campo en el cliente; polling con `?since=` | Dos personas agregando gastos no se pisan, sin CRDT ni websockets |
| Evidencia | Nota de texto compartida + foto de boleta cifrada en Vercel Blob privado (`receipts/<grupo>/<gasto>.txt`), leída vía `/api/group/:id/receipt/:gasto`. Si Blob falla o no hay cuota, la foto queda en el dispositivo marcada como pendiente y se sube en un sync posterior (reintento cada 5 min); también se suben así las fotos anteriores a compartir o a Blob. Un cron diario (`/api/cron/receipts`) borra las fotos de grupos vencidos usando el sorted set `bp:receipts:due` | Nada de binarios en Redis; las fotos vencen con el grupo |
| Dependencias | Última versión mayor de las dependencias principales | Si una integración se atrasa, se usa la librería directo |

## Modelo de datos

```ts
interface Person  { id: string; name: string; emoji: string; settled: number; at?: number }
interface Expense { id: string; what: string; amount: number; by: string; for?: string[]; note?: string; at?: number }
interface Group   { title: string; emoji: string; currency: string; palette: string; people: Person[]; expenses: Expense[] }
```

La primera persona cobra y reparte. Lo que debe cada persona = su parte de cada gasto − lo que adelantó (`by`); los montos se calculan en céntimos. "Pagó" guarda `settled`; si luego entra un gasto, se muestra "pagó S/120, debe S/30 más". La foto con caras es solo una forma rápida de crear `Person[]`.

**No hacer:** pagó por gasto × persona, optimización de transferencias, cuentas de usuario, CRDT/websockets, binarios en Redis.

## Versiones

| Versión | Estado | Contenido |
|---|---|---|
| v0.1.0 | ✅ | Cancha: foto, caras, pagó / no pagó, link compartido |
| v0.2.0 | ✅ | Fundaciones: Preact 11, release-please + CHANGELOG, versión en el footer, `schemaVersion`, presupuesto de JS, E2E con Playwright |
| v0.3.0 | ✅ | Cuentas (`/cuenta`): personas, gastos, saldos, toggle pagó, emoji del grupo personalizable, IndexedDB v2 |
| v0.4.0 | ✅ | Colaborativo: link para editar (cualquiera agrega gastos) y link para ver (`/c`), sync cifrado por ítem |
| v0.5.0 | ✅ | Evidencia: nota compartida, foto de boleta solo en el dispositivo |
| v1.0.0 | ✅ | Resumen para WhatsApp, copy generalista |
| v1.1.0 | ✅ | 6 paletas curadas con contraste AA validado en tests, por cuenta y visibles en el link público |
| v2.0.0 | Pendiente | Multimoneda |

## Versionamiento

- **App:** SemVer con Conventional Commits; release-please genera CHANGELOG, tags y GitHub Releases.
- **Datos locales:** versión de IndexedDB con migraciones probadas.
- **Payload compartido:** `schemaVersion` dentro del JSON cifrado; los links viejos se siguen leyendo hasta que expiran.
