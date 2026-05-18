# ADR-006: Signed CLI Release Binaries

**Status**: Accepted
**Date**: 2026-02-01

### Context
Distributing a CLI tool that executes shell commands on user machines requires establishing trust in the binary's authenticity.

### Decision
Release all CLI binaries with:
1. **SHA-256 checksum** published with each release
2. **Digital signature** using the release signing key
3. **Reproducible build** instructions in the repository
4. Checksum and signature verified by `npm postinstall` script

### Rationale
- SHA-256 checksums prevent supply chain attacks by allowing users to verify binary integrity
- Digital signatures establish provenance and prevent tampering
- Reproducible builds allow independent verification
- npm postinstall verification catches corrupted or tampered packages
