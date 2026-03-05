# Dashboard PRD

## Background
We need a single place (web dashboard) where Erik/Anton can see every project and talk to Atlas/AGIS/subagents directly. Clients should have their own lightweight portal showing their Lovable sites and a way to request changes.

We already have a prototype generator (`dashboard/`) that turns `projects.yaml` + `clients.yaml` into `dist/index.html` (internal view) and `dist/clients/<slug>.html` (client view). Next we need to make it useful: richer layout, configurable forms, status panes, and a publish workflow (here.now).

## Goals
1. **Internal Control Room**
   - Grid of project cards (existing) + sidebar that shows:
     - "Message Atlas/AGIS" buttons (link stubs configurable per env).
     - Table/list of open change requests (pulled from data for now; later from Notion).
     - Subagent activity summary (placeholder list for now).
2. **Client Portals**
   - One page per client with their cards, preview/live links, and a prominent "Request change" CTA (link configurable per client).
   - Optional summary paragraph/contact info per client.
3. **Config-driven data**
   - Split data into `clients.yaml`, `projects.yaml`, and `requests.yaml` so we can extend easily.
   - Support card-level metadata (stage, status, last update).
4. **Publish and deploy**
   - `npm run build` (already) + new `npm run publish` command that pushes `dist/` to here.now using an API key read from `process.env.HERENOW_API_KEY`.
   - Accept `--slug` override (default `atlas-dashboard`).
5. **Styling polish**
   - Keep dark/neon theme but add layout for sidebar panels, badges, button styles.

## Non-goals (for this iteration)
- Live data from Notion/Airtable (we’ll integrate once we have API credentials).
- Authenticated portals.

## Deliverables
1. **Data layer**
   - `data/requests.yaml` with sample entries.
   - `data/settings.yaml` for global form/message URLs (e.g., `messageAtlasUrl`, `messageAgisUrl`).
   - Update generator to load and pass these into templates.

2. **Templates**
   - Internal page shows:
     - Project grid.
     - Right/sidebar with two panels: “Open requests” (loop over requests data) and “Command center” (buttons linking to message forms + quick stats).
   - Client page shows CTA button (per client) plus optional placeholder for embedded form.

3. **Scripts**
   - `publish.mjs`: zips or streams `dist/` and hits `https://here.now/api/v1/publish` with Bearer token.
   - `npm run publish` -> builds then publishes (slug read from CLI or defaults to `atlas-dashboard`).

4. **Docs**
   - Update `README.md` with usage (`npm run build`, `npm run publish`, how to edit YAML, env vars required).

## Open questions
- Need actual form URLs (Tally/Typeform) + data store credentials later. For now, use placeholders from YAML.
