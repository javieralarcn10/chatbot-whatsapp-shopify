# Shopify WhatsApp AI Assistant

Boilerplate de un asistente de atención al cliente por WhatsApp para tiendas Shopify. Recibe mensajes a través de [Zernio](https://zernio.com), los procesa de forma asíncrona con QStash y responde con un agente de IA con acceso en tiempo real al catálogo, pedidos y checkout de tu tienda.

Este proyecto está pensado como punto de partida: clónalo, conecta tu propia tienda Shopify y personaliza el system prompt con la información y el tono de tu marca.

## Características

- **WhatsApp vía Zernio** — Webhooks firmados, deduplicación de eventos y filtro por números permitidos.
- **Procesamiento asíncrono** — QStash desacopla la recepción del webhook del procesamiento del agente (timeout de 10 min, 3 reintentos).
- **Agente de IA** — `ToolLoopAgent` (Vercel AI SDK) con razonamiento, fallback de modelos y hasta 10 pasos por conversación.
- **Herramientas nativas de Shopify** — Búsqueda de productos, detalle de producto, recomendaciones, listado de colecciones, búsqueda de pedidos y creación de checkout, implementadas directamente contra la Storefront/Admin API (sin pasar por un servidor MCP).
- **Memoria persistente** — Supermemory por usuario (`accountId-phoneNumber`) para contexto entre conversaciones.
- **Multimodal** — Transcripción de audios e interpretación de imágenes y PDFs (con caption).
- **Rate limiting** — Límites por ráfaga (30 msg / 2 min), diario (150 msg / 24 h) y bloqueo temporal por reincidencia.
- **Estado en Redis** — Hilos de conversación, transcripciones (45 días, máx. 200 por usuario) y debounce de mensajes (4 s). Compatible con [Upstash Redis](https://upstash.com/docs/redis) (mismo proveedor que QStash).
- **Detección de mensajes negativos** — Cada mensaje del cliente se evalúa con IA para detectar quejas, enfado o frustración (`src/utils/eval.ts`).
- **Auto-mejora del system prompt (opcional)** — Cuando se detecta un mensaje negativo, puede abrir automáticamente una Pull Request en GitHub proponiendo una mejora del system prompt (ver [sección dedicada](#auto-mejora-del-system-prompt-opcional)).

## Arquitectura

```
WhatsApp → Zernio → POST /zernio/new-message
                         │
                         ├─ Verificar firma HMAC
                         ├─ Deduplicar evento (Redis)
                         ├─ Rate limit
                         └─ Publicar en QStash
                                    │
                                    ▼
                         POST /qstash/new-message
                                    │
                                    ├─ Verificar firma QStash
                                    ├─ Debounce / burst (Chat SDK)
                                    ├─ Transcribir audio / analizar imagen o PDF
                                    └─ Agente IA + Shopify tools + Supermemory
                                               │
                                               ▼
                                    Respuesta por WhatsApp (Zernio API)
```

## Requisitos

- Node.js 20+
- Redis ([Upstash Redis](https://upstash.com/docs/redis) recomendado, o cualquier instancia compatible con el protocolo Redis)
- Cuenta en [Zernio](https://zernio.com) con WhatsApp conectado
- [Upstash QStash](https://upstash.com/docs/qstash) (o QStash local en desarrollo)
- Tienda Shopify con Storefront API (token público) y Admin API (token privado) habilitadas
- API keys: AI Gateway, Supermemory, Zernio

## Instalación

```bash
git clone <repo-url>
cd chatbot-shopify
npm install
cp .env.example .env
```

Rellena las variables en `.env` (ver tabla siguiente) y arranca en desarrollo:

```bash
npm run dev
```

Para producción:

```bash
npm run build
npm start
```

## Personalización para tu tienda

Este boilerplate no incluye información de ninguna marca concreta. Para adaptarlo a tu tienda:

1. **System prompt** (`src/assistant/instructions/system-prompt.ts`) — Sustituye los textos entre `[CORCHETES]` por el nombre de tu tienda, tono de marca, políticas de envío/devolución/pagos y cualquier otra regla de negocio propia. Es el lugar principal donde defines qué puede y no puede responder tu asistente.
2. **Metafields de Shopify** (opcional) — Si tu catálogo usa metafields personalizados (ficha técnica, ingredientes, tallas, etc.), añádelos en `src/shopify/queries.ts` y expón su valor formateado en `src/shopify/formatters.ts`. Ambos archivos incluyen comentarios indicando dónde hacerlo.
3. **Herramientas de Shopify** (`src/shopify/tools.ts`) — Añade, quita o adapta las tools disponibles para el agente (por ejemplo, si tu tienda no gestiona pedidos por Admin API, puedes eliminar `search_orders`).
4. **Formato de salida** (`src/assistant/instructions/format-instructions.ts`) — Ajusta las reglas de formato si tu canal no es WhatsApp o quieres un estilo distinto.

## Variables de entorno

| Variable                     | Descripción                                                                                                                                                                |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                       | Puerto del servidor (por defecto `3000`)                                                                                                                                   |
| `APP_URL`                    | URL pública del servicio (QStash llama a `{APP_URL}/qstash/new-message`)                                                                                                   |
| `ZERNIO_API_KEY`             | API key de Zernio para enviar mensajes y descargar adjuntos                                                                                                                |
| `ZERNIO_WEBHOOK_SECRET`      | Secreto para verificar la firma HMAC de los webhooks                                                                                                                       |
| `REDIS_URL`                  | URL de conexión de Redis (`rediss://default:PASSWORD@HOST:PORT`; en [Upstash Redis](https://upstash.com/docs/redis) la copias directamente del dashboard)                  |
| `SHOPIFY_DOMAIN`             | Dominio de la tienda Shopify (`mi-tienda.myshopify.com`)                                                                                                                   |
| `SHOPIFY_ACCESS_TOKEN`       | Token de acceso de la Admin API (usado por `search_orders`)                                                                                                                |
| `SHOPIFY_STORE_FRONT_TOKEN`  | Token público de la Storefront API (usado por el resto de herramientas de catálogo/checkout)                                                                               |
| `SHOPIFY_API_VERSION`        | Versión de la API de Shopify a usar (opcional, por defecto `2026-01`)                                                                                                      |
| `AI_GATEWAY_API_KEY`         | API key del AI Gateway (Vercel AI SDK)                                                                                                                                     |
| `SUPERMEMORY_API_KEY`        | API key de Supermemory                                                                                                                                                     |
| `QSTASH_URL`                 | URL de QStash (`http://127.0.0.1:8080` en local con [QStash CLI](https://upstash.com/docs/qstash/howto/local-development))                                                 |
| `QSTASH_TOKEN`               | Token de QStash                                                                                                                                                            |
| `QSTASH_CURRENT_SIGNING_KEY` | Clave de firma actual de QStash                                                                                                                                            |
| `QSTASH_NEXT_SIGNING_KEY`    | Clave de firma siguiente de QStash                                                                                                                                         |
| `ALLOWED_PHONES`             | Lista de números a los que el bot responderá, separados por coma (ej. `+34600111222,+34600333444`). Si se deja vacío, responde a todos los números                         |
| `AUTO_IMPROVE_SYSTEM_PROMPT` | Activa la auto-mejora del system prompt vía PR de GitHub (opcional, por defecto desactivada). Ver [Auto-mejora del system prompt](#auto-mejora-del-system-prompt-opcional) |
| `GITHUB_TOKEN`               | Personal access token de GitHub con permisos de `Contents` y `Pull requests` sobre el repo (solo si `AUTO_IMPROVE_SYSTEM_PROMPT=true`)                                     |
| `GITHUB_REPO`                | Repositorio en formato `owner/repo` (solo si `AUTO_IMPROVE_SYSTEM_PROMPT=true`)                                                                                            |
| `GITHUB_BASE_BRANCH`         | Rama base sobre la que se abre la PR (opcional, por defecto `main`)                                                                                                        |

## Endpoints

| Método | Ruta                  | Descripción                                       |
| ------ | --------------------- | ------------------------------------------------- |
| `GET`  | `/up`                 | Health check                                      |
| `POST` | `/zernio/new-message` | Webhook de Zernio (`message.received`)            |
| `POST` | `/qstash/new-message` | Callback interno de QStash para procesar mensajes |

### Configuración del webhook en Zernio

Apunta el webhook de mensajes entrantes a:

```
{APP_URL}/zernio/new-message
```

En desarrollo local, expón el puerto con ngrok u otra herramienta similar y usa esa URL como `APP_URL`.

## Auto-mejora del system prompt (opcional)

Cada mensaje del cliente se evalúa con IA (`src/utils/eval.ts`) para detectar tono negativo (quejas, enfado, frustración, etc.). Cuando se detecta uno, además de registrarlo en logs, el proyecto puede abrir automáticamente una Pull Request en GitHub proponiendo una mejora del system prompt.

Esta función está **desactivada por defecto** y es totalmente opcional. Si la activas, el flujo hace lo siguiente:

1. Lee el contenido actual de `src/assistant/instructions/system-prompt.ts` directamente desde tu repo de GitHub.
2. Le pasa a un modelo de IA el mensaje negativo, el motivo detectado, las últimas 20 mensajes de la conversación y el system prompt actual.
3. El modelo devuelve un resumen del problema, cómo solucionarlo y el archivo `system-prompt.ts` actualizado.
4. Si hay cambios, crea una rama (`auto-improve/system-prompt-<timestamp>`), actualiza el archivo y abre una Pull Request con el resumen, la propuesta de mejora y el diff, lista para que la revise un humano antes de mergear.

Para habilitarla, define en tu `.env`:

```bash
AUTO_IMPROVE_SYSTEM_PROMPT=true
GITHUB_TOKEN=<personal access token con permiso "Contents" y "Pull requests" sobre el repo>
GITHUB_REPO=owner/repo
GITHUB_BASE_BRANCH=main   # opcional, por defecto "main"
```

La integración con la API de GitHub vive en `src/services/github.ts` y la lógica de análisis + apertura de PR en `src/utils/auto-improve-system-prompt.ts`.

## Estructura del proyecto

```
src/
├── index.ts                 # Servidor Fastify y rutas
├── assistant/
│   ├── agent.ts             # Agente ToolLoopAgent (tools de Shopify + Supermemory)
│   ├── bot.ts               # Chat SDK, debounce y flujo de mensajes
│   ├── media.ts             # Transcripción de audio/imagen/PDF
│   ├── errors-logging.ts    # Logging estructurado de errores del agente
│   └── instructions/        # Prompts modulares (sistema, shopify, contexto, memoria, formato)
├── shopify/
│   ├── tools.ts             # Tools del AI SDK (search_products, get_product_details, get_product_recommendations, list_collections, search_orders, create_checkout)
│   ├── shopify-api.ts       # Cliente GraphQL (Storefront + Admin API)
│   ├── queries.ts           # Queries/mutations GraphQL
│   └── formatters.ts        # Normalización de respuestas de Shopify
├── services/
│   ├── qstash.ts            # Publicación y verificación QStash
│   ├── zernio.ts            # Envío de mensajes WhatsApp
│   └── github.ts            # Cliente de la API de GitHub (branches, contenidos, Pull Requests)
├── utils/
│   ├── auto-improve-system-prompt.ts  # Auto-mejora opcional del system prompt vía PR de GitHub
│   ├── check-duplicated-webhook.ts
│   ├── eval.ts
│   ├── rate-limit.ts
│   └── verify-webhook-signature.ts
└── db/
    └── redis.ts             # Cliente Redis (ioredis, vía REDIS_URL — compatible con Upstash Redis)
```

## Scripts

| Comando          | Descripción                                     |
| ---------------- | ----------------------------------------------- |
| `npm run dev`    | Desarrollo con recarga automática (`tsx watch`) |
| `npm run build`  | Compila TypeScript a `dist/`                    |
| `npm start`      | Ejecuta la build de producción                  |
| `npm test`       | Ejecuta `test.ts` en modo watch                 |
| `npm run format` | Formatea el código fuente con Prettier          |

## Despliegue

El proyecto incluye `nixpacks.toml` para despliegue en plataformas compatibles (Railway, etc.):

- **Build:** `npm ci && npm run build`
- **Start:** `node dist/index.js`

Asegúrate de configurar todas las variables de entorno y de que `APP_URL` apunte a la URL pública del despliegue.

## Desarrollo local con QStash

1. Instala y arranca el [QStash CLI](https://upstash.com/docs/qstash/howto/local-development).
2. Configura `QSTASH_URL=http://127.0.0.1:8080` y las claves de firma que proporcione el CLI.
3. Expón tu servidor con ngrok: `ngrok http 3001` (o el puerto que uses).
4. Define `APP_URL` con la URL pública de ngrok.

## Licencia

ISC
