# SafeHer

A women's safety web app. With one tap, it sends your live location to the people you trust. It also has a safe-journey timer, a siren, and a fake incoming call.

## Features

- **SOS button**: emails your location (as a Google Maps link) to all your trusted contacts
- **WhatsApp alert**: opens WhatsApp with the message and your location already typed
- **Safe-journey timer**: set how long a trip will take; if you don't tap "I'm safe" in time, your contacts are alerted automatically
- **Siren**: a loud alarm to attract attention
- **Fake call**: a fake incoming call screen with a ringtone, to leave an uncomfortable situation
- **Nearby help**: quick links to police stations, hospitals and pharmacies on Google Maps
- **Accounts**: register and log in; every user has their own private contacts

## Tech stack

- **Backend:** Node.js, Express
- **Database:** MongoDB (Mongoose)
- **Auth:** JWT tokens, passwords hashed with bcrypt
- **Email:** Nodemailer (Gmail)
- **Frontend:** HTML, CSS and JavaScript (no framework), browser Geolocation API

## Run it on your computer

You need [Node.js](https://nodejs.org) and a MongoDB database (a free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster works).

1. Download the project and open a terminal in its folder.
2. Install the libraries:
   ```
   npm install
   ```
3. Copy `.env.example` to a new file named `.env` and fill it in:

   | Name | What it is |
   |---|---|
   | `MONGODB_URI` | Your MongoDB connection string, ending in `/safeher?...` |
   | `JWT_SECRET` | Any long random text; it signs the login tokens |
   | `EMAIL_USER` | The Gmail address that sends alerts (optional) |
   | `EMAIL_PASS` | A Gmail **App password** (optional) |
   | `PORT` | Port number, default 3000 |

   If you leave the email lines empty, alerts are printed in the terminal instead of being emailed ("test mode").
4. Start the server:
   ```
   npm start
   ```
5. Open http://localhost:3000, create an account, add a contact, and press SOS.

## Project structure

```
safeher/
├── server.js          Express server, API routes, MongoDB model
├── package.json
├── .env.example       Template for your own .env file
└── public/
    ├── index.html     The page
    ├── style.css      Styling
    └── script.js      Browser logic (SOS, timer, login, siren, fake call)
```

## API overview

| Method | Route | What it does |
|---|---|---|
| POST | `/api/register`, `/api/login` | Create an account / log in, returns a token |
| GET | `/api/me` | Current user |
| GET, POST, DELETE | `/api/contacts` | Manage your trusted contacts |
| POST | `/api/sos` | Send an SOS alert |
| GET, POST | `/api/journey`, `/api/journey/start`, `/api/journey/cancel` | Safe-journey timer |

All routes except register and login need a valid login token.

## Known limitations

- Alerts go by email and WhatsApp only; there is no SMS yet.
- The location in an alert is a single reading, not a live track.
- Journey timers are kept in server memory, so restarting the server clears them.
- Geolocation in browsers needs `localhost` or HTTPS.

## Ideas for the future

- Live location link that contacts can follow on a map
- SMS alerts
- Shake-to-send SOS on phones
- A map of unsafe areas reported by users

## Important

This app supports, but does not replace, emergency services. In an emergency in India, call **112** first.
