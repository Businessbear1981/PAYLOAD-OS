# Payload — Context

## Glossary

### Payload
The **platform**. A "Windows for AI workspace" — a shell that hosts AI-driven applications. Provides the sidebar + center workspace + tab system + plugin registry + agent orchestrator pattern. **Domain-agnostic and ships as a library** (npm package per Q1 — `@payload/shell` for React + `@payload/native` for React Native) — each Consuming Application installs it, registers tabs, deploys its own infrastructure. The platform was originally conceived for the NEST intelligence/OSINT use case but is generalized as the substrate for any consuming app — Sean's words: "can be used for anything." Repo: `Businessbear1981/PAYLOAD-OS`. Resolved 2026-06-03.

### The Shell
The UI surface Payload exposes: sidebar, center workspace mount point, tool launcher, theming context, auth context, orchestrator hook. This is what a consuming application renders.

### Consuming Application
An application that runs on Payload. Each Consuming Application owns its own data (own Supabase project), own deployment (own Vercel / Railway / domain), own auth/users, own branding. It uses Payload only as the shell library. Examples:
- **Finesse** — first Consuming Application. Lifestyle/hospitality domain. Tabs: Wardrobe, Vault, Concierge, Date Planner.
- **NEST** — planned second Consuming Application. Intelligence/OSINT domain. Tabs: EagleEye, Roots, Bond Desk, Bernard.

### Tab
The unit of mountable functionality. A Consuming Application registers tabs into Payload's sidebar. Each tab declares an id, label, icon, render function, and required permissions. When a user clicks a tab, its render function mounts into Payload's Workspace.

### Workspace
The center mount point inside Payload's shell. Holds at most one active Tab's content at a time. Equivalent to a window in a traditional OS.

### Orchestrator (CNS)
The agent orchestrator pattern (Bernard / Concierge style) that routes user intent to tools. Pattern lives in the Shell; each Consuming Application provides its own concrete orchestrator instance and tool registry. Finesse's orchestrator is the Concierge; NEST's is Bernard.

### Dual Control
The decoupling property between Payload (the shell library) and a Consuming Application. The two are independent control planes:
- **Payload's plane:** the shell, the plugin contract, the orchestrator hook shape, the integrations vault page, the audit page, the truth layer, the shared lib clients (Supabase / R2 / AI Gateway / media). Sean can change/monitor/extend any of this without touching the Consuming Application's domain code or its public APIs.
- **Consuming Application's plane:** its own domain APIs, business logic, data schema beyond the shared engines, branded UI in each Tab's render function, vendor-specific webhook handlers (CCBill for Finesse, etc.).
The two planes communicate only through the documented plugin contract (tab registration, orchestrator hooks, integration reads). A shell version bump never silently breaks Finesse's `/api/*` routes; a Finesse API change never silently breaks the shell. Resolved 2026-06-03.

### OSINT Engine
A Payload-level capability — open-source intelligence aggregation (web search, public records, social signals, news, public filings, image/visual sig matching). Primary consumer is **NEST / EagleEye**: the OSINT structure powers EagleEye's M&A + CRE deal sourcing (Apollo / ATTOM / Trepp / NewsAPI / Instantly / Mapbox per `[[project_eagleeye_vendors]]`). Other Consuming Applications may or may not use OSINT — Finesse does not in v1 (Sean: "we might not even use osint, seems to me we can use osint structure to modify EagleEye"). The Engine is available in the shell; applications opt in by importing the relevant tab/hook. Resolved 2026-06-03.

## Not in scope of this glossary
Per-application domain content (the actual Wardrobe SKUs for Finesse, the actual EagleEye data sources for NEST) belongs in each Consuming Application's own context, not here. Bundled reference docs: `C:\Users\sgill\Desktop\payload-bundle.zip`. Implementation decisions go in `docs/adr/`, not here.
