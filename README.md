# claude-mods

Claude Code mods I made for my own setup.

## session-cards

Session stats as small cards in the band above the prompt. I made it to replace ccstatusline with a native mod.

```
▁▁▁▁▁▁▁▁▁▁▁▁▁▁ ▁▁▁▁▁▁▁▁▁▁▁▁▁▁ ▁▁▁▁▁▁▁▁▁▁▁▁▁▁ ▁▁▁▁▁▁▁▁▁▁▁▁▁▁ ▁▁▁▁▁▁▁▁▁▁▁▁▁▁ ▁▁▁▁▁▁▁▁▁▁▁▁▁▁ ▁▁▁▁▁▁▁▁▁▁▁▁▁▁

 GIT            MODEL          EFFORT         CONTEXT        5H LIMIT       WEEKLY LIMIT   COST
 main           Opus 5.5       xhigh          382k/1M, 38%   2% · 4h 1m     45% · 2d 14h   $13.22

```

- GIT shows the current branch
- MODEL is the session model
- EFFORT is the effort level from your settings, the model setting first and then the global one
- CONTEXT is how full the context window is, the top line works as a progress bar
- 5H LIMIT is how much of the 5 hour window you used and when it resets, with a bar too
- WEEKLY LIMIT is the same for the weekly window
- COST is the session cost in dollars, same number as `/cost`. On Max it's just for reference

Everything refreshes every 5 seconds and after each turn. When the terminal is narrow the cards wrap to the next line and keep their width.

### Install

Type this at the prompt of a Claude Code terminal session:

```
/plugin install session-cards --marketplace alan-oliv/claude-mods
```

Answer `y` to add the marketplace and pick a scope. It starts working right away.

### Notes

Mods are early access in Claude Code and I built this one on 2.1.296, so a new release can break it. If something looks off, open an issue and I'll take a look.

Context and limits stay empty until the session gets its first reply from the API, there is nothing to read before that.
