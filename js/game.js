(function () {
  "use strict";

  const WORD_LENGTH = 5;
  const MAX_GUESSES = 6;
  const STAGGER_MS = 300;
  const FLIP_MS = 500;
  const REVEAL_TOTAL_MS = (WORD_LENGTH - 1) * STAGGER_MS + FLIP_MS;
  const ANSWER_WORDS = Object.keys(ANSWERS); // curated GULC-themed answers
  const VALID_SET = new Set(VALID_WORDS); // full dictionary used to validate guesses
  ANSWER_WORDS.forEach((w) => VALID_SET.add(w.toLowerCase())); // belt & suspenders

  const EPOCH = Date.UTC(2024, 0, 1); // arbitrary fixed epoch for daily word rotation & puzzle numbering
  const DC_TZ = "America/New_York"; // the word rotates at midnight Eastern (DC time), for every player

  // Reads a Date's wall-clock date/time as it appears in a given IANA time zone.
  function zonedParts(date, timeZone) {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = {};
    fmt.formatToParts(date).forEach((p) => {
      if (p.type !== "literal") parts[p.type] = parseInt(p.value, 10);
    });
    if (parts.hour === 24) parts.hour = 0;
    return parts;
  }

  function dcDateKey(date) {
    const p = zonedParts(date || new Date(), DC_TZ);
    return `${p.year}-${p.month}-${p.day}`;
  }

  // Number of whole DC calendar days since EPOCH. Rolls over exactly at DC midnight
  // for every visitor, regardless of their own local time zone.
  function dcDayIndex(date) {
    const p = zonedParts(date || new Date(), DC_TZ);
    const asUTCms = Date.UTC(p.year, p.month - 1, p.day);
    return Math.floor((asUTCms - EPOCH) / 86400000);
  }

  function dailyIndex() {
    const days = dcDayIndex();
    return ((days % ANSWER_WORDS.length) + ANSWER_WORDS.length) % ANSWER_WORDS.length;
  }

  function dailyPuzzleNumber() {
    return dcDayIndex() + 1;
  }

  function msUntilNextDcMidnight() {
    const p = zonedParts(new Date(), DC_TZ);
    const secondsSinceMidnight = p.hour * 3600 + p.minute * 60 + p.second;
    return (86400 - secondsSinceMidnight) * 1000;
  }

  function formatCountdown(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
  }

  /** @typedef {{mode:'daily'|'practice', answer:string, puzzleNumber:number, guesses:string[], statuses:string[][], keyStatuses:Object, done:boolean, won:boolean, dateKey:string}} GameState */

  /** @type {GameState} */
  let state = null;

  const boardEl = document.getElementById("board");
  const keyboardEl = document.getElementById("keyboard");
  const toastContainer = document.getElementById("toast-container");
  const cluePanel = document.getElementById("clue-panel");

  let currentGuess = "";
  let inputLocked = false;

  function storageKey() {
    return "hoya-wordle-state";
  }
  function statsKey() {
    return "hoya-wordle-stats";
  }

  function loadStats() {
    try {
      const raw = localStorage.getItem(statsKey());
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { played: 0, wins: 0, streak: 0, maxStreak: 0, distribution: [0, 0, 0, 0, 0, 0] };
  }

  function saveStats(stats) {
    localStorage.setItem(statsKey(), JSON.stringify(stats));
  }

  // Only the daily game is persisted — starting a practice round must never clobber
  // today's saved daily result, since stats/share both read it back later.
  function saveState() {
    if (state.mode !== "daily") return;
    try {
      localStorage.setItem(storageKey(), JSON.stringify(state));
    } catch (e) {}
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(storageKey());
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.mode === "daily" && parsed.dateKey === dcDateKey()) {
          return parsed;
        }
      }
    } catch (e) {}
    return null;
  }

  // Returns today's saved daily result even while a practice round is active in memory.
  function getDailyRecord() {
    if (state && state.mode === "daily") return state;
    try {
      const raw = localStorage.getItem(storageKey());
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.mode === "daily" && parsed.dateKey === dcDateKey()) return parsed;
      }
    } catch (e) {}
    return null;
  }

  function newDailyState() {
    return {
      mode: "daily",
      answer: ANSWER_WORDS[dailyIndex()].toLowerCase(),
      puzzleNumber: dailyPuzzleNumber(),
      guesses: [],
      statuses: [],
      keyStatuses: {},
      done: false,
      won: false,
      dateKey: dcDateKey(),
    };
  }

  function newPracticeState() {
    const answer = ANSWER_WORDS[Math.floor(Math.random() * ANSWER_WORDS.length)].toLowerCase();
    return {
      mode: "practice",
      answer,
      puzzleNumber: null,
      guesses: [],
      statuses: [],
      keyStatuses: {},
      done: false,
      won: false,
      dateKey: dcDateKey(),
    };
  }

  function buildBoard() {
    boardEl.innerHTML = "";
    for (let r = 0; r < MAX_GUESSES; r++) {
      const row = document.createElement("div");
      row.className = "board-row";
      row.id = `row-${r}`;
      for (let c = 0; c < WORD_LENGTH; c++) {
        const tile = document.createElement("div");
        tile.className = "tile";
        tile.id = `tile-${r}-${c}`;
        row.appendChild(tile);
      }
      boardEl.appendChild(row);
    }
  }

  const KEY_ROWS = [
    ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
    ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
    ["enter", "z", "x", "c", "v", "b", "n", "m", "back"],
  ];

  function buildKeyboard() {
    keyboardEl.innerHTML = "";
    KEY_ROWS.forEach((row) => {
      const rowEl = document.createElement("div");
      rowEl.className = "key-row";
      row.forEach((key) => {
        const btn = document.createElement("button");
        btn.className = "key";
        btn.dataset.key = key;
        if (key === "enter" || key === "back") btn.classList.add("wide");
        btn.textContent = key === "back" ? "⌫" : key === "enter" ? "Enter" : key;
        btn.addEventListener("click", () => handleKey(key));
        rowEl.appendChild(btn);
      });
      keyboardEl.appendChild(rowEl);
    });
  }

  function showToast(msg, duration = 1600) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    toastContainer.appendChild(el);
    setTimeout(() => el.remove(), duration);
  }

  function shakeRow(r) {
    const row = document.getElementById(`row-${r}`);
    row.classList.add("shake");
    setTimeout(() => row.classList.remove("shake"), 400);
  }

  // Wordle-style two-pass evaluation that correctly handles duplicate letters.
  function evaluateGuess(guess, answer) {
    const result = new Array(WORD_LENGTH).fill("absent");
    const answerLetters = answer.split("");
    const used = new Array(WORD_LENGTH).fill(false);

    for (let i = 0; i < WORD_LENGTH; i++) {
      if (guess[i] === answerLetters[i]) {
        result[i] = "correct";
        used[i] = true;
      }
    }
    for (let i = 0; i < WORD_LENGTH; i++) {
      if (result[i] === "correct") continue;
      const idx = answerLetters.findIndex((l, j) => l === guess[i] && !used[j]);
      if (idx !== -1) {
        result[i] = "present";
        used[idx] = true;
      }
    }
    return result;
  }

  function statusRank(s) {
    return s === "correct" ? 3 : s === "present" ? 2 : s === "absent" ? 1 : 0;
  }

  function updateKeyStatuses(guess, statuses) {
    for (let i = 0; i < WORD_LENGTH; i++) {
      const letter = guess[i];
      const newStatus = statuses[i];
      const existing = state.keyStatuses[letter];
      if (!existing || statusRank(newStatus) > statusRank(existing)) {
        state.keyStatuses[letter] = newStatus;
      }
    }
  }

  function renderKeyboard() {
    document.querySelectorAll(".key").forEach((btn) => {
      const key = btn.dataset.key;
      btn.classList.remove("correct", "present", "absent");
      const status = state.keyStatuses[key];
      if (status) btn.classList.add(status);
    });
  }

  function renderBoard(animateRow) {
    for (let r = 0; r < state.guesses.length; r++) {
      const guess = state.guesses[r];
      const statuses = state.statuses[r];
      for (let c = 0; c < WORD_LENGTH; c++) {
        const tile = document.getElementById(`tile-${r}-${c}`);
        tile.textContent = guess[c].toUpperCase();
        tile.classList.add("filled");
        if (r === animateRow) {
          setTimeout(() => {
            tile.classList.add("flip");
            setTimeout(() => tile.classList.add(statuses[c]), FLIP_MS / 2);
            setTimeout(() => tile.classList.remove("flip"), FLIP_MS);
          }, c * STAGGER_MS);
        } else {
          tile.classList.add(statuses[c]);
        }
      }
    }
    // current in-progress row
    if (state.guesses.length < MAX_GUESSES) {
      const r = state.guesses.length;
      for (let c = 0; c < WORD_LENGTH; c++) {
        const tile = document.getElementById(`tile-${r}-${c}`);
        tile.textContent = (currentGuess[c] || "").toUpperCase();
        tile.classList.toggle("filled", !!currentGuess[c]);
      }
    }
  }

  function emojiGrid(statuses) {
    return statuses
      .map((row) =>
        row.map((s) => (s === "correct" ? "🟩" : s === "present" ? "🟨" : "⬛")).join("")
      )
      .join("\n");
  }

  function buildShareText(record) {
    const result = record.won ? `${record.guesses.length}/${MAX_GUESSES}` : `X/${MAX_GUESSES}`;
    const header = `Hoya Wordle #${record.puzzleNumber} ${result}`;
    return `${header}\n\n${emojiGrid(record.statuses)}`;
  }

  function fallbackCopy(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      showToast("Copied results to clipboard!");
    } catch (e) {
      showToast("Could not copy — please copy manually");
    }
    document.body.removeChild(ta);
  }

  function shareResults() {
    const record = getDailyRecord();
    if (!record || !record.done) {
      showToast("Finish today's Hoya Wordle to share your results!", 2200);
      return;
    }
    const text = buildShareText(record);
    if (navigator.share) {
      navigator.share({ text }).catch(() => {});
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => showToast("Copied results to clipboard!"),
        () => fallbackCopy(text)
      );
    } else {
      fallbackCopy(text);
    }
  }

  function showClue(reveal) {
    const word = state.answer.toUpperCase();
    const clue = ANSWERS[word];
    cluePanel.classList.remove("hidden");
    const title =
      state.mode === "daily"
        ? `Hoya Wordle #${state.puzzleNumber}${reveal ? " — the word was " + word : ""}`
        : reveal
        ? "The word was " + word
        : word;
    const shareBlock =
      state.mode === "daily"
        ? `<div class="clue-footer">
             <span class="countdown-value" id="clue-countdown">--:--:--</span>
             <button class="share-btn" id="share-btn-clue" type="button">Share Results 📤</button>
           </div>`
        : "";
    cluePanel.innerHTML = `<h3>${title}</h3><p>${clue}</p>${shareBlock}`;
  }

  function endGame(won) {
    state.done = true;
    state.won = won;
    inputLocked = true;
    saveState();

    if (state.mode === "daily") {
      const stats = loadStats();
      stats.played += 1;
      if (won) {
        stats.wins += 1;
        stats.streak += 1;
        stats.maxStreak = Math.max(stats.maxStreak, stats.streak);
        stats.distribution[state.guesses.length - 1] += 1;
      } else {
        stats.streak = 0;
      }
      saveStats(stats);
    }

    setTimeout(() => {
      showToast(won ? ["Brilliant!", "Excellent!", "Great job!", "Nice!", "Phew!", "You got it!"][state.guesses.length - 1] : "So close!", 1800);
      showClue(!won);
      if (state.mode === "daily") setTimeout(renderStats, 300);
    }, REVEAL_TOTAL_MS + 300);
  }

  function submitGuess() {
    if (inputLocked) return;
    if (currentGuess.length !== WORD_LENGTH) {
      showToast("Not enough letters");
      shakeRow(state.guesses.length);
      return;
    }
    if (!VALID_SET.has(currentGuess)) {
      showToast("Not in word list");
      shakeRow(state.guesses.length);
      return;
    }

    const statuses = evaluateGuess(currentGuess, state.answer);
    const rowIndex = state.guesses.length;
    state.guesses.push(currentGuess);
    state.statuses.push(statuses);
    updateKeyStatuses(currentGuess, statuses);

    const won = currentGuess === state.answer;
    currentGuess = "";
    renderBoard(rowIndex);

    setTimeout(() => renderKeyboard(), REVEAL_TOTAL_MS);

    saveState();

    if (won) {
      endGame(true);
    } else if (state.guesses.length >= MAX_GUESSES) {
      endGame(false);
    }
  }

  function handleKey(key) {
    if (inputLocked) return;
    if (key === "enter") {
      submitGuess();
      return;
    }
    if (key === "back") {
      currentGuess = currentGuess.slice(0, -1);
      renderBoard();
      return;
    }
    if (/^[a-z]$/.test(key) && currentGuess.length < WORD_LENGTH) {
      currentGuess += key;
      renderBoard();
      const r = state.guesses.length;
      const c = currentGuess.length - 1;
      const tile = document.getElementById(`tile-${r}-${c}`);
      tile.classList.add("pop");
      setTimeout(() => tile.classList.remove("pop"), 100);
    }
  }

  document.addEventListener("keydown", (e) => {
    if (document.querySelector(".modal-overlay:not(.hidden)")) return;
    const key = e.key.toLowerCase();
    if (key !== "enter" && key !== "backspace" && !/^[a-z]$/.test(key)) return;
    // A toolbar/keyboard button can still hold focus from a previous click (e.g. "New
    // practice word"). Without this, pressing Enter both submits the guess AND re-fires
    // that focused button's native click-on-Enter behavior, wiping the board we just filled.
    if (document.activeElement instanceof HTMLButtonElement) {
      document.activeElement.blur();
    }
    e.preventDefault();
    if (key === "enter") handleKey("enter");
    else if (key === "backspace") handleKey("back");
    else handleKey(key);
  });

  function startGame(newState) {
    state = newState;
    currentGuess = "";
    inputLocked = false;
    cluePanel.classList.add("hidden");
    buildBoard();
    buildKeyboard();
    renderBoard();
    renderKeyboard();
    if (state.done) {
      inputLocked = true;
      showClue(!state.won);
    }
    saveState();
  }

  function renderStats() {
    const stats = loadStats();
    document.getElementById("stat-played").textContent = stats.played;
    document.getElementById("stat-winpct").textContent = stats.played
      ? Math.round((stats.wins / stats.played) * 100)
      : 0;
    document.getElementById("stat-streak").textContent = stats.streak;
    document.getElementById("stat-maxstreak").textContent = stats.maxStreak;

    const distEl = document.getElementById("guess-distribution");
    distEl.innerHTML = "";
    const max = Math.max(1, ...stats.distribution);
    const dailyRecord = getDailyRecord();
    stats.distribution.forEach((count, i) => {
      const row = document.createElement("div");
      row.className = "dist-row";
      const isCurrent =
        dailyRecord && dailyRecord.done && dailyRecord.won && dailyRecord.guesses.length - 1 === i;
      row.innerHTML = `<span class="dist-num">${i + 1}</span><div class="dist-bar-wrap"><div class="dist-bar${
        isCurrent ? " current" : ""
      }" style="width:${(count / max) * 100}%">${count}</div></div>`;
      distEl.appendChild(row);
    });
  }

  function wireModals() {
    document.getElementById("help-btn").addEventListener("click", () => {
      document.getElementById("help-modal").classList.remove("hidden");
    });
    document.getElementById("stats-btn").addEventListener("click", () => {
      renderStats();
      document.getElementById("stats-modal").classList.remove("hidden");
    });
    document.querySelectorAll("[data-close]").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.getElementById(btn.dataset.close).classList.add("hidden");
      });
    });
    document.querySelectorAll(".modal-overlay").forEach((overlay) => {
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) overlay.classList.add("hidden");
      });
    });
    document.getElementById("new-btn").addEventListener("click", () => {
      startGame(newPracticeState());
      showToast("New practice word! (progress not tracked in stats)", 2200);
    });

    // Share buttons are (re)created dynamically, so use delegated listeners.
    cluePanel.addEventListener("click", (e) => {
      if (e.target.closest("#share-btn-clue")) shareResults();
    });
    document.getElementById("stats-modal").addEventListener("click", (e) => {
      if (e.target.closest("#share-btn-stats")) shareResults();
    });
  }

  function tickCountdown() {
    const text = formatCountdown(msUntilNextDcMidnight());
    document.querySelectorAll(".countdown-value").forEach((el) => (el.textContent = text));
  }

  function checkForNewDailyWord() {
    const freshKey = dcDateKey();
    if (state && state.mode === "daily" && state.dateKey !== freshKey) {
      startGame(newDailyState());
      showToast("Today's new Hoya Wordle is here!", 2400);
    }
  }

  function init() {
    wireModals();
    const saved = loadState();
    startGame(saved || newDailyState());
    if (!loadStats().played && !saved) {
      // first-time visitor: show help automatically
      document.getElementById("help-modal").classList.remove("hidden");
    }
    tickCountdown();
    setInterval(() => {
      tickCountdown();
      checkForNewDailyWord();
    }, 1000);
  }

  init();
})();
