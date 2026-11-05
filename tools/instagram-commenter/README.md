# The commenter

The one step in the Instagram pipeline that cannot be a server job. No
Instagram API lets you comment on someone else's post, so this drives real
Chrome against a profile that is signed in once and then stays signed in —
the same way your everyday Chrome does.

It lives outside grimoire's `package.json` on purpose: grimoire deploys to
Railway, and nothing here should ship to a machine with no browser.

## Two commands, in this order

```bash
cd tools/instagram-commenter && npm install
node comment-gates.js --login      # a window opens; sign in; close it
./install-schedule.sh              # three batches a day, from then on
```

After that it runs by itself. `runs.log` is the record.

The schedule is already loaded. Until the login happens it does nothing at
all — no window, no browser — because a run checks for a confirmed session
first. The login arms it; nothing else does.

## What a run does

Takes up to 8 pending gates, newest first. For each: opens the `/p/<code>/`
permalink, finds the comment box, types the keyword at human speed, posts,
then waits a random 90–420 seconds. The reel is marked commented **before**
the comment is posted, because these bots answer within about thirty seconds
and a DM that lands before the row is written attaches to the wrong reel.

Eight a run, three runs a day, is about a week for a backlog of 142. Raise it
with `--count` if you want, and read the next section before you do.

## What it refuses to do

Instagram action-blocks an account that comments too fast, and an action block
costs days, not a retry. So the run stops dead — it does not skip and carry on
— the moment it sees any of:

- an action block, a "try again later", or a restriction notice
- a checkpoint or challenge page
- a signed-out or expired session
- three reels in a row with no comment box

Each of those ends the run with a message saying which, and exit code 2.
Nothing retries into a refusal.

## Flags

```
--dry-run              open each reel, find the box, type nothing
--count <n>            how many to post this run (default 8)
--min-wait --max-wait  seconds between comments (default 90 / 420)
--item <id>            just this one
--login                sign in once
```

## The session

Kept in `~/.kitabi-instagram-profile` — a Chrome profile directory, holding
what any signed-in browser holds. It is not your everyday Chrome profile,
because Chrome locks a profile while it is open and this has to work whether
or not you have Chrome running. No password is stored anywhere, by this or by
anything else in the repo. If you ever want it gone, delete that directory.

Chrome itself is used rather than a downloaded Chromium, and the window is
visible rather than headless: both are what an ordinary session looks like,
and this is your real account.
