/**
 * RelayCatalog — Configuración / Mapeo
 *
 * Responsabilidad: conocer qué relés existen y cómo controlarlos.
 * No ejecuta, no llama red.
 *
 * Tipos:
 *   "gpio" → controlado via Raspberry Pi + GPIO API (MQTT: alice/relay/{id}/set)
 *   "wifi" → controlado via NodeMCU/ESP8266          (MQTT: alice/wifi/{id}/set)
 *
 * Para agregar un relay WiFi:
 *   1. Flashea el NodeMCU con alice_wifi_relay.ino y DEVICE_ID = "<id>"
 *   2. Agrega aquí: { id: "<id>", displayName: "...", pin: "D1", type: "wifi" }
 */

export type RelayType = "gpio" | "wifi";

export interface RelayDefinition {
  /** Identificador único usado en URLs: /api/relays/:id */
  id: string;
  /** Nombre legible para la UI */
  displayName: string;
  /**
   * GPIO relays: pin en la Raspberry ("gpio5", "gpio13", …)
   * WiFi relays: pin en el NodeMCU ("D1", "D2", …) — solo informativo
   */
  pin: string;
  /** Protocolo de control. Default: "gpio" */
  type?: RelayType;
}

// ── Relés físicos (Raspberry Pi GPIO) ────────────────────────────────────────

export const RELAY_CATALOG: RelayDefinition[] = [
  { id: "escalas",         displayName: "Escalas",         pin: "gpio5"  },
  { id: "reflectores",     displayName: "Reflectores",     pin: "gpio7"  },
  { id: "habitacion",      displayName: "Habitacion",      pin: "gpio18" },
  { id: "corredores",      displayName: "Corredores",      pin: "gpio19" },
  { id: "estudio",         displayName: "Estudio",         pin: "gpio8"  },
  { id: "corredorese",     displayName: "Corredores 2",    pin: "gpio10" },
  { id: "sala",            displayName: "Sala",            pin: "gpio23" },
  { id: "hab-noche",       displayName: "Hab Noche",       pin: "gpio24" },
  { id: "cocina",          displayName: "Cocina",          pin: "gpio26" },
  { id: "entrada",         displayName: "Entrada",         pin: "gpio4"  },
  { id: "si",              displayName: "si",              pin: "gpio6"  },
  { id: "bodega",          displayName: "Bodega",          pin: "gpio9"  },
  { id: "porton",          displayName: "Portón",          pin: "gpio11" },
  { id: "comedor",         displayName: "Comedor",         pin: "gpio12" },
  { id: "dormitorio-1",    displayName: "Dormitorio 1",    pin: "gpio13" },
  { id: "alarma",          displayName: "Alarma",          pin: "gpio14" },
  { id: "bomba-agua",      displayName: "Bomba Agua",      pin: "gpio15" },
  { id: "dormitorio-2",    displayName: "Dormitorio 2",    pin: "gpio16" },
  { id: "dormitorio-3",    displayName: "Dormitorio 3",    pin: "gpio17" },
  { id: "pasillo",         displayName: "Pasillo",         pin: "gpio20" },
  { id: "lavanderia",      displayName: "Lavandería",      pin: "gpio21" },
  { id: "garaje",          displayName: "Garaje",          pin: "gpio22" },
  { id: "exterior-frente", displayName: "Exterior Frente", pin: "gpio25" },
  { id: "terraza",         displayName: "Terraza",         pin: "gpio27" },

  // ── Relés WiFi (NodeMCU / ESP8266) ────────────────────────────────────────
  // Agrega aquí tus NodeMCUs. El id debe coincidir con DEVICE_ID en el .ino
  { id: "wifi-garaje",  displayName: "Garaje WiFi",   pin: "D1", type: "wifi" },
  // { id: "wifi-terraza", displayName: "Terraza WiFi",  pin: "D1", type: "wifi" },
];

/** Busca un relé por su id lógico. Devuelve undefined si no existe. */
export function findRelay(id: string): RelayDefinition | undefined {
  return RELAY_CATALOG.find((r) => r.id === id);
}

/** Solo relés GPIO (Raspberry Pi). */
export const GPIO_RELAYS = RELAY_CATALOG.filter((r) => !r.type || r.type === "gpio");

/** Solo relés WiFi (NodeMCU). */
export const WIFI_RELAYS = RELAY_CATALOG.filter((r) => r.type === "wifi");
