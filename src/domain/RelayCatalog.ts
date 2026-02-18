/**
 * RelayCatalog — Configuración / Mapeo
 *
 * Responsabilidad: conocer qué relés existen y a qué pin GPIO
 * corresponde cada uno en la Raspberry. No ejecuta, no llama red.
 *
 * Edita este archivo para agregar / renombrar / reasignar relés.
 * El campo `pin` debe coincidir con las keys de VALID_GPIO_PINS
 * del controlador FastAPI (gpio4 … gpio27).
 */

export interface RelayDefinition {
  /** Identificador único usado en URLs: /api/relays/:id */
  id: string;
  /** Nombre legible para la UI */
  displayName: string;
  /** Nombre del pin GPIO en la Raspberry ("gpio5", "gpio13", …) */
  pin: string;
}

export const RELAY_CATALOG: RelayDefinition[] = [
  { id: "entrada",         displayName: "Entrada",          pin: "gpio4"  },
  { id: "cocina",          displayName: "Cocina",           pin: "gpio5"  },
  { id: "sala",            displayName: "Sala",             pin: "gpio6"  },
  { id: "comedor",         displayName: "Comedor",          pin: "gpio12" },
  { id: "dormitorio-1",    displayName: "Dormitorio 1",     pin: "gpio13" },
  { id: "dormitorio-2",    displayName: "Dormitorio 2",     pin: "gpio16" },
  { id: "dormitorio-3",    displayName: "Dormitorio 3",     pin: "gpio17" },
  { id: "bano-1",          displayName: "Baño 1",           pin: "gpio18" },
  { id: "bano-2",          displayName: "Baño 2",           pin: "gpio19" }, 
  { id: "pasillo",         displayName: "Pasillo",          pin: "gpio20" },
  { id: "lavanderia",      displayName: "Lavandería",       pin: "gpio21" },
  { id: "garaje",          displayName: "Garaje",           pin: "gpio22" },
  { id: "luz-garaje",      displayName: "Luz Garaje",       pin: "gpio23" },
  { id: "jardin",          displayName: "Jardín",           pin: "gpio24" },
  { id: "exterior-frente", displayName: "Exterior Frente",  pin: "gpio25" },
  { id: "exterior-fondo",  displayName: "Exterior Fondo",   pin: "gpio26" },
  { id: "terraza",         displayName: "Terraza",          pin: "gpio27" },
];

/** Busca un relé por su id lógico. Devuelve undefined si no existe. */
export function findRelay(id: string): RelayDefinition | undefined {
  return RELAY_CATALOG.find((r) => r.id === id);
}
