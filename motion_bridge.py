#!/usr/bin/env python3
"""
motion_bridge.py — Puente Arduino Serial → MQTT
Corre en la Raspberry Pi que tiene el Arduino conectado por USB.

Requisitos:
  pip install pyserial paho-mqtt

El Arduino escribe por Serial:
  MOTION:sensor-1
  MOTION:sensor-2

Este script lo publica en MQTT:
  alice/motion/sensor-1  →  {"motion": true}
  alice/motion/sensor-2  →  {"motion": true}

El Gateway (Ubuntu .1.4) suscrito a alice/motion/+ activa el relay configurado.
"""

import json
import time
import serial
import serial.tools.list_ports
import paho.mqtt.client as mqtt

# ── Configuración ─────────────────────────────────────────────────────────────
BROKER      = "192.168.1.4"
BROKER_PORT = 1883
CLIENT_ID   = "rpi-motion-bridge"

# Puerto serie del Arduino (ajustar si es diferente)
# /dev/ttyUSB0 → Arduino con chip CH340 (clonico)
# /dev/ttyACM0 → Arduino Uno original
SERIAL_PORT = "/dev/ttyUSB0"
BAUD_RATE   = 9600

# Cooldown mínimo entre publicaciones del mismo sensor (segundos)
# Evita flood si el PIR oscila
COOLDOWN_SECS = 2
# ─────────────────────────────────────────────────────────────────────────────

_last_published: dict[str, float] = {}


def find_arduino_port() -> str:
    """Busca automáticamente el puerto Arduino si SERIAL_PORT no responde."""
    for port in serial.tools.list_ports.comports():
        desc = port.description.lower()
        if "arduino" in desc or "ch340" in desc or "ttyusb" in port.device or "ttyacm" in port.device:
            return port.device
    return SERIAL_PORT


def on_connect(client, userdata, flags, rc):
    if rc == 0:
        print(f"[MQTT] Conectado a {BROKER}:{BROKER_PORT}")
    else:
        print(f"[MQTT] Error de conexion (rc={rc})")


def main():
    # MQTT
    client = mqtt.Client(client_id=CLIENT_ID)
    client.on_connect = on_connect
    client.connect(BROKER, BROKER_PORT, keepalive=60)
    client.loop_start()

    # Serial
    port = find_arduino_port()
    print(f"[Bridge] Abriendo puerto serie: {port} @ {BAUD_RATE}")

    try:
        ser = serial.Serial(port, BAUD_RATE, timeout=1)
    except serial.SerialException as e:
        print(f"[ERROR] No se pudo abrir {port}: {e}")
        print("  Puertos disponibles:")
        for p in serial.tools.list_ports.comports():
            print(f"    {p.device} — {p.description}")
        return

    # Dar tiempo al Arduino para reiniciar tras abrir el puerto
    time.sleep(2)
    print("[Bridge] Escuchando Arduino... (Ctrl+C para detener)")

    while True:
        try:
            raw = ser.readline()
            if not raw:
                continue

            line = raw.decode("utf-8", errors="ignore").strip()
            if not line:
                continue

            print(f"[Serial] {line}")

            if not line.startswith("MOTION:"):
                continue

            sensor_id = line.split(":", 1)[1].strip()
            if not sensor_id:
                continue

            # Cooldown por sensor
            now = time.time()
            if now - _last_published.get(sensor_id, 0) < COOLDOWN_SECS:
                continue

            _last_published[sensor_id] = now

            topic   = f"alice/motion/{sensor_id}"
            payload = json.dumps({"motion": True})
            client.publish(topic, payload, qos=1)
            print(f"[MQTT] → {topic}: {payload}")

        except serial.SerialException as e:
            print(f"[ERROR] Puerto serie: {e}")
            time.sleep(3)
        except KeyboardInterrupt:
            print("\n[Bridge] Detenido.")
            break

    ser.close()
    client.loop_stop()


if __name__ == "__main__":
    main()
