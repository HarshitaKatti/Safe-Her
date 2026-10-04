require("dotenv").config();
const express = require("express");
const path = require("path");
const nodemailer = require("nodemailer");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

if (!process.env.JWT_SECRET) {
  console.log("Note: set JWT_SECRET in .env before you share or deploy this app.");
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ---------- database model ----------
// A User document holds the account details and that user's own contacts.
const contactSchema = new mongoose.Schema(
  { id: String, name: String, phone: String, email: String },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    contacts: [contactSchema],
  },
  { timestamps: true }
);

const User = mongoose.model("User", userSchema);

function makeToken(user) {
  return jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: "7d" });
}

// Express 4 does not catch errors inside async routes, so wrap them.
// Any error is passed to the error handler at the bottom of this file.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- login check: runs before every protected route ----------
async function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Please log in." });

  try {
    const { id } = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(id);
    if (!user) return res.status(401).json({ error: "Please log in again." });
    req.user = user;
    next();
  } catch (err) {
    res.status(401).json({ error: "Please log in again." });
  }
}

// ---------- helper: send an alert email to a list of contacts ----------
async function sendAlert(contacts, subject, text) {
  // No email set up yet? Print the alert in the terminal so you can test.
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.log("\n--- ALERT (test mode, no email configured) ---");
    console.log("To:", contacts.map((c) => c.email).join(", "));
    console.log(text);
    return { sent: contacts.length, testMode: true };
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });

  await Promise.all(
    contacts.map((c) =>
      transporter.sendMail({ from: process.env.EMAIL_USER, to: c.email, subject, text })
    )
  );
  return { sent: contacts.length, testMode: false };
}

function locationText(lat, lng) {
  return lat && lng
    ? `Location: https://maps.google.com/?q=${lat},${lng}`
    : "Location could not be found.";
}

// ---------- register and login ----------
app.post("/api/register", wrap(async (req, res) => {
  const name = (req.body.name || "").trim();
  const email = (req.body.email || "").trim().toLowerCase();
  const password = req.body.password || "";

  if (!name || !email.includes("@")) {
    return res.status(400).json({ error: "Enter your name and a valid email." });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters." });
  }
  if (await User.findOne({ email })) {
    return res.status(409).json({ error: "An account with this email already exists." });
  }

  // Never store the real password, only a hash of it.
  const passwordHash = bcrypt.hashSync(password, 10);
  const user = await User.create({ name, email, passwordHash });

  res.status(201).json({ token: makeToken(user), user: { name: user.name, email: user.email } });
}));

app.post("/api/login", wrap(async (req, res) => {
  const email = (req.body.email || "").trim().toLowerCase();
  const password = req.body.password || "";

  const user = await User.findOne({ email });
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: "Wrong email or password." });
  }
  res.json({ token: makeToken(user), user: { name: user.name, email: user.email } });
}));

app.get("/api/me", auth, (req, res) => {
  res.json({ name: req.user.name, email: req.user.email });
});

// ---------- contacts API (only this user's contacts) ----------
app.get("/api/contacts", auth, (req, res) => {
  res.json(req.user.contacts);
});

app.post("/api/contacts", auth, wrap(async (req, res) => {
  const { name, phone, email } = req.body;
  if (!name || !email) {
    return res.status(400).json({ error: "Name and email are required." });
  }
  const contact = { id: Date.now().toString(), name, phone: phone || "", email };
  req.user.contacts.push(contact);
  await req.user.save();
  res.status(201).json(contact);
}));

app.delete("/api/contacts/:id", auth, wrap(async (req, res) => {
  req.user.contacts = req.user.contacts.filter((c) => c.id !== req.params.id);
  await req.user.save();
  res.json({ ok: true });
}));

// ---------- SOS API ----------
app.post("/api/sos", auth, wrap(async (req, res) => {
  const { lat, lng } = req.body;

  if (req.user.contacts.length === 0) {
    return res.status(400).json({ error: "Add at least one trusted contact first." });
  }

  const text =
    `${req.user.name} needs help right now!\n${locationText(lat, lng)}\n` +
    `Please call them or contact the police (112).`;

  try {
    res.json(await sendAlert(req.user.contacts, "SOS: I need help", text));
  } catch (err) {
    console.error("Email error:", err.message);
    res.status(500).json({ error: "Could not send the alert. Check your email settings." });
  }
}));

// ---------- Safe-journey timer API ----------
// One timer per user, kept in memory (restarting the server clears them).
const journeys = {}; // userId -> { status, endsAt, timeoutId }

app.get("/api/journey", auth, (req, res) => {
  const j = journeys[req.user.id];
  if (!j) return res.json({ status: "none" });
  res.json({ status: j.status, endsAt: j.endsAt });
});

app.post("/api/journey/start", auth, (req, res) => {
  const { minutes, lat, lng } = req.body;
  const mins = Number(minutes);
  const id = req.user.id;

  if (!mins || mins < 1 || mins > 720) {
    return res.status(400).json({ error: "Enter minutes between 1 and 720." });
  }
  if (req.user.contacts.length === 0) {
    return res.status(400).json({ error: "Add at least one trusted contact first." });
  }
  if (journeys[id] && journeys[id].timeoutId) clearTimeout(journeys[id].timeoutId);

  const endsAt = Date.now() + mins * 60 * 1000;
  journeys[id] = { status: "active", endsAt };

  // When time runs out, load the user again (their contacts may have changed)
  // and send the alert automatically.
  journeys[id].timeoutId = setTimeout(async () => {
    try {
      const user = await User.findById(id);
      if (!user) return;
      const text =
        `${user.name} started a safe journey but did not check in on time.\n` +
        `Last known ${locationText(lat, lng)}\n` +
        `Please call them now. If you cannot reach them, contact the police (112).`;
      await sendAlert(user.contacts, "SAFETY ALERT: missed check-in", text);
      journeys[id].status = "alerted";
    } catch (err) {
      console.error("Journey alert failed:", err.message);
      journeys[id].status = "failed";
    }
  }, mins * 60 * 1000);

  res.json({ status: "active", endsAt });
});

app.post("/api/journey/cancel", auth, (req, res) => {
  const j = journeys[req.user.id];
  if (j && j.timeoutId) clearTimeout(j.timeoutId);
  delete journeys[req.user.id];
  res.json({ status: "none" });
});

// ---------- last resort: any unexpected error ends up here ----------
app.use((err, req, res, next) => {
  console.error("Server error:", err.message);
  res.status(500).json({ error: "Something went wrong on the server. Try again." });
});

// ---------- connect to MongoDB, then start the server ----------
if (!process.env.MONGODB_URI) {
  console.error("MONGODB_URI is missing. Add it to your .env file (see .env.example).");
  process.exit(1);
}

mongoose
  .connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 })
  .then(() => {
    console.log("Connected to MongoDB");
    app.listen(PORT, () => console.log(`SafeHer running at http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error("Could not connect to MongoDB:", err.message);
    process.exit(1);
  });
