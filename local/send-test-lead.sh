#!/bin/sh
# Sends one fake enquiry to the local capture endpoint, the same way a Facebook or Zapier form would.
#   ./send-test-lead.sh                       random new person on Migsun Lucknow Central
#   ./send-test-lead.sh 9876543210 "Ravi"     a specific number (send twice to see a re-enquiry)
PHONE="${1:-9$(date +%s | tail -c 10)}"
NAME="${2:-Test Lead}"
curl -s -X POST "http://127.0.0.1:54321/functions/v1/capture/migsun-lucknow-central" \
  -H "content-type: application/json" -H "x-capture-secret: demo-secret" \
  -d "{\"contact\":\"$NAME\",\"mobile\":\"$PHONE\",\"city\":\"Lucknow\",\"category\":\"Yes, ready to buy\",\"date\":\"$(date -u +%Y-%m-%dT%H:%M:%S+00:00)\"}"
echo
