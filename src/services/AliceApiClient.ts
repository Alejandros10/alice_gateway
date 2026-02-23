/**
 * AliceApiClient — Cliente tipado para el API de Next.js (alice_home_controller_front)
 *
 * El Gateway consume este cliente para:
 *  - Obtener los horarios activos al arrancar o al recargar
 *  - Registrar ejecuciones de horarios en la BD (fire-and-forget)
 *
 * El API de Next.js es la única capa que accede a la BD (Prisma/MySQL).
 * El Gateway no conoce el esquema de BD; solo habla con este cliente.
 *
 * Base URL configurada en .env: FRONTEND_URL (default http://localhost:3000)
 */

import axios, { AxiosInstance } from "axios";
import type { FrigateDetectionRule } from "../config/frigateRules";
export type { FrigateDetectionRule };

// ── DTOs (espejo de los tipos definidos en Next.js) ────────────────────────────

export interface ScheduleDto {
  id:      string;
  relayId: string;
  action:  "on" | "off";
  days:    string;        // "mon,tue,wed,thu,fri"
  time:    string;        // "HH:MM"
  label:   string | null;
}

interface GetSchedulesResponse {
  schedules: ScheduleDto[];
}

interface LogRelayEventRequest {
  relayId: string;
  action:  "on" | "off";
  source?: string;
}


// ── Cliente ────────────────────────────────────────────────────────────────────

class AliceApiClient {
  private http: AxiosInstance;

  constructor(baseUrl: string) {
    this.http = axios.create({
      baseURL: baseUrl,
      timeout: 5_000,
      headers: { "Content-Type": "application/json" },
    });
  }

  /**
   * Obtiene todos los horarios habilitados desde Next.js.
   * Llamado al arrancar el gateway y al recibir /api/schedules/reload.
   */
  async getSchedules(): Promise<ScheduleDto[]> {
    const { data } = await this.http.get<GetSchedulesResponse>(
      "/api/schedules"
    );
    return data.schedules;
  }

  /**
   * Lee la regla de detección Frigate desde la BD (via Next.js API).
   * Retorna null si el endpoint no está disponible.
   */
  async getFrigateRule(): Promise<FrigateDetectionRule | null> {
    try {
      const { data } = await this.http.get<{ rule: FrigateDetectionRule }>(
        "/api/automations/frigate-detection"
      );
      return data.rule;
    } catch {
      return null;
    }
  }

  /**
   * Lee el modo de la casa ("home" | "away") desde la BD (via Next.js API).
   * Retorna "home" si el endpoint no está disponible.
   */
  async getHouseMode(): Promise<"home" | "away"> {
    try {
      const { data } = await this.http.get<{ mode: "home" | "away" }>(
        "/api/settings/house-mode"
      );
      return data.mode ?? "home";
    } catch {
      return "home";
    }
  }

  /**
   * Obtiene la lista de emails de notificación habilitados desde la BD.
   */
  async getNotificationEmails(): Promise<string[]> {
    try {
      const { data } = await this.http.get<{ emails: { email: string; enabled: boolean }[] }>(
        "/api/settings/notification-emails"
      );
      return (data.emails ?? []).filter((e) => e.enabled).map((e) => e.email);
    } catch {
      return [];
    }
  }

  /**
   * Registra en BD la ejecución de un horario.
   * Fire-and-forget: los errores se loguean pero no interrumpen el flujo.
   */
  logRelayEvent(relayId: string, action: "on" | "off"): void {
    const body: LogRelayEventRequest = { relayId, action, source: "schedule" };
    this.http
      .post<{ ok: boolean }>("/api/alice/relay-events", body)
      .catch((err) => {
        console.warn(
          `[AliceApiClient] No se pudo registrar evento (${relayId} ${action}):`,
          err.message
        );
      });
  }
}

// Singleton — inicializado con FRONTEND_URL en index.ts
let _client: AliceApiClient | null = null;

export function initAliceApiClient(baseUrl: string): void {
  _client = new AliceApiClient(baseUrl);
}

export function aliceApi(): AliceApiClient {
  if (!_client) throw new Error("AliceApiClient no inicializado. Llama initAliceApiClient() primero.");
  return _client;
}
