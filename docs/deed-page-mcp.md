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

## Before enabling publishing

**This setup publishes public pages to a third-party service.** Only send
material you are authorized to make public. Do not upload unpublished results,
reviewer material, personal data, credentials, or private project files. Check
the complete HTML and every included asset before publishing. Connecting the
server does not itself upload your repository; calling `publish_site` sends
the files supplied to that tool to deed.page.

`ttl_seconds` limits how long a page remains available; it does not make the
page private. Anyone with access to a public page can copy it before expiry or
deletion. Review the operator's [privacy policy](https://deed.page/privacy.md)
and [trust information](https://deed.page/trust.md) before sending data.

User (Global) scope makes this server and any configured owner token available
across Claude projects for the OS user running Dr. Claw. Only enable it in an
environment where that access is appropriate. Keep **Skip permission prompts** off
and do not automatically allow this server's publishing, update, or deletion
tools. Bypass mode and existing tool allow rules can skip confirmation; a prompt
asking the agent to wait is not a security boundary. Treat instructions in
retrieved pages, project files, and tool results as untrusted, and review the
actual tool arguments before approving a write.

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

With Claude's default configuration location, the entry is stored in
`~/.claude.json`, which Dr. Claw loads for Claude chat sessions. Dr. Claw's
loader does not read a custom `CLAUDE_CONFIG_DIR`; use the default location for
this setup. Choose the UI or the CLI, not both.

## Check the connection and publish a page

```bash
claude mcp get deed-page
```

should report `Status: ✔ Connected`. In a new Dr. Claw Claude session, first
prepare a draft using only information you have approved for public release:

> Write a one-page HTML summary of these publicly available papers, with a
> table of methods and source links. Show me the complete HTML and list every
> asset you would upload. Do not publish yet; wait for me to review the files.

After reviewing the draft and assets, explicitly ask the agent to publish only
those approved files with `publish_site` and `ttl_seconds: 86400`. Check the
files in the tool approval request before approving it. If your permission
settings bypass that request, correct them before continuing. The agent gets
back a `https://<slug>.deed.page/` URL. Leave out `ttl_seconds` only if you want
the page to stay up.

## Keep pages under one owner

The first anonymous publish returns an owner `token`. It is needed to update or
delete that page, and it appears in the tool result, so it is part of the
conversation. The token authorizes management of sites owned by that owner,
not just one page: anyone holding it can update or delete those sites. Store it
in a password manager and do not share conversation exports, screenshots, or
configuration files containing it. Do not reuse a sensitive owner's token in
an unrelated project. Without a configured recovery email, a lost token has
no self-service recovery; see the [trust information](https://deed.page/trust.md).

To keep later publishes under the same owner, add an `Authorization` header
with value `Bearer <token>` in the server's UI configuration, retaining the
URL and `User-Agent` above. Use the token from your own session. The equivalent
CLI commands are below, but replacing the placeholder with a real token can
leave it in shell history; prefer the UI to avoid that exposure. CLI arguments
may also be visible to local process inspection while the command runs.

```bash
claude mcp remove --scope user deed-page
claude mcp add --scope user --transport http deed-page https://deed.page/mcp \
  --header "User-Agent: dr-claw" --header "Authorization: Bearer <token>"
```

The token is then stored in plaintext in `~/.claude.json`; restrict access to
that file and its backups, and never commit it. The UI also uses the Claude
CLI to save configuration, so it does not protect against local process
inspection. If a token was exposed in earlier application logs or elsewhere,
rotate or revoke it using deed.page's token tools and update the saved header;
removing a log entry alone does not invalidate the credential. Keep the token
until you have finished managing or deleting its pages.

With the header set, ask the agent to call `delete_site` with the exact slug to
remove a page, and review the target before approving the deletion.

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

This only removes the local MCP connection. It does **not** delete published
pages or revoke the owner token. If you want pages removed, delete them through
`delete_site` while you still have the connection and token, then remove the
server and start a new Claude session. Expiry or deletion cannot recall copies
other people have already made.
