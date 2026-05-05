# Lark Loom — Claude Code Instructions

## PR Auto-Review

When a `pull_request.opened` or `pull_request.synchronize` GitHub webhook arrives:

1. Read the PR diff via `mcp__github__pull_request_read` (method: `get_diff`).
2. Check for: security vulnerabilities, logic bugs, and obvious optimization opportunities.
3. Comment on the PR via `mcp__github__add_issue_comment`:
   - If a **serious issue** is found → describe the single most severe problem concisely.
   - If no serious issues → post exactly: `LGTM`
