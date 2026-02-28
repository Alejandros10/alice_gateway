/**
 * MqttBus — Servicio MQTT del Gateway
 *
 * Responsabilidad:
 *  - Publicar comandos de relé al controlador GPIO via MQTT
 *  - Publicar comandos a relés WiFi (NodeMCU/ESP8266) via MQTT
 *  - Suscribirse a estados confirmados por GPIO y por NodeMCUs
 *  - Actualizar RelayStateStore y notificar al RealtimeHub (WS)
 *  - LWT: alice/system/gateway/status → "offline"
 *
 * Topics GPIO (Raspberry Pi):
 *  alice/relay/{id}/set    → comando individual  { "pin": "gpio26", "state": true }
 *  alice/relay/all/set     → comando bulk         { "state": true }
 *  alice/relay/+/state    ← estado confirmado    { "state": true }
 *  alice/relay/all/state  ← estado bulk          { "state": true }
 *
 * Topics WiFi (NodeMCU/ESP8266):
 *  alice/wifi/{id}/set    → comando              { "state": true }
 *  alice/wifi/+/state    ← estado confirmado    { "state": bool, "online": bool }
 *
 * Otros:
 *  alice/system/gateway/status → online/offline (LWT)
 *  frigate/events             ← eventos de detección Frigate
 */

import mqtt, { MqttClient } from "mqtt";
import { relayStateStore } from "./RelayStateStore";
import { realtimeHub } from "./RealtimeHub";
import { RELAY_CATALOG } from "../domain/RelayCatalog";

// ── Topics GPIO ───────────────────────────────────────────────────────────────
const TOPIC_GPIO_CMD       = (id: string) => `alice/relay/${id}/set`;
const TOPIC_ALL_CMD        = "alice/relay/all/set";
const TOPIC_GPIO_STATE_SUB = "alice/relay/+/state";
const TOPIC_ALL_STATE_SUB  = "alice/relay/all/state";
const TOPIC_STATUS         = "alice/system/gateway/status";

// ── Topics WiFi (NodeMCU) ─────────────────────────────────────────────────────
const TOPIC_WIFI_CMD       = (id: string) => `alice/wifi/${id}/set`;
const TOPIC_WIFI_STATE_SUB = "alice/wifi/+/state";

// ── Otros ─────────────────────────────────────────────────────────────────────
const TOPIC_FRIGATE_SUB    = "frigate/events";

type FrigateHandler = (topic: string, payload: Buffer) => void;

class MqttBus {
  private client: MqttClient | null = null;
  private _frigateHandlers: FrigateHandler[] = [];

  connect(brokerUrl: string, clientId = "alice-gateway"): void {
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

      this.client!.subscribe(
        [
          TOPIC_GPIO_STATE_SUB,
          TOPIC_ALL_STATE_SUB,
          TOPIC_WIFI_STATE_SUB,   // ← estados de NodeMCUs
          TOPIC_FRIGATE_SUB,
        ],
        { qos: 1 },
        (err) => {
          if (err) console.error("[MQTT] Subscribe error:", err.message);
          else     console.log("[MQTT] Subscribed → GPIO states + WiFi states + Frigate");
        }
      );
    });

    this.client.on("reconnect", () => console.log("[MQTT] Reconnecting..."));
    this.client.on("error",     (err) => console.error("[MQTT] Error:", err.message));
    this.client.on("message",   (topic, payload) => this._handleIncoming(topic, payload));
  }

  // ── Publish GPIO ──────────────────────────────────────────────────────────

  /** Relay GPIO: publica { pin, state } → GPIO API en la Raspberry lo ejecuta. */
  publishCommand(relayId: string, pin: string, state: boolean): void {
    if (!this.client?.connected) {
      console.warn(`[MQTT] Not connected — GPIO command dropped for "${relayId}"`);
      return;
    }
    const payload = JSON.stringify({ pin, state });
    this.client.publish(TOPIC_GPIO_CMD(relayId), payload, { qos: 1 });
    console.log(`[MQTT] GPIO Cmd → ${TOPIC_GPIO_CMD(relayId)}: ${payload}`);
  }

  /** Todos los relés GPIO a la vez. */
  publishAll(state: boolean): void {
    if (!this.client?.connected) {
      console.warn("[MQTT] Not connected — all command dropped");
      return;
    }
    const payload = JSON.stringify({ state });
    this.client.publish(TOPIC_ALL_CMD, payload, { qos: 1 });
    console.log(`[MQTT] Cmd → ${TOPIC_ALL_CMD}: ${payload}`);
  }

  // ── Publish WiFi ──────────────────────────────────────────────────────────

  /** Relay WiFi (NodeMCU): publica { state } → el NodeMCU lo ejecuta localmente. */
  publishWifiCommand(relayId: string, state: boolean): void {
    if (!this.client?.connected) {
      console.warn(`[MQTT] Not connected — WiFi command dropped for "${relayId}"`);
      return;
    }
    const payload = JSON.stringify({ state });
    this.client.publish(TOPIC_WIFI_CMD(relayId), payload, { qos: 1 });
    console.log(`[MQTT] WiFi Cmd → ${TOPIC_WIFI_CMD(relayId)}: ${payload}`);
  }

  // ── Frigate ───────────────────────────────────────────────────────────────

  addFrigateHandler(fn: FrigateHandler): void {
    this._frigateHandlers.push(fn);
  }

  // ── Estado ────────────────────────────────────────────────────────────────

  get isConnected(): boolean {
    return this.client?.connected ?? false;
  }

  // ── Incoming ──────────────────────────────────────────────────────────────

  private _handleIncoming(topic: string, payloadBuf: Buffer): void {
    const raw = payloadBuf.toString("utf-8");
    console.log(`[MQTT] Incoming ← ${topic}: ${raw}`);

    // Frigate
    if (topic.startsWith("frigate/")) {
      for (const fn of this._frigateHandlers) fn(topic, payloadBuf);
      return;
    }

    try {
      const data = JSON.parse(raw) as { state: boolean; online?: boolean };
      const parts = topic.split("/");

      // ── alice/relay/all/state (GPIO bulk) ─────────────────────────────────
      if (topic === TOPIC_ALL_STATE_SUB) {
        for (const relay of RELAY_CATALOG) {
          relayStateStore.set(relay.id, data.state);
        }
        realtimeHub.broadcastSnapshot(relayStateStore.getAll());
        console.log(`[MQTT] All GPIO relays confirmed → ${data.state ? "ON" : "OFF"}`);
        return;
      }

      // ── alice/relay/{id}/state (GPIO individual) ───────────────────────────
      if (parts.length === 4 && parts[0] === "alice" && parts[1] === "relay" && parts[3] === "state") {
        const relayId = parts[2];
        relayStateStore.set(relayId, data.state);
        realtimeHub.broadcastRelayUpdate(relayId, data.state);
        console.log(`[MQTT] GPIO "${relayId}" confirmed → ${data.state ? "ON" : "OFF"}`);
        return;
      }

      // ── alice/wifi/{id}/state (WiFi NodeMCU) ──────────────────────────────
      if (parts.length === 4 && parts[0] === "alice" && parts[1] === "wifi" && parts[3] === "state") {
        const relayId = parts[2];
        const online  = data.online ?? true;
        relayStateStore.set(relayId, data.state);
        realtimeHub.broadcastRelayUpdate(relayId, data.state);
        console.log(
          `[MQTT] WiFi "${relayId}" confirmed → ${data.state ? "ON" : "OFF"} | online: ${online}`
        );
        return;
      }

    } catch (err) {
      console.error("[MQTT] Error parsing incoming message:", err);
    }
  }
}

export const mqttBus = new MqttBus();
