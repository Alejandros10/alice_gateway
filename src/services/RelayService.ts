/**
 * RelayService — Caso de uso / Negocio
 *
 * Flujo para setState(id, state):
 *   1. Validar que el relé existe en el catálogo
 *   2. Según relay.type:
 *        "gpio" → mqttBus.publishCommand(id, pin, state)  → GPIO API (Raspberry)
 *        "wifi" → mqttBus.publishWifiCommand(id, state)   → NodeMCU/ESP8266
 *   3. Actualizar RelayStateStore de forma optimista
 *   4. Notificar a RealtimeHub → todos los clientes WS se enteran
 *
 * La confirmación real llega por MQTT (alice/relay/{id}/state o alice/wifi/{id}/state)
 * y es procesada por MqttBus, que actualiza el store y re-difunde.
 */

import { findRelay, RELAY_CATALOG } from "../domain/RelayCatalog";
import { relayStateStore } from "./RelayStateStore";
import { realtimeHub } from "./RealtimeHub";
import { mqttBus } from "./MqttBus";

class RelayService {

  async turnOn(id: string): Promise<void>  { return this.setState(id, true);  }
  async turnOff(id: string): Promise<void> { return this.setState(id, false); }

  async setState(id: string, state: boolean): Promise<void> {
    const relay = findRelay(id);
    if (!relay) throw new Error(`Relay "${id}" not found in catalog`);

    const type = relay.type ?? "gpio";

    if (type === "wifi") {
      // NodeMCU: topic alice/wifi/{id}/set → payload { "state": bool }
      mqttBus.publishWifiCommand(relay.id, state);
    } else {
      // Raspberry Pi GPIO: topic alice/relay/{id}/set → payload { "pin": ..., "state": bool }
      mqttBus.publishCommand(relay.id, relay.pin, state);
    }

    relayStateStore.set(id, state);
    realtimeHub.broadcastRelayUpdate(id, state);

    console.log(`[RelayService] ${relay.displayName} [${type}] → ${state ? "ON" : "OFF"}`);
  }

  async setAll(state: boolean): Promise<void> {
    // Bulk command sólo aplica a GPIO (Raspberry).
    // Los WiFi no tienen comando bulk — no están en la misma red física.
    mqttBus.publishAll(state);

    for (const relay of RELAY_CATALOG) {
      relayStateStore.set(relay.id, state);
    }
    realtimeHub.broadcastSnapshot(relayStateStore.getAll());

    console.log(`[RelayService] setAll → ${state ? "ON" : "OFF"}`);
  }

  getSnapshot(): Record<string, boolean> {
    return relayStateStore.getAll();
  }

  /** Lista enriquecida con type incluido — el frontend la usa para separar secciones. */
  getAll() {
    const snapshot = relayStateStore.getAll();
    return RELAY_CATALOG.map((r) => ({
      id:          r.id,
      displayName: r.displayName,
      pin:         r.pin,
      type:        r.type ?? "gpio",
      state:       snapshot[r.id] ?? false,
    }));
  }
}

export const relayService = new RelayService();
