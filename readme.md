# MedTracker

A full-stack medication tracking app with real-time reminders, dose history, and adherence analytics — built to solve a real problem: remembering to actually take your meds on time, with a system that follows up if you don't.

## Features

- 🔔 **Real-time alerts** via browser notifications and web push
- ⏰ **Snooze functionality** — postpone a reminder without losing track of it
- 📊 **Dose history & adherence analytics** — see what you've taken and what you've missed over time
- 💾 **Persistent storage** — schedules and history survive refreshes and sessions
- 🔁 **Reliable scheduling** — background job queue ensures reminders fire even if the app isn't open

## Tech Stack

**Frontend**
- React
- Browser Notifications API

**Backend**
- Node.js / Express
- PostgreSQL
- [BullMQ](https://docs.bullmq.io/) — job queue for scheduled/recurring reminders
- [web-push](https://github.com/web-push-libs/web-push) — push notifications even when the tab is closed

## Architecture

A four-layer backend design:
1. **API layer** — Express routes for medications, schedules, and dose logs
2. **Scheduling layer** — BullMQ jobs trigger reminders at the correct time, with retry/snooze logic
3. **Notification layer** — web-push delivers alerts to the browser/device
4. **Data layer** — PostgreSQL stores medications, schedules, and adherence history

## Getting Started

### Prerequisites
- Node.js (v18+)
- PostgreSQL instance
- VAPID keys for web-push (generate with `npx web-push generate-vapid-keys`)

### Setup

```bash
# Clone the repo
git clone https://github.com/cheron2000/medtracker.git
cd medtracker

# Install dependencies
npm install

# Configure environment variables
cp .env.example .env
# add DATABASE_URL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY

# Run database migrations
npm run db:migrate

# Start Redis (required by BullMQ) and the app
npm run dev
```

## Roadmap

- [ ] Multi-user support with auth
- [ ] Mobile app / PWA support
- [ ] Caregiver view for tracking a dependent's adherence

## License

MIT
