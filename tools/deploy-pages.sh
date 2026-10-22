#!/bin/bash
# Publishes the game to GitHub Pages, as a folder inside whatever branch Pages
# is serving - so it can share the site with other projects already there.
#
# Only the files the browser actually loads are copied (index.html, src/,
# the sprite sheets); tests, tools and the raw AI source strips stay out.
#
#   tools/deploy-pages.sh
#
# Settings (environment variables):
#   PAGES_BRANCH   branch GitHub Pages serves      (default: claude/optimistic-dijkstra-dkl4f9)
#   PAGES_DIR      folder for the game on the site (default: shooter)
#   DEPLOY_TRAILER extra lines appended to the deploy commit message
set -euo pipefail

BRANCH=${PAGES_BRANCH:-claude/optimistic-dijkstra-dkl4f9}
DIR=${PAGES_DIR:-shooter}
ROOT=$(git rev-parse --show-toplevel)
SRC_REV=$(git -C "$ROOT" rev-parse --short HEAD)

git -C "$ROOT" fetch origin "$BRANCH"
WT=$(mktemp -d)
git -C "$ROOT" worktree add --detach "$WT" FETCH_HEAD >/dev/null
trap 'git -C "$ROOT" worktree remove --force "$WT"' EXIT

rm -rf "${WT:?}/$DIR"
mkdir -p "$WT/$DIR/assets/ai"
cp "$ROOT/index.html" "$WT/$DIR/"
cp -r "$ROOT/src" "$WT/$DIR/"
cp "$ROOT/assets/player.png" "$WT/$DIR/assets/"
cp "$ROOT"/assets/ai/*.png "$WT/$DIR/assets/ai/"
# Without this, Jekyll may skip or mangle files; harmless if already there.
[ -e "$WT/.nojekyll" ] || touch "$WT/.nojekyll"

cd "$WT"
git add -A "$DIR" .nojekyll
if git diff --cached --quiet; then
  echo "Pages already up to date with $SRC_REV"
  exit 0
fi
git commit -q -m "Deploy shooter game to /$DIR/ (source $SRC_REV)" ${DEPLOY_TRAILER:+-m "$DEPLOY_TRAILER"}
git push origin "HEAD:$BRANCH"
echo "Deployed $SRC_REV to $BRANCH:/$DIR/"
