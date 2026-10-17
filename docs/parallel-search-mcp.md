# Web research with Parallel Search MCP

Use [Parallel Search MCP](https://docs.parallel.ai/integrations/mcp/search-mcp)
to search the web and fetch pages from Claude Code sessions in Dr. Claw. The
anonymous endpoint needs no account or API key, and search uses Fast mode. Free
access is intended for exploration and light use; higher limits require a
Parallel account.

This guide uses Dr. Claw's existing Claude MCP settings. Have Claude Code
installed and authenticated on the machine running the Dr. Claw server, as in
the [Quick Start](../README.md#quick-start). MCP configuration is specific to
each backend; these steps configure Claude sessions.

## Add the server

1. Open **Settings → MCP Servers** and select the **Claude** provider.
2. Click **Add MCP Server**, choose **User (Global)** scope, and enter
   `parallel-search` as the server name. This makes it available across projects
   for the OS user running Dr. Claw.
3. Select **JSON Import** and paste this single-server configuration:

   ```json
   {
     "type": "http",
     "url": "https://search.parallel.ai/mcp",
     "headers": {
       "User-Agent": "dr-claw"
     }
   }
   ```

4. Click **Add Server**, then start a new Claude chat session in your project.

Use HTTP (Streamable HTTP) for this endpoint. No authorization header is needed.
The JSON Import field takes the server object above, without an `mcpServers`
wrapper. Keep any existing server entries and permission settings.

Alternatively, run this on the server machine as the same OS user that runs
Dr. Claw, using the Claude CLI configured for Dr. Claw:

```bash
claude mcp add --scope user --transport http parallel-search https://search.parallel.ai/mcp --header "User-Agent: dr-claw"
```

User scope stores the entry in `~/.claude.json`, which Dr. Claw loads for Claude
chat sessions. Use Claude's default configuration location for this setup;
Dr. Claw's loader does not read a custom `CLAUDE_CONFIG_DIR`. Choose either the
UI or CLI setup; running both with the same name is unnecessary.

## Check the connection and research a topic

On the server machine, inspect the saved entry and its connection status:

```bash
claude mcp get parallel-search
claude mcp list
```

In a new Dr. Claw Claude session, try:

> Use parallel-search's web_search to find recent work on retrieval-augmented
> generation evaluation, prioritizing original papers and official project
> pages. Use web_fetch to read the two most relevant pages. Summarize their
> evaluation methods, include source URLs and publication dates where available,
> and distinguish source claims from your interpretation.

`web_search` finds sources; `web_fetch` reads URLs. Approve the relevant MCP tools
when prompted under your existing permission mode. Check the cited sources
before using the results in a literature review.

If tools are missing, confirm that the chat provider is Claude, that setup ran
under the same OS user as the server, and that the entry uses the exact URL
above with HTTP transport. Check that the server machine can reach the endpoint
over HTTPS, then start a new session. If the service reports a rate limit,
follow its retry guidance or configure authenticated access as described in the
[Parallel setup guide](https://docs.parallel.ai/integrations/mcp/search-mcp).

## Remove the server

Delete `parallel-search` in **Settings → MCP Servers → Claude**, or run:

```bash
claude mcp remove --scope user parallel-search
```

Start a new Claude session after removal. Other MCP servers remain configured.
