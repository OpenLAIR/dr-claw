# Publishing research pages with deed.page MCP

Use [deed.page](https://deed.page/docs) to turn a literature summary, results
table or small HTML report from a Claude Code session in Dr. Claw into a public
link you can share with collaborators. The hosted MCP server needs no account or
API key. This guide comes from the deed.page team (Avatar 8 LLC); the same
server is also packaged as an MIT agent skill at
[f-o-x11/deed-page-skill](https://github.com/f-o-x11/deed-page-skill).

This guide uses Dr. Claw's existing Claude MCP settings, the same way as the
[Parallel Search MCP setup](parallel-search-mcp.md). Have Claude Code installed
and authenticated on the machine running the Dr. Claw server, as in the
[Quick Start](../README.md#quick-start). These steps configure Claude sessions.

## Add the server

1. Open **Settings → Agents → Claude → MCP Servers**.
2. Click **Add MCP Server**, choose **User (Global)** scope, and enter
   `deed-page` as the server name.
3. Select **JSON Import** and paste this single-server configuration:

   ```json
   {
     "type": "http",
     "url": "https://deed.page/mcp",
     "headers": {
       "User-Agent": "dr-claw"
     }
   }
   ```

4. Click **Add Server**, then start a new Claude chat session in your project.

Or run this on the server machine as the same OS user that runs Dr. Claw:

```bash
claude mcp add --scope user --transport http deed-page https://deed.page/mcp --header "User-Agent: dr-claw"
```

Either way the entry is stored in `~/.claude.json`, which Dr. Claw loads for
Claude chat sessions. Choose the UI or the CLI, not both.

## Check the connection and publish a page

```bash
claude mcp get deed-page
```

should report `Status: ✔ Connected`. In a new Dr. Claw Claude session, try:

> Write a one-page HTML summary of the papers we discussed, with a table of
> methods and source links. Publish it with deed-page's publish_site using
> ttl_seconds 86400, and give me the URL.

Approve `publish_site` when prompted under your existing permission mode. The
agent gets back a `https://<slug>.deed.page/` URL. Leave out `ttl_seconds` only
if you want the page to stay up.

## Keep pages under one owner

The first anonymous publish returns an owner `token`. It is needed to update or
delete that page, and it appears in the tool result, so it is part of the
conversation. To keep later publishes under the same owner, re-add the server
with the token as a header (use the token from your own session):

```bash
claude mcp remove --scope user deed-page
claude mcp add --scope user --transport http deed-page https://deed.page/mcp \
  --header "User-Agent: dr-claw" --header "Authorization: Bearer <token>"
```

The token is then stored in `~/.claude.json`; treat that file as a credential.
With the header set, ask the agent to call `delete_site` with a slug to remove a
page.

Published pages are public. Do not publish unpublished results, reviewer
material or personal data you would not post openly. Anonymous pages show a
small deed.page badge; see the [docs](https://deed.page/docs) for limits.

If the tools are missing, confirm that the chat provider is Claude, that setup
ran under the same OS user as the server, and that the entry uses HTTP transport
and the exact URL above, then start a new session.

## Remove the server

Delete `deed-page` in **Settings → Agents → Claude → MCP Servers**, or run:

```bash
claude mcp remove --scope user deed-page
```
