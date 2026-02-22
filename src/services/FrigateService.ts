/**
 * FrigateService — Integración Frigate NVR → Relés via MQTT
 *
 * Flujo:
 *   Frigate detecta persona → MQTT frigate/events
 *     → FrigateService verifica regla (enabled + hora activa)
 *     → RelayService enciende los relés configurados
 *     → Auto-apagado después de autoOffSec segundos
 *
 * La regla se lee desde la BD (via AliceApiClient → /api/automations/frigate-detection)
 * y se cachea 60 segundos para no saturar el frontend.
 * Si el API no responde se usa el DEFAULT_FRIGATE_RULE del config.
 */

import { mqttBus }                                    from "./MqttBus";
import { relayService }                               from "./RelayService";
import { aliceApi }                                   from "./AliceApiClient";
import { DEFAULT_FRIGATE_RULE, FrigateDetectionRule } from "../config/frigateRules";

const TOPIC_EVENTS    = "frigate/events";
const RULE_CACHE_TTL  = 60_000; // ms

interface FrigateAfter {
  id:             string;
  camera:         string;
  label:          string;
  score:          number;
  top_score:      number;
  stationary:     boolean;
  false_positive: boolean;
  end_time:       number | null;
}

interface FrigateEventPayload {
  type:   "new" | "update" | "end";
  before: Record<string, unknown> | null;
  after:  FrigateAfter;
}

class FrigateService {
  private rule: FrigateDetectionRule = { ...DEFAULT_FRIGATE_RULE };
  private ruleLastFetched = 0;
  private autoOffTimer: NodeJS.Timeout | null = null;

  init(): void {
    mqttBus.addFrigateHandler((topic: string, payload: Buffer) => {
      if (topic === TOPIC_EVENTS) {
        this._handleEvent(payload).catch((err) =>
          console.error("[Frigate] Unhandled error:", err)
        );
      }
    });
    console.log("[Frigate] Service ready — monitoring frigate/events");
  }

  // ── Regla desde BD (con caché) ────────────────────────────────────────────

  private async _refreshRule(): Promise<void> {
    const now = Date.now();
    if (now - this.ruleLastFetched < RULE_CACHE_TTL) return;
    try {
      const rule = await aliceApi().getFrigateRule();
      if (rule) this.rule = rule;
      this.ruleLastFetched = now;
    } catch {
      // Si falla, se mantiene la regla cacheada (o el default)
    }
  }

  // ── Verificación horaria ──────────────────────────────────────────────────

  private _isActiveHour(): boolean {
    const hourStr = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Bogota",
      hour:     "numeric",
      hour12:   false,
    }).format(new Date());
    const hour = parseInt(hourStr, 10);
    return hour >= this.rule.activeAfterHour;
  }

  // ── Handler principal ─────────────────────────────────────────────────────

  private async _handleEvent(payloadBuf: Buffer): Promise<void> {
    await this._refreshRule();

    if (!this.rule.enabled)   return;
    if (!this._isActiveHour()) return;

    let event: FrigateEventPayload;
    try {
      event = JSON.parse(payloadBuf.toString("utf-8")) as FrigateEventPayload;
    } catch {
      console.error("[Frigate] Invalid JSON payload");
      return;
    }

    if (event.type !== "new")           return;
    if (event.after.label !== "person") return;
    if (event.after.false_positive)     return;

    const camera  = event.after.camera;
    const score   = event.after.top_score.toFixed(2);
    const targets = this.rule.relayIds.join(", ");
    console.log(`[Frigate] Person on "${camera}" (${score}) → ON [${targets}]`);

    // Encender todos los relés configurados
    for (const relayId of this.rule.relayIds) {
      relayService.turnOn(relayId).catch((err: Error) => {
        console.error(`[Frigate] Error turning on "${relayId}":`, err.message);
      });
    }

    // Auto-apagado — reinicia el timer en cada nueva detección
    if (this.rule.autoOffSec > 0) {
      if (this.autoOffTimer) clearTimeout(this.autoOffTimer);
      this.autoOffTimer = setTimeout(() => {
        console.log(`[Frigate] Auto-off after ${this.rule.autoOffSec}s`);
        for (const relayId of this.rule.relayIds) {
          relayService.turnOff(relayId).catch(() => {});
        }
        this.autoOffTimer = null;
      }, this.rule.autoOffSec * 1_000);
    }
  }
}

export const frigateService = new FrigateService();
