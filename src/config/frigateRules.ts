/**
 * frigateRules.ts — Configuración de detección Frigate → Relés
 *
 * La regla activa se carga desde la BD (Setting table) via AliceApiClient.
 * Este archivo define solo los valores por defecto usados si el API no responde.
 *
 * Campos:
 *   enabled         — activar/desactivar la automatización completa
 *   activeAfterHour — solo actúa si la hora local (Bogotá) es >= este valor (0-23)
 *   relayIds        — lista de relés que se encienden al detectar una persona
 *   autoOffSec      — segundos hasta apagado automático (0 = nunca apaga solo)
 */

export interface FrigateDetectionRule {
  enabled:         boolean;
  activeAfterHour: number;
  relayIds:        string[];
  autoOffSec:      number;
}

export const DEFAULT_FRIGATE_RULE: FrigateDetectionRule = {
  enabled:         true,
  activeAfterHour: 18,
  relayIds:        ["corredores", "reflectores"],
  autoOffSec:      300,
};
