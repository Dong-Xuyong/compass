# Compass writer contract

The Compass page reads `purpose.md` and `journal.json` from the private repo `Dong-Xuyong/progress-sync`. It writes only `compass.json` in that same repo. Do not put the GitHub token in this repo. The token lives in the browser under `localStorage` key `dong-gh-sync`, shared with the other apps.

## compass.json

```json
{
  "version": 1,
  "updatedAt": "2026-11-04T21:34:00+00:00",
  "weekly": [
    {
      "week": "2026-W45",
      "goals": [
        { "id": "g1", "goal": "Ship the thesis", "light": "green", "note": "Draft is in" },
        { "id": "g2", "goal": "Train four days a week", "light": "yellow" },
        { "id": "g3", "goal": "Save the emergency fund", "light": "red", "note": "Not started" }
      ],
      "advice": "Protect the first hour.",
      "mood": { "mood": 3.4, "energy": 3.8 },
      "createdBy": "hiluluk"
    }
  ],
  "wins": [
    { "date": "2026-11-04", "text": "Called home", "createdBy": "dong" }
  ],
  "better": [
    { "date": "2026-11-04", "text": "Lights out at 23:00", "createdBy": "dong" }
  ],
  "weeklyPick": [
    { "week": "2026-W45", "text": "One deep block before mail.", "createdBy": "hiluluk" }
  ],
  "goalProgress": { "g1": 40, "g2": 10, "g3": 0 }
}
```

`version` is `1`.

`updatedAt` is the top-level UTC time of the last write, ISO-8601 with a `+00:00` suffix. Set it on every write.

`weekly` is append-only. One object is the Sunday check. `week` is an ISO week `GGGG-Www`. `goals` uses ids `g1`, `g2`, and `g3`, in the same order as the top 3 goals in `purpose.md`. `light` is `green`, `yellow`, or `red`. `note` is optional and is one line shown under that light. `advice` is the one line for the week. `mood` is optional and holds that week's average `mood` and `energy`. `createdBy` names the writer. Dr. Hiluluk's Sunday check uses a name other than `dong`.

`wins` is append-only. Each item is `{ "date", "text", "createdBy" }`. `date` is `YYYY-MM-DD`. The page adds at most 3 for the current day and sets `createdBy` to `dong`.

`better` is append-only, same item shape as `wins`. The page adds at most one for the current day, with `createdBy` `dong`.

`weeklyPick` is append-only. Each item is `{ "week", "text", "createdBy" }`. The page shows the latest week. It does not write picks.

`goalProgress` maps a goal id to an integer from 0 to 100. The page writes this when the slider moves. `g1`, `g2`, and `g3` are the top 3 goals from `purpose.md`, in order.

A missing file is created as:

```json
{
  "version": 1,
  "updatedAt": "<UTC ISO-8601 with +00:00>",
  "weekly": [],
  "wins": [],
  "better": [],
  "weeklyPick": [],
  "goalProgress": {}
}
```

## Write rules

- Read the file, change it, then `PUT` with the `sha` from the `GET`. On `409`, `GET` again and retry once. Do not retry a second time.
- `wins`, `better`, `weekly`, and `weeklyPick` are append-only. Never delete an item you did not mean to remove. Keep items another writer added.
- Every item the page appends sets `createdBy` to `dong`. Leave another writer's `createdBy` as it is.
- Set top-level `updatedAt` on every write.
- Keep every top-level key you are not editing.
- Repo: `Dong-Xuyong/progress-sync`. Path: `compass.json`.
- `PUT https://api.github.com/repos/Dong-Xuyong/progress-sync/contents/compass.json` with `Authorization: Bearer <token>`, `message` `Save compass progress` (or `Create compass.json` the first time), `content` as base64 of the full JSON, and `sha` when the file already exists.

## Files this page only reads

`purpose.md` holds the nine questions with latest and past answers, the values, the 1-year vision, and the top 3 goals. The page accepts headings (`Q1`, `Question 1`, or the question sentence), a `Latest` line, and dated bullets. Sections it does not recognise are still shown.

`journal.json` is the journal contract. Mood and energy are integers 1–5 on `entries[YYYY-MM-DD].fields` (`mood`, `energy`, and `moodMeter` when mood is empty). Sleep is hours on `fields.sleep` (a number, an hours string, or `{ "bed", "wake" }` / `{ "hours" }`), with the same values also read from `days` and the top-level `sleep` map. A missing score stays missing.
