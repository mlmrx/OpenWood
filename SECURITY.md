# Security policy

## Reporting

Please report vulnerabilities privately to the project maintainers rather than opening a public exploit report. Include the affected commit, reproduction steps, impact, and any suggested mitigation. Do not include provider credentials, uploaded assets, or personal data.

## Deployment requirements

- Keep every provider key in the server environment. Never expose it through client-side configuration.
- OpenWood issues a high-entropy HttpOnly anonymous-workspace cookie and stores only its SHA-256 digest. Private projects are isolated without a login page; the public demo is read-only and only released screenings are public.
- Mutations require a same-origin custom header. Model runs have rolling per-workspace and deployment-wide budgets. Add Cloudflare rate limiting or a gateway IP policy for high-traffic deployments.
- Restrict model-provider egress to approved origins; use a gateway for organization deployments.
- OpenWood validates declared MIME type and byte signatures for every upload. ISO-BMFF candidates are structurally inspected for `moov`/`mdat`, duration, picture and sound tracks, and dimensions before they can qualify as a master. The 32 MB buffered intake stays below the standard Worker isolate ceiling but is a storage boundary, not a malware scanner; production render workers should additionally decode media and scan it before processing. Larger deployments should use direct-to-R2 multipart ingest rather than raising this buffered limit.
- Treat uploaded files, URLs, and extracted text as untrusted data, never instructions.
- Require positive voice/likeness consent and preserve it in release provenance.
- Security headers include CSP, frame denial, nosniff, strict referrer policy, and restricted browser permissions. Remote URL ingestion and generated HTML are deliberately unsupported.
- Treat the anonymous cookie as a bearer credential. Add organization authentication and audited membership before storing confidential or regulated productions.
- Uploaded active formats such as HTML and SVG are rejected. Documents are forced to attachment; playable media is served with `nosniff`, sandbox CSP, same-origin policy, and byte-range validation.

## Supported versions

Security fixes target the latest commit on the default branch.
