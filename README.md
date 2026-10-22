# El Buen Pagador

Cuentas claras, amistades largas. Divide la cancha, el viaje o la cena, y marca quién ya pagó.

- **Cancha** (`/`): sube la foto del equipo, cada cara recibe un emoji hasta que pague; sin foto, basta con pegar la lista del grupo (o decir cuántos son) y cada uno aparece con su nombre. La cuota puede ser fija aunque no cuadre con el costo, y el costo se puede ocultar del link. Exporta una imagen o comparte un link de solo lectura.
- **Cuentas** (`/cuenta`): agrega personas y gastos (qué, cuánto, quién pagó, entre quiénes), con nota y foto de la boleta opcionales. Cada persona tiene un solo botón de pagó / no pagó. Comparte un link para editar (cualquiera con el link agrega gastos) y otro para ver (`/c`).

Todo lo compartido se cifra en el navegador; la llave viaja en el `#` del link y el servidor solo guarda texto cifrado. Las fotos de boletas no salen del dispositivo.

```bash
pnpm install
pnpm dev
```

Para los links compartidos en producción, conecta Upstash Redis al proyecto en Vercel (`KV_REST_API_URL`, `KV_REST_API_TOKEN`). Sin esas variables, en desarrollo se guardan en `.astro/`.

## Calidad

```bash
pnpm test:crap   # tests unitarios + cobertura + CRAP < 10
pnpm e2e         # Playwright (Chromium) contra astro dev
pnpm build && pnpm js-budget 40   # JS inicial por página, en KB gz
```

## Versiones

SemVer con [Conventional Commits](https://www.conventionalcommits.org/); release-please abre el PR de release y escribe el [CHANGELOG](CHANGELOG.md). El plan está en [docs/ROADMAP.md](docs/ROADMAP.md).

[MIT](LICENSE)
