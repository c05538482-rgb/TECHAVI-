require("dotenv").config();

const express = require("express");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { Resend } = require("resend");

const app = express();
const PORT = Number(process.env.PORT || 10000);
const DATABASE_URL = process.env.DATABASE_URL;
const REEF_API_KEY = process.env.REEF_API_KEY;
const APP_URL = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const CACHE_TTL = Math.max(60, Number(process.env.CACHE_TTL_SECONDS || 600));
const ALARM_INTERVAL = Math.max(5, Number(process.env.ALARM_INTERVAL_MINUTES || 30));

if (!DATABASE_URL) console.warn("[UYARI] DATABASE_URL ayarlı değil.");
if (!REEF_API_KEY) console.warn("[UYARI] REEF_API_KEY ayarlı değil.");

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL && !DATABASE_URL.includes("localhost")
    ? { rejectUnauthorized: false }
    : false
});

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  store: DATABASE_URL ? new pgSession({
    pool,
    tableName: "user_sessions",
    createTableIfMissing: true
  }) : undefined,
  secret: process.env.SESSION_SECRET || "dev-only-change-me",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 24 * 30
  }
}));

app.use(express.static("public"));

async function db(sql, params = []) {
  if (!DATABASE_URL) throw new Error("DATABASE_URL eksik.");
  return pool.query(sql, params);
}

async function initDb() {
  if (!DATABASE_URL) return;
  await db(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS search_cache (
      cache_key TEXT PRIMARY KEY,
      payload JSONB NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS alarms (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      store TEXT NOT NULL,
      product_id TEXT,
      title TEXT NOT NULL,
      url TEXT,
      current_price NUMERIC,
      target_price NUMERIC NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      last_checked_at TIMESTAMPTZ,
      triggered_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS alarms_active_idx ON alarms(active);
  `);
}

function normalizeQuery(q) {
  return String(q || "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\\u0300-\\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9çğıöşüı\s-]/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function cacheKey(store, query) {
  // n11 and Trendyol cache keys are versioned so old price rows cannot survive
  // the SEPETTE/TY+ enrichment fixes. Hepsiburada key stays unchanged.
  const version = store === "n11" ? "|n11-sepette-v5" : (store === "trendyol" ? "|trendyol-price-v2" : "");
  return crypto.createHash("sha256")
    .update(`${store}${version}|${normalizeQuery(query)}`)
    .digest("hex");
}

async function getCache(key) {
  if (!DATABASE_URL) return null;
  const r = await db(
    `SELECT payload FROM search_cache WHERE cache_key=$1 AND expires_at > NOW()`,
    [key]
  );
  return r.rows[0]?.payload || null;
}

async function setCache(key, payload, ttlSeconds = CACHE_TTL) {
  if (!DATABASE_URL) return;
  await db(`
    INSERT INTO search_cache(cache_key,payload,expires_at)
    VALUES($1,$2,NOW() + ($3 * INTERVAL '1 second'))
    ON CONFLICT(cache_key) DO UPDATE
    SET payload=EXCLUDED.payload, expires_at=EXCLUDED.expires_at
  `, [key, JSON.stringify(payload), ttlSeconds]);
}

async function reef(path, body) {
  if (!REEF_API_KEY) throw new Error("REEF_API_KEY Render'da tanımlı değil.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const r = await fetch(`https://api.reefapi.com${path}`, {
      method: "POST",
      headers: {
        "x-api-key": REEF_API_KEY,
        "content-type": "application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok || json.ok === false) {
      const msg = json?.error?.message || json?.error || `ReefAPI HTTP ${r.status}`;
      throw new Error(String(msg));
    }
    return json;
  } finally {
    clearTimeout(timeout);
  }
}

function num(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v == null) return null;
  if (typeof v === "object") {
    for (const key of ["value", "amount", "price", "current", "sale", "discounted", "final", "basket_price", "campaign_price"]) {
      const n = num(v[key]);
      if (n != null && n > 0) return n;
    }
    return null;
  }
  const s = String(v).replace(/TRY|TL/gi, "").replace(/\s/g, "");
  if (s.includes(",") && s.includes(".")) {
    return Number(s.replace(/\./g, "").replace(",", ".")) || null;
  }
  if (s.includes(",")) return Number(s.replace(",", ".")) || null;
  return Number(s) || null;
}

function trendyolNum(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v == null) return null;
  if (typeof v === "object") {
    for (const key of ["current_value", "price_value", "value", "amount", "current", "price", "sale", "discounted", "final"]) {
      const n = trendyolNum(v[key]);
      if (n != null && n > 0) return n;
    }
    return null;
  }
  const s = String(v).replace(/TRY|TL/gi, "").replace(/₺/g, "").replace(/\s/g, "").trim();
  if (!s) return null;
  // Trendyol's formatted strings use Turkish notation: 12.999 TL = 12999,
  // while 395,99 TL = 395.99. Never parse a dot-only value as 12.999.
  if (s.includes(",")) return Number(s.replace(/\./g, "").replace(",", ".")) || null;
  if (/^\d{1,3}(?:\.\d{3})+$/.test(s)) return Number(s.replace(/\./g, "")) || null;
  return Number(s) || null;
}

function firstNumber(...values) {
  for (const v of values) {
    const n = num(v);
    if (n != null && n > 0) return n;
  }
  return null;
}

function pickImage(x) {
  return x?.image || x?.image_url || x?.thumbnail || x?.images?.[0] || x?.gallery?.[0] || null;
}

// n11 search cards expose the shelf price, while the real SEPETTE price is
// available on product/detail. We enrich n11 rows only; Trendyol and
// Hepsiburada never enter this function. Detail responses are cached for 24h
// because each detail call costs 2 ReefAPI credits.
function extractN11BasketPrice(value, seen = new Set()) {
  if (value == null || typeof value !== "object") return null;
  if (seen.has(value)) return null;
  seen.add(value);

  // ReefAPI documents campaign_price as the exact Turkish-formatted
  // SEPETTE price. Search recursively because n11's detail payload can
  // place campaign information at different nesting levels.
  const exactKeys = ["campaign_price", "basket_price", "basketPrice", "in_basket_price", "inBasketPrice"];
  for (const key of exactKeys) {
    if (value[key] != null) {
      const n = num(value[key]);
      if (n != null && n > 0) return n;
    }
  }

  // Some responses wrap the campaign fields in an object.
  for (const key of ["campaign", "campaigns", "basket", "basket_offer", "offers", "pricing", "price_info"]) {
    const child = value[key];
    if (child == null) continue;
    const n = extractN11BasketPrice(child, seen);
    if (n != null && n > 0) return n;
  }

  // Last resort: if n11 gives only the SEPETTE percentage, calculate the
  // shopper price from the shelf price. This is only used when the response
  // explicitly says SEPETTE; we never subtract an unrelated campaign number.
  const campaignText = [value.campaign, value.campaign_text, value.campaign_label, value.badge, value.label]
    .filter(v => typeof v === "string")
    .join(" | ");
  if (/sepet/i.test(campaignText)) {
    const amountMatches = campaignText.match(/(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?\s*(?:TL|₺)/gi);
    if (amountMatches?.length) {
      const n = num(amountMatches[amountMatches.length - 1]);
      if (n != null && n > 0) return n;
    }

    const pct = campaignText.match(/%\s*(\d+(?:[.,]\d+)?)/);
    const shelf = firstNumber(value.price, value.price_value, value.current_price, value.sale_price);
    if (pct && shelf != null) {
      const rate = Number(pct[1].replace(",", "."));
      if (Number.isFinite(rate) && rate > 0 && rate < 100) {
        return Math.round((shelf * (1 - rate / 100)) * 100) / 100;
      }
    }
  }

  return null;
}

async function getN11Detail(x) {
  const productId = x?.product_id ?? x?.id;
  const url = x?.url || x?.product_url || x?.link;
  if (!productId && !url) return null;

  // URL is the most reliable n11 product/detail identifier according to the
  // current ReefAPI documentation. Fall back to product_id only if no URL exists.
  const identity = String(url || productId);
  const key = crypto.createHash("sha256")
    .update(`n11-detail-v2|${identity}`)
    .digest("hex");

  const cached = await getCache(key);
  if (cached) return cached;

  try {
    const response = await reef("/n11/v1/product/detail", url
      ? { url }
      : { product_id: String(productId) });

    const detail = response?.data?.product || response?.data?.data || response?.data || null;
    if (!detail || typeof detail !== "object") return null;

    const basketPrice = extractN11BasketPrice(detail);
    // Store the resolved shopper price under a private normalized field so the
    // search-row price can never accidentally win later.
    const normalized = basketPrice != null
      ? { ...detail, __n11_basket_price: basketPrice }
      : detail;

    await setCache(key, normalized, 60 * 60 * 24);
    return normalized;
  } catch (e) {
    console.warn(`[n11 detail] ${identity}: ${e.message}`);
    return null;
  }
}

async function enrichN11Rows(rows) {
  if (!rows.length) return rows;

  const enriched = new Array(rows.length);
  let next = 0;
  const workerCount = Math.min(4, rows.length);

  async function worker() {
    while (true) {
      const index = next++;
      if (index >= rows.length) return;

      const row = rows[index];
      const existingBasket = extractN11BasketPrice(row);
      if (existingBasket != null) {
        enriched[index] = { ...row, __n11_basket_price: existingBasket };
        continue;
      }

      const detail = await getN11Detail(row);
      enriched[index] = detail ? { ...row, ...detail } : row;
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return enriched;
}


// Trendyol Plus / SEPETTE fiyatı: search endpoint yalnızca normal fiyatı döndürebilir.
// IMPORTANT: Trendyol formatted prices must ALWAYS be parsed with trendyolNum.
// A value such as "12.999 TL" is 12999 TRY, not 12.999. Using the generic
// num() here caused cards to show values such as 13 TL / 78 TL / 100 TL.
// product/detail ise TY+ fiyatı ve campaign/campaigns bilgisini sağlar.
function extractTrendyolPlusPrice(value, seen = new Set()) {
  if (value == null) return null;
  if (typeof value !== "object") return null;
  if (seen.has(value)) return null;
  seen.add(value);

  const exactKeys = [
    "ty_plus_price", "tyPlusPrice", "plus_price", "plusPrice",
    "ty_plus", "tyPlus", "plus_member_price", "plusMemberPrice",
    "loyalty_price", "loyaltyPrice"
  ];
  for (const key of exactKeys) {
    const v = value[key];
    if (v != null) {
      if (typeof v === "object") {
        const n = trendyolNum(v?.current_value ?? v?.price_value ?? v?.value ?? v?.amount ?? v?.price ?? v?.current);
        if (n != null && n > 0) return n;
      } else {
        const n = trendyolNum(v);
        if (n != null && n > 0) return n;
      }
    }
  }

  // ReefAPI may expose the TY+ amount inside the price object.
  if (value.price && typeof value.price === "object") {
    for (const key of exactKeys) {
      const n = trendyolNum(value.price[key]?.current_value ?? value.price[key]?.price_value ?? value.price[key]?.value ?? value.price[key]?.amount ?? value.price[key]);
      if (n != null && n > 0) return n;
    }
  }

  // Campaign text such as:
  // "Trendyol Plus'a Özel - Sepette 395,99 TL"
  // Only accept an amount when the SAME text explicitly mentions both
  // Trendyol Plus and Sepette. This prevents unrelated public coupons from
  // changing the normal product price.
  const textParts = [];
  for (const key of ["text", "title", "name", "description", "label", "message", "campaign_text", "badge"]) {
    if (typeof value[key] === "string") textParts.push(value[key]);
  }
  const text = textParts.join(" | ");
  if (/trendyol\s*plus/i.test(text) && /sepet/i.test(text)) {
    const afterBasket = text.match(/sepet[^0-9]*(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:,\d{1,2})?)\s*(?:TL|₺)/i);
    if (afterBasket) {
      const n = trendyolNum(afterBasket[1]);
      if (n != null && n > 0) return n;
    }
  }

  // Walk campaign/price containers recursively, but do NOT walk the entire
  // arbitrary object looking for a random number. That could mistake a list
  // price, coupon threshold, review count, etc. for the Plus price.
  for (const key of ["campaign", "campaigns", "price", "pricing", "price_info", "loyalty", "membership", "promotion"]) {
    const child = value[key];
    if (child == null) continue;
    const n = extractTrendyolPlusPrice(child, seen);
    if (n != null && n > 0) return n;
  }

  // Arrays such as campaigns[] are handled here.
  if (Array.isArray(value)) {
    for (const item of value) {
      const n = extractTrendyolPlusPrice(item, seen);
      if (n != null && n > 0) return n;
    }
  }
  return null;
}

async function getTrendyolDetail(x) {
  const contentId = x?.content_id ?? x?.id;
  const url = x?.url || x?.product_url || x?.link;
  if (!contentId && !url) return null;

  const identity = String(url || contentId);
  const key = crypto.createHash("sha256")
    .update(`trendyol-price-v3|${identity}`)
    .digest("hex");

  const cached = await getCache(key);
  if (cached) return cached;

  try {
    const response = await reef("/trendyol/v1/product/detail", url
      ? { url }
      : { content_id: String(contentId) });
    const detail = response?.data?.product || response?.data?.data || response?.data || null;
    if (!detail || typeof detail !== "object") return null;

    const plusPrice = extractTrendyolPlusPrice(detail);
    const normalized = plusPrice != null
      ? { ...detail, __trendyol_plus_price: plusPrice }
      : { ...detail, __trendyol_plus_price: null };

    // Plus pricing can change; 6h cache keeps credit usage reasonable while
    // avoiding stale membership prices for a whole day.
    await setCache(key, normalized, 60 * 60 * 6);
    return normalized;
  } catch (e) {
    console.warn(`[trendyol detail] ${identity}: ${e.message}`);
    return null;
  }
}

async function enrichTrendyolRows(rows) {
  if (!rows.length) return rows;
  const enriched = new Array(rows.length);
  let next = 0;
  const workerCount = Math.min(4, rows.length);

  async function worker() {
    while (true) {
      const index = next++;
      if (index >= rows.length) return;
      const row = rows[index];
      const detail = await getTrendyolDetail(row);
      enriched[index] = detail ? { ...row, ...detail } : row;
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return enriched;
}

function normalizeStoreRow(store, x) {
  const title = x?.title || x?.name || x?.product_name || "Ürün";
  let price = null;
  let original = null;
  let discount = num(x?.discount_rate ?? x?.discount);

  if (store === "n11") {
    // n11: SEPETTE campaign_price is the shopper's in-basket price and
    // MUST take precedence over the shelf price. ReefAPI documents
    // campaign_price as a Turkish-formatted string such as "10.894,11 TL".
    // Keep price as the fallback only when no basket campaign exists.
    price = firstNumber(
      x?.__n11_basket_price,
      extractN11BasketPrice(x),
      x?.campaign_price,
      x?.campaign?.price,
      x?.campaign?.campaign_price,
      x?.campaign?.basket_price,
      x?.basket_price,
      x?.sale_price,
      x?.discounted_price,
      x?.price
    );
    original = firstNumber(x?.original_price, x?.list_price, x?.old_price);
  } else if (store === "mediamarkt") {
    price = firstNumber(x?.price, x?.current_price, x?.sale_price);
    original = firstNumber(x?.was_price, x?.original_price, x?.list_price);
    discount = num(x?.discount_percent ?? x?.discount);
  } else if (store === "teknosa") {
    price = firstNumber(x?.price, x?.current_price, x?.sale_price);
    original = firstNumber(x?.was_price, x?.original_price, x?.list_price);
    discount = num(x?.discount_percent ?? x?.discount);
  } else if (store === "vatan") {
    // Vatan's `price` is the public online/Web'e Özel shopper price.
    // Keep basket_price separate; do not replace the displayed price with a
    // basket-only offer unless the site/API says it is the main price.
    price = firstNumber(x?.price, x?.current_price, x?.sale_price);
    original = firstNumber(x?.was_price, x?.regular_price, x?.original_price, x?.list_price);
    discount = num(x?.discount_percent ?? x?.discount);
  } else {
    if (store === "trendyol" && x?.__trendyol_plus_price != null) {
      // ONLY override the Trendyol price when ReefAPI explicitly exposed a
      // Trendyol Plus / SEPETTE price. Existing green SEPETTE pricing remains
      // untouched because normal Trendyol search/detail price handling is the
      // fallback below.
      price = firstNumber(x.__trendyol_plus_price);
    }
    if (price == null) {
      price = trendyolNum(
        x?.price_value ??
        x?.current_value ??
        x?.current_price ??
        x?.sale_price ??
        x?.special_price ??
        x?.price
      );
    }
    original = trendyolNum(
      x?.original_price ??
      x?.list_price ??
      x?.listPrice ??
      x?.old_price
    );
  }

  if (!discount && original && price && original > price) {
    discount = Math.round((1 - price / original) * 100);
  }

  return {
    store,
    id: String(
      x?.content_id ?? x?.sku ?? x?.product_id ?? x?.id ?? x?.product_code ?? crypto.randomUUID()
    ),
    title,
    brand: x?.brand?.name || x?.brand || "",
    price,
    originalPrice: original,
    discount: discount || 0,
    currency: "TRY",
    url: x?.url || x?.product_url || x?.link || "#",
    image: pickImage(x),
    rating: num(x?.rating ?? x?.score),
    reviews: Number(x?.comment_count ?? x?.review_count ?? x?.reviews_count ?? 0) || 0,
    stock: x?.stock ?? x?.stock_status ?? null,
    raw: x
  };
}

async function searchStore(store, query) {
  const key = cacheKey(store, query);
  const cached = await getCache(key);
  if (cached) return { ...cached, cached: true };

  let response;
  if (store === "trendyol") {
    response = await reef("/trendyol/v1/search", { query, page: 1, max_pages: 1 });
  } else if (store === "hepsiburada") {
    response = await reef("/hepsiburada/v1/search", { query, page: 1 });
  } else if (store === "n11") {
    response = await reef("/n11/v1/search", { query, page: 1 });
  } else if (store === "mediamarkt") {
    response = await reef("/mediamarkt/v1/search", { query, country: "tr", page: 1 });
  } else if (store === "teknosa") {
    response = await reef("/teknosa/v1/search", { query, page: 1 });
  } else if (store === "vatan") {
    response = await reef("/vatan/v1/search", { query, page: 1 });
  } else {
    throw new Error("Desteklenmeyen mağaza");
  }

  let rows = response?.data?.results || response?.data?.products || [];

  // n11 keeps its existing enrichment. Trendyol gets a separate, isolated
  // detail lookup only to detect TY+ / Plus basket pricing. Hepsiburada is
  // completely untouched.
  if (store === "n11") {
    rows = await enrichN11Rows(rows);
  } else if (store === "trendyol") {
    rows = await enrichTrendyolRows(rows);
  }

  const result = {
    store,
    count: Number(response?.meta?.total_count ?? response?.data?.total_count ?? rows.length) || rows.length,
    products: rows.map(x => normalizeStoreRow(store, x)),
    fetchedAt: new Date().toISOString()
  };
  await setCache(key, result);
  return { ...result, cached: false };
}

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ ok: false, error: "Giriş yapmalısın." });
  next();
}

app.get("/api/health", async (req, res) => {
  res.json({ ok: true, database: Boolean(DATABASE_URL), reef: Boolean(REEF_API_KEY) });
});

app.get("/api/auth/me", async (req, res) => {
  if (!req.session.userId || !DATABASE_URL) return res.json({ ok: true, user: null });
  const r = await db("SELECT id,name,email FROM users WHERE id=$1", [req.session.userId]);
  res.json({ ok: true, user: r.rows[0] || null });
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const name = String(req.body.name || "").trim().slice(0, 80);
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!name || !email || password.length < 6) {
      return res.status(400).json({ ok: false, error: "Ad, geçerli e-posta ve en az 6 karakter şifre gerekli." });
    }

    const exists = await db("SELECT id FROM users WHERE email=$1", [email]);
    if (exists.rowCount) return res.status(409).json({ ok: false, error: "Bu e-posta zaten kayıtlı." });

    const hash = await bcrypt.hash(password, 12);
    const r = await db(
      "INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) RETURNING id,name,email",
      [name, email, hash]
    );
    req.session.userId = r.rows[0].id;
    res.json({ ok: true, user: r.rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "Kayıt sırasında hata oluştu." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const r = await db("SELECT * FROM users WHERE email=$1", [email]);
    const user = r.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ ok: false, error: "E-posta veya şifre yanlış." });
    }
    req.session.userId = user.id;
    res.json({ ok: true, user: { id: user.id, name: user.name, email: user.email } });
  } catch (e) {
    res.status(500).json({ ok: false, error: "Giriş sırasında hata oluştu." });
  }
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/search", async (req, res) => {
  const query = normalizeQuery(req.query.q);
  if (query.length < 2) return res.status(400).json({ ok: false, error: "En az 2 karakter yaz." });

  const stores = ["trendyol", "hepsiburada", "n11", "mediamarkt", "teknosa", "vatan"];
  const settled = await Promise.allSettled(stores.map(s => searchStore(s, query)));
  const results = {};
  const errors = {};

  settled.forEach((r, i) => {
    const store = stores[i];
    if (r.status === "fulfilled") results[store] = r.value;
    else errors[store] = r.reason?.message || "Arama başarısız";
  });

  const products = Object.values(results).flatMap(x => x.products);
  res.json({
    ok: true,
    query,
    stores: results,
    errors,
    products
  });
});

app.get("/api/alarms", requireAuth, async (req, res) => {
  const r = await db(`
    SELECT id,store,title,url,current_price,target_price,active,last_checked_at,triggered_at,created_at
    FROM alarms WHERE user_id=$1 ORDER BY created_at DESC
  `, [req.session.userId]);
  res.json({ ok: true, alarms: r.rows });
});

app.post("/api/alarms", requireAuth, async (req, res) => {
  const store = String(req.body.store || "").trim();
  const title = String(req.body.title || "").trim();
  const url = String(req.body.url || "").trim();
  const productId = String(req.body.productId || "").trim();
  const target = num(req.body.targetPrice);

  if (!["trendyol", "hepsiburada", "n11"].includes(store) || !title || !target || target <= 0) {
    return res.status(400).json({ ok: false, error: "Mağaza, ürün ve geçerli hedef fiyat gerekli." });
  }

  const r = await db(`
    INSERT INTO alarms(user_id,store,product_id,title,url,target_price)
    VALUES($1,$2,$3,$4,$5,$6)
    RETURNING id,store,title,url,target_price,active,created_at
  `, [req.session.userId, store, productId || null, title, url || null, target]);

  res.json({ ok: true, alarm: r.rows[0] });
});

app.delete("/api/alarms/:id", requireAuth, async (req, res) => {
  await db("UPDATE alarms SET active=false WHERE id=$1 AND user_id=$2", [req.params.id, req.session.userId]);
  res.json({ ok: true });
});

async function fetchAlarmPrice(alarm) {
  const q = normalizeQuery(alarm.title);
  const result = await searchStore(alarm.store, q);
  const products = result.products || [];

  const targetId = String(alarm.product_id || "");
  let best = products.find(p => String(p.id) === targetId);
  if (!best) {
    const titleTokens = q.split(" ").filter(Boolean).slice(0, 6);
    best = products
      .map(p => {
        const t = normalizeQuery(p.title);
        const score = titleTokens.filter(x => t.includes(x)).length;
        return { p, score };
      })
      .sort((a,b) => b.score - a.score)[0]?.p;
  }
  return best?.price ?? null;
}

async function checkAlarms() {
  if (!DATABASE_URL || !REEF_API_KEY) return;
  try {
    const r = await db(`
      SELECT * FROM alarms
      WHERE active=true
      ORDER BY last_checked_at NULLS FIRST
      LIMIT 20
    `);

    for (const alarm of r.rows) {
      try {
        const price = await fetchAlarmPrice(alarm);
        await db("UPDATE alarms SET current_price=$1,last_checked_at=NOW() WHERE id=$2", [price, alarm.id]);

        if (price != null && price <= Number(alarm.target_price)) {
          await db("UPDATE alarms SET active=false,triggered_at=NOW() WHERE id=$1", [alarm.id]);

          const user = await db("SELECT name,email FROM users WHERE id=$1", [alarm.user_id]);
          if (resend && user.rows[0]?.email) {
            const from = process.env.RESEND_FROM || "TechAvı <onboarding@resend.dev>";
            await resend.emails.send({
              from,
              to: [user.rows[0].email],
              subject: `🔔 TechAvı fiyat alarmı: ${alarm.title}`,
              html: `
                <div style="font-family:Arial,sans-serif">
                  <h2>🔔 Fiyat alarmı tetiklendi</h2>
                  <p>${escapeHtml(alarm.title)}</p>
                  <p>Güncel fiyat: <b>${Number(price).toLocaleString("tr-TR")} TL</b></p>
                  <p>Hedef fiyat: <b>${Number(alarm.target_price).toLocaleString("tr-TR")} TL</b></p>
                  ${alarm.url ? `<p><a href="${escapeAttr(alarm.url)}">Ürünü aç</a></p>` : ""}
                </div>
              `
            });
          }
        }
      } catch (e) {
        console.error("Alarm kontrol hatası", alarm.id, e.message);
      }
    }
  } catch (e) {
    console.error("Alarm job hatası", e.message);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/`/g, "&#096;");
}

app.post("/api/jobs/check-alarms", async (req, res) => {
  const secret = req.get("x-job-secret") || req.query.secret;
  if (!process.env.JOB_SECRET || secret !== process.env.JOB_SECRET) {
    return res.status(403).json({ ok: false, error: "Yetkisiz." });
  }
  await checkAlarms();
  res.json({ ok: true });
});

app.use((req, res) => {
  res.sendFile(require("path").join(process.cwd(), "public", "index.html"));
});

(async () => {
  try {
    await initDb();
    setInterval(checkAlarms, ALARM_INTERVAL * 60 * 1000);
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`TechAvı V2 çalışıyor: http://0.0.0.0:${PORT}`);
    });
  } catch (e) {
    console.error("Başlatma hatası:", e);
    process.exit(1);
  }
})();
