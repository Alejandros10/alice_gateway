/**
 * frigateRules.ts — Configuración de detección Frigate → Relés (por cámara)
 *
 * La regla activa se carga desde la BD (Setting table) via AliceApiClient.
 * Este archivo define solo los valores por defecto.
 *
 * Estructura:
 *   enabled         — activa/desactiva toda la automatización
 *   activeAfterHour — solo actúa si hora local Bogotá >= este valor (0-23)
 *   autoOffSec      — segundos hasta apagado (0 = manual)
 *   cameras         — mapa cameraId → { enabled, relayIds[] }
 *                     Cada cámara puede tener sus propios relés y activarse
 *                     de forma independiente.
 */

export interface FrigateCameraRule {
  enabled:  boolean;
  relayIds: string[];
}

export interface FrigateDetectionRule {
  enabled:          boolean;
  activeAfterHour:  number;
  activeUntilHour:  number;
  autoOffSec:       number;
  cameras:          Record<string, FrigateCameraRule>;
}

export const DEFAULT_FRIGATE_RULE: FrigateDetectionRule = {
  enabled:          true,
  activeAfterHour:  18,
  activeUntilHour:  6,
  autoOffSec:       300,
  cameras: {
    camara_fronta:  { enabled: true, relayIds: ["entrada",  "corredores"] },
    camara_trasera: { enabled: true, relayIds: ["terraza",  "reflectores"] },
  },
};
