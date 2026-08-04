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
  daily word selection (deterministic by date, same word for everyone each
  day), a practice mode (the &#8635; button, unlimited random rounds not
  counted in stats), and localStorage-backed stats/streaks.

## Customizing the word list

Add or remove entries in the `ANSWERS` object in `js/answers.js` (format:
`"WORD": "clue"`). Any word you add must also exist in `js/valid-words.js`
(all lowercase) or guesses for it will be rejected — the game asserts this
isn't violated by construction, but if you hand-edit the list, double check.
