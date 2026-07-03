#!/usr/bin/env bash
# snapshot.sh — Napravi snapshot tag pre veće izmene
# Upotreba: ./scripts/snapshot.sh <kratak-opis>
# Primer:   ./scripts/snapshot.sh add-user-auth

set -e

if [ -z "$1" ]; then
  echo "Greška: Nedostaje opis zadatka."
  echo "Upotreba: $0 <kratak-opis>"
  echo "Primer:   $0 add-user-auth"
  exit 1
fi

DESCRIPTION=$(echo "$1" | tr ' ' '-' | tr '[:upper:]' '[:lower:]' | tr -cd '[:alnum:]-')
DATE=$(date +%Y-%m-%d)
TAG="snapshot/pre-${DESCRIPTION}-${DATE}"

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
CURRENT_COMMIT=$(git rev-parse --short HEAD)

echo "Kreiranje snapshot taga..."
echo "  Tag:    $TAG"
echo "  Branch: $CURRENT_BRANCH"
echo "  Commit: $CURRENT_COMMIT"
echo ""

git tag "$TAG" HEAD
git push origin "$TAG"

echo "Snapshot uspešno kreiran: $TAG"
echo ""
echo "Rollback komande:"
echo "  Pregled:      git checkout $TAG"
echo "  Hard reset:   git checkout main && git reset --hard $TAG"
