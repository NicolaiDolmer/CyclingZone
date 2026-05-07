#!/usr/bin/env bash
# Setup CyclingZone GitHub Projects v2 board
# Kræver: gh CLI med project-scope (gh auth refresh -s project)
# Kør fra repo-roden: bash scripts/setup-github-project.sh
set -euo pipefail

OWNER="NicolaiDolmer"
REPO="CyclingZone"
PROJECT_TITLE="CyclingZone Roadmap"

echo "==> Tjekker gh auth scope..."
if ! gh auth status 2>&1 | grep -q "project"; then
  echo "ADVARSEL: 'project'-scope ikke bekræftet. Kør: gh auth refresh -s project"
  echo "Fortsætter alligevel — fejler hvis scope mangler."
fi

# ── 1. Opret project (idempotent: spring over hvis allerede eksisterer) ────────
echo "==> Opretter project '$PROJECT_TITLE'..."
EXISTING=$(gh project list --owner "$OWNER" --format json | python3 -c "
import sys, json
projects = json.load(sys.stdin).get('projects', [])
match = next((p for p in projects if p['title'] == '$PROJECT_TITLE'), None)
print(match['number'] if match else '')
" 2>/dev/null || echo "")

if [ -n "$EXISTING" ]; then
  PROJECT_NUMBER="$EXISTING"
  echo "    Project eksisterer allerede (#$PROJECT_NUMBER) — springer oprettelse over."
else
  PROJECT_JSON=$(gh project create --owner "$OWNER" --title "$PROJECT_TITLE" --format json)
  PROJECT_NUMBER=$(echo "$PROJECT_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['number'])")
  echo "    Oprettet project #$PROJECT_NUMBER."
fi

PROJECT_ID=$(gh project view "$PROJECT_NUMBER" --owner "$OWNER" --format json | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "    Project node ID: $PROJECT_ID"

# ── 2. Link project til repository ────────────────────────────────────────────
echo "==> Linker project til $OWNER/$REPO..."
gh project link "$PROJECT_NUMBER" --owner "$OWNER" --repo "$OWNER/$REPO" 2>/dev/null || \
  echo "    (link allerede oprettet eller ikke tilgængeligt — fortsætter)"

# ── 3. Opret custom fields ────────────────────────────────────────────────────
echo "==> Opretter custom fields..."

create_field_if_missing() {
  local field_name="$1"
  local data_type="$2"
  shift 2
  local extra_args=("$@")

  EXISTING_FIELD=$(gh project field-list "$PROJECT_NUMBER" --owner "$OWNER" --format json | \
    python3 -c "
import sys, json
fields = json.load(sys.stdin).get('fields', [])
match = next((f for f in fields if f.get('name') == '$field_name'), None)
print('exists' if match else '')
" 2>/dev/null || echo "")

  if [ "$EXISTING_FIELD" = "exists" ]; then
    echo "    Felt '$field_name' eksisterer allerede — springer over."
  else
    gh project field-create "$PROJECT_NUMBER" --owner "$OWNER" \
      --data-type "$data_type" --name "$field_name" "${extra_args[@]}"
    echo "    Oprettet felt: $field_name ($data_type)"
  fi
}

create_field_if_missing "slice" "SINGLE_SELECT" \
  --single-select-options "07,08,09,10,11,12,13,14"

create_field_if_missing "priority" "SINGLE_SELECT" \
  --single-select-options "high,med,low"

create_field_if_missing "status" "SINGLE_SELECT" \
  --single-select-options "backlog,active,blocked,done"

create_field_if_missing "sæson" "SINGLE_SELECT" \
  --single-select-options "1,2,3,4"

# ── 4. Tilføj alle åbne issues ────────────────────────────────────────────────
echo "==> Henter åbne issues..."
ISSUE_URLS=$(gh issue list --state open --limit 200 --json url | \
  python3 -c "import sys,json; [print(i['url']) for i in json.load(sys.stdin)]")

ISSUE_COUNT=$(echo "$ISSUE_URLS" | wc -l | tr -d ' ')
echo "    Fandt $ISSUE_COUNT åbne issues. Tilføjer til project..."

ADDED=0
SKIPPED=0
while IFS= read -r url; do
  if gh project item-add "$PROJECT_NUMBER" --owner "$OWNER" --url "$url" 2>/dev/null; then
    ADDED=$((ADDED + 1))
  else
    SKIPPED=$((SKIPPED + 1))
  fi
done <<< "$ISSUE_URLS"

echo "    Tilføjet: $ADDED issues. Allerede i projekt: $SKIPPED."

# ── 5. Opret views via GraphQL ────────────────────────────────────────────────
echo "==> Opretter views via GraphQL..."

# Hent eksisterende views
EXISTING_VIEWS=$(gh api graphql -f query="
query {
  node(id: \"$PROJECT_ID\") {
    ... on ProjectV2 {
      views(first: 20) {
        nodes { id name }
      }
    }
  }
}" | python3 -c "
import sys, json
data = json.load(sys.stdin)
views = data['data']['node']['views']['nodes']
print(json.dumps([v['name'] for v in views]))
")
echo "    Eksisterende views: $EXISTING_VIEWS"

create_view_if_missing() {
  local view_name="$1"
  local layout="$2"  # BOARD_LAYOUT, TABLE_LAYOUT, ROADMAP_LAYOUT

  if echo "$EXISTING_VIEWS" | python3 -c "import sys,json; names=json.load(sys.stdin); exit(0 if '$view_name' not in names else 1)"; then
    gh api graphql -f query="
mutation {
  createProjectV2View(input: {
    projectId: \"$PROJECT_ID\"
    name: \"$view_name\"
    layout: $layout
  }) {
    projectV2View { id name }
  }
}" | python3 -c "
import sys, json
result = json.load(sys.stdin)
view = result['data']['createProjectV2View']['projectV2View']
print(f'    Oprettet view: {view[\"name\"]} (id: {view[\"id\"]})')
"
  else
    echo "    View '$view_name' eksisterer allerede — springer over."
  fi
}

# View 1: Board grupperet på slice (standard table-view som udgangspunkt)
create_view_if_missing "Board (slice)" "TABLE_LAYOUT"

# View 2: Roadmap (tidsaksen)
create_view_if_missing "Roadmap" "ROADMAP_LAYOUT"

# View 3: Active backlog (filter: claude:todo)
create_view_if_missing "Active backlog" "TABLE_LAYOUT"

echo ""
echo "✓ Setup færdigt!"
echo ""
echo "Næste trin (manuelt i browser):"
echo "  1. Åbn: https://github.com/users/$OWNER/projects"
echo "  2. Sæt group-by = 'slice' på 'Board (slice)'-viewet"
echo "  3. Tilføj filter 'label:claude:todo' på 'Active backlog'-viewet"
echo "  4. Konfigurér Roadmap-datofelter (start/slut) på Roadmap-viewet"
echo "  5. Verificér på GitHub Mobile app"
