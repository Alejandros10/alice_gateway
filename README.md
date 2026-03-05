# alice_gateway

Gateway central del sistema Alice. Orquesta el control de relés GPIO y WiFi, sensores de movimiento, programación horaria e integración con Frigate. Expone una API REST y un canal WebSocket para el frontend.

---

## Arquitectura

```
alice_home_controller_front  (:3000)
            │  HTTP + WebSocket
     alice_gateway  (:3001)          ← este servicio
            │
            ├── MQTT ──► Mosquitto (:1883)
            │               ├── alice_gpio_API_controller (:8000)  [Raspberry Pi - GPIO]
            │               ├── NodeMCU / ESP8266                  [Relés WiFi]
            │               └── motion_bridge.py                   [Arduino → sensores PIR]
            │
            ├── HTTP ──► alice_notifier (:3003)
            └── HTTP ──► Frigate (:5000)
```

---

## Tecnologías

| Componente    | Versión | Descripción                              |
|---------------|---------|------------------------------------------|
| Node.js       | 18+     | Entorno de ejecución                     |
| TypeScript    | 5.4+    | Lenguaje                                 |
| Express       | 4.19+   | Servidor HTTP / router REST              |
| ws            | 8.17+   | WebSocket server                         |
| mqtt          | 5+      | Cliente MQTT (Mosquitto)                 |
| node-cron     | 3+      | Programación de tareas horarias          |
| ts-node-dev   | 2.0+    | Hot reload en desarrollo                 |

---

## Estructura del proyecto

```
alice_gateway/
├── src/
│   ├── index.ts                      # Entry point — HTTP + WebSocket + MQTT
│   ├── domain/
│   │   ├── RelayCatalog.ts           # Catálogo de relés GPIO y WiFi
│   │   └── MotionCatalog.ts          # Mapeo sensor de movimiento → relay
│   ├── api/
│   │   ├── RelayController.ts        # Rutas /api/relays/...
│   │   └── ScheduleController.ts     # Rutas /api/schedules/...
│   └── services/
│       ├── MqttBus.ts                # MQTT: publica comandos, suscribe estados
│       ├── RelayService.ts           # Lógica de negocio relay
│       ├── RelayStateStore.ts        # Estado en memoria (relés + online WiFi)
│       ├── RealtimeHub.ts            # WebSocket hub (broadcast a clientes)
│       ├── SchedulerService.ts       # Programación horaria de relés
│       ├── FrigateService.ts         # Integración con Frigate (cámaras)
│       ├── NotifierClient.ts         # Cliente HTTP → alice_notifier
│       ├── AliceApiClient.ts         # Cliente HTTP → frontend
│       └── RaspberryRelayClient.ts   # Cliente HTTP → alice_gpio_API_controller
├── motion_bridge.py                  # Script Python para Raspberry Pi (Arduino → MQTT)
├── package.json
├── tsconfig.json
└── .env
```

---

## Catálogo de relés

Definido en [src/domain/RelayCatalog.ts](src/domain/RelayCatalog.ts).

### GPIO (Raspberry Pi)

| ID                | Nombre UI        | Pin GPIO |
|-------------------|------------------|----------|
| escalas           | Escalas          | gpio5    |
| reflectores       | Reflectores      | gpio7    |
| habitacion        | Habitacion       | gpio18   |
| corredores        | Corredores       | gpio19   |
| estudio           | Estudio          | gpio8    |
| corredorese       | Corredores 2     | gpio10   |
| sala              | Sala             | gpio23   |
| hab-noche         | Hab Noche        | gpio24   |
| cocina            | Cocina           | gpio26   |
| entrada           | Entrada          | gpio4    |
| bodega            | Bodega           | gpio9    |
| porton            | Portón           | gpio11   |
| comedor           | Comedor          | gpio12   |
| dormitorio-1      | Dormitorio 1     | gpio13   |
| alarma            | Alarma           | gpio14   |
| bomba-agua        | Bomba Agua       | gpio15   |
| dormitorio-2      | Dormitorio 2     | gpio16   |
| dormitorio-3      | Dormitorio 3     | gpio17   |
| pasillo           | Pasillo          | gpio20   |
| lavanderia        | Lavandería       | gpio21   |
| garaje            | Garaje           | gpio22   |
| exterior-frente   | Exterior Frente  | gpio25   |
| terraza           | Terraza          | gpio27   |

### WiFi (NodeMCU / ESP8266)

| ID         | Nombre UI  | Dispositivo |
|------------|------------|-------------|
| wifi-sala  | Sala WiFi  | NodeMCU D1  |

Para agregar un relay WiFi nuevo: flashear el NodeMCU con `alice_nodemcu/` y agregar la entrada en `RelayCatalog.ts`.

---

## Sensores de movimiento

Definidos en [src/domain/MotionCatalog.ts](src/domain/MotionCatalog.ts).

El Arduino (conectado por USB a la Raspberry Pi) lee los sensores PIR y escribe por Serial. El script `motion_bridge.py` actúa como puente Serial → MQTT. El gateway suscribe el topic `alice/motion/+` y activa el relay configurado con auto-apagado.

```
PIR → Arduino → Serial "MOTION:sensor-1"
              → motion_bridge.py (RPi)
              → MQTT alice/motion/sensor-1
              → Gateway → relay "pasillo" (auto-off 60s)
```

Para cambiar qué relay enciende cada sensor, editar `MotionCatalog.ts`:

```ts
{ sensorId: "sensor-1", relayId: "pasillo", autoOffSecs: 60 },
{ sensorId: "sensor-2", relayId: "entrada", autoOffSecs: 30 },
```

### Correr motion_bridge.py en la Raspberry Pi

```bash
pip3 install pyserial paho-mqtt --break-system-packages
python3 motion_bridge.py
```

Como servicio systemd:

```bash
sudo tee /etc/systemd/system/alice-motion.service << 'EOF'
[Unit]
Description=Alice Motion Bridge
After=network.target

[Service]
ExecStart=/usr/bin/python3 /home/alice/motion_bridge.py
Restart=always
RestartSec=5
User=alice

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable alice-motion
sudo systemctl start alice-motion
sudo journalctl -u alice-motion -f
```

---

## MQTT — Topics

### Publicados por el Gateway

| Topic                    | Payload                            | Descripción                  |
|--------------------------|------------------------------------|------------------------------|
| `alice/relay/{id}/set`   | `{ "pin": "gpio26", "state": true }` | Comando GPIO individual    |
| `alice/relay/all/set`    | `{ "state": true }`                | Comando GPIO todos           |
| `alice/wifi/{id}/set`    | `{ "state": true }`                | Comando WiFi (NodeMCU)       |
| `alice/system/gateway/status` | `"online"` / `"offline"` (LWT) | Estado del gateway       |

### Suscritos por el Gateway

| Topic                    | Payload                                    | Descripción                   |
|--------------------------|--------------------------------------------|-------------------------------|
| `alice/relay/+/state`    | `{ "state": bool }`                        | Estado confirmado GPIO        |
| `alice/relay/all/state`  | `{ "state": bool }`                        | Estado bulk GPIO              |
| `alice/wifi/+/state`     | `{ "state": bool, "online": bool }`        | Estado WiFi + presencia       |
| `alice/motion/+`         | `{ "motion": true }`                       | Evento de movimiento          |
| `frigate/events`         | JSON Frigate                               | Eventos de detección          |

---

## API REST

**Base URL:** `http://192.168.1.4:3001`

### Relés

| Método | Endpoint                  | Descripción                     |
|--------|---------------------------|---------------------------------|
| GET    | `/api/relays`             | Lista todos los relés con estado|
| POST   | `/api/relays/:id/on`      | Enciende un relé                |
| POST   | `/api/relays/:id/off`     | Apaga un relé                   |
| POST   | `/api/relays/all/on`      | Enciende todos                  |
| POST   | `/api/relays/all/off`     | Apaga todos                     |

### Schedules

| Método | Endpoint                  | Descripción                     |
|--------|---------------------------|---------------------------------|
| GET    | `/api/schedules`          | Lista tareas programadas        |
| POST   | `/api/schedules`          | Crea tarea programada           |
| DELETE | `/api/schedules/:id`      | Elimina tarea                   |

### Health

```
GET /health
```
```json
{
  "ok": true,
  "ws_clients": 2,
  "mqtt_connected": true,
  "scheduler_jobs": 3,
  "uptime": 3600.5
}
```

---

## WebSocket

Comparte el puerto `3001` con HTTP.

```js
const ws = new WebSocket("ws://192.168.1.4:3001");
```

### Eventos recibidos

**`relay.snapshot`** — al conectarse, estado completo:
```json
{
  "type": "relay.snapshot",
  "payload": { "cocina": false, "sala": true }
}
```

**`relay.updated`** — tras cada cambio:
```json
{
  "type": "relay.updated",
  "relay": "cocina",
  "state": true,
  "online": true,
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

> El campo `online` solo aplica a relés WiFi (NodeMCU). Cuando es `false`, el dispositivo está desconectado y la UI muestra el relay deshabilitado.

---

## Variables de entorno

```env
# Puerto del gateway (HTTP + WebSocket comparten el mismo)
PORT=3001

# Broker MQTT
MQTT_URL=mqtt://192.168.1.4:1883
MQTT_CLIENT_ID=alice-gateway

# Controlador GPIO en la Raspberry Pi (fallback / debug)
RASPBERRY_URL=http://192.168.1.2:8000

# URL del frontend (para AliceApiClient)
FRONTEND_URL=http://192.168.1.4:3000

# Servicios auxiliares
NOTIFIER_URL=http://192.168.1.4:3003
FRIGATE_URL=http://192.168.1.4:5000
```

---

## Instalación y ejecución

```bash
cd alice_gateway
npm install
```

**Desarrollo** (hot reload):
```bash
npm run dev
```

**Producción:**
```bash
npm run build
npm start
```

### Como servicio systemd (servidor Ubuntu)

```bash
sudo nano /etc/systemd/system/alice-gateway.service
```

```ini
[Unit]
Description=Alice Gateway
After=network.target

[Service]
User=alice
WorkingDirectory=/home/alice/alice_gateway
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
npm run build
sudo systemctl daemon-reload
sudo systemctl enable alicia-api
sudo systemctl start alicia-api
sudo journalctl -u alicia-api -f
```

---

## Pruebas rápidas con curl

```bash
# Estado de todos los relés
curl http://192.168.1.4:3001/api/relays

# Encender relay
curl -X POST http://192.168.1.4:3001/api/relays/cocina/on

# Apagar relay
curl -X POST http://192.168.1.4:3001/api/relays/sala/off

# Encender todos
curl -X POST http://192.168.1.4:3001/api/relays/all/on

# Simular evento de movimiento (para pruebas sin Arduino)
mosquitto_pub -h 192.168.1.4 -t alice/motion/sensor-1 -m '{"motion":true}'

# Health check
curl http://192.168.1.4:3001/health
```

---

## Scripts disponibles

| Script          | Descripción                              |
|-----------------|------------------------------------------|
| `npm run dev`   | Desarrollo con hot reload (ts-node-dev)  |
| `npm run build` | Compila TypeScript → dist/               |
| `npm start`     | Producción (requiere build previo)       |



alicia-api.service        loaded active running GPIOService FastAPI (Alicia)