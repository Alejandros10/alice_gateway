/**
 * index.ts — Entry Point del Gateway
 *
 * Crea el servidor HTTP de Express, monta el WebSocket sobre el mismo
 * puerto y arranca todo en un solo proceso.
 *
 * Puerto: variable PORT en .env (default 3001)
 */

import "dotenv/config";
import http from "http";
import express from "express";
import { realtimeHub } from "./services/RealtimeHub";
import relayRouter from "./api/RelayController";

const PORT = Number(process.env.PORT ?? 3001);

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
    uptime: process.uptime(),
  });
});

// ── HTTP Server compartido con WebSocket ─────────────────────────────────────
const server = http.createServer(app);

// Montar WebSocket sobre el mismo server (mismo puerto)
realtimeHub.attach(server);

// ── Arranque ─────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log("─────────────────────────────────────────");
  console.log(`  Alice Gateway`);
  console.log(`  HTTP  →  http://localhost:${PORT}`);
  console.log(`  WS    →  ws://localhost:${PORT}`);
  console.log("─────────────────────────────────────────");
});
