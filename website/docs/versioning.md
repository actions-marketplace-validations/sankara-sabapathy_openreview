# Versioning

- Action SemVer: `v0.4.0` + mutable `v0`/`v1` tags (moved on release by `release.yml`). Pin `@v1` for latest, `@v0.4.0` to freeze.
- Config `version: 1` (schema version, required; additive-only in v1.x). Breaking changes bump to `version: 2` with migration guide.
- Optional `requires_action: ">=0.3.0"` sets a floor for the running action release and fails fast with a clear message. The workflow `uses:` ref selects the release — the yaml cannot pin it, only guard it.
- Docs versioned per major via Docusaurus.
- Releases: Conventional Commits → release-please → GitHub Release → tag move.
