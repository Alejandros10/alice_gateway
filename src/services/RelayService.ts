/**
 * RelayService — Caso de uso / Negocio
 *
 * Responsabilidad: orquestar el flujo completo de encendido/apagado.
 *
 * Flujo para setState(id, state):
 *   1. Validar que el relé existe en el catálogo
 *   2. Llamar a RaspberryRelayClient → ejecuta el cambio físico en GPIO
 *   3. Actualizar RelayStateStore → nueva verdad en memoria
 *   4. Notificar a RealtimeHub → todos los clientes WS se enteran
 *
 * No contiene lógica HTTP ni de WebSocket directamente.
 * Se exporta como singleton `relayService`.
 */

import { findRelay, RELAY_CATALOG } from "../domain/RelayCatalog";
import { relayStateStore } from "./RelayStateStore";
import { raspberryRelayClient } from "./RaspberryRelayClient";
import { realtimeHub } from "./RealtimeHub";

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
   * Lanza Error si el id no existe en el catálogo o si la Raspberry falla.
   */
  async setState(id: string, state: boolean): Promise<void> {
    const relay = findRelay(id);
    if (!relay) {
      throw new Error(`Relay "${id}" not found in catalog`);
    }

    // 1. Ejecutar cambio físico en la Raspberry
    await raspberryRelayClient.setState(relay.pin, state);

    // 2. Actualizar estado local
    relayStateStore.set(id, state);

    // 3. Notificar a todos los clientes WS
    realtimeHub.broadcastRelayUpdate(id, state);

    console.log(`[RelayService] ${relay.displayName} (${relay.pin}) → ${state ? "ON" : "OFF"}`);
  }

  /**
   * Enciende o apaga todos los relés a la vez.
   * Llama a la Raspberry, actualiza el store y difunde un snapshot.
   */
  async setAll(state: boolean): Promise<void> {
    await raspberryRelayClient.setAll(state);
    for (const relay of RELAY_CATALOG) {
      relayStateStore.set(relay.id, state);
    }
    realtimeHub.broadcastSnapshot(relayStateStore.getAll());
    console.log(`[RelayService] setAll → ${state ? "ON" : "OFF"}`);
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
