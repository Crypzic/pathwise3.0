#!/usr/bin/env bash
# One-time migration script — run this INSTEAD of overwriting, if you want to
# preserve git history on these files rather than replacing them wholesale.
# Run from repo root, on a clean working tree.

set -e

mkdir -p docs/product docs/architecture docs/database docs/api docs/roadmap docs/decisions

git mv docs/pathwise-master-blueprint.md docs/product/master-blueprint.md
git mv docs/pathwise-ops-checklist.md docs/product/ops-checklist.md
git mv docs/pathwise-build-plan.md docs/roadmap/build-plan.md

echo "Docs relocated with history preserved. Now copy in the new README.md files"
echo "and other scaffolding (.github/, CONTRIBUTING.md, etc.) from the provided zip,"
echo "then commit."
