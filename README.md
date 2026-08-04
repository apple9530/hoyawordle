# Hoya Wordle

A Wordle clone themed around Georgetown Law (GULC). Every answer is a
law-school / GULC-flavored 5-letter term (`TORTS`, `BRIEF`, `HOYAS`, `VENUE`,
`DICTA`, `ESTOP`, ...), and every guess is checked against a real dictionary
so nonsense entries are rejected.

## Running it

No build step, no dependencies. Either:

- Open `index.html` directly in a browser, or
- Serve the folder locally, e.g. `python3 -m http.server 8000`, then visit
  `http://localhost:8000`.

## How it works

- **`js/valid-words.js`** — a ~14,800-word dictionary of valid 5-letter
  guesses (derived from the public NYT Wordle valid-guess list). Any guess
  not in this list is rejected with a "Not in word list" message.
- **`js/answers.js`** — the curated list of ~50 Georgetown Law / GULC answer
  words, each with a short clue revealed at the end of the round. Every
  answer word is also a member of the dictionary above.
- **`js/game.js`** — game logic: board/keyboard rendering, guess evaluation,
  daily word selection, a practice mode (the &#8635; button, unlimited random
  rounds not counted in stats), and localStorage-backed stats/streaks.

## Daily word & sharing

- The word rotates once every 24 hours at **midnight Eastern (DC time)** —
  every player gets the same word on the same calendar day, regardless of
  their own local time zone. A live countdown ("New Hoya Wordle in HH:MM:SS")
  is shown under the header, in the end-of-round panel, and in the Statistics
  modal, and the puzzle auto-refreshes the moment a new day starts.
- Each daily puzzle is numbered (`Hoya Wordle #N`, counted from a fixed
  epoch). After finishing the daily round, a **Share Results** button
  (in the end-of-round panel and in Statistics) copies a Wordle-style emoji
  grid — e.g. `Hoya Wordle #947 3/6` plus 🟩🟨⬛ rows — to the clipboard (or
  opens the native share sheet on supporting devices), with no spoilers.
- Practice rounds are unlimited and never touch the daily save, stats, or
  puzzle number, so starting one can't clobber today's completed result.

## Customizing the word list

Add or remove entries in the `ANSWERS` object in `js/answers.js` (format:
`"WORD": "clue"`). Any word you add must also exist in `js/valid-words.js`
(all lowercase) or guesses for it will be rejected — the game asserts this
isn't violated by construction, but if you hand-edit the list, double check.
