#!/usr/bin/env bash
# Render config templates with scenario parameters. Pure host-side
# substitution (perl) so it works without gettext/envsubst.
set -euo pipefail
cd "$(dirname "$0")"

UPLINK_MAXAGE="${UPLINK_MAXAGE:-2m}"
META_TTL="${META_TTL:-30s}"
PURGE_TOKEN="${PURGE_TOKEN:-lab-purge-token}"
BACKGROUND_UPDATE="${BACKGROUND_UPDATE:-on}"
XFP="${XFP:-http}"   # lab is http-only; prod uses https
PROP_DELAY="${PROP_DELAY:-60s}"   # mock npm read-path propagation lag
# Single edge by default; multi-replica scenario overrides this.
NGINX_UPSTREAM="${NGINX_UPSTREAM:-    server edge:4873 max_fails=3 fail_timeout=10s;}"

render() {
  local src="$1" dst="$2"
  perl -pe '
    s/\$\{UPLINK_MAXAGE\}/$ENV{UPLINK_MAXAGE}/g;
    s/\$\{META_TTL\}/$ENV{META_TTL}/g;
    s/\$\{PURGE_TOKEN\}/$ENV{PURGE_TOKEN}/g;
    s/\$\{BACKGROUND_UPDATE\}/$ENV{BACKGROUND_UPDATE}/g;
    s/\$\{XFP\}/$ENV{XFP}/g;
    s/\$\{PROP_DELAY\}/$ENV{PROP_DELAY}/g;
    s/\$\{NGINX_UPSTREAM\}/$ENV{NGINX_UPSTREAM}/g;
  ' "$src" > "$dst"
}

export UPLINK_MAXAGE META_TTL PURGE_TOKEN BACKGROUND_UPDATE NGINX_UPSTREAM XFP PROP_DELAY
render edge/config.template.yaml edge/config.yaml
render nginx/nginx.template.conf nginx/nginx.conf
render npm-cdn/nginx.template.conf npm-cdn/nginx.conf
echo "rendered: UPLINK_MAXAGE=$UPLINK_MAXAGE META_TTL=$META_TTL PROP_DELAY=$PROP_DELAY BACKGROUND_UPDATE=$BACKGROUND_UPDATE"
echo "         upstream='$NGINX_UPSTREAM'"
