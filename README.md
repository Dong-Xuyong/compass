# Compass

Purpose, this week, mood, wins, and 1% better.

Live: https://dong-xuyong.github.io/compass/

No build step. `index.html` loads `dong-ui` and `js/purpose.js`, `js/journal.js`, `js/model.js`, then `js/app.js`.

The page reads `purpose.md` and `journal.json` from the private repo `Dong-Xuyong/progress-sync`, and writes `compass.json` there. The GitHub token stays in this browser under `dong-gh-sync`. Without a token, or while offline, each tab explains what is missing and keeps anything already saved on the phone.

## Contract

`CONTRACT.md` is the writer spec. `compass.json` looks like this:

```json
{
  "version": 1,
  "updatedAt": "2026-11-04T21:34:00+00:00",
  "weekly": [
    {
      "week": "2026-W45",
      "goals": [
        { "id": "g1", "goal": "Ship the thesis", "light": "green", "note": "Draft is in" }
      ],
      "advice": "Protect the first hour.",
      "mood": { "mood": 3.4, "energy": 3.8 },
      "createdBy": "hiluluk"
    }
  ],
  "wins": [{ "date": "2026-11-04", "text": "Called home", "createdBy": "dong" }],
  "better": [{ "date": "2026-11-04", "text": "Lights out at 23:00", "createdBy": "dong" }],
  "weeklyPick": [{ "week": "2026-W45", "text": "One deep block before mail.", "createdBy": "hiluluk" }],
  "goalProgress": { "g1": 40, "g2": 10, "g3": 0 }
}
```

- `updatedAt` is UTC ISO-8601 with `+00:00`, set on every write.
- `g1`, `g2`, and `g3` are the top 3 goals in `purpose.md`, in that order. `goalProgress` uses those ids, each 0–100.
- `note` on a weekly goal is optional. The Week tab shows it under the light.
- `weekly[].mood` is optional `{ "mood", "energy" }` averages. The Week tab shows it when it is present.
- `wins`, `better`, `weekly`, and `weeklyPick` are append-only. Each item has `createdBy`. The page uses `dong`.
- If `compass.json` is missing, the page creates it with empty arrays and an empty `goalProgress`.
- Writes `GET` the file, `PUT` with that `sha`, and on `409` `GET` and `PUT` once more.

## Tabs

1. Purpose. Nine questions, latest answer, past answers folded away, values, 1-year vision, and the top 3 goals with progress bars.
2. This week. Green, yellow, or red for each goal, the optional note, one advice line, and weekly mood averages when they are there. Dr. Hiluluk fills this on Sunday.
3. Mood. A 30-day chart of mood, energy, and sleep. Feeling low opens a two-minute box-breathing guide (4-4-4-4), a walk timer, or a reframe prompt.
4. Wins. Up to three a night, one tap to save. Low-mood days are marked.
5. 1% Better. One change a day, the streak, the `1.01ⁿ` curve (365 days is about 37.8×) with today marked, and the latest weekly pick.

## Tests

```bash
node tests/purpose.test.mjs
node tests/journal.test.mjs
node tests/model.test.mjs
```
