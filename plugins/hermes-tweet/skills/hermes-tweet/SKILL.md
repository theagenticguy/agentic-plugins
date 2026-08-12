---
name: hermes-tweet
description: >
  Install and operate Hermes Tweet, the native Hermes Agent X/Twitter plugin
  for Xquik automation. Use when the user needs Hermes Agent Twitter tooling,
  Hermes X automation, social media agent workflows, X/Twitter reads, launch
  monitoring, brand research, support triage, or approval-gated tweet actions
  through Hermes.
arguments:
  - name: task
    description: Optional Hermes Tweet setup or workflow goal.
    required: false
user_facing: true
metadata:
  libraries:
    - name: Hermes Tweet
      package: hermes-tweet
      ecosystem: pypi
      skill_version: 0.1.x
      verified: "2026-06-13"
---

# Hermes Tweet

Use Hermes Tweet when a Hermes Agent workflow needs current X/Twitter signal or
explicitly approved account actions through Xquik.

## Install

Prefer the source-native Hermes plugin install:

```bash
hermes plugins install Xquik-dev/hermes-tweet --enable
```

Then install the Python runtime package into the Hermes virtual environment:

```bash
uv pip install --python ~/.hermes/hermes-agent/venv/bin/python hermes-tweet
hermes plugins enable hermes-tweet
```

For a local checkout, use:

```bash
hermes plugins install file:///absolute/path/to/hermes-tweet --force --enable
```

## Configure

Set the API key in the Hermes runtime environment or `~/.hermes/.env`:

```bash
export XQUIK_API_KEY="set-your-key"
export HERMES_TWEET_ENABLE_ACTIONS="false"
```

If Hermes is already running after an environment change, reload the interactive
CLI session or restart gateway and cron sessions.

## Tool Routing

Start every workflow with `tweet_explore`. It searches the bundled endpoint
catalog and does not make network calls.

Use `tweet_read` for catalog-listed read-only endpoints after
`XQUIK_API_KEY` is configured.

Use `tweet_action` only when the session intentionally enables:

```bash
export HERMES_TWEET_ENABLE_ACTIONS="true"
```

Keep actions explicit and approval-gated. Do not pass credentials in tool
arguments. Hermes Tweet reads authentication from the runtime environment.

## Workflows

| Goal                    | Route                                                                 |
| ----------------------- | --------------------------------------------------------------------- |
| Social listening        | Explore search, trend, monitor, and account routes, then read.        |
| Launch monitoring       | Keep actions disabled and schedule read-only trend or mention checks. |
| Support triage          | Read public mentions and timelines before drafting responses.         |
| Creator research        | Combine profile, follower, media, search, and trend reads.            |
| Giveaway audits         | Read tweet, reply, follower, list, draw, and export evidence first.   |
| Controlled publishing   | Enable actions only in attended sessions that need account changes.   |
| Remote gateway profiles | Install and configure Hermes Tweet on the gateway host.               |

## References

- Runtime package: [github.com/Xquik-dev/hermes-tweet](https://github.com/Xquik-dev/hermes-tweet)
- PyPI package: [pypi.org/project/hermes-tweet](https://pypi.org/project/hermes-tweet/)
- Xquik API overview: [docs.xquik.com/api-reference/overview](https://docs.xquik.com/api-reference/overview)
