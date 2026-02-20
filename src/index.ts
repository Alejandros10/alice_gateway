/**
 * index.ts — Entry Point del Gateway
 *
 * Crea el servidor HTTP de Express, monta el WebSocket sobre el mismo
 * puerto, conecta al broker MQTT y arranca todo en un solo proceso.
 *
 * Variables de entorno:
 *   PORT         (default 3001)
 *   MQTT_URL     (default mqtt://localhost:1883)
 *   FRONTEND_URL — URL de Next.js, usada por AliceApiClient (default http://localhost:3000)
 */

import "dotenv/config";
import http from "http";
import express from "express";
import { realtimeHub } from "./services/RealtimeHub";
import { mqttBus } from "./services/MqttBus";
import { initAliceApiClient } from "./services/AliceApiClient";
import { schedulerService } from "./services/SchedulerService";
import relayRouter from "./api/RelayController";
import scheduleRouter from "./api/ScheduleController";

const PORT           = Number(process.env.PORT           ?? 3001);
const MQTT_URL       =        process.env.MQTT_URL        ?? "mqtt://localhost:1883";
const MQTT_CLIENT_ID =        process.env.MQTT_CLIENT_ID ?? "alice-gateway";
const FRONTEND_URL   =        process.env.FRONTEND_URL   ?? "http://localhost:3000";

// ── AliceApiClient (debe inicializarse antes que SchedulerService) ─────────────
initAliceApiClient(FRONTEND_URL);

// ── Express ───────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

// CORS simple para desarrollo (Next corre en otro puerto)
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (_req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Rutas
app.use("/api/relays",    relayRouter);
app.use("/api/schedules", scheduleRouter);

// Health check
app.get("/health", (_req, res) => {
  res.json({
    ok:             true,
    ws_clients:     realtimeHub.connectedClients,
    mqtt_connected: mqttBus.isConnected,
    scheduler_jobs: schedulerService.count,
    uptime:         process.uptime(),
  });
});

// ── HTTP Server compartido con WebSocket ──────────────────────────────────────
const server = http.createServer(app);
realtimeHub.attach(server);

// ── MQTT ───────────────────────────────────────────────────────────────────────
mqttBus.connect(MQTT_URL, MQTT_CLIENT_ID);

// ── Arranque ───────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log("─────────────────────────────────────────");
  console.log(`  Alice Gateway`);
  console.log(`  HTTP     →  http://localhost:${PORT}`);
  console.log(`  WS       →  ws://localhost:${PORT}`);
  console.log(`  MQTT     →  ${MQTT_URL}`);
  console.log(`  Frontend →  ${FRONTEND_URL}`);
  console.log("─────────────────────────────────────────");

  // Delay de 3s para dar tiempo al frontend de estar listo
  setTimeout(() => {
    schedulerService.reload().catch((err) => {
      console.error("[Scheduler] Error en carga inicial:", err);
    });
  }, 3_000);
});
