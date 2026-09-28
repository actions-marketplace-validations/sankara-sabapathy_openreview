# Versioning

- Action SemVer: `v1.2.3` + mutable `v1` (moved on release by `release.yml`).
- Config `version: 1`: additive-only. Breaking changes bump to `version: 2` with migration guide; v1 supported 6 months.
- Docs versioned per major via Docusaurus.
- Releases: Conventional Commits → release-please → GitHub Release → tag move.
