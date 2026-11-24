import base64
import io
import json
import logging
import math
import os
import re
from datetime import date, datetime
from functools import wraps

import firebase_admin
import requests
from firebase_admin import auth as fb_auth
from firebase_admin import credentials, firestore
from flask import (Flask, jsonify, redirect, render_template, request,
                   send_from_directory, session, url_for)
from google.cloud.firestore_v1.base_query import FieldFilter
from openai import OpenAI
from PIL import Image, UnidentifiedImageError

try:  # optional: load a local .env file during development
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("agroassistant")

# ---------------------------------------------------------------------------
# Configuration — every secret comes from environment variables.
# See .env.example for the full list. Nothing secret lives in the repo.
# ---------------------------------------------------------------------------


def env(name, default=None, required=True):
    value = os.environ.get(name, default)
    if required and not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


app = Flask(__name__)
app.secret_key = env("FLASK_SECRET_KEY")
app.config.update(
    MAX_CONTENT_LENGTH=10 * 1024 * 1024,  # 10 MB upload cap
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=bool(os.environ.get("VERCEL")) or os.environ.get("SESSION_COOKIE_SECURE") == "1",
)

OPENAI_API_KEY = env("OPENAI_API_KEY")
STORMGLASS_API_KEY = env("STORMGLASS_API_KEY")
WEATHERAPI_KEY = env("WEATHERAPI_KEY")
TREFLE_API_KEY = env("TREFLE_API_KEY")
PLANT_ID_API_KEY = env("PLANT_ID_API_KEY")
GOOGLE_API_KEY = env("GOOGLE_API_KEY")          # browser key, used for geocoding on signup
GOOGLE_MAPS_API_KEY = env("GOOGLE_MAPS_API_KEY")  # browser key, used on the plots map
AI_DAILY_LIMIT = int(os.environ.get("AI_DAILY_LIMIT", "60"))  # OpenAI calls per user per day

# Firebase web config is public by design (it ships to every browser);
# access is controlled by Firebase Auth + Firestore rules, not by hiding it.
firebase_config = {
    "apiKey": env("FIREBASE_API_KEY"),
    "authDomain": env("FIREBASE_AUTH_DOMAIN"),
    "projectId": env("FIREBASE_PROJECT_ID"),
    "storageBucket": env("FIREBASE_STORAGE_BUCKET", required=False),
    "messagingSenderId": env("FIREBASE_MESSAGING_SENDER_ID", required=False),
    "appId": env("FIREBASE_APP_ID"),
    "measurementId": env("FIREBASE_MEASUREMENT_ID", required=False),
}


def load_service_account():
    """FIREBASE_SERVICE_ACCOUNT_JSON may hold the raw JSON or a base64 copy of it.
    Locally you can instead point GOOGLE_APPLICATION_CREDENTIALS at the JSON file."""
    raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON", "").strip()
    if raw:
        if not raw.startswith("{"):
            raw = base64.b64decode(raw).decode("utf-8")
        return credentials.Certificate(json.loads(raw))
    path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if path and os.path.exists(path):
        return credentials.Certificate(path)
    raise RuntimeError("Set FIREBASE_SERVICE_ACCOUNT_JSON (or GOOGLE_APPLICATION_CREDENTIALS for local dev)")


firebase_admin.initialize_app(load_service_account())
db = firestore.client()
openai_client = OpenAI(api_key=OPENAI_API_KEY)

HTTP_TIMEOUT = 15


@app.after_request
def security_headers(resp):
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("X-Frame-Options", "DENY")
    resp.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    return resp


@app.errorhandler(413)
def too_large(_):
    if request.path.startswith("/api/") or request.is_json:
        return jsonify({"error": "Upload too large (max 10 MB)."}), 413
    return render_template("diagnosis.html", error="Image too large (max 10 MB).",
                           username=session.get("currentUser", {}).get("name", "")), 413


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------

def current_uid():
    return session.get("currentUser", {}).get("uid")


def login_required(view):
    """For HTML pages: redirect to the sign-in page when not logged in."""
    @wraps(view)
    def wrapper(*args, **kwargs):
        if not current_uid():
            return redirect(url_for("signup"))
        return view(*args, **kwargs)
    return wrapper


def api_login_required(view):
    """For JSON/API endpoints: 401 when not logged in."""
    @wraps(view)
    def wrapper(*args, **kwargs):
        if not current_uid():
            return jsonify({"error": "Not logged in"}), 401
        return view(*args, **kwargs)
    return wrapper


def verify_request_token():
    """Verify the Firebase ID token sent by the browser. Returns the decoded token or None."""
    data = request.get_json(silent=True) or {}
    token = data.get("idToken")
    if not token or not isinstance(token, str):
        return None, data
    try:
        return fb_auth.verify_id_token(token), data
    except Exception:
        log.warning("Rejected invalid Firebase ID token")
        return None, data


def username():
    return session.get("currentUser", {}).get("name", "")


# ---------------------------------------------------------------------------
# OpenAI with a per-user daily quota (stored in Firestore so it works on serverless)
# ---------------------------------------------------------------------------

class QuotaExceeded(Exception):
    pass


def consume_ai_quota(uid):
    ref = db.collection("usage").document(f"{uid}-{date.today()}")

    @firestore.transactional
    def txn(transaction):
        snap = ref.get(transaction=transaction)
        count = (snap.to_dict() or {}).get("openai", 0) if snap.exists else 0
        if count >= AI_DAILY_LIMIT:
            return False
        transaction.set(ref, {"openai": count + 1, "uid": uid, "date": str(date.today())}, merge=True)
        return True

    if not txn(db.transaction()):
        raise QuotaExceeded()


def ask_openai(uid, system, user, json_mode=False):
    consume_ai_quota(uid)
    kwargs = {"response_format": {"type": "json_object"}} if json_mode else {}
    completion = openai_client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        **kwargs,
    )
    return completion.choices[0].message.content or ""


QUOTA_MSG = "Daily AI limit reached. Please try again tomorrow."

# ---------------------------------------------------------------------------
# Weather / soil data (cached once per user per day in Firestore)
# ---------------------------------------------------------------------------

DEFAULT_COORDS = (33.7501, -84.3885)  # Atlanta, GA


def user_coords(user):
    coords = (user or {}).get("coordinates")
    try:
        return float(coords[0]), float(coords[1])
    except (TypeError, ValueError, IndexError, KeyError):
        return DEFAULT_COORDS


def get_stormglass(lat, lng):
    resp = requests.get(
        "https://api.stormglass.io/v2/bio/point",
        params={"lat": lat, "lng": lng, "params": "soilMoisture,soilTemperature"},
        headers={"Authorization": STORMGLASS_API_KEY},
        timeout=HTTP_TIMEOUT,
    )
    data = resp.json()
    if not resp.ok or not data.get("hours"):
        raise RuntimeError(f"Stormglass error {resp.status_code}: {data.get('errors')}")
    return data


def get_weatherapi_averages(query):
    resp = requests.get(
        "https://api.weatherapi.com/v1/forecast.json",
        params={"key": WEATHERAPI_KEY, "q": query, "days": 3},
        timeout=HTTP_TIMEOUT,
    )
    weather = resp.json()
    if not resp.ok or "forecast" not in weather:
        raise RuntimeError(f"WeatherAPI error {resp.status_code}: {weather.get('error')}")

    daily = []
    for day in weather["forecast"]["forecastday"]:
        hours = day["hour"] or [{}]
        n = len(hours)
        daily.append({
            "date": day["date"],
            "averageTemperature": round(sum(h.get("temp_c", 0) for h in hours) / n, 2),
            "averageCloud": round(sum(h.get("cloud", 0) for h in hours) / n, 2),
            "averagePrecip": round(sum(h.get("precip_in", 0) for h in hours) / n, 2),  # hourly average
            "totalPrecip": day["day"].get("totalprecip_in", 0),                         # daily total (in)
            "UV": day["day"].get("uv"),
        })
    return {"daily_averages": daily}


def ensure_daily_data(uid, user=None):
    """Fetch today's soil + weather data if we don't already have it. Never stores error payloads."""
    doc_id = f"{date.today()}-{uid}"
    sg_ref = db.collection("stormglass_data").document(doc_id)
    wx_ref = db.collection("weatherapi_data").document(doc_id)
    sg_snap, wx_snap = sg_ref.get(), wx_ref.get()
    sg, wx = sg_snap.to_dict() if sg_snap.exists else None, wx_snap.to_dict() if wx_snap.exists else None

    if sg is None or wx is None:
        if user is None:
            user = db.collection("users").document(uid).get().to_dict() or {}
        lat, lng = user_coords(user)
    if sg is None:
        try:
            sg = get_stormglass(lat, lng)
            sg_ref.set(sg)
        except Exception:
            log.exception("Stormglass fetch failed")
            sg = {}
    if wx is None:
        try:
            city = (user.get("address") or {}).get("city")
            wx = get_weatherapi_averages(city or f"{lat},{lng}")
            wx_ref.set(wx)
        except Exception:
            log.exception("WeatherAPI fetch failed")
            wx = {}
    return sg, wx


def current_conditions(uid):
    sg, wx = ensure_daily_data(uid)
    hours = sg.get("hours") or [{}]
    days = wx.get("daily_averages") or [{}]
    return {
        "soilMoisture": (hours[0].get("soilMoisture") or {}).get("sg", 0.0),
        "avgCloud": days[0].get("averageCloud", 0.0),
        "avgPrecip": days[0].get("averagePrecip", 0.0),
        "totalPrecip": days[0].get("totalPrecip", 0.0),
        "avgTemp": days[0].get("averageTemperature", 0.0),
    }


def first_source(values):
    values = values or {}
    for key in ("noaa", "sg"):
        if values.get(key) is not None:
            return values[key]
    return next(iter(values.values()), None)


# ---------------------------------------------------------------------------
# Plants
# ---------------------------------------------------------------------------

def user_plants(uid):
    """All plant docs belonging to a user (indexed query instead of scanning every user's docs)."""
    docs = db.collection("plant_data").where(filter=FieldFilter("uid", "==", uid)).stream()
    return [d.to_dict() for d in docs]


def plant_ref_for(uid, slug):
    """Plant docs are stored as '<slug>-<uid>'; confirm ownership before returning."""
    if not slug or not isinstance(slug, str) or "/" in slug:
        return None
    ref = db.collection("plant_data").document(f"{slug}-{uid}")
    snap = ref.get()
    if snap.exists and (snap.to_dict() or {}).get("uid") == uid:
        return ref
    return None


def trefle_get(path, **params):
    resp = requests.get(f"https://trefle.io/api/v1/{path}",
                        headers={"Authorization": f"Bearer {TREFLE_API_KEY}"},
                        params=params, timeout=HTTP_TIMEOUT)
    resp.raise_for_status()
    return resp.json()


def lookup_plant(name):
    """Try the name as a Trefle slug first, then fall back to a search."""
    slug = name.lower().strip().replace(" ", "-")
    try:
        data = trefle_get(f"plants/{slug}")
        if data.get("data"):
            return data["data"]
    except requests.RequestException:
        pass
    try:
        results = trefle_get("plants/search", q=name).get("data") or []
        if results:
            return trefle_get(f"plants/{results[0]['id']}").get("data")
    except requests.RequestException:
        log.exception("Trefle search failed")
    return None


# ---------------------------------------------------------------------------
# Geometry
# ---------------------------------------------------------------------------

EARTH_R = 6371000.0
SQM_PER_ACRE = 4046.8564224


def bbox_acres(ne_lat, ne_long, sw_lat, sw_long):
    ne_lat, ne_long, sw_lat, sw_long = map(float, (ne_lat, ne_long, sw_lat, sw_long))
    height = EARTH_R * math.radians(abs(ne_lat - sw_lat))
    width = EARTH_R * math.radians(abs(ne_long - sw_long)) * math.cos(math.radians((ne_lat + sw_lat) / 2))
    return round(width * height / SQM_PER_ACRE, 2)


def polygon_acres(points):
    """Shoelace formula on a local equirectangular projection (accurate for field-sized plots).
    points: list of {'lat':..,'lng':..}"""
    if len(points) < 3:
        return None
    lat0 = math.radians(sum(p["lat"] for p in points) / len(points))
    xy = [(EARTH_R * math.radians(p["lng"]) * math.cos(lat0), EARTH_R * math.radians(p["lat"])) for p in points]
    area = 0.0
    for (x1, y1), (x2, y2) in zip(xy, xy[1:] + xy[:1]):
        area += x1 * y2 - x2 * y1
    return round(abs(area) / 2 / SQM_PER_ACRE, 2)


def plot_acres(plot):
    try:
        if plot.get("polygon_path"):
            acres = polygon_acres(plot["polygon_path"])
            if acres is not None:
                return acres
        return bbox_acres(plot["ne_lat"], plot["ne_long"], plot["sw_lat"], plot["sw_long"])
    except (KeyError, TypeError, ValueError):
        return plot.get("acres", 0)


def user_plots(uid):
    plots = {}
    for doc in db.collection("users").document(uid).collection("plots").stream():
        plot = doc.to_dict() or {}
        if plot.get("plot_name"):
            plot["acres"] = plot_acres(plot)  # recompute so older, mis-measured plots are corrected
            plots[plot["plot_name"]] = plot
    return plots


PLOT_NAME_RE = re.compile(r"^(?!\.{1,2}$)(?!__.*__$)[^/]{1,100}$")


def valid_plot_name(name):
    return isinstance(name, str) and bool(PLOT_NAME_RE.match(name.strip())) and name.strip() == name


# ---------------------------------------------------------------------------
# Public pages
# ---------------------------------------------------------------------------

@app.route("/")
def home():
    return render_template("landing_page.html")


@app.route("/google1a83795a95853461.html")
def google_verification():
    return send_from_directory("static", "google1a83795a95853461.html")


@app.route("/robots.txt")
def robots_txt():
    return ("User-agent: *\nAllow: /\n\nSitemap: https://agroassistant.vercel.app/sitemap.xml\n",
            200, {"Content-Type": "text/plain"})


@app.route("/sitemap.xml")
def sitemap_xml():
    today = datetime.now().strftime("%Y-%m-%d")
    sitemap = f"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <url><loc>https://agroassistant.vercel.app/</loc><lastmod>{today}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>
    <url><loc>https://agroassistant.vercel.app/signup</loc><lastmod>{today}</lastmod><changefreq>monthly</changefreq><priority>0.8</priority></url>
</urlset>"""
    return sitemap, 200, {"Content-Type": "application/xml"}


@app.route("/signup", methods=["GET"])
def signup():
    return render_template("login_signup.html", firebase_config=firebase_config, google_api_key=GOOGLE_API_KEY)


# ---------------------------------------------------------------------------
# Authentication (server trusts only verified Firebase ID tokens)
# ---------------------------------------------------------------------------

def _clean_address(addr):
    addr = addr if isinstance(addr, dict) else {}
    return {k: str(addr.get(k, ""))[:200] for k in ("line1", "line2", "city", "state", "zip", "country")}


def _clean_coords(coords):
    try:
        lat, lng = float(coords[0]), float(coords[1])
        if -90 <= lat <= 90 and -180 <= lng <= 180:
            return [lat, lng]
    except (TypeError, ValueError, IndexError):
        pass
    return None


def _start_session(uid, user):
    session.clear()
    session["currentUser"] = {
        "uid": uid,
        "name": user.get("name", ""),
        "email": user.get("email", ""),
        "address": user.get("address", {}),
    }


@app.route("/api/create_user", methods=["POST"])
def create_user():
    decoded, data = verify_request_token()
    if not decoded:
        return jsonify({"message": "Invalid or missing ID token"}), 401
    uid = decoded["uid"]

    user = {
        "uid": uid,
        "name": str(data.get("name", ""))[:100],
        "username": str(data.get("username", ""))[:100],
        "email": decoded.get("email", ""),
        "address": _clean_address(data.get("address")),
    }
    coords = _clean_coords(data.get("coordinates"))
    if coords:
        user["coordinates"] = coords

    db.collection("users").document(uid).set(user, merge=True)
    _start_session(uid, user)
    try:
        ensure_daily_data(uid, user)
    except Exception:
        log.exception("Initial data fetch failed")
    return jsonify({"message": "User created successfully"}), 201


@app.route("/api/login_user", methods=["POST"])
def login_user():
    decoded, _ = verify_request_token()
    if not decoded:
        return jsonify({"message": "Invalid or missing ID token"}), 401
    uid = decoded["uid"]

    user = db.collection("users").document(uid).get().to_dict()
    if not user:
        return jsonify({"message": "Account profile not found. Please sign up again."}), 404
    _start_session(uid, user)
    try:
        ensure_daily_data(uid, user)
    except Exception:
        log.exception("Daily data fetch failed at login")
    return jsonify({"message": "Logged in"}), 200


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("signup"))


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------

@app.route("/dashboard")
@login_required
def index():
    uid = current_uid()
    try:
        plants = user_plants(uid)[:4]
        sg, wx = ensure_daily_data(uid)
        hours = sg.get("hours") or [{}]
        hour = hours[1] if len(hours) > 1 else hours[0]
        soil_moisture = first_source(hour.get("soilMoisture"))
        soil_temperature = first_source(hour.get("soilTemperature"))
        daily = wx.get("daily_averages") or [{"UV": "--", "date": str(date.today()),
                                               "averageTemperature": "--", "averageCloud": "--",
                                               "averagePrecip": "--"}]
        return render_template("dashboard.html", plants=plants, daily_averages=daily,
                               soil_moisture=soil_moisture if soil_moisture is not None else "--",
                               soil_temperature=soil_temperature if soil_temperature is not None else "--",
                               username=username())
    except Exception:
        log.exception("Dashboard failed")
        return "Something went wrong loading your dashboard. Please try again.", 500


# ---------------------------------------------------------------------------
# Chatbot
# ---------------------------------------------------------------------------

CHATBOT_INSTRUCTIONS = """
You are AgriBot, an AI chatbot designed to serve only as an agricultural assistant. You can provide expert answers, guidance, and data related to agriculture, including:

1. Crop Data: planting times, yield information, recommended seed varieties, soil nutrient needs, pest/disease management, harvesting guidelines, etc.
2. Farming Practices: irrigation methods, sustainable farming, organic practices, use of pesticides and fertilizers, crop rotation, etc.
3. Agricultural Economics: market trends, cost-benefit analysis of certain crops, yield projections, and similar topics.
4. Agri-Tech: modern technologies like drones, sensors, or software solutions that help optimize crop production and farm management.

Your only goal is to address questions in these agricultural domains. Ensure responses are 50 words or less and do not include markdown.
"""


@app.route("/chatbot", methods=["GET"])
@login_required
def chatbot_page():
    return render_template("chatbot.html", username=username())


@app.route("/chatbot", methods=["POST"])
@api_login_required
def chatbot_api():
    data = request.get_json(silent=True) or {}
    question = str(data.get("question", "")).strip()
    if not question:
        return jsonify({"response": "Please ask a question!"})
    if len(question) > 1000:
        return jsonify({"response": "Please keep questions under 1000 characters."}), 400
    try:
        return jsonify({"response": ask_openai(current_uid(), CHATBOT_INSTRUCTIONS, question)})
    except QuotaExceeded:
        return jsonify({"response": QUOTA_MSG}), 429
    except Exception:
        log.exception("Chatbot failed")
        return jsonify({"response": "Sorry, something went wrong."}), 502


# ---------------------------------------------------------------------------
# Crops
# ---------------------------------------------------------------------------

def render_crops(error=None, status=200):
    return render_template("crops.html", matching_docs=user_plants(current_uid()),
                           error=error, username=username()), status


@app.route("/crops/show-crops", methods=["GET"])
@login_required
def crops_page():
    return render_crops()


@app.route("/crops", methods=["POST"])
@login_required
def crops_api():
    uid = current_uid()
    plant_name = request.form.get("plant_name", "").strip()
    if not plant_name:
        return render_crops("Plant name cannot be empty.", 400)
    if len(plant_name) > 100:
        return render_crops("Plant name is too long.", 400)

    try:
        data = lookup_plant(plant_name)
        if not data or not data.get("slug"):
            return render_crops(f"Could not find data for plant: {plant_name}", 404)
        if plant_ref_for(uid, data["slug"]):
            return render_crops(f"{plant_name} is already in your crops.", 409)

        plant = {
            "common_name": data.get("common_name") or "Unknown",
            "scientific_name": data.get("scientific_name") or "Unknown",
            "image_url": data.get("image_url") or "",
            "slug": data["slug"],
            "uid": uid,
        }
        try:
            plant["description"] = ask_openai(
                uid,
                "I will provide a plant's scientific name and you are to provide a brief description "
                "of the plant along with some basic care tips in under 50 words.",
                plant["scientific_name"])
        except QuotaExceeded:
            plant["description"] = ""
        db.collection("plant_data").document(f"{plant['slug']}-{uid}").set(plant)
        return redirect(url_for("crops_page"))
    except Exception:
        log.exception("crops_api failed")
        return render_crops("Something went wrong adding that plant. Please try again.", 500)


@app.route("/api/add_irrigation", methods=["POST"])
@api_login_required
def add_irrigation():
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or "forPlant" not in data:
        return jsonify({"message": "No data provided"}), 400
    ref = plant_ref_for(current_uid(), data["forPlant"])
    if not ref:
        return jsonify({"message": "Matching plant not found"}), 404
    entry = {k: data[k] for k in list(data)[:20] if isinstance(k, str) and len(k) <= 50}
    ref.update({"irrigations": firestore.ArrayUnion([entry])})
    return jsonify({"message": "Irrigation added successfully"}), 201


@app.route("/api/get_crop_data", methods=["GET"])
@api_login_required
def get_crop_data():
    return jsonify(user_plants(current_uid())), 200


@app.route("/api/update_crop_data", methods=["POST"])
@api_login_required
def update_crop_data():
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or "slug" not in data:
        return jsonify({"message": "Invalid data"}), 400
    try:
        updates = {
            "fieldArea": float(data["fieldArea"]),
            "cropDensity": float(data["cropDensity"]),
            "waterCost": float(data["waterCost"]),
        }
    except (KeyError, TypeError, ValueError):
        return jsonify({"message": "fieldArea, cropDensity and waterCost must be numbers"}), 400
    ref = plant_ref_for(current_uid(), data["slug"])
    if not ref:
        return jsonify({"message": "Plant not found"}), 404
    ref.update(updates)
    return jsonify({"message": "Crop data updated successfully"}), 200


@app.route("/api/growing_conditions", methods=["POST"])
@api_login_required
def growing_conditions():
    uid = current_uid()
    data = request.get_json(silent=True) or {}
    ref = plant_ref_for(uid, data.get("plantName"))
    if not ref:
        return jsonify({"message": "Plant not found"}), 404

    plant = ref.get().to_dict() or {}
    today = str(date.today())
    if plant.get("growth_score") is not None and plant.get("date") == today:
        return jsonify({"growth_score": plant["growth_score"]}), 200

    try:
        reply = ask_openai(
            uid,
            "I will provide today's current soil and weather conditions, as well as a plant name. You must "
            "determine how well the plant can grow under these conditions, and return a score from 0 to 100. "
            "Try to keep the score on the higher end, only give bad score if the conditions are very poor. "
            "Only return the score number value, no other text at all.",
            f"Plant: {plant.get('scientific_name', data.get('plantName'))}, "
            f"Conditions: {json.dumps(current_conditions(uid))}")
    except QuotaExceeded:
        return jsonify({"message": QUOTA_MSG}), 429
    match = re.search(r"\d+(\.\d+)?", reply)
    if not match:
        return jsonify({"message": "Could not compute a score"}), 502
    score = max(0.0, min(100.0, float(match.group())))
    ref.set({"growth_score": score, "date": today}, merge=True)
    return jsonify({"growth_score": score}), 200


# ---------------------------------------------------------------------------
# Profile
# ---------------------------------------------------------------------------

def geocode_address(address):
    """Best-effort server-side geocoding (OpenStreetMap Nominatim). Returns [lat, lng] or None."""
    try:
        from geopy.geocoders import Nominatim
        query = ", ".join(v for v in (address.get("line1"), address.get("city"), address.get("state"),
                                      address.get("zip"), address.get("country")) if v)
        loc = Nominatim(user_agent="agroassistant").geocode(query, timeout=5)
        return [loc.latitude, loc.longitude] if loc else None
    except Exception:
        log.exception("Geocoding failed")
        return None


@app.route("/profile", methods=["GET", "POST"])
@login_required
def profile():
    uid = current_uid()
    user_ref = db.collection("users").document(uid)
    user = user_ref.get().to_dict() or {}

    if request.method == "POST":
        address = _clean_address(request.form)
        updates = {
            "name": request.form.get("name", "")[:100],
            "email": request.form.get("email", "")[:200],
            "address": address,
        }
        if address != user.get("address"):
            coords = geocode_address(address)
            if coords:
                updates["coordinates"] = coords
            # today's cached weather/soil was for the old address — refetch on next load
            for col in ("stormglass_data", "weatherapi_data"):
                db.collection(col).document(f"{date.today()}-{uid}").delete()

        user_ref.set(updates, merge=True)  # merge keeps coordinates, username, etc.
        session["currentUser"] = {**session["currentUser"], **{k: updates[k] for k in ("name", "email", "address")}}
        return redirect(url_for("profile"))

    addr = user.get("address") or {}
    return render_template("profile.html", name=user.get("name", ""), email=user.get("email", ""),
                           city=addr.get("city", ""), country=addr.get("country", ""), state=addr.get("state", ""),
                           zip=addr.get("zip", ""), line1=addr.get("line1", ""), line2=addr.get("line2", ""),
                           username=username())


# ---------------------------------------------------------------------------
# Diagnosis (image never touches disk — works on Vercel's read-only filesystem)
# ---------------------------------------------------------------------------

def prepare_image(file_storage):
    """Validate the upload is a real image, downscale it, and return a JPEG data URI."""
    raw = file_storage.read()
    try:
        Image.open(io.BytesIO(raw)).verify()
        img = Image.open(io.BytesIO(raw))
        img = img.convert("RGB")
    except (UnidentifiedImageError, OSError, ValueError):
        return None
    img.thumbnail((1500, 1500))
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=85)
    return "data:image/jpeg;base64," + base64.b64encode(out.getvalue()).decode("ascii")


@app.route("/diagnosis", methods=["GET", "POST"])
@login_required
def diagnosis():
    if request.method == "GET":
        return render_template("diagnosis.html", username=username())

    upload = request.files.get("plant")
    if not upload or not upload.filename:
        return render_template("diagnosis.html", error="No image provided.", username=username()), 400
    image_uri = prepare_image(upload)
    if not image_uri:
        return render_template("diagnosis.html", error="That file isn't a supported image (try JPG or PNG).",
                               username=username()), 400

    user = db.collection("users").document(current_uid()).get().to_dict() or {}
    lat, lng = user_coords(user)
    try:
        resp = requests.post(
            "https://plant.id/api/v3/health_assessment"
            "?details=local_name,description,url,treatment,classification,common_names,cause",
            headers={"Api-Key": PLANT_ID_API_KEY, "Content-Type": "application/json"},
            json={"images": [image_uri], "latitude": lat, "longitude": lng},
            timeout=30,
        )
        resp.raise_for_status()
        suggestions = resp.json().get("result", {}).get("disease", {}).get("suggestions") or []
    except Exception:
        log.exception("Plant.id request failed")
        return render_template("diagnosis.html", error="Diagnosis service is unavailable right now.",
                               image_url=image_uri, username=username()), 502

    if not suggestions:
        return render_template("diagnosis.html", disease="No disease detected",
                               description="We couldn't identify a disease in this photo.",
                               image_url=image_uri, username=username())

    best = max(suggestions, key=lambda s: s.get("probability", 0))
    details = best.get("details") or {}
    treatment = details.get("treatment") or {}
    return render_template("diagnosis.html", disease=best.get("name"), description=details.get("description"),
                           bio_treatment=treatment.get("biological", []),
                           chem_treatment=treatment.get("chemical", []),
                           preventative_treatment=treatment.get("prevention", []),
                           image_url=image_uri, username=username())


# ---------------------------------------------------------------------------
# Calendar / schedule
# ---------------------------------------------------------------------------

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
AI_EVENT_TYPES = {"Irrigate", "Fertilize", "Plant", "Harvest", "Prune", "Checkup"}


def clean_event(raw, allow_custom_type=True):
    """Validate an event dict. Returns a clean dict or raises ValueError."""
    if not isinstance(raw, dict):
        raise ValueError("event must be an object")
    ev_date = str(raw.get("date", ""))
    if not DATE_RE.match(ev_date):
        raise ValueError("date must be YYYY-MM-DD")
    datetime.strptime(ev_date, "%Y-%m-%d")
    ev_type = str(raw.get("type", "")).strip()[:50]
    if not ev_type or (not allow_custom_type and ev_type not in AI_EVENT_TYPES):
        raise ValueError("invalid event type")
    event = {
        "date": ev_date,
        "type": ev_type,
        # the calendar form sends the plot as 'plant'; statistics and the calendar read 'plot'
        "plot": str(raw.get("plot") or raw.get("plant") or "")[:100],
        "notes": str(raw.get("notes", ""))[:500],
    }
    if ev_type == "Irrigate":
        event["inches"] = float(raw["inches"])
    elif ev_type == "Fertilize":
        event["fert"] = float(raw["fert"])
        event["npk"] = str(raw.get("npk", ""))[:20]
    elif ev_type == "Harvest":
        event["yield"] = float(raw["yield"])
    return event


@app.route("/calendar")
@login_required
def calendar():
    return render_template("calendar.html", username=username())


@app.route("/api/get_schedule", methods=["GET"])
@api_login_required
def get_schedule():
    uid = current_uid()
    schedule = []
    for doc in db.collection("users").document(uid).collection("schedule").stream():
        ev = doc.to_dict() or {}
        ev.setdefault("plot", ev.get("plant"))  # legacy events stored the plot under 'plant'
        schedule.append(ev)
    return jsonify({"schedule": schedule, "plots": user_plots(uid)})


@app.route("/api/add_event", methods=["POST"])
@api_login_required
def add_event():
    try:
        event = clean_event(request.get_json(silent=True))
    except (ValueError, KeyError, TypeError) as e:
        return jsonify({"error": f"Invalid event: {e}"}), 400
    db.collection("users").document(current_uid()).collection("schedule").document().set(event)
    return jsonify({"success": True}), 200


@app.route("/api/clear_schedule", methods=["POST"])
@api_login_required
def clear_schedule():
    batch, n = db.batch(), 0
    for doc in db.collection("users").document(current_uid()).collection("schedule").stream():
        batch.delete(doc.reference)
        n += 1
        if n % 400 == 0:
            batch.commit()
            batch = db.batch()
    batch.commit()
    return jsonify({"success": True}), 200


@app.route("/api/AI_schedule", methods=["POST"])
@api_login_required
def AI_schedule():
    uid = current_uid()
    plots = {name: {"plants": p.get("crop", []), "idealValues": p.get("idealValues", {})}
             for name, p in user_plots(uid).items()}
    if not plots:
        return jsonify({"error": "Add a plot first so the schedule has something to plan for."}), 400

    instructions = """
    Using the provided plots, crops, address, weather, and soil data, generate a 1-month farm schedule with events in these categories: Irrigate, Fertilize, Plant, Harvest, Prune, and Checkup.
    Tailor the plan to the specific crops and conditions for each plot, with at least 10 events in total.

    Return a JSON object with a 'schedule' field containing an array of event objects. Each event must include:
    - date (YYYY-MM-DD)
    - type (e.g., Irrigate, Harvest)
    - plot (name of the plot involved)

    Additionally, include:
    - inches (number of inches of water) — only for Irrigate events
    - fert and npk (fertilizer amount in pounds/acre and ideal NPK ratio) — only for Fertilize events
    - yield (yield amount in pounds/acre) - only for Harvest events
    Ensure these fields are ideal for each plant's needs

    Only include fields relevant to the event type. No explanation, just the JSON output.
    """
    try:
        reply = ask_openai(
            uid, instructions,
            f"Plots: {json.dumps(plots)}, Address: {json.dumps(session['currentUser'].get('address', {}))}, "
            f"Conditions: {json.dumps(current_conditions(uid))}, Current Date: {date.today()}",
            json_mode=True)
        raw_events = json.loads(reply).get("schedule", [])
    except QuotaExceeded:
        return jsonify({"error": QUOTA_MSG}), 429
    except Exception:
        log.exception("AI schedule failed")
        return jsonify({"error": "Could not generate a schedule. Please try again."}), 502

    schedule = []
    for raw in raw_events[:60]:
        try:
            ev = clean_event(raw, allow_custom_type=False)
        except (ValueError, KeyError, TypeError):
            continue  # drop malformed events from the model
        if ev["plot"] in plots:
            schedule.append(ev)

    batch = db.batch()
    col = db.collection("users").document(uid).collection("schedule")
    for ev in schedule:
        batch.set(col.document(), ev)
    batch.commit()
    return jsonify(schedule)


# ---------------------------------------------------------------------------
# Plots
# ---------------------------------------------------------------------------

@app.route("/plots", methods=["GET"])
@login_required
def show_plots():
    uid = current_uid()
    user = db.collection("users").document(uid).get().to_dict() or {}
    lat, lng = user_coords(user)
    return render_template("plots.html", key=GOOGLE_MAPS_API_KEY, lat=lat, long=lng,
                           user_plants=user_plants(uid), plots=list(user_plots(uid).values()),
                           username=username())


@app.route("/plots", methods=["POST"])
@api_login_required
def save_plots():
    uid = current_uid()
    plot_name = (request.form.get("field-name") or "").strip()
    crops = [c[:100] for c in request.form.getlist("crop-type")][:20]
    if not valid_plot_name(plot_name):
        return jsonify({"error": "Plot name must be 1–100 characters and cannot contain '/'."}), 400
    try:
        coords = {k: float(request.form.get(k)) for k in ("sw_lat", "sw_long", "ne_lat", "ne_long")}
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid plot coordinates."}), 400

    plot = {"crop": crops, "plot_name": plot_name, **coords}

    polygon_path = request.form.get("polygon_path")
    if polygon_path:
        try:
            pts = json.loads(polygon_path)
            plot["polygon_path"] = [{"lat": float(p[0]), "lng": float(p[1])} for p in pts][:500]
        except (json.JSONDecodeError, TypeError, ValueError, IndexError):
            pass  # ignore a malformed polygon; the bounding box is still saved
    plot["acres"] = plot_acres(plot)

    try:
        reply = ask_openai(
            uid,
            """Given the location and different plants on a plot of land, return the ideal inches of water,
            pounds/acre of fertilizer, and NPK ratio the overall plot needs on average each irrigation/fertilization.
            Ensure the ideal values are based on each plant's needs.
            Return a JSON object with fields:
            - idealIrrigationPerWeek (number of inches of water)
            - idealFertilizerPerWeek (number of pounds/acre of fertilizer)
            - idealNPKPerWeek (NPK ratio formatted as 'XX-XX-XX')""",
            f"Plants: {json.dumps(crops)}, Address: {json.dumps(session['currentUser'].get('address', {}))}",
            json_mode=True)
        plot["idealValues"] = json.loads(reply)
    except QuotaExceeded:
        return jsonify({"error": QUOTA_MSG}), 429
    except Exception:
        log.exception("Ideal values lookup failed")
        plot["idealValues"] = {}

    db.collection("users").document(uid).collection("plots").document(plot_name).set(plot)
    if request.headers.get("X-Requested-With") == "XMLHttpRequest":
        return jsonify({"message": "Plot saved"})
    return redirect(url_for("show_plots"))


@app.route("/api/delete_plot", methods=["POST"])
@api_login_required
def delete_plot():
    plot_name = (request.get_json(silent=True) or {}).get("plot_name")
    if not valid_plot_name(plot_name):
        return jsonify({"message": "Invalid plot name"}), 400
    db.collection("users").document(current_uid()).collection("plots").document(plot_name).delete()
    return jsonify({"message": "Plot deleted"})


# ---------------------------------------------------------------------------
# Statistics
# ---------------------------------------------------------------------------

@app.route("/statistics")
@login_required
def statistics():
    return render_template("statistics.html", username=username())


@app.route("/api/get_statistics_data", methods=["GET"])
@api_login_required
def get_irrigations():
    uid = current_uid()
    buckets = {"Irrigate": "irrigations", "Fertilize": "fertilizers", "Harvest": "harvests"}
    data = {v: {} for v in buckets.values()}
    for doc in db.collection("users").document(uid).collection("schedule").stream():
        event = doc.to_dict() or {}
        plot = event.get("plot") or event.get("plant")  # legacy events used 'plant'
        bucket = buckets.get(event.get("type"))
        if plot and bucket:
            data[bucket].setdefault(plot, []).append(event)
    return jsonify({"schedule": data, "plots": user_plots(uid)})


# WSGI application for Vercel deployment
application = app

if __name__ == "__main__":
    app.run(debug=os.environ.get("FLASK_DEBUG") == "1")
