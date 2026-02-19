/**
 * index.ts — Entry Point del Gateway
 *
 * Crea el servidor HTTP de Express, monta el WebSocket sobre el mismo
 * puerto, conecta al broker MQTT y arranca todo en un solo proceso.
 *
 * Puerto: variable PORT en .env (default 3001)
 * MQTT:   variable MQTT_URL en .env (default mqtt://localhost:1883)
 */

import "dotenv/config";
import http from "http";
import express from "express";
import { realtimeHub } from "./services/RealtimeHub";
import { mqttBus } from "./services/MqttBus";
import relayRouter from "./api/RelayController";

const PORT          = Number(process.env.PORT ?? 3001);
const MQTT_URL      = process.env.MQTT_URL      ?? "mqtt://localhost:1883";
const MQTT_CLIENT_ID = process.env.MQTT_CLIENT_ID ?? "alice-gateway";

// ── Express ──────────────────────────────────────────────────────────────────
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
app.use("/api/relays", relayRouter);

// Health check
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    ws_clients: realtimeHub.connectedClients,
    mqtt_connected: mqttBus.isConnected,
    uptime: process.uptime(),
  });
});

// ── HTTP Server compartido con WebSocket ─────────────────────────────────────
const server = http.createServer(app);

// Montar WebSocket sobre el mismo server (mismo puerto)
realtimeHub.attach(server);

// ── MQTT Bus ──────────────────────────────────────────────────────────────────
mqttBus.connect(MQTT_URL, MQTT_CLIENT_ID);

// ── Arranque ─────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log("─────────────────────────────────────────");
  console.log(`  Alice Gateway`);
  console.log(`  HTTP  →  http://localhost:${PORT}`);
  console.log(`  WS    →  ws://localhost:${PORT}`);
  console.log(`  MQTT  →  ${MQTT_URL}`);
  console.log("─────────────────────────────────────────");
});
