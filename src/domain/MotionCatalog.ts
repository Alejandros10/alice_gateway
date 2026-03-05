/**
 * MotionCatalog — Mapeo sensor de movimiento → relay
 *
 * Configura aquí qué relay se enciende cuando cada sensor detecta movimiento
 * y cuántos segundos esperar sin movimiento antes de apagarlo.
 *
 * sensor-1 / sensor-2 deben coincidir con lo que el Arduino envía por Serial:
 *   MOTION:sensor-1
 *   MOTION:sensor-2
 */

export interface MotionRule {
  /** ID del sensor. Debe coincidir con lo que publica el Arduino (MOTION:{sensorId}) */
  sensorId: string;
  /** Nombre legible para logs */
  displayName: string;
  /** Relay a encender cuando hay movimiento (debe existir en RelayCatalog) */
  relayId: string;
  /** Segundos sin movimiento antes de apagar el relay automáticamente */
  autoOffSecs: number;
}

export const MOTION_CATALOG: MotionRule[] = [
  {
    sensorId:    "sensor-1",
    displayName: "Sensor Pasillo",
    relayId:     "pasillo",
    autoOffSecs: 60,
  },
  {
    sensorId:    "sensor-2",
    displayName: "Sensor Entrada",
    relayId:     "entrada",
    autoOffSecs: 30,
  },
];

/** Busca la regla por sensor ID. */
export function findMotionRule(sensorId: string): MotionRule | undefined {
  return MOTION_CATALOG.find((r) => r.sensorId === sensorId);
}
