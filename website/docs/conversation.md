# Conversation (`/ask` + reactions)

Reviews are one-shot; questions are a conversation. Anyone with write access
can ask the reviewer about the PR in a comment:

```text
/ask why is the retry loop flagged? I thought the backoff was capped.
```

The action answers in-thread, grounded in the PR diff plus the previous
round's recorded findings. Quote the finding you mean and it stays adjacent
to your question:

```text
/ask is this still true after my fix?
> src/auth.ts:42 session fixation — session id not rotated on login
```

What it can see: the current PR diff (truncated at `max_diff_chars`), the
recorded findings from the last review, and your quoted lines. What it
cannot see: inline review threads (only issue comments trigger the
workflow), or files outside the diff except through the recorded findings.
`/ask` answers with the first review's `main` provider and counts against
the run's `max_runtime_s` budget like any agent call. Manual `/review`
always runs a full fresh review.

## Feedback signal

Every published review also logs a structured reaction summary:

```text
Feedback signals: {"+1":2,"-1":1} across 2 bot comment(s).
```

Reactions on the bot's own PR comments (the sticky and its answers) are
aggregated per comment and in total. It is read-only signal collection:
nothing about the verdict changes. It exists so a future rollup (issue
#43) can measure which findings humans confirm or reject. What is stored
today is only these counts in the run log.
