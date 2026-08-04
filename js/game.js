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

  const EPOCH = Date.UTC(2024, 0, 1); // arbitrary fixed epoch for daily word rotation

  function dailyIndex() {
    const now = new Date();
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    const days = Math.floor((today - EPOCH) / 86400000);
    return ((days % ANSWER_WORDS.length) + ANSWER_WORDS.length) % ANSWER_WORDS.length;
  }

  function todayKey() {
    const now = new Date();
    return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  }

  /** @typedef {{mode:'daily'|'practice', answer:string, guesses:string[], statuses:string[][], keyStatuses:Object, done:boolean, won:boolean, dateKey:string}} GameState */

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

  function saveState() {
    try {
      localStorage.setItem(storageKey(), JSON.stringify(state));
    } catch (e) {}
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(storageKey());
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.mode === "daily" && parsed.dateKey === todayKey()) {
          return parsed;
        }
      }
    } catch (e) {}
    return null;
  }

  function newDailyState() {
    return {
      mode: "daily",
      answer: ANSWER_WORDS[dailyIndex()].toLowerCase(),
      guesses: [],
      statuses: [],
      keyStatuses: {},
      done: false,
      won: false,
      dateKey: todayKey(),
    };
  }

  function newPracticeState() {
    const answer = ANSWER_WORDS[Math.floor(Math.random() * ANSWER_WORDS.length)].toLowerCase();
    return {
      mode: "practice",
      answer,
      guesses: [],
      statuses: [],
      keyStatuses: {},
      done: false,
      won: false,
      dateKey: todayKey(),
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

  function showClue(reveal) {
    const word = state.answer.toUpperCase();
    const clue = ANSWERS[word];
    cluePanel.classList.remove("hidden");
    cluePanel.innerHTML = `<h3>${reveal ? "The word was " + word : word}</h3><p>${clue}</p>`;
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
    if (key === "enter") handleKey("enter");
    else if (key === "backspace") handleKey("back");
    else if (/^[a-z]$/.test(key)) handleKey(key);
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
    stats.distribution.forEach((count, i) => {
      const row = document.createElement("div");
      row.className = "dist-row";
      const isCurrent = state.mode === "daily" && state.done && state.won && state.guesses.length - 1 === i;
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
  }

  function init() {
    wireModals();
    const saved = loadState();
    startGame(saved || newDailyState());
    if (!loadStats().played && !saved) {
      // first-time visitor: show help automatically
      document.getElementById("help-modal").classList.remove("hidden");
    }
  }

  init();
})();
