# Use GBP Sphere from Claude, ChatGPT or any AI assistant (MCP)

GBP Sphere ships a small local server that speaks the [Model Context Protocol](https://modelcontextprotocol.io). Connect it once and your assistant can look up, audit and compare Google Business Profiles by itself: ask "audit Tacombi Flatiron in New York and build the Excel audit", and it collects the data, scores the profile, finds the local competitors and saves the workbook.

- Runs on your computer. No account, no API key, no paid service, nothing to deploy.
- Uses the same code as the extension (place parser, 16-check audit, competitor benchmark, Excel writer), so the numbers match the report page.
- Reads the same public Google Maps data the extension reads, without cookies or your Google account. It only contacts google.com (and raw.githubusercontent.com once a month for the category list).
- Needs [Node.js](https://nodejs.org) 18 or newer. No `npm install`: the server has no dependencies.

## Tools

| Tool | What the assistant gets |
| --- | --- |
| `gbp_search` | Google Maps results for a search ("dentist in Austin TX"), optionally ranked from a place or a lat/lng |
| `gbp_profile` | The full public profile: categories, rating, reviews, address parts, phone, website, hours, holiday-hours warnings, attributes, photo count, latest posts, claimed status, booking links, every ID |
| `gbp_audit` | Score out of 100, grade, every check with the reason, a prioritised fix list, and a benchmark against the top Maps results from the business address (position, review and rating gaps, categories competitors use) |
| `gbp_competitors` | Who ranks on Google Maps for a keyword (default: the primary category) from the business address, and where the business sits |
| `gbp_maps_rank` | Google Maps position (top 20) for up to 15 keywords, searched from the business address |
| `gbp_categories` | Category research: real-category check, related categories, categories nearby competitors use, Google's predefined services, keyword ideas |
| `gbp_audit_excel` | The agency workbook (.xlsx): Initial GBP Audit, GBP and Competitor Audit, Service List, saved to `Downloads/GBP-Sphere/` |
| `gbp_research_links` | Ready-made Maps, directory and free audit-tool links for the business |
| `gbp_decode_id` | CID, feature ID, Place ID and Maps links from any Google Maps link (offline) |

Every tool takes the business as a Google Maps link (address bar or a `maps.app.goo.gl` share link), a link with `cid=`, a CID, a feature ID, or plain words such as "Peter Luger Steak House Brooklyn".

## Connect it

The commands below fetch the server straight from GitHub with `npx`, so there is nothing to download first. If you cloned the repository, you can use `node /path/to/GBP-Sphere/mcp/server.js` instead of the `npx` part.

### Claude Code

```sh
claude mcp add gbp-sphere -- npx -y -p github:sakibsphere/GBP-Sphere gbp-sphere-mcp
```

Add `--scope user` to have it in every project.

### Claude Desktop

Settings > Developer > Edit Config, then add this to `claude_desktop_config.json` and restart Claude:

```json
{
  "mcpServers": {
    "gbp-sphere": {
      "command": "npx",
      "args": ["-y", "-p", "github:sakibsphere/GBP-Sphere", "gbp-sphere-mcp"]
    }
  }
}
```

### ChatGPT (Codex CLI and the Codex IDE extension)

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.gbp-sphere]
command = "npx"
args = ["-y", "-p", "github:sakibsphere/GBP-Sphere", "gbp-sphere-mcp"]
```

The ChatGPT website and desktop app only connect to MCP servers on the internet, not to programs on your computer. To use it there, run the HTTP mode below and publish it through a tunnel you control (for example Cloudflare Tunnel or ngrok), then add the public `/mcp` address as a connector in ChatGPT's developer mode. Anyone with that address can use your server while the tunnel is open, so close it when you are done.

### Cursor, Windsurf, VS Code (Copilot), Gemini CLI, LM Studio and others

They all accept the same command. In the client's MCP settings (`mcp.json`, `settings.json` or similar), add a server named `gbp-sphere` with command `npx` and arguments `-y -p github:sakibsphere/GBP-Sphere gbp-sphere-mcp`. VS Code uses `"servers"` instead of `"mcpServers"` and needs `"type": "stdio"`.

## Local HTTP API (for scripts, n8n, Make, custom GPT builders)

```sh
npx -y -p github:sakibsphere/GBP-Sphere gbp-sphere-mcp --http 8765
```

- `http://127.0.0.1:8765/` lists the tools and their parameters.
- `GET /api/<tool>?param=value` or `POST /api/<tool>` with a JSON body runs a tool and returns JSON, for example `http://127.0.0.1:8765/api/gbp_audit?place=Peter%20Luger%20Steak%20House%20Brooklyn`.
- `POST /mcp` is the same MCP server over HTTP (JSON responses), for clients that connect by URL.
- `/openapi.json` describes the API for tools that import OpenAPI.

It listens on 127.0.0.1 only and refuses requests that come from web pages, so a site you visit cannot use it.

## Good to know

- Requests to Google are spaced out (one at a time, a short pause between them) and cached for an hour, so a long task never floods Google. If Google answers "429", wait a minute.
- Rankings depend on where the searcher stands. Competitor and rank tools search from the business's own address, the way the extension's report page does.
- Google no longer shows owner descriptions publicly, so that check is "unknown" and does not cost points.
- Website checks (LocalBusiness markup, lead form) and the review, photo and post exports need a real browser page, so they stay in the extension.
- Excel files are saved to `Downloads/GBP-Sphere/` unless the assistant passes another folder.
