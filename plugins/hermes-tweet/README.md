# hermes-tweet

Claude Code guidance for installing and operating
[Hermes Tweet](https://github.com/Xquik-dev/hermes-tweet), the native
Hermes Agent X/Twitter plugin for Xquik automation.

## Skill

| Skill          | Purpose                                                              |
| -------------- | -------------------------------------------------------------------- |
| `hermes-tweet` | Install Hermes Tweet, configure its key, and route read-first usage. |

## Runtime Package

Install the runtime plugin from the source package or PyPI:

```bash
hermes plugins install Xquik-dev/hermes-tweet --enable
uv pip install --python ~/.hermes/hermes-agent/venv/bin/python hermes-tweet
```

Set `XQUIK_API_KEY` in the Hermes runtime environment before calling
`tweet_read`. Keep `HERMES_TWEET_ENABLE_ACTIONS=false` unless the current
session needs explicit account-changing actions.
