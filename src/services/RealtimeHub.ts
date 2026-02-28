/**
 * RealtimeHub — WebSocket Hub
 *
 * Responsabilidad: distribuir eventos en tiempo real a todos los
 * clientes web conectados.
 *
 * Eventos emitidos:
 *   relay.snapshot  → al conectarse un cliente (estado completo actual)
 *   relay.updated   → cuando un relé cambia de estado
 *
 * Se monta sobre el mismo http.Server de Express para compartir puerto.
 * Se exporta como singleton `realtimeHub`.
 */

import { WebSocket, WebSocketServer } from "ws";
import type { Server } from "http";
import { relayStateStore } from "./RelayStateStore";

// ── Tipos de eventos ────────────────────────────────────────────────────────

interface SnapshotEvent {
  type: "relay.snapshot";
  payload: Record<string, boolean>;
}

interface UpdatedEvent {
  type: "relay.updated";
  relay: string;
  state: boolean;
  online?: boolean;
  timestamp: string;
}

type WsEvent = SnapshotEvent | UpdatedEvent;

// ── Hub ─────────────────────────────────────────────────────────────────────

class RealtimeHub {
  private wss: WebSocketServer | null = null;

  /**
   * Conecta el WebSocketServer al http.Server de Express.
   * Llamar una sola vez desde index.ts después de crear el server.
   */
  attach(server: Server): void {
    this.wss = new WebSocketServer({ server });

    this.wss.on("connection", (ws: WebSocket, req) => {
      const ip = req.socket.remoteAddress ?? "unknown";
      console.log(`[WS] Cliente conectado: ${ip}`);

      // Enviar snapshot del estado actual al nuevo cliente
      const snapshot: SnapshotEvent = {
        type: "relay.snapshot",
        payload: relayStateStore.getAll(),
      };
      ws.send(JSON.stringify(snapshot));

      ws.on("close", () => {
        console.log(`[WS] Cliente desconectado: ${ip}`);
      });

      ws.on("error", (err) => {
        console.error(`[WS] Error en cliente ${ip}:`, err.message);
      });
    });

    console.log("[WS] RealtimeHub listo y escuchando conexiones.");
  }

  /** Emite un evento a todos los clientes conectados. */
  broadcast(event: WsEvent): void {
    if (!this.wss) return;

    const data = JSON.stringify(event);
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  }

  /** Shortcut para emitir relay.updated (el evento más frecuente). */
  broadcastRelayUpdate(relayId: string, state: boolean, online?: boolean): void {
    this.broadcast({
      type: "relay.updated",
      relay: relayId,
      state,
      ...(online !== undefined ? { online } : {}),
      timestamp: new Date().toISOString(),
    });
  }

  /** Emite un snapshot completo a todos los clientes (útil tras setAll). */
  broadcastSnapshot(payload: Record<string, boolean>): void {
    this.broadcast({ type: "relay.snapshot", payload });
  }

  /** Número de clientes WS conectados actualmente. */
  get connectedClients(): number {
    return this.wss?.clients.size ?? 0;
  }
}

export const realtimeHub = new RealtimeHub();
