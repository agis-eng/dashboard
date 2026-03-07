# Atlas Dashboard

Static generator that turns YAML data into an internal control room plus client-specific portals. Outputs live at `dist/` and can be deployed to here.now.

## Prerequisites
- Node.js 20+
- `zip` CLI (macOS default) for packaging during publish
- `HERENOW_API_KEY` environment variable for deployment

## Commands
| Command | Description |
| --- | --- |
| `npm install` | Install dependencies |
| `npm run build` | Regenerate `dist/` from YAML + templates |
| `npm run publish` | Builds, zips `dist/`, and uploads to here.now |

### Publish flags
- `--slug my-slug` overrides the default `atlas-dashboard` slug:
  ```bash
  npm run publish -- --slug atlas-dashboard-dev
  ```

## Data sources
All content lives under `data/`:

- `clients.yaml` – Contact info, portal slugs, change-request URLs, optional summary copy.
- `projects.yaml` – Internal + client project metadata (stage, status, owner, URLs).
- `requests.yaml` – Open change requests shown in the internal sidebar.
- `partners.yaml` – Partner ecosystem entries that power `partners/index.html` and one detail page per partner.
- `settings.yaml` – Global message URLs, subagent activity placeholders, and copy for sidebar buttons.

Adjust these files then run `npm run build`. The generator writes:
- `dist/index.html` – Internal control room (project grid + sidebar panels + project search).
- `dist/partners/index.html` – Partner network directory.
- `dist/partners/<slug>.html` – Partner-specific profile + linked projects.
- `dist/clients/<slug>.html` – One portal per client with CTA + project cards.

## Environment variables
- `HERENOW_API_KEY` – Required for `npm run publish`. Used as a Bearer token when calling `https://here.now/api/v1/publish`.

## Deploy flow
1. Edit YAML / templates.
2. Run `npm run build` to preview locally (open `dist/index.html`).
3. When ready, run `HERENOW_API_KEY=... npm run publish -- --slug <your-slug>`.
4. here.now responds with the deployed URL/slug.
