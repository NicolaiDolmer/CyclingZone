#!/bin/bash
# Stop-hook: advarer hvis NOW.md overstiger 30-linjers mål
if [ -f "docs/NOW.md" ]; then
  L=$(wc -l < "docs/NOW.md")
  if [ "$L" -gt 40 ]; then
    echo "{\"systemMessage\": \"ADVARSEL: NOW.md er $L linjer (maal: maks 30). Flyt historik til docs/archive/ nu.\"}"
  fi
fi
