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
  private state: Record<string, boolean> = {};

  constructor() {
    // Todos los relés arrancan en OFF al iniciar el Gateway
    for (const relay of RELAY_CATALOG) {
      this.state[relay.id] = false;
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
}

export const relayStateStore = new RelayStateStore();
