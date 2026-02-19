/**
 * RelayService — Caso de uso / Negocio
 *
 * Responsabilidad: orquestar el flujo completo de encendido/apagado.
 *
 * Flujo para setState(id, state):
 *   1. Validar que el relé existe en el catálogo
 *   2. Publicar comando MQTT → alice/relay/{id}/set  (GPIO suscrito)
 *   3. Actualizar RelayStateStore de forma optimista
 *   4. Notificar a RealtimeHub → todos los clientes WS se enteran
 *
 * La confirmación real llega por MQTT (alice/relay/{id}/state ← GPIO)
 * y es procesada por MqttBus, que actualiza el store y re-difunde
 * si el estado real difiere del optimista.
 *
 * No contiene lógica HTTP ni de WebSocket directamente.
 * Se exporta como singleton `relayService`.
 */

import { findRelay, RELAY_CATALOG } from "../domain/RelayCatalog";
import { relayStateStore } from "./RelayStateStore";
import { realtimeHub } from "./RealtimeHub";
import { mqttBus } from "./MqttBus";

class RelayService {
  // ── Casos de uso principales ──────────────────────────────────────────────

  /** Enciende un relé por su id lógico. */
  async turnOn(id: string): Promise<void> {
    return this.setState(id, true);
  }

  /** Apaga un relé por su id lógico. */
  async turnOff(id: string): Promise<void> {
    return this.setState(id, false);
  }

  /**
   * Cambia el estado de un relé.
   * Publica el comando via MQTT y actualiza optimistamente el estado local.
   * Lanza Error si el id no existe en el catálogo.
   */
  async setState(id: string, state: boolean): Promise<void> {
    const relay = findRelay(id);
    if (!relay) {
      throw new Error(`Relay "${id}" not found in catalog`);
    }

    // 1. Publicar comando al GPIO via MQTT (pin incluido en payload)
    mqttBus.publishCommand(relay.id, relay.pin, state);

    // 2. Actualización optimista del estado local
    relayStateStore.set(id, state);

    // 3. Notificar a todos los clientes WS (update optimista inmediato)
    realtimeHub.broadcastRelayUpdate(id, state);

    console.log(`[RelayService] ${relay.displayName} (${relay.pin}) → ${state ? "ON" : "OFF"} [via MQTT]`);
  }

  /**
   * Enciende o apaga todos los relés a la vez.
   * Publica comando MQTT bulk, actualiza store y difunde snapshot.
   */
  async setAll(state: boolean): Promise<void> {
    mqttBus.publishAll(state);

    for (const relay of RELAY_CATALOG) {
      relayStateStore.set(relay.id, state);
    }
    realtimeHub.broadcastSnapshot(relayStateStore.getAll());

    console.log(`[RelayService] setAll → ${state ? "ON" : "OFF"} [via MQTT]`);
  }

  // ── Consultas ─────────────────────────────────────────────────────────────

  /** Estado actual de todos los relés. */
  getSnapshot(): Record<string, boolean> {
    return relayStateStore.getAll();
  }

  /**
   * Lista enriquecida: combina el catálogo con el estado actual.
   * Útil para el endpoint GET /api/relays.
   */
  getAll() {
    const snapshot = relayStateStore.getAll();
    return RELAY_CATALOG.map((r) => ({
      id: r.id,
      displayName: r.displayName,
      pin: r.pin,
      state: snapshot[r.id] ?? false,
    }));
  }
}

export const relayService = new RelayService();
