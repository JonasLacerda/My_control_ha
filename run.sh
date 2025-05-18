#!/bin/bash

# Lê configurações do arquivo gerado pelo HA
CONFIG="/data/options.json"

export HA_HOST=$(jq -r '.ha_host' "$CONFIG")
export HA_PORT=$(jq -r '.ha_port' "$CONFIG")
export HA_TOKEN=$(jq -r '.ha_token' "$CONFIG")
export MQTT_BROKER=$(jq -r '.mqtt_broker' "$CONFIG")
export MQTT_USER=$(jq -r '.mqtt_user' "$CONFIG")
export MQTT_PASS=$(jq -r '.mqtt_pass' "$CONFIG")
export MQTT_TOPIC=$(jq -r '.mqtt_topic' "$CONFIG")

# Verifica variáveis críticas
if [ -z "$HA_TOKEN" ]; then
  echo "❌ Token do HA não definido! Edite no Supervisor > Seu Addon > Configuração" >&2
  exit 1
fi

# Inicia o bridge
node mqtt_ws.js