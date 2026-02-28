/**
 * RelayStateStore — Estado actual de los relés
 *
 * Responsabilidad: persistir y leer el estado ON/OFF de cada relé.
 * Fase inicial: en memoria (RAM).
 * Fase futura: reemplazar por adaptador Redis sin tocar el resto del código.
 *
 * Se exporta como singleton `relayStateStore`.
 */

import { RELAY_CATALOG } from "../domain/RelayCatalog";

class RelayStateStore {
  private state:  Record<string, boolean> = {};
  private online: Record<string, boolean> = {};

  constructor() {
    // Todos los relés arrancan en OFF al iniciar el Gateway
    for (const relay of RELAY_CATALOG) {
      this.state[relay.id] = false;
      // WiFi relays arrancan como offline hasta que el NodeMCU publique su estado
      if (relay.type === "wifi") this.online[relay.id] = false;
    }
  }

  /** Devuelve una copia del estado completo { id: boolean } */
  getAll(): Record<string, boolean> {
    return { ...this.state };
  }

  /** Devuelve el estado de un relé específico. undefined si no existe. */
  get(id: string): boolean | undefined {
    return this.state[id];
  }

  /** Actualiza el estado de un relé. */
  set(id: string, value: boolean): void {
    this.state[id] = value;
  }

  /** Devuelve el estado online de un relay WiFi. undefined si no aplica (GPIO). */
  getOnline(id: string): boolean | undefined {
    return this.online[id];
  }

  /** Actualiza el estado online de un relay WiFi. */
  setOnline(id: string, value: boolean): void {
    this.online[id] = value;
  }
}

export const relayStateStore = new RelayStateStore();
