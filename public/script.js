// ---------- grab page elements ----------
const sosBtn = document.getElementById("sos-btn");
const sosStatus = document.getElementById("sos-status");
const addBtn = document.getElementById("add-btn");
const contactList = document.getElementById("contact-list");
const contactMsg = document.getElementById("contact-msg");

// ---------- last known location (used by the WhatsApp button) ----------
let lastLocation = null;

// ---------- WhatsApp alert ----------
// Opens WhatsApp with the alert already typed. The user taps Send.
function openWhatsApp(contact) {
  const who = currentUser ? currentUser.name : "Your contact";
  const where = lastLocation
    ? `My location: https://maps.google.com/?q=${lastLocation.lat},${lastLocation.lng}`
    : "I could not get my location.";
  const text = `${who} here. I need help. ${where} Please call me now.`;

  let number = contact.phone.replace(/\D/g, "");
  if (number.length === 10) number = "91" + number;
  else if (number.length === 11 && number.startsWith("0")) number = "91" + number.slice(1);

  // Open first (browsers block popups that wait), then refresh the location for next time.
  window.open(`https://wa.me/${number}?text=${encodeURIComponent(text)}`, "_blank");
  getLocation();
}

// ---------- login state ----------
let token = localStorage.getItem("safeher-token");
let currentUser = null;

// Like fetch, but sends the login token. If the server says we are not
// logged in (401), we go back to the login screen.
async function api(path, options = {}) {
  options.headers = { ...(options.headers || {}), Authorization: "Bearer " + token };
  const res = await fetch(path, options);
  if (res.status === 401) logout();
  return res;
}

// ---------- contacts ----------
async function loadContacts() {
  const res = await api("/api/contacts");
  const contacts = await res.json();
  contactList.innerHTML = "";

  if (contacts.length === 0) {
    contactList.innerHTML = "<li>No contacts yet. Add someone you trust above.</li>";
    return;
  }

  contacts.forEach((c) => {
    const li = document.createElement("li");
    const info = document.createElement("div");
    info.innerHTML = `<strong></strong><small></small>`;
    info.querySelector("strong").textContent = c.name;
    info.querySelector("small").textContent = c.email + (c.phone ? " | " + c.phone : "");

    const del = document.createElement("button");
    del.textContent = "Remove";
    del.className = "mini";
    del.addEventListener("click", async () => {
      await api("/api/contacts/" + c.id, { method: "DELETE" });
      loadContacts();
    });

    const actions = document.createElement("div");
    actions.className = "row-actions";
    if (c.phone) {
      const wa = document.createElement("button");
      wa.textContent = "WhatsApp";
      wa.className = "mini wa";
      wa.addEventListener("click", () => openWhatsApp(c));
      actions.appendChild(wa);
    }
    actions.appendChild(del);

    li.append(info, actions);
    contactList.appendChild(li);
  });
}

addBtn.addEventListener("click", async () => {
  const name = document.getElementById("c-name").value.trim();
  const phone = document.getElementById("c-phone").value.trim();
  const email = document.getElementById("c-email").value.trim();
  contactMsg.textContent = "";

  if (!name || !email) {
    contactMsg.textContent = "Please enter a name and an email.";
    return;
  }

  const res = await api("/api/contacts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, phone, email }),
  });

  if (!res.ok) {
    const data = await res.json();
    contactMsg.textContent = data.error || "Could not add contact.";
    return;
  }

  document.getElementById("c-name").value = "";
  document.getElementById("c-phone").value = "";
  document.getElementById("c-email").value = "";
  loadContacts();
});

// ---------- SOS ----------
function setStatus(text, type) {
  sosStatus.textContent = text;
  sosStatus.className = type || "";
}

function getLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        lastLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        resolve(lastLocation);
      },
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

async function sendSOS() {
  sosBtn.disabled = true;
  setStatus("Getting your location...");

  const location = await getLocation();
  if (!location) {
    setStatus("Location not available. Sending alert without it...");
  }

  const res = await api("/api/sos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      lat: location ? location.lat : null,
      lng: location ? location.lng : null,
    }),
  });
  const data = await res.json();

  if (res.ok) {
    const note = data.testMode ? " (test mode: check the terminal)" : "";
    setStatus(`Alert sent to ${data.sent} contact(s).${note}`, "ok");
  } else {
    setStatus(data.error || "Something went wrong. Call 112 now.", "error");
  }
  sosBtn.disabled = false;
}

sosBtn.addEventListener("click", sendSOS);

// ---------- nearby help links ----------
function setHelpLinks(lat, lng) {
  const at = lat && lng ? `/@${lat},${lng},14z` : "";
  const base = "https://www.google.com/maps/search/";
  const suffix = lat && lng ? "" : "+near+me";
  document.getElementById("link-police").href = base + "police+station" + suffix + at;
  document.getElementById("link-hospital").href = base + "hospital" + suffix + at;
  document.getElementById("link-pharmacy").href = base + "pharmacy" + suffix + at;
}

setHelpLinks();
getLocation().then((loc) => {
  if (loc) setHelpLinks(loc.lat, loc.lng);
});


// ---------- safe-journey timer ----------
const journeySetup = document.getElementById("journey-setup");
const journeyActive = document.getElementById("journey-active");
const journeyTime = document.getElementById("journey-time");
const journeyMsg = document.getElementById("journey-msg");

function setJourneyMsg(text, type) {
  journeyMsg.textContent = text;
  journeyMsg.className = type || "";
}

function showJourney(state, endsAt) {
  const running = state === "active";
  journeySetup.hidden = running;
  journeyActive.hidden = !running;

  if (running) {
    const secs = Math.max(0, Math.round((endsAt - Date.now()) / 1000));
    const mm = String(Math.floor(secs / 60)).padStart(2, "0");
    const ss = String(secs % 60).padStart(2, "0");
    journeyTime.textContent = `${mm}:${ss}`;
  }
  if (state === "alerted") {
    setJourneyMsg("Time ran out. Your contacts were alerted.", "error");
  }
}

// Ask the server for the timer state (works even after a page refresh).
async function refreshJourney() {
  const res = await api("/api/journey");
  const data = await res.json();
  showJourney(data.status, data.endsAt);
}

document.getElementById("journey-start").addEventListener("click", async () => {
  setJourneyMsg("Getting your location...");
  const location = await getLocation();

  const res = await api("/api/journey/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      minutes: document.getElementById("journey-mins").value,
      lat: location ? location.lat : null,
      lng: location ? location.lng : null,
    }),
  });
  const data = await res.json();

  if (!res.ok) {
    setJourneyMsg(data.error || "Could not start the journey.", "error");
    return;
  }
  setJourneyMsg("Journey started. Stay safe!", "ok");
  showJourney("active", data.endsAt);
});

document.getElementById("journey-cancel").addEventListener("click", async () => {
  await api("/api/journey/cancel", { method: "POST" });
  setJourneyMsg("Glad you're safe. Timer cancelled.", "ok");
  showJourney("none");
});

setInterval(() => { if (currentUser) refreshJourney(); }, 1000);

// ---------- quick tools: sound helpers ----------
// Browsers only allow sound after a tap, so we create the audio inside button clicks.
let audioCtx = null;
function getAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

const toolsMsg = document.getElementById("tools-msg");

// ---------- loud siren ----------
const sirenBtn = document.getElementById("siren-btn");
let sirenOsc = null;
let sirenTimer = null;

function startSiren() {
  const ctx = getAudio();
  sirenOsc = ctx.createOscillator();
  sirenOsc.type = "sawtooth";
  sirenOsc.frequency.value = 700;
  sirenOsc.connect(ctx.destination);
  sirenOsc.start();

  let high = false;
  sirenTimer = setInterval(() => {
    high = !high;
    sirenOsc.frequency.setValueAtTime(high ? 1000 : 700, ctx.currentTime);
  }, 450);

  sirenBtn.textContent = "Stop siren";
  sirenBtn.classList.add("on");
}

function stopSiren() {
  clearInterval(sirenTimer);
  if (sirenOsc) sirenOsc.stop();
  sirenOsc = null;
  sirenBtn.textContent = "Start loud siren";
  sirenBtn.classList.remove("on");
}

sirenBtn.addEventListener("click", () => {
  if (sirenOsc) stopSiren();
  else startSiren();
});

// ---------- fake incoming call ----------
const callScreen = document.getElementById("call-screen");
const callStatus = document.getElementById("call-status");
const callName = document.getElementById("call-name");
const acceptBtn = document.getElementById("call-accept");
const declineBtn = document.getElementById("call-decline");
const endBtn = document.getElementById("call-end");
let ringTimer = null;
let callClock = null;

function ringOnce() {
  const ctx = getAudio();
  [0, 0.35].forEach((offset) => {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = 880;
    osc.connect(ctx.destination);
    osc.start(ctx.currentTime + offset);
    osc.stop(ctx.currentTime + offset + 0.25);
  });
  if (navigator.vibrate) navigator.vibrate([400, 200, 400]);
}

function showIncomingCall() {
  callName.textContent = document.getElementById("fake-name").value.trim() || "Mom";
  callStatus.textContent = "Incoming call";
  acceptBtn.hidden = false;
  declineBtn.hidden = false;
  endBtn.hidden = true;
  callScreen.hidden = false;
  ringOnce();
  ringTimer = setInterval(ringOnce, 2000);
}

function closeCall() {
  clearInterval(ringTimer);
  clearInterval(callClock);
  if (navigator.vibrate) navigator.vibrate(0);
  callScreen.hidden = true;
}

acceptBtn.addEventListener("click", () => {
  clearInterval(ringTimer);
  if (navigator.vibrate) navigator.vibrate(0);
  acceptBtn.hidden = true;
  declineBtn.hidden = true;
  endBtn.hidden = false;

  let seconds = 0;
  callStatus.textContent = "00:00";
  callClock = setInterval(() => {
    seconds++;
    const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
    const ss = String(seconds % 60).padStart(2, "0");
    callStatus.textContent = `${mm}:${ss}`;
  }, 1000);
});

declineBtn.addEventListener("click", closeCall);
endBtn.addEventListener("click", closeCall);

document.getElementById("fake-btn").addEventListener("click", () => {
  getAudio(); // unlock sound now, while we have a tap
  const delay = Number(document.getElementById("fake-delay").value);
  toolsMsg.textContent = delay
    ? `Fake call will ring in ${delay} seconds.`
    : "";
  setTimeout(() => {
    toolsMsg.textContent = "";
    showIncomingCall();
  }, delay * 1000);
});

// ---------- login and register ----------
const authScreen = document.getElementById("auth-screen");
const appArea = document.getElementById("app");
const authMsg = document.getElementById("auth-msg");
let authMode = "login";

function setAuthMode(mode) {
  authMode = mode;
  const reg = mode === "register";
  document.getElementById("auth-name-row").hidden = !reg;
  document.getElementById("auth-title").textContent = reg ? "Create your account" : "Log in";
  document.getElementById("auth-submit").textContent = reg ? "Create account" : "Log in";
  document.getElementById("auth-switch").textContent = reg
    ? "I already have an account"
    : "Create a new account";
  authMsg.textContent = "";
}

function showApp(user) {
  currentUser = user;
  authScreen.hidden = true;
  appArea.hidden = false;
  document.getElementById("who").textContent = "Signed in as " + user.name;
  loadContacts();
  refreshJourney();
}

function logout() {
  token = null;
  currentUser = null;
  localStorage.removeItem("safeher-token");
  appArea.hidden = true;
  authScreen.hidden = false;
  document.getElementById("auth-password").value = "";
  setAuthMode("login");
}

document.getElementById("auth-switch").addEventListener("click", () => {
  setAuthMode(authMode === "login" ? "register" : "login");
});

async function submitAuth() {
  authMsg.textContent = "";
  const body = {
    email: document.getElementById("auth-email").value,
    password: document.getElementById("auth-password").value,
  };
  if (authMode === "register") body.name = document.getElementById("auth-name").value;

  const res = await fetch("/api/" + authMode, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();

  if (!res.ok) {
    authMsg.textContent = data.error || "Something went wrong. Try again.";
    return;
  }
  token = data.token;
  localStorage.setItem("safeher-token", token);
  document.getElementById("auth-password").value = "";
  showApp(data.user);
}

document.getElementById("auth-submit").addEventListener("click", submitAuth);
document.getElementById("auth-password").addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitAuth();
});
document.getElementById("logout-btn").addEventListener("click", logout);

// On page load: if we already have a token, check it and go straight in.
(async function start() {
  if (!token) return logout();
  const res = await fetch("/api/me", { headers: { Authorization: "Bearer " + token } });
  if (res.ok) showApp(await res.json());
  else logout();
})();
