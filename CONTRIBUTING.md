# Contributing

## Branch strategy

- `main` is always deployable — protected, no direct pushes.
- Branch per unit of work: `feature/step-4-mastery-engine`, `fix/upload-mime-check`, `docs/update-api-table`.
- Open a PR into `main`, get at least one approval, squash-merge.

## Commit conventions

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(quiz): add spaced-repetition scheduling
fix(auth): correct JWT expiry check
docs(roadmap): mark step 3 complete
chore(deps): bump prisma to 6.2
```

Common types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`.

## Before opening a PR

- [ ] Backend: `npx tsc --noEmit` passes
- [ ] Frontend: `npm run build` passes
- [ ] You used the mock AI provider unless deliberately testing real API behavior
- [ ] Relevant docs updated (see `docs/README.md` for which folder owns what)

## Where things live

- Product decisions → `docs/product/`
- Build order / what's next → `docs/roadmap/build-plan.md`
- "Why did we choose X" → `docs/decisions/`
- API behavior → `backend/README.md`

If you're not sure where something belongs, ask before scattering it across three places.
