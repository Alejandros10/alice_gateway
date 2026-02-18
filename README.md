# alice_gateway

Gateway central del sistema Alice. Actúa como intermediario entre la interfaz web y el controlador GPIO de la Raspberry Pi. Expone una API REST y un canal WebSocket para actualizaciones en tiempo real.

---

## Rol en la arquitectura

```
alice_home_controller_front  (:3000)
            │
     alice_gateway  (:3001)        ← este servicio
       HTTP + WebSocket
            │
alice_gpio_API_contoller  (:8000)
         (Raspberry Pi)
```

Este servicio es el **único punto de entrada** para el frontend. Nunca debe saltarse para llamar al controlador GPIO directamente.

---

## Tecnologias

| Componente  | Version  | Descripcion                          |
|-------------|----------|--------------------------------------|
| Node.js     | 18+      | Entorno de ejecucion                 |
| TypeScript  | 5.4+     | Lenguaje                             |
| Express     | 4.19+    | Servidor HTTP / router REST          |
| ws          | 8.17+    | WebSocket server                     |
| Axios       | 1.7+     | Cliente HTTP hacia el GPIO API       |
| ts-node-dev | 2.0+     | Hot reload en desarrollo             |

---

## Estructura del proyecto

```
alice_gateway/
├── src/
│   ├── index.ts                    # Entry point — HTTP + WebSocket
│   ├── domain/
│   │   └── RelayCatalog.ts         # Catalogo de 17 reles con nombres de sala
│   ├── api/
│   │   └── RelayController.ts      # Rutas Express (/api/relays/...)
│   └── services/
│       ├── RelayService.ts         # Logica de negocio y orquestacion
│       ├── RaspberryRelayClient.ts # Cliente HTTP hacia alice_gpio_API_contoller
│       ├── RelayStateStore.ts      # Estado en memoria (todos los reles)
│       └── RealtimeHub.ts          # WebSocket hub (broadcast a clientes)
├── package.json
├── tsconfig.json
└── .env
```

---

## Catalogo de reles

Definido en [src/domain/RelayCatalog.ts](src/domain/RelayCatalog.ts). Cada rele tiene un `id` (usado en URLs), un `displayName` (mostrado en la UI) y un `pin` (nombre GPIO para el controlador).

| ID                | Nombre UI        | Pin GPIO |
|-------------------|------------------|----------|
| entrada           | Entrada          | gpio4    |
| cocina            | Cocina           | gpio5    |
| sala              | Sala             | gpio6    |
| comedor           | Comedor          | gpio12   |
| dormitorio-1      | Dormitorio 1     | gpio13   |
| dormitorio-2      | Dormitorio 2     | gpio16   |
| dormitorio-3      | Dormitorio 3     | gpio17   |
| bano-1            | Bano 1           | gpio18   |
| bano-2            | Bano 2           | gpio19   |
| pasillo           | Pasillo          | gpio20   |
| lavanderia        | Lavanderia       | gpio21   |
| garaje            | Garaje           | gpio22   |
| luz-garaje        | Luz Garaje       | gpio23   |
| jardin            | Jardin           | gpio24   |
| exterior-frente   | Exterior Frente  | gpio25   |
| exterior-fondo    | Exterior Fondo   | gpio26   |
| terraza           | Terraza          | gpio27   |

---

## API REST

**Base URL:** `http://localhost:3001`

---

### `GET /api/relays`
Retorna todos los reles del catalogo con su estado actual.

**Response:**
```json
{
  "relays": [
    { "id": "cocina", "displayName": "Cocina", "pin": "gpio5", "state": false },
    { "id": "sala",   "displayName": "Sala",   "pin": "gpio6", "state": true  }
  ]
}
```

---

### `GET /api/relays/state`
Retorna un snapshot plano `{ id: boolean }`. Util para sincronizacion rapida.

**Response:**
```json
{
  "cocina": false,
  "sala": true,
  "dormitorio-1": false
}
```

---

### `POST /api/relays/:id/on`
Enciende un rele por su ID logico.

```
POST /api/relays/cocina/on
```

**Response exitosa (`200`):**
```json
{ "ok": true, "relay": "cocina", "state": true }
```

**Errores:**
| Codigo | Causa |
|--------|-------|
| `404`  | El ID no existe en el catalogo |
| `502`  | La Raspberry no respondio o fallo el hardware |

---

### `POST /api/relays/:id/off`
Apaga un rele por su ID logico.

```
POST /api/relays/sala/off
```

**Response exitosa (`200`):**
```json
{ "ok": true, "relay": "sala", "state": false }
```

---

### `POST /api/relays/all/on`
Enciende todos los reles del catalogo.

**Response exitosa (`200`):**
```json
{ "ok": true, "state": true }
```

---

### `POST /api/relays/all/off`
Apaga todos los reles del catalogo.

**Response exitosa (`200`):**
```json
{ "ok": true, "state": false }
```

---

### `GET /health`
Health check del gateway.

**Response:**
```json
{
  "ok": true,
  "ws_clients": 2,
  "uptime": 3600.5
}
```

---

## WebSocket

El WebSocket comparte el mismo puerto que HTTP (`3001`). Al conectarse, el cliente recibe inmediatamente el estado actual. Cualquier cambio posterior se difunde a todos los clientes conectados.

**Conectar:**
```js
const ws = new WebSocket("ws://localhost:3001");
```

**Evento `relay.snapshot`** — enviado al conectarse:
```json
{
  "type": "relay.snapshot",
  "payload": {
    "cocina": false,
    "sala": true,
    "dormitorio-1": false
  }
}
```

**Evento `relay.updated`** — enviado tras cada cambio de estado:
```json
{
  "type": "relay.updated",
  "relay": "cocina",
  "state": true,
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

---

## Flujo interno de una operacion

Cuando el frontend llama `POST /api/relays/cocina/on`, el gateway ejecuta:

```
RelayController
      │  valida que "cocina" existe en RelayCatalog
      ▼
RelayService.turnOn("cocina")
      │
      ├─► RaspberryRelayClient.setState("gpio5", true)
      │         POST http://192.168.1.2:8000/api/relay/set
      │         { "name": "gpio5", "state": true }
      │
      ├─► RelayStateStore.set("cocina", true)
      │
      └─► RealtimeHub.broadcastRelayUpdate("cocina", true)
                WS → { type: "relay.updated", relay: "cocina", state: true }
```

---

## Variables de entorno

Archivo `.env` en la raiz del proyecto:

```env
# Puerto del gateway (HTTP + WebSocket comparten el mismo)
PORT=3001

# URL base del controlador FastAPI en la Raspberry Pi
RASPBERRY_URL=http://192.168.1.2:8000
```

## Instalacion y ejecucion

### Requisitos previos

- Node.js 18 o superior
- npm 9 o superior

### 1. Instalar dependencias

```bash
cd alice_gateway
npm install
```

### 2. Configurar variables de entorno

```bash
cp .env .env.local   # o editar .env directamente
```

Verificar que `RASPBERRY_URL` apunta a la IP correcta de la Raspberry Pi.

### 3. Ejecutar

**Modo desarrollo** (hot reload con ts-node-dev):

```bash
npm run dev
```

**Modo produccion** (compilar TypeScript primero):

```bash
npm run build
npm start
```

La salida al arrancar:

```
─────────────────────────────────────────
  Alice Gateway
  HTTP  →  http://localhost:3001
  WS    →  ws://localhost:3001
─────────────────────────────────────────
```

---

### 4. Ejecutar como servicio systemd (produccion en servidor Linux)

```bash
sudo nano /etc/systemd/system/alice-gateway.service
```

```ini
[Unit]
Description=Alice Gateway
After=network.target

[Service]
User=pi
WorkingDirectory=/home/pi/alice/alice_gateway
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
# Compilar antes de activar el servicio
npm run build

sudo systemctl daemon-reload
sudo systemctl enable alice-gateway
sudo systemctl start alice-gateway

# Ver logs en tiempo real
sudo journalctl -u alice-gateway -f
```

---

## Pruebas rapidas con curl

```bash
# Listar todos los reles con estado
curl http://localhost:3001/api/relays

# Snapshot de estados
curl http://localhost:3001/api/relays/state

# Encender cocina
curl -X POST http://localhost:3001/api/relays/cocina/on

# Apagar sala
curl -X POST http://localhost:3001/api/relays/sala/off

# Encender todos
curl -X POST http://localhost:3001/api/relays/all/on

# Apagar todos
curl -X POST http://localhost:3001/api/relays/all/off

# Health check
curl http://localhost:3001/health
```

---

## Scripts disponibles

| Script          | Comando         | Descripcion                              |
|-----------------|-----------------|------------------------------------------|
| `npm run dev`   | ts-node-dev     | Desarrollo con hot reload                |
| `npm run build` | tsc             | Compilar TypeScript a dist/              |
| `npm start`     | node dist/index | Produccion (requiere build previo)       |
