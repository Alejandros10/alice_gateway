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
import { RELAY_CATALOG, findRelay } from "../domain/RelayCatalog";
import { findMotionRule } from "../domain/MotionCatalog";

// ── Topics GPIO ───────────────────────────────────────────────────────────────
const TOPIC_GPIO_CMD       = (id: string) => `alice/relay/${id}/set`;
const TOPIC_ALL_CMD        = "alice/relay/all/set";
const TOPIC_GPIO_STATE_SUB = "alice/relay/+/state";
const TOPIC_ALL_STATE_SUB  = "alice/relay/all/state";
const TOPIC_STATUS         = "alice/system/gateway/status";

// ── Topics WiFi (NodeMCU) ─────────────────────────────────────────────────────
const TOPIC_WIFI_CMD       = (id: string) => `alice/wifi/${id}/set`;
const TOPIC_WIFI_STATE_SUB = "alice/wifi/+/state";

// ── Topics Movimiento (Arduino + RPi bridge) ──────────────────────────────────
const TOPIC_MOTION_SUB     = "alice/motion/+";

// ── Otros ─────────────────────────────────────────────────────────────────────
const TOPIC_FRIGATE_SUB    = "frigate/events";

type FrigateHandler = (topic: string, payload: Buffer) => void;

class MqttBus {
  private client: MqttClient | null = null;
  private _frigateHandlers: FrigateHandler[] = [];
  /** Timers de auto-apagado por sensor. Se resetean con cada detección. */
  private _motionTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

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
          TOPIC_MOTION_SUB,       // ← sensores de movimiento (Arduino + RPi bridge)
          TOPIC_FRIGATE_SUB,
        ],
        { qos: 1 },
        (err) => {
          if (err) console.error("[MQTT] Subscribe error:", err.message);
          else     console.log("[MQTT] Subscribed → GPIO states + WiFi states + Motion + Frigate");
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

  // ── Movimiento ────────────────────────────────────────────────────────────

  /**
   * Enciende el relay mapeado al sensor y programa el auto-apagado.
   * Si llega otro evento antes del timeout, resetea el timer.
   */
  private _handleMotion(sensorId: string): void {
    const rule = findMotionRule(sensorId);
    if (!rule) {
      console.warn(`[Motion] Sin regla para sensor "${sensorId}" — ignorado`);
      return;
    }

    const relay = findRelay(rule.relayId);
    if (!relay) {
      console.warn(`[Motion] Relay "${rule.relayId}" no existe en el catálogo`);
      return;
    }

    console.log(`[Motion] ${rule.displayName} → encendiendo "${rule.relayId}" (auto-off ${rule.autoOffSecs}s)`);

    // Encender relay
    this._triggerRelay(relay.id, relay.pin, relay.type === "wifi", true);

    // Resetear timer de auto-apagado
    const existing = this._motionTimers.get(sensorId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      console.log(`[Motion] Auto-off "${rule.relayId}" (${rule.autoOffSecs}s sin movimiento)`);
      this._triggerRelay(relay.id, relay.pin, relay.type === "wifi", false);
      this._motionTimers.delete(sensorId);
    }, rule.autoOffSecs * 1_000);

    this._motionTimers.set(sensorId, timer);
  }

  /** Publica el comando al relay correcto según su tipo (GPIO o WiFi). */
  private _triggerRelay(relayId: string, pin: string, isWifi: boolean, state: boolean): void {
    if (isWifi) {
      this.publishWifiCommand(relayId, state);
    } else {
      this.publishCommand(relayId, pin, state);
    }
    relayStateStore.set(relayId, state);
    realtimeHub.broadcastRelayUpdate(relayId, state);
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

    // Movimiento: alice/motion/{sensorId}
    if (topic.startsWith("alice/motion/")) {
      const sensorId = topic.split("/")[2];
      if (sensorId) this._handleMotion(sensorId);
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
        relayStateStore.setOnline(relayId, online);
        realtimeHub.broadcastRelayUpdate(relayId, data.state, online);
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
