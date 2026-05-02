# Data Licenses

## Sources

### data.stortinget.no — Stortinget preparatory works (Proposisjoner, Innstillinger)

- **License:** NLOD 2.0 — Norwegian Licence for Open Government Data
- **License URL:** https://data.norge.no/nlod/en/2.0/
- **Terms URL:** https://data.stortinget.no/om-datatjenesten/bruksvilkar/
- **Basis:** data.stortinget.no bruksvilkår references NLOD; Stortinget is a public body publishing open government data under NLOD 2.0.
- **Attribution required:** "Stortinget skal oppgis som kilde" — Stortinget must be cited as source
- **Commercial use:** permitted under NLOD 2.0
- **AI training/development:** permitted under NLOD 2.0
- **Rate limit:** 100 API calls/min (HTTP 429 above this); ingestion paces at ≤90/min for retry headroom

## Code License

The MCP server software (TypeScript code, Dockerfile, ingestion scripts) is licensed under Apache-2.0. See [LICENSE](LICENSE).

The Apache-2.0 code license does not apply to the data — the data carries its own license per the source above. Distinct licenses for code and data is the standard pattern for MCPs that build the database from an upstream API at deploy time.
