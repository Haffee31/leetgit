# Contributing to LeetGit

Thanks for your interest! Here's how to get started.

## Workflow

1. Fork the repo and create a branch from `main`
   ```
   git checkout -b feat/your-feature
   ```
2. Make your changes with focused, single-purpose commits
3. Run the test suite — all tests must pass
   ```
   npm test
   ```
4. Push your branch and open a Pull Request against `main`

## Commit style

Use conventional commit prefixes:
- `feat:` — new feature
- `fix:` — bug fix
- `docs:` — documentation only
- `chore:` — tooling, deps, version bumps
- `refactor:` — code change with no behaviour change

## PR checklist

- [ ] Tested manually by loading the unpacked extension in Chrome
- [ ] `npm test` passes
- [ ] PR description explains what changed and why