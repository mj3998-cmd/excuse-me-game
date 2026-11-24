/**
 * EXCUSE ME! - Collaborative Party Game
 * Powered by Firebase Firestore & Anonymous Authentication
 *
 * Game Rules:
 * 1. Room holds up to 5 players.
 * 2. Each player gets one unique category based on joining order:
 *    - Player 1: Who?
 *    - Player 2: Did what?
 *    - Player 3: What?
 *    - Player 4: Where?
 *    - Player 5: Why?
 * 3. Each player can submit only one answer.
 * 4. Answers are private in the 'answers' subcollection until the reveal.
 * 5. When all 5 submit, Firestore triggers onSnapshot() and reveals
 *    the completed sentence in order on every connected device!
 */

// ==========================================================================
// 1. FIREBASE MODULAR SDK IMPORTS & CONFIGURATION
// ==========================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  getDocs,
  collection,
  onSnapshot,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

// Your Firebase Project Configuration
const firebaseConfig = {
  apiKey: "AIzaSyBTrXgMtTcIk_JYZEqB82o9LcEfP42SfHU",
  authDomain: "excuse-me-game.firebaseapp.com",
  projectId: "excuse-me-game",
  storageBucket: "excuse-me-game.firebasestorage.app",
  messagingSenderId: "461188660062",
  appId: "1:461188660062:web:da9851769a84548006adcf",
  measurementId: "G-03HZWSRV0K"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Authentication State
let currentUserId = null;
let authReadyPromise = null;

function initAuth() {
  authReadyPromise = new Promise((resolve) => {
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        currentUserId = user.uid;
        resolve(user.uid);
      } else {
        try {
          const cred = await signInAnonymously(auth);
          currentUserId = cred.user.uid;
          resolve(cred.user.uid);
        } catch (err) {
          console.error("Anonymous authentication error:", err);
          showToast("⚠️ Firebase Auth error: " + err.message);
          resolve(null);
        }
      }
    });
  });
}

// ==========================================================================
// 2. GAME CONSTANTS & CATEGORY DEFINITIONS
// ==========================================================================

const MAX_PLAYERS = 5;

// The 5 fixed categories assigned in joining order (0 -> 4)
const CATEGORIES = [
  {
    slot: 0,
    name: "Who?",
    hint: "Name a ridiculous person, animal, creature, or character.",
    placeholder: "e.g. A runaway ninja raccoon",
    ideas: [
      "A squad of undercover capybaras",
      "My grandmother's hyperactive ferret",
      "An offended Victorian ghost",
      "A rogue sentient Roomba",
      "Three raccoons in a trench coat",
      "The neighborhood cat mafia",
      "A time-traveling disco wizard"
    ]
  },
  {
    slot: 1,
    name: "Did what?",
    hint: "What action did they perform? (past tense verb phrase)",
    placeholder: "e.g. accidentally swallowed",
    ideas: [
      "accidentally swallowed",
      "demanded a ransom for",
      "teleported",
      "declared martial law over",
      "deep-fried and devoured",
      "covered in hot nacho cheese",
      "challenged to a breakdance battle"
    ]
  },
  {
    slot: 2,
    name: "What?",
    hint: "What item, vehicle, or target was involved?",
    placeholder: "e.g. my math homework",
    ideas: [
      "my alarm clock",
      "the entire school bus",
      "a 400-pound wheel of cheddar cheese",
      "my left sneaker",
      "the mayor's golf cart",
      "a suitcase full of lukewarm mayonnaise",
      "the neighbor's Wi-Fi router"
    ]
  },
  {
    slot: 3,
    name: "Where?",
    hint: "Where did this happen? (starts with in, on, at, behind...)",
    placeholder: "e.g. at the top of the Eiffel Tower",
    ideas: [
      "at the top of Mount Everest",
      "inside the local IKEA ball pit",
      "behind the dumpster at Wendy's",
      "in the middle of a crowded library",
      "on the International Space Station",
      "underneath my teacher's desk",
      "inside an underground submarine"
    ]
  },
  {
    slot: 4,
    name: "Why?",
    hint: "What was the ridiculous reason? (starts with because, to, in order to...)",
    placeholder: "e.g. because the aliens commanded it",
    ideas: [
      "because the fortune cookie commanded them to",
      "to fulfill an ancient cursed prophecy",
      "in exchange for a lifetime supply of tacos",
      "to impress a flock of judgmental seagulls",
      "because mercury was in retrograde",
      "to avoid doing laundry",
      "so the SWAT team would bring donuts"
    ]
  }
];

// Predicaments to prompt the excuse
const PREDICAMENTS = [
  "Why were you late to class / work?",
  "Why didn't you do your homework?",
  "Why did you call the fire department at 3 AM?",
  "Why is there an alpaca in the living room?",
  "Why did you scream in the grocery store?",
  "Why did you cancel our dinner date?"
];

// Sample player names & avatars for quick picking or bot simulation
const SAMPLE_NAMES = [
  "Captain Quack", "DJ Pickles", "Professor Waffles", "Madame Chaos",
  "Snoozy Sam", "Lord Guacamole", "Princess Taco", "Dr. Bamboozle",
  "Baron Von Banana", "Sneaky Squirrel", "Sir Oops-a-lot", "Ninja Noodles"
];

const BOT_AVATARS = ["🦆", "🥒", "🧇", "🔮", "🦥", "🥑", "🌮", "🕵️", "🍌", "🐿️"];

const ROOM_CODES = [
  "OOPS", "YOLO", "WACK", "BONK", "NOPE", "ZOOM", "TACO", "MEOW",
  "CHEF", "FROG", "DUCK", "BOOM", "COOL", "WILD", "NERD", "HYPE"
];

// Local state
let currentRoom = null;
let roomUnsubscribe = null;
// Cache local player's own submission in memory for instant UX
const localSubmissionCache = {};

// ==========================================================================
// 3. DOM ELEMENTS
// ==========================================================================

// Screens
const screenWelcome = document.getElementById("welcome-screen");
const screenGame = document.getElementById("game-screen");
const screenReveal = document.getElementById("reveal-screen");

// Welcome Screen
const playerNameInput = document.getElementById("player-name-input");
const randomNameBtn = document.getElementById("random-name-btn");
const createRoomBtn = document.getElementById("create-room-btn");
const roomCodeInput = document.getElementById("room-code-input");
const joinRoomBtn = document.getElementById("join-room-btn");

// Game Screen
const displayRoomCode = document.getElementById("display-room-code");
const copyRoomCodeBtn = document.getElementById("copy-room-code-btn");
const currentPlayerName = document.getElementById("current-player-name");
const leaveRoomBtn = document.getElementById("leave-room-btn");
const questionText = document.getElementById("question-text");
const categoryTitle = document.getElementById("category-title");
const categoryHint = document.getElementById("category-hint");
const playerAnswerInput = document.getElementById("player-answer-input");
const inspireBtn = document.getElementById("inspire-btn");
const submitAnswerBtn = document.getElementById("submit-answer-btn");
const submissionConfirmation = document.getElementById("submission-confirmation");
const submissionCounter = document.getElementById("submission-counter");
const progressBarFill = document.getElementById("progress-bar-fill");
const playersChipsContainer = document.getElementById("players-chips-container");
const fillBotsBtn = document.getElementById("fill-bots-btn");

// Reveal Screen
const revealQuestionText = document.getElementById("reveal-question-text");
const completedExcuseContent = document.getElementById("completed-excuse-content");
const contributorsList = document.getElementById("contributors-list");
const copyExcuseBtn = document.getElementById("copy-excuse-btn");
const readAloudBtn = document.getElementById("read-aloud-btn");
const playAgainBtn = document.getElementById("play-again-btn");
const confettiCanvas = document.getElementById("confetti-canvas");

// Toast Notification
const toast = document.getElementById("toast");

// ==========================================================================
// 4. SCREEN NAVIGATION & UTILITIES
// ==========================================================================

function showScreen(screen) {
  [screenWelcome, screenGame, screenReveal].forEach(s => s.classList.remove("active"));
  screen.classList.add("active");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showToast(message, duration = 3200) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove("hidden");

  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.classList.add("hidden");
  }, duration);
}

function getRandomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function escapeHtml(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function cleanSentencePart(text) {
  if (!text) return "";
  let clean = text.trim();
  clean = clean.replace(/[.!?]+$/, "");
  return clean;
}

// ==========================================================================
// 5. WELCOME SCREEN & INITIALIZATION
// ==========================================================================

function initWelcomeScreen() {
  const savedName = localStorage.getItem("excuse_me_saved_name");
  playerNameInput.value = savedName || getRandomItem(SAMPLE_NAMES);

  randomNameBtn.addEventListener("click", () => {
    playerNameInput.value = getRandomItem(SAMPLE_NAMES);
    playerNameInput.focus();
  });

  createRoomBtn.addEventListener("click", handleCreateRoom);
  joinRoomBtn.addEventListener("click", handleJoinRoom);

  // Auto-uppercase 4-letter room code input
  roomCodeInput.addEventListener("input", (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
  });

  roomCodeInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleJoinRoom();
  });
}

function getPlayerName() {
  const name = playerNameInput.value.trim();
  if (!name) {
    const fallback = getRandomItem(SAMPLE_NAMES);
    playerNameInput.value = fallback;
    return fallback;
  }
  localStorage.setItem("excuse_me_saved_name", name);
  return name;
}

function generateRoomCode() {
  return getRandomItem(ROOM_CODES);
}

// ==========================================================================
// 6. FIRESTORE REAL-TIME SYNCHRONIZATION (onSnapshot)
// ==========================================================================

function subscribeToRoom(roomCode) {
  // Clean up any existing listener
  if (roomUnsubscribe) {
    roomUnsubscribe();
    roomUnsubscribe = null;
  }

  const roomRef = doc(db, "rooms", roomCode);

  roomUnsubscribe = onSnapshot(roomRef, async (docSnap) => {
    if (!docSnap.exists()) {
      showToast("⚠️ This room has been closed.");
      leaveRoom();
      return;
    }

    currentRoom = docSnap.data();

    // Check if round is revealed
    if (currentRoom.status === "revealed") {
      await enterRevealScreen();
    } else {
      renderCurrentState();
    }
  }, (error) => {
    console.error("Firestore onSnapshot error:", error);
    showToast("⚠️ Network issue: " + error.message);
  });
}

function leaveRoom() {
  if (roomUnsubscribe) {
    roomUnsubscribe();
    roomUnsubscribe = null;
  }
  currentRoom = null;
  showScreen(screenWelcome);
}

// ==========================================================================
// 7. ROOM CREATION (Firestore)
// ==========================================================================

async function handleCreateRoom() {
  const playerName = getPlayerName();
  createRoomBtn.disabled = true;
  createRoomBtn.textContent = "⏳ Creating Room...";

  try {
    await authReadyPromise;

    if (!currentUserId) {
      throw new Error("Authentication not ready. Please try again.");
    }

    let roomCode = generateRoomCode();

    // Ensure room code isn't actively in use
    const checkDoc = await getDoc(doc(db, "rooms", roomCode));
    if (checkDoc.exists()) {
      // Pick another random code if taken
      roomCode = getRandomItem(ROOM_CODES.filter(c => c !== roomCode));
    }

    const randomPredicament = getRandomItem(PREDICAMENTS);

    // Host is Player 1 -> assigned Slot 0 ("Who?")
    const hostPlayer = {
      id: currentUserId,
      name: playerName,
      avatar: "😎",
      slotIndex: 0,
      isSubmitted: false,
      isBot: false
    };

    const roomData = {
      code: roomCode,
      hostId: currentUserId,
      predicament: randomPredicament,
      predicamentIndex: PREDICAMENTS.indexOf(randomPredicament),
      status: "playing",
      round: 1,
      players: [hostPlayer],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    await setDoc(doc(db, "rooms", roomCode), roomData);

    currentRoom = roomData;
    subscribeToRoom(roomCode);
    showScreen(screenGame);
    renderCurrentState();
    showToast(`🎉 Room "${roomCode}" created!`);

  } catch (error) {
    console.error("Error creating room in Firestore:", error);
    showToast("❌ Could not create room: " + error.message);
  } finally {
    createRoomBtn.disabled = false;
    createRoomBtn.textContent = "✨ Create Room";
  }
}

// ==========================================================================
// 8. JOINING ROOMS (Firestore Transaction for Concurrency Safety)
// ==========================================================================

async function handleJoinRoom() {
  const playerName = getPlayerName();
  const rawCode = roomCodeInput.value.trim().toUpperCase();

  if (!rawCode) {
    showToast("⚠️ Please enter a 4-letter room code!");
    roomCodeInput.focus();
    return;
  }

  joinRoomBtn.disabled = true;
  joinRoomBtn.textContent = "⏳ Joining...";

  try {
    await authReadyPromise;

    if (!currentUserId) {
      throw new Error("Authentication not ready. Please check connection.");
    }

    const roomRef = doc(db, "rooms", rawCode);

    // Use a transaction to prevent race conditions when two players join simultaneously
    await runTransaction(db, async (transaction) => {
      const roomDoc = await transaction.get(roomRef);

      if (!roomDoc.exists()) {
        throw new Error(`Room "${rawCode}" does not exist!`);
      }

      const roomData = roomDoc.data();
      const existingPlayers = roomData.players || [];

      // Check if already in the room
      const existingPlayer = existingPlayers.find(p => p.id === currentUserId);
      if (existingPlayer) {
        // Already registered, re-enter smoothly
        return;
      }

      // Check maximum players rule
      if (existingPlayers.length >= MAX_PLAYERS) {
        throw new Error("Room is full! (Maximum 5 players reached)");
      }

      // Assign category strictly by joining order:
      // 0: Who?, 1: Did what?, 2: What?, 3: Where?, 4: Why?
      const assignedSlot = existingPlayers.length;

      const newPlayer = {
        id: currentUserId,
        name: playerName,
        avatar: getRandomItem(["🦄", "🐯", "🦊", "🐼", "🦁", "🐨"]),
        slotIndex: assignedSlot,
        isSubmitted: false,
        isBot: false
      };

      transaction.update(roomRef, {
        players: [...existingPlayers, newPlayer],
        updatedAt: serverTimestamp()
      });
    });

    // Successfully joined room
    subscribeToRoom(rawCode);
    showScreen(screenGame);
    showToast(`🚀 Joined room "${rawCode}"!`);

  } catch (error) {
    console.error("Error joining room:", error);
    showToast("⚠️ " + error.message);
  } finally {
    joinRoomBtn.disabled = false;
    joinRoomBtn.textContent = "🚀 Join Room";
  }
}

// ==========================================================================
// 9. GAME SCREEN LOGIC & RENDERING
// ==========================================================================

function renderCurrentState() {
  if (!currentRoom) return;

  // If status is revealed, let enterRevealScreen handle it
  if (currentRoom.status === "revealed") {
    enterRevealScreen();
    return;
  }

  // Ensure Game Screen is visible
  if (!screenGame.classList.contains("active") && !screenWelcome.classList.contains("active")) {
    showScreen(screenGame);
  }

  // Header & Predicament Question
  displayRoomCode.textContent = currentRoom.code;
  questionText.textContent = currentRoom.predicament || PREDICAMENTS[0];

  // Find local player in currentRoom.players
  const myPlayer = currentRoom.players.find(p => p.id === currentUserId);

  if (myPlayer) {
    currentPlayerName.textContent = myPlayer.name;
    const cat = CATEGORIES[myPlayer.slotIndex] || CATEGORIES[0];
    categoryTitle.textContent = `${cat.name}`;
    categoryHint.textContent = cat.hint;
    playerAnswerInput.placeholder = cat.placeholder;

    // Update input and button state based on submission status
    if (myPlayer.isSubmitted) {
      submitAnswerBtn.disabled = true;
      submitAnswerBtn.textContent = "✅ Locked In!";
      submissionConfirmation.classList.remove("hidden");
      playerAnswerInput.disabled = true;

      // Restore locally cached answer if present
      if (localSubmissionCache[myPlayer.slotIndex]) {
        playerAnswerInput.value = localSubmissionCache[myPlayer.slotIndex];
      }
    } else {
      submitAnswerBtn.disabled = false;
      submitAnswerBtn.textContent = "💥 Lock In My Excuse Part!";
      submissionConfirmation.classList.add("hidden");
      playerAnswerInput.disabled = false;

      // Clear input if starting a fresh round and not focused
      if (!playerAnswerInput.matches(":focus") && !myPlayer.isSubmitted) {
        playerAnswerInput.value = "";
      }
    }
  }

  // Submission Progress
  const submittedCount = currentRoom.players.filter(p => p.isSubmitted).length;
  submissionCounter.textContent = `${submittedCount}/${MAX_PLAYERS} Submitted`;

  const percent = Math.min(100, Math.round((submittedCount / MAX_PLAYERS) * 100));
  progressBarFill.style.width = `${percent}%`;

  // Render Players Status Chips
  // NOTE: Answers are hidden here! Only name, role, and readiness are shown.
  playersChipsContainer.innerHTML = "";
  currentRoom.players.forEach(p => {
    const chip = document.createElement("div");
    chip.className = `player-chip ${p.isSubmitted ? "submitted" : "pending"}`;
    const category = CATEGORIES[p.slotIndex] ? CATEGORIES[p.slotIndex].name : `Slot ${p.slotIndex + 1}`;

    chip.innerHTML = `
      <span class="chip-avatar">${p.avatar || "👤"}</span>
      <span>${escapeHtml(p.name)}</span>
      <span class="chip-category">${escapeHtml(category)}</span>
      <span class="chip-status">${p.isSubmitted ? "✓ Ready" : "typing..."}</span>
    `;
    playersChipsContainer.appendChild(chip);
  });
}

// "Silly Idea" helper button
inspireBtn.addEventListener("click", () => {
  if (!currentRoom) return;
  const myPlayer = currentRoom.players.find(p => p.id === currentUserId);
  const slotIdx = myPlayer ? myPlayer.slotIndex : 0;
  const cat = CATEGORIES[slotIdx] || CATEGORIES[0];

  playerAnswerInput.value = getRandomItem(cat.ideas);
  playerAnswerInput.focus();
  showToast("💡 Silly idea added!");
});

// Copy Room Code Button
copyRoomCodeBtn.addEventListener("click", () => {
  if (!currentRoom) return;
  copyToClipboard(currentRoom.code, "📋 Room code copied!");
});

// Leave Room
leaveRoomBtn.addEventListener("click", () => {
  if (confirm("Are you sure you want to leave this room?")) {
    leaveRoom();
  }
});

// ==========================================================================
// 10. ANSWER SUBMISSION (Firestore Subcollection & Privacy)
// ==========================================================================

submitAnswerBtn.addEventListener("click", async () => {
  if (!currentRoom) return;
  const text = playerAnswerInput.value.trim();

  if (!text) {
    showToast("⚠️ Type your excuse piece before submitting!");
    playerAnswerInput.focus();
    return;
  }

  const myPlayer = currentRoom.players.find(p => p.id === currentUserId);
  if (!myPlayer || myPlayer.isSubmitted) return;

  submitAnswerBtn.disabled = true;
  submitAnswerBtn.textContent = "⏳ Locking in...";

  try {
    const roomCode = currentRoom.code;
    const slotIdx = myPlayer.slotIndex;
    const currentRound = currentRoom.round || 1;

    // Cache locally for the author
    localSubmissionCache[slotIdx] = text;

    // 1. Save answer in private subcollection 'answers'
    // Document ID: slot_0, slot_1, etc.
    const answerRef = doc(db, "rooms", roomCode, "answers", `slot_${slotIdx}`);
    await setDoc(answerRef, {
      slotIndex: slotIdx,
      uid: currentUserId,
      text: text,
      round: currentRound,
      isBot: false,
      createdAt: serverTimestamp()
    });

    // 2. Mark this player as submitted in the main room document via transaction
    const roomRef = doc(db, "rooms", roomCode);
    await runTransaction(db, async (transaction) => {
      const roomDoc = await transaction.get(roomRef);
      if (!roomDoc.exists()) return;

      const data = roomDoc.data();
      const updatedPlayers = data.players.map(p => {
        if (p.id === currentUserId) {
          return { ...p, isSubmitted: true };
        }
        return p;
      });

      const allSubmitted = updatedPlayers.length >= MAX_PLAYERS && updatedPlayers.every(p => p.isSubmitted);

      transaction.update(roomRef, {
        players: updatedPlayers,
        status: allSubmitted ? "revealed" : data.status,
        updatedAt: serverTimestamp()
      });
    });

    showToast("🎉 Your part is locked in!");

    // If there are unfilled slots, trigger local bots simulation to assist
    checkAndTriggerBotsIfNeeded();

  } catch (error) {
    console.error("Error submitting answer to Firestore:", error);
    showToast("❌ Submission error: " + error.message);
    submitAnswerBtn.disabled = false;
    submitAnswerBtn.textContent = "💥 Lock In My Excuse Part!";
  }
});

// ==========================================================================
// 11. DEMO MODE & BOT SIMULATION (Firestore)
// ==========================================================================

fillBotsBtn.addEventListener("click", () => {
  addBotPlayersImmediately();
});

async function addBotPlayersImmediately() {
  if (!currentRoom) return;
  const roomCode = currentRoom.code;
  const roomRef = doc(db, "rooms", roomCode);

  try {
    fillBotsBtn.disabled = true;
    fillBotsBtn.textContent = "🤖 Adding bots...";

    const currentRound = currentRoom.round || 1;

    await runTransaction(db, async (transaction) => {
      const roomDoc = await transaction.get(roomRef);
      if (!roomDoc.exists()) return;

      const data = roomDoc.data();
      const players = [...data.players];

      // Fill empty slots up to 5
      for (let slot = 0; slot < MAX_PLAYERS; slot++) {
        let existing = players.find(p => p.slotIndex === slot);

        if (!existing) {
          const availableNames = SAMPLE_NAMES.filter(n => !players.some(p => p.name === n));
          const botName = getRandomItem(availableNames.length ? availableNames : SAMPLE_NAMES);
          const cat = CATEGORIES[slot];
          const botIdea = getRandomItem(cat.ideas);

          players.push({
            id: "bot_" + Math.random().toString(36).substring(2, 8),
            name: botName,
            avatar: getRandomItem(BOT_AVATARS),
            slotIndex: slot,
            isSubmitted: true,
            isBot: true
          });

          // Write bot answer to subcollection
          const answerRef = doc(db, "rooms", roomCode, "answers", `slot_${slot}`);
          transaction.set(answerRef, {
            slotIndex: slot,
            uid: currentUserId, // written under author's authenticated session
            text: botIdea,
            round: currentRound,
            isBot: true,
            createdAt: serverTimestamp()
          });

        } else if (existing.isBot && !existing.isSubmitted) {
          const cat = CATEGORIES[slot];
          const botIdea = getRandomItem(cat.ideas);
          existing.isSubmitted = true;

          const answerRef = doc(db, "rooms", roomCode, "answers", `slot_${slot}`);
          transaction.set(answerRef, {
            slotIndex: slot,
            uid: currentUserId,
            text: botIdea,
            round: currentRound,
            isBot: true,
            createdAt: serverTimestamp()
          });
        }
      }

      const allSubmitted = players.length >= MAX_PLAYERS && players.every(p => p.isSubmitted);

      transaction.update(roomRef, {
        players: players,
        status: allSubmitted ? "revealed" : data.status,
        updatedAt: serverTimestamp()
      });
    });

  } catch (error) {
    console.error("Error adding bots:", error);
    showToast("⚠️ Could not add bots: " + error.message);
  } finally {
    fillBotsBtn.disabled = false;
    fillBotsBtn.textContent = "🤖 Simulate Other Players (Demo)";
  }
}

function checkAndTriggerBotsIfNeeded() {
  if (!currentRoom) return;

  const occupiedSlots = currentRoom.players.map(p => p.slotIndex);
  const neededSlots = [];
  for (let i = 0; i < MAX_PLAYERS; i++) {
    if (!occupiedSlots.includes(i)) {
      neededSlots.push(i);
    }
  }

  if (neededSlots.length === 0) return;

  showToast("🤖 Bot friends are writing their excuses...", 2500);

  // Staggered addition of bot players
  neededSlots.forEach((slot, index) => {
    setTimeout(async () => {
      if (!currentRoom || currentRoom.status === "revealed") return;

      try {
        const roomRef = doc(db, "rooms", currentRoom.code);
        const currentRound = currentRoom.round || 1;

        await runTransaction(db, async (transaction) => {
          const roomDoc = await transaction.get(roomRef);
          if (!roomDoc.exists()) return;

          const data = roomDoc.data();
          const players = [...data.players];

          // Check if slot was filled in the meantime
          if (players.some(p => p.slotIndex === slot)) return;

          const availableNames = SAMPLE_NAMES.filter(n => !players.some(p => p.name === n));
          const botName = getRandomItem(availableNames.length ? availableNames : SAMPLE_NAMES);
          const cat = CATEGORIES[slot];
          const botIdea = getRandomItem(cat.ideas);

          players.push({
            id: "bot_" + Math.random().toString(36).substring(2, 8),
            name: botName,
            avatar: getRandomItem(BOT_AVATARS),
            slotIndex: slot,
            isSubmitted: true,
            isBot: true
          });

          const answerRef = doc(db, "rooms", currentRoom.code, "answers", `slot_${slot}`);
          transaction.set(answerRef, {
            slotIndex: slot,
            uid: currentUserId,
            text: botIdea,
            round: currentRound,
            isBot: true,
            createdAt: serverTimestamp()
          });

          const allSubmitted = players.length >= MAX_PLAYERS && players.every(p => p.isSubmitted);

          transaction.update(roomRef, {
            players: players,
            status: allSubmitted ? "revealed" : data.status,
            updatedAt: serverTimestamp()
          });
        });
      } catch (err) {
        console.warn("Bot simulated player step error:", err);
      }
    }, (index + 1) * 800);
  });
}

// ==========================================================================
// 12. REVEAL SCREEN & SENTENCE ASSEMBLY
// ==========================================================================

let activeRevealSentence = "";

async function enterRevealScreen() {
  if (!currentRoom) return;

  showScreen(screenReveal);
  revealQuestionText.textContent = `"${currentRoom.predicament || PREDICAMENTS[0]}"`;

  try {
    // Read all answers from the 'answers' subcollection
    // Security rules allow everyone to read now because room.status == 'revealed'
    const answersCol = collection(db, "rooms", currentRoom.code, "answers");
    const answersSnap = await getDocs(answersCol);

    const answersMap = {};
    answersSnap.forEach(docSnap => {
      const data = docSnap.data();
      answersMap[data.slotIndex] = data.text;
    });

    // Assemble parts in strict order:
    // Slot 0: Who?
    // Slot 1: Did what?
    // Slot 2: What?
    // Slot 3: Where?
    // Slot 4: Why?
    const orderedParts = [];

    for (let slot = 0; slot < MAX_PLAYERS; slot++) {
      const player = currentRoom.players.find(p => p.slotIndex === slot);
      const cat = CATEGORIES[slot];
      const answerText = answersMap[slot] || localSubmissionCache[slot] || getRandomItem(cat.ideas);

      orderedParts.push({
        slot: slot,
        categoryName: cat.name,
        text: cleanSentencePart(answerText),
        playerName: player ? player.name : "Mystery Guest",
        avatar: player ? player.avatar : "👤"
      });
    }

    // Capitalize first letter of "Who?"
    if (orderedParts[0] && orderedParts[0].text) {
      orderedParts[0].text = orderedParts[0].text.charAt(0).toUpperCase() + orderedParts[0].text.slice(1);
    }

    // Assemble HTML with colored tokens
    let html = "";
    orderedParts.forEach(part => {
      html += `<span class="excuse-token token-part-${part.slot}" title="${escapeHtml(part.categoryName)} by ${escapeHtml(part.playerName)}">${escapeHtml(part.text)}</span> `;
    });
    html = html.trim() + "!";
    completedExcuseContent.innerHTML = html;

    // Plain text for copy/TTS
    activeRevealSentence = orderedParts.map(p => p.text).join(" ") + "!";

    // Render Contributors Breakdown List
    contributorsList.innerHTML = "";
    orderedParts.forEach(part => {
      const badge = document.createElement("div");
      badge.className = `contributor-badge token-part-${part.slot}`;
      badge.innerHTML = `
        <span>${part.avatar}</span>
        <span><strong>${escapeHtml(part.categoryName)}</strong> (${escapeHtml(part.playerName)}): "${escapeHtml(part.text)}"</span>
      `;
      contributorsList.appendChild(badge);
    });

    // Launch celebration confetti!
    startConfetti();

  } catch (err) {
    console.error("Error loading reveal answers from Firestore:", err);
    showToast("⚠️ Could not load all answers: " + err.message);
  }
}

// Copy Plain Text Excuse
copyExcuseBtn.addEventListener("click", () => {
  if (!activeRevealSentence) return;
  copyToClipboard(activeRevealSentence, "📋 Completed excuse copied to clipboard!");
});

// Read Aloud using Web Speech API
readAloudBtn.addEventListener("click", () => {
  if (!("speechSynthesis" in window)) {
    showToast("Speech synthesis not supported in this browser!");
    return;
  }

  if (!activeRevealSentence) return;

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(activeRevealSentence);
  utterance.pitch = 1.1;
  utterance.rate = 0.95;

  window.speechSynthesis.speak(utterance);
  showToast("🔊 Reading the excuse out loud!");
});

// ==========================================================================
// 13. PLAY AGAIN (Category Rotation & Round Reset via Firestore)
// ==========================================================================

playAgainBtn.addEventListener("click", async () => {
  if (!currentRoom) return;

  playAgainBtn.disabled = true;
  playAgainBtn.textContent = "⏳ Starting Round...";

  try {
    const roomRef = doc(db, "rooms", currentRoom.code);

    await runTransaction(db, async (transaction) => {
      const roomDoc = await transaction.get(roomRef);
      if (!roomDoc.exists()) return;

      const data = roomDoc.data();
      const nextIndex = ((data.predicamentIndex || 0) + 1) % PREDICAMENTS.length;
      const newRound = (data.round || 1) + 1;

      // Rotate slots so players get a new category, and reset submission flags
      const rotatedPlayers = data.players.map(p => ({
        ...p,
        slotIndex: (p.slotIndex + 1) % MAX_PLAYERS,
        isSubmitted: false
      }));

      transaction.update(roomRef, {
        predicament: PREDICAMENTS[nextIndex],
        predicamentIndex: nextIndex,
        status: "playing",
        round: newRound,
        players: rotatedPlayers,
        updatedAt: serverTimestamp()
      });
    });

    // Clear local answer input & cache
    playerAnswerInput.value = "";
    Object.keys(localSubmissionCache).forEach(k => delete localSubmissionCache[k]);

    showToast("🎮 New round started! Categories rotated!");

  } catch (error) {
    console.error("Error restarting game:", error);
    showToast("⚠️ Could not restart: " + error.message);
  } finally {
    playAgainBtn.disabled = false;
    playAgainBtn.textContent = "🔄 Play Again";
  }
});

// ==========================================================================
// 14. CLIPBOARD & CONFETTI UTILITIES
// ==========================================================================

function copyToClipboard(text, successMsg) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showToast(successMsg);
    }).catch(() => {
      fallbackCopy(text, successMsg);
    });
  } else {
    fallbackCopy(text, successMsg);
  }
}

function fallbackCopy(text, successMsg) {
  const tempInput = document.createElement("textarea");
  tempInput.value = text;
  document.body.appendChild(tempInput);
  tempInput.select();
  document.execCommand("copy");
  document.body.removeChild(tempInput);
  showToast(successMsg);
}

// Lightweight 60fps Canvas Confetti
function startConfetti() {
  if (!confettiCanvas) return;
  const ctx = confettiCanvas.getContext("2d");

  confettiCanvas.width = window.innerWidth;
  confettiCanvas.height = window.innerHeight;

  const colors = ["#FF4F6E", "#FFBE0B", "#06D6A0", "#3A86FF", "#8338EC"];
  const pieces = [];
  const pieceCount = 90;

  for (let i = 0; i < pieceCount; i++) {
    pieces.push({
      x: window.innerWidth * 0.5 + (Math.random() - 0.5) * 200,
      y: window.innerHeight * 0.4 + (Math.random() - 0.5) * 100,
      vx: (Math.random() - 0.5) * 16,
      vy: (Math.random() - 0.8) * 14,
      size: Math.random() * 9 + 6,
      color: getRandomItem(colors),
      rotation: Math.random() * 360,
      vRotation: (Math.random() - 0.5) * 12,
      gravity: 0.35,
      opacity: 1
    });
  }

  let animationFrame;
  let startTime = Date.now();

  function update() {
    const elapsed = Date.now() - startTime;
    ctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);

    pieces.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.gravity;
      p.rotation += p.vRotation;

      if (elapsed > 2000) {
        p.opacity -= 0.02;
      }

      ctx.save();
      ctx.globalAlpha = Math.max(0, p.opacity);
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rotation * Math.PI) / 180);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.65);
      ctx.restore();
    });

    if (elapsed < 3500) {
      animationFrame = requestAnimationFrame(update);
    } else {
      ctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
      cancelAnimationFrame(animationFrame);
    }
  }

  update();
}

window.addEventListener("resize", () => {
  if (confettiCanvas) {
    confettiCanvas.width = window.innerWidth;
    confettiCanvas.height = window.innerHeight;
  }
});

// Run initialization on DOM load
document.addEventListener("DOMContentLoaded", () => {
  initAuth();
  initWelcomeScreen();
});
