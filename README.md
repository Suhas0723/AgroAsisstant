# AgroAssistant

Farming assistant web app: AI chatbot, crop tracking, plot mapping, irrigation/fertilizer calendar with an AI scheduler, plant disease diagnosis, and weather/soil data.

## Local setup

1. `pip install -r requirements.txt`
2. Copy `.env.example` to `.env` and fill in the keys. For the Firebase Admin key you can either paste the JSON into `FIREBASE_SERVICE_ACCOUNT_JSON` or set `GOOGLE_APPLICATION_CREDENTIALS` to the path of the downloaded key file (keep it outside the repo).
3. `python app.py` (set `FLASK_DEBUG=1` in `.env` for debug mode)

Never commit `.env`, `auth.yaml`, or any service-account JSON — they are git-ignored.

## Deploying

See [DEPLOYMENT.md](DEPLOYMENT.md). All secrets are read from environment variables.

## Security notes

- The server only trusts Firebase **ID tokens** (verified with the Admin SDK) — never a raw `uid` from the browser.
- Browsers never read or write Firestore directly; deploy `firestore.rules` (deny-all) to enforce that.
- OpenAI usage is capped per user per day (`AI_DAILY_LIMIT`).
- Restrict the browser API keys (`FIREBASE_API_KEY`, `GOOGLE_API_KEY`, `GOOGLE_MAPS_API_KEY`) to your domain in Google Cloud Console → Credentials.
