/**
 * MqttBus — Servicio MQTT del Gateway
 *
 * Responsabilidad:
 *  - Publicar comandos de relé al controlador GPIO via MQTT
 *  - Suscribirse a estados de relé confirmados por el GPIO
 *  - Actualizar RelayStateStore y notificar al RealtimeHub (WS)
 *    cuando llega una confirmación de estado desde GPIO
 *  - LWT: alice/system/gateway/status → "offline"
 *
 * Topics:
 *  alice/relay/{id}/set   → comando individual (publish)
 *  alice/relay/all/set    → comando bulk       (publish)
 *  alice/relay/+/state    ← estado individual  (subscribe, retained)
 *  alice/relay/all/state  ← estado bulk        (subscribe, retained)
 *  alice/system/gateway/status → online/offline (LWT)
 *
 * Payload publish alice/relay/{id}/set:
 *   { "pin": "gpio26", "state": true }
 *
 * Payload publish alice/relay/all/set:
 *   { "state": true }
 *
 * Payload subscribe alice/relay/{id}/state:
 *   { "state": true }
 */

import mqtt, { MqttClient } from "mqtt";
import { relayStateStore } from "./RelayStateStore";
import { realtimeHub } from "./RealtimeHub";
import { RELAY_CATALOG } from "../domain/RelayCatalog";

const TOPIC_CMD           = (id: string) => `alice/relay/${id}/set`;
const TOPIC_ALL_CMD       = "alice/relay/all/set";
const TOPIC_STATE_SUB     = "alice/relay/+/state";
const TOPIC_ALL_STATE_SUB = "alice/relay/all/state";
const TOPIC_STATUS        = "alice/system/gateway/status";
const TOPIC_FRIGATE_SUB   = "frigate/events";

type FrigateHandler = (topic: string, payload: Buffer) => void;

class MqttBus {
  private client: MqttClient | null = null;
  private brokerUrl = "";
  private _frigateHandlers: FrigateHandler[] = [];

  /**
   * Conecta al broker MQTT e inicia las suscripciones.
   * Llamar una sola vez desde index.ts en el arranque.
   */
  connect(brokerUrl: string, clientId = "alice-gateway"): void {
    this.brokerUrl = brokerUrl;

    this.client = mqtt.connect(brokerUrl, {
      clientId,
      clean: true,
      reconnectPeriod: 3_000,
      connectTimeout: 10_000,
      will: {
        topic: TOPIC_STATUS,
        payload: Buffer.from("offline"),
        retain: true,
        qos: 1,
      },
    });

    this.client.on("connect", () => {
      console.log(`[MQTT] Connected → ${brokerUrl}`);
      this.client!.publish(TOPIC_STATUS, "online", { retain: true, qos: 1 });

      // Suscribirse a confirmaciones de estado del GPIO + eventos Frigate
      this.client!.subscribe(
        [TOPIC_STATE_SUB, TOPIC_ALL_STATE_SUB, TOPIC_FRIGATE_SUB],
        { qos: 1 },
        (err) => {
          if (err) console.error("[MQTT] Subscribe error:", err.message);
          else console.log(`[MQTT] Subscribed → relay states + frigate/events`);
        }
      );
    });

    this.client.on("reconnect", () => {
      console.log("[MQTT] Reconnecting...");
    });

    this.client.on("error", (err) => {
      console.error("[MQTT] Error:", err.message);
    });

    this.client.on("message", (topic: string, payload: Buffer) => {
      this._handleIncoming(topic, payload);
    });
  }

  // ── Publish ───────────────────────────────────────────────────────────────

  /** Publica un comando de encendido/apagado para un relé individual. */
  publishCommand(relayId: string, pin: string, state: boolean): void {
    if (!this.client?.connected) {
      console.warn(`[MQTT] Not connected — command dropped for relay "${relayId}"`);
      return;
    }
    const payload = JSON.stringify({ pin, state });
    this.client.publish(TOPIC_CMD(relayId), payload, { qos: 1 });
    console.log(`[MQTT] Cmd → ${TOPIC_CMD(relayId)}: ${payload}`);
  }

  /** Publica un comando para todos los relés a la vez. */
  publishAll(state: boolean): void {
    if (!this.client?.connected) {
      console.warn("[MQTT] Not connected — all command dropped");
      return;
    }
    const payload = JSON.stringify({ state });
    this.client.publish(TOPIC_ALL_CMD, payload, { qos: 1 });
    console.log(`[MQTT] Cmd → ${TOPIC_ALL_CMD}: ${payload}`);
  }

  // ── Frigate ───────────────────────────────────────────────────────────────

  /** Registra un handler para mensajes de Frigate (frigate/events). */
  addFrigateHandler(fn: FrigateHandler): void {
    this._frigateHandlers.push(fn);
  }

  // ── Estado ────────────────────────────────────────────────────────────────

  /** true si el cliente MQTT está conectado al broker. */
  get isConnected(): boolean {
    return this.client?.connected ?? false;
  }

  // ── Handler de mensajes entrantes ─────────────────────────────────────────

  /**
   * Procesa confirmaciones de estado publicadas por el GPIO.
   * Actualiza el store y difunde a los clientes WebSocket.
   */
  private _handleIncoming(topic: string, payloadBuf: Buffer): void {
    const raw = payloadBuf.toString("utf-8");
    console.log(`[MQTT] Incoming ← ${topic}: ${raw}`);

    // Despachar a handlers de Frigate
    if (topic.startsWith("frigate/")) {
      for (const fn of this._frigateHandlers) fn(topic, payloadBuf);
      return;
    }

    try {
      const data = JSON.parse(raw) as { state: boolean };

      // ── alice/relay/all/state ─────────────────────────────────────────
      if (topic === TOPIC_ALL_STATE_SUB) {
        for (const relay of RELAY_CATALOG) {
          relayStateStore.set(relay.id, data.state);
        }
        realtimeHub.broadcastSnapshot(relayStateStore.getAll());
        console.log(`[MQTT] All relays confirmed → ${data.state ? "ON" : "OFF"}`);
        return;
      }

      // ── alice/relay/{id}/state ────────────────────────────────────────
      const parts = topic.split("/");
      if (
        parts.length === 4 &&
        parts[0] === "alice" &&
        parts[1] === "relay" &&
        parts[3] === "state"
      ) {
        const relayId = parts[2];
        relayStateStore.set(relayId, data.state);
        realtimeHub.broadcastRelayUpdate(relayId, data.state);
        console.log(`[MQTT] Relay "${relayId}" confirmed → ${data.state ? "ON" : "OFF"}`);
      }
    } catch (err) {
      console.error("[MQTT] Error parsing incoming message:", err);
    }
  }
}

export const mqttBus = new MqttBus();
