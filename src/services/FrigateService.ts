/**
 * FrigateService — Integración Frigate NVR → Relés via MQTT (por cámara)
 *
 * Flujo:
 *   Frigate detecta persona → MQTT frigate/events
 *     → verifica regla global (enabled + hora activa)
 *     → busca regla específica de la cámara (cameras[camera].enabled + relayIds)
 *     → RelayService enciende los relés de ESA cámara
 *     → auto-apagado independiente por cámara
 *
 * La regla se lee desde la BD cada 60s via AliceApiClient.
 */

import { mqttBus }                                                   from "./MqttBus";
import { relayService }                                              from "./RelayService";
import { aliceApi }                                                  from "./AliceApiClient";
import { DEFAULT_FRIGATE_RULE, FrigateDetectionRule }                from "../config/frigateRules";

const TOPIC_EVENTS   = "frigate/events";
const RULE_CACHE_TTL = 60_000;

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
  private rule: FrigateDetectionRule          = { ...DEFAULT_FRIGATE_RULE };
  private ruleLastFetched                     = 0;
  private autoOffTimers = new Map<string, NodeJS.Timeout>(); // key = cameraId

  init(): void {
    mqttBus.addFrigateHandler((topic: string, payload: Buffer) => {
      if (topic === TOPIC_EVENTS) {
        this._handleEvent(payload).catch((err) =>
          console.error("[Frigate] Unhandled error:", err)
        );
      }
    });
    console.log("[Frigate] Service ready — per-camera rules active");
  }

  private async _refreshRule(): Promise<void> {
    const now = Date.now();
    if (now - this.ruleLastFetched < RULE_CACHE_TTL) return;
    try {
      const rule = await aliceApi().getFrigateRule();
      if (rule) this.rule = rule;
      this.ruleLastFetched = now;
    } catch { /* mantiene regla cacheada */ }
  }

  private _isActiveHour(): boolean {
    const hourStr = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Bogota",
      hour:     "numeric",
      hour12:   false,
    }).format(new Date());
    return parseInt(hourStr, 10) >= this.rule.activeAfterHour;
  }

  private async _handleEvent(payloadBuf: Buffer): Promise<void> {
    await this._refreshRule();

    if (!this.rule.enabled)    return;
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

    const camera     = event.after.camera;
    const cameraRule = this.rule.cameras[camera];

    if (!cameraRule) {
      console.log(`[Frigate] Camera "${camera}" not in rules — ignored`);
      return;
    }
    if (!cameraRule.enabled || cameraRule.relayIds.length === 0) return;

    const score   = event.after.top_score.toFixed(2);
    const targets = cameraRule.relayIds.join(", ");
    console.log(`[Frigate] Person on "${camera}" (${score}) → ON [${targets}]`);

    for (const relayId of cameraRule.relayIds) {
      relayService.turnOn(relayId).catch((err: Error) => {
        console.error(`[Frigate] Error turning on "${relayId}":`, err.message);
      });
    }

    // Auto-apagado independiente por cámara
    if (this.rule.autoOffSec > 0) {
      const existing = this.autoOffTimers.get(camera);
      if (existing) clearTimeout(existing);

      const timer = setTimeout(() => {
        console.log(`[Frigate] Auto-off "${camera}" after ${this.rule.autoOffSec}s`);
        for (const relayId of cameraRule.relayIds) {
          relayService.turnOff(relayId).catch(() => {});
        }
        this.autoOffTimers.delete(camera);
      }, this.rule.autoOffSec * 1_000);

      this.autoOffTimers.set(camera, timer);
    }
  }
}

export const frigateService = new FrigateService();
