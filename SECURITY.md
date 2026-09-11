# Security Policy

## Reporting a vulnerability

Please do **not** open a public GitHub issue for security problems.

Use GitHub's private vulnerability reporting for this repository:
<https://github.com/OpenLAIR/dr-claw/security/advisories/new>

Include the affected commit or version, the deployment mode (OSS or Platform),
the configuration needed to reproduce, and a proof of concept if you have one.
We aim to acknowledge reports within 7 days.

## Supported versions

Only the latest release on `main` receives security fixes.

## Deployment notes

Dr. Claw is designed for a single trusted operator on a local machine. Before
exposing it beyond `localhost`, read the
[Security Checklist](docs/configuration.md#security-checklist). In short:

- The JWT signing secret is generated per installation on first start (or set
  `JWT_SECRET` / `JWT_SECRET_FILE` yourself). Keep the `jwt-secret` file next to
  the database private and back it up with the database.
- Set `API_KEY` for an extra request-level gate.
- Bind to `127.0.0.1` (`HOST=127.0.0.1`) unless you deliberately want network
  access, and put the server behind a TLS-terminating reverse proxy when you do.
