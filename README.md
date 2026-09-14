# ARIKARA BEATS

MVP de tienda propia para beats, licencias y servicios premium.

## Stack actual

- Frontend: HTML/CSS/JS vanilla en `/Users/abercipadro/ARIKARABEATS-WEB/frontend`
- Backend: Node + Express en `/Users/abercipadro/ARIKARABEATS-WEB/server`
- Pago: Stripe Checkout
- Persistencia Fase 1: JSON local en `/Users/abercipadro/ARIKARABEATS-WEB/server/data/orders.json`
- Email: SMTP/Nodemailer

## Flujo Fase 1

1. El usuario añade beats al carrito.
2. El frontend llama a `POST /api/checkout`.
3. El backend valida catálogo, licencias, disponibilidad y precios.
4. El backend crea un pedido `pending_checkout`.
5. Se crea una Stripe Checkout Session.
6. Stripe redirige a `success.html`.
7. El webhook confirma el pago real.
8. El pedido pasa a `paid_pending_delivery`.
9. Se envía:
   - email interno al equipo
   - email de confirmación al cliente
10. La entrega del material sigue siendo manual.

## Variables de entorno

Copia `.env.example` a `.env` y rellena:

```bash
cp .env.example .env
```

Variables importantes:

- `PORT`
- `APP_BASE_URL`
- `CORS_ALLOWED_ORIGINS`
- `STRIPE_SECRET_KEY`
- `STRIPE_PUBLISHABLE_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_CURRENCY`
- `SALES_NOTIFICATION_EMAIL`
- `ORDERS_API_KEY`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASS`
- `EMAIL_FROM`

Compatibilidad temporal:

- si vuestro `.env` antiguo todavía usa `APP_URL`, el backend lo sigue aceptando como fallback de `APP_BASE_URL`
- si todavía usáis `EMAIL_TO`, también se acepta como fallback de `SALES_NOTIFICATION_EMAIL`

## Frontend y backend en producción

El frontend está pensado para desplegarse en Netlify y el backend en Render.

Configuración actual del frontend:

- en local usa rutas relativas (`localhost`)
- en producción usa como base de API:
  - `https://arikara-beats-api.onrender.com`

Configuración actual del backend:

- permite CORS desde:
  - `https://arikarabeats.com`
  - `https://www.arikarabeats.com`
  - `https://arikarabeats.netlify.app`
  - localhost en desarrollo

### Gmail SMTP

Si vais a usar Gmail:

- `SMTP_HOST=smtp.gmail.com`
- `SMTP_PORT=587`
- `SMTP_SECURE=false`
- `SMTP_USER=arikarabeats@gmail.com`
- `SMTP_PASS=<app password de Google>`

## Instalar dependencias

```bash
npm install
```

## Arrancar localmente

```bash
npm run dev
```

La web quedará servida en:

- [http://localhost:3000](http://localhost:3000)

## Probar Stripe Checkout en local

1. Configura `STRIPE_SECRET_KEY` en `.env`
2. Arranca el servidor con `npm run dev`
3. Añade productos al carrito
4. Abre `/cart.html`
5. Pulsa `Pagar con Stripe`

Tarjeta de prueba típica:

- `4242 4242 4242 4242`
- fecha futura
- CVC cualquiera

### Qué funciona ya sin `STRIPE_WEBHOOK_SECRET`

Con `STRIPE_SECRET_KEY` configurada, aunque todavía no exista `STRIPE_WEBHOOK_SECRET`, ya funciona:

- creación de pedidos borrador
- validación real de carrito
- creación de Stripe Checkout Session
- redirección al Checkout alojado por Stripe
- retorno a `success.html`
- reconciliación controlada desde `success.html` usando `session_id`
- actualización del pedido a `paid_pending_delivery` en modo degradado si Stripe confirma que la sesión está pagada
- vaciado del carrito tras retorno exitoso

Esto permite probar el checkout en modo test sin bloquear el desarrollo.

### Qué queda pendiente hasta añadir `STRIPE_WEBHOOK_SECRET`

Hasta configurar `STRIPE_WEBHOOK_SECRET`, no existe confirmación fuerte asíncrona por webhook firmado.
Eso implica que:

- la confirmación post-pago depende del retorno del usuario a `success.html`
- la automatización robusta de emails post-pago queda idealmente delegada al webhook
- el flujo está operativo, pero en modo degradado/controlado

## Probar webhook en local

Necesitas Stripe CLI:

```bash
stripe listen --forward-to http://localhost:3000/api/webhook/stripe
```

Copia el `whsec_...` que devuelva la CLI y colócalo en:

- `STRIPE_WEBHOOK_SECRET`

Mientras no exista esta variable:

- el servidor arranca bien
- el endpoint webhook no rompe la app
- pero el webhook queda en modo espera

## Dónde se guardan los pedidos

Archivo:

- `/Users/abercipadro/ARIKARABEATS-WEB/server/data/orders.json`

Estados principales:

- `pending_checkout`
- `paid_pending_delivery`
- `delivered`
- `cancelled`
- `refunded`

## Consultar pedidos

### Resumen público de éxito

El frontend consulta:

- `GET /api/orders/:orderId/summary?session_id=...`

### Consulta interna simple

Con `ORDERS_API_KEY` configurada:

- `GET /api/orders?key=TU_CLAVE`
- `GET /api/orders/ARK-000001?key=TU_CLAVE`

Si `ORDERS_API_KEY` no está configurada, en local se permite acceso desde localhost.

## Fuente canónica del catálogo

El backend valida catálogo, licencias, precios y disponibilidad leyendo la fuente real del frontend:

- `/Users/abercipadro/ARIKARABEATS-WEB/frontend/data.js`

Así no se confía nunca en el precio enviado por el navegador.

## Descargas gratuitas con tag

El MP3 usado por el preview es también la fuente por defecto de la descarga gratuita: solo se permite para beats con `status: "available"`, preview MP3 y sin `freeDownload: false`. No se duplican rutas en el catálogo. Para desactivar un beat concreto añade `freeDownload: false`; si en el futuro hiciera falta un MP3 con tag distinto, usa el campo opcional `freeDownloadUrl` con una ruta relativa dentro de `./assets/audio/`.

La API nunca acepta una ruta del navegador. Resuelve el beat desde `frontend/data.js`, valida su disponibilidad y sirve exclusivamente un MP3 bajo `frontend/assets/audio/` mediante una URL temporal firmada.

Las descargas gratuitas no escriben datos en `server/data` ni en ningún JSON. El aviso interno a `arikarabeats@gmail.com`, enviado mediante el transporte Resend ya existente, es el registro del lead. La autorización temporal solo se devuelve tras confirmar ese envío. No se envía ningún correo al usuario: el navegador descarga directamente el MP3 con tag.

`FREE_DOWNLOADS_TOKEN_SECRET` es opcional pero recomendable en Render: define un secreto aleatorio largo para que los enlaces temporales de descarga sigan siendo válidos tras un reinicio del servicio. No se configura en Netlify ni se expone al frontend.

La descarga gratuita no requiere disco persistente. Los pedidos siguen usando `server/data/orders.json`: si el disco del servicio Render no es persistente, se perderán al reiniciar los pedidos locales, sus datos de cliente, items, estados de pago/entrega, referencias Stripe y marcas de notificación. Este repositorio no contiene una configuración de Render ni evidencia de un Persistent Disk, por lo que esa persistencia no está confirmada. Si se habilita uno, debe montarse en la ruta absoluta que usa el proceso desplegado para `server/data`, no en la ruta local de macOS documentada arriba.

El límite antiabuso se mantiene solo en memoria y conserva hashes efímeros de IP/email durante un máximo de 15 minutos; no se persiste IP ni user agent. Define en el aviso de privacidad validado el plazo de conservación de los eventos y del consentimiento antes de activar la función.

## Notas importantes

- `exclusive` sigue fuera del checkout y se gestiona por contacto.
- Los servicios premium no entran en carrito ni checkout.
- Si un beat pasa a `status: "sold"`, seguirá visible pero no será comprable.
- La entrega del material sigue siendo manual en Fase 1.
- `STRIPE_PUBLISHABLE_KEY` queda preparada para usos futuros con Stripe.js o embebidos, aunque el checkout actual usa redirección directa a la URL de Stripe Checkout.
