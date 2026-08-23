var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// cocktail-ai production worker
var __defProp2 = Object.defineProperty;
var __name2 = /* @__PURE__ */ __name((target, value) => __defProp2(target, "name", { value, configurable: true }), "__name");
var __defProp22 = Object.defineProperty;
var __name22 = /* @__PURE__ */ __name2((target, value) => __defProp22(target, "name", { value, configurable: true }), "__name");
var ALLOWED_ORIGINS = [
  "https://cocktailapp-lr42ivhn.manus.space",
  "http://localhost:8081",
  "http://localhost:3000",
  "capacitor://localhost",
  "ionic://localhost"
];
function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Device-Id, X-Device-Token",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400"
  };
}
__name(corsHeaders, "corsHeaders");
__name2(corsHeaders, "corsHeaders");
__name22(corsHeaders, "corsHeaders");
function json(data, status = 200, origin = "") {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) }
  });
}
__name(json, "json");
__name2(json, "json");
__name22(json, "json");
function err(msg, status = 400, origin = "") {
  return json({ error: msg }, status, origin);
}
__name(err, "err");
__name2(err, "err");
__name22(err, "err");
var RATE_LIMIT_AI = { window: 60, max: 20 };
async function checkRateLimit(env, ip, route) {
  if (!env.DB) return true;
  const key = `rl:${route}:${ip}`;
  const now = Math.floor(Date.now() / 1e3);
  const windowStart = now - RATE_LIMIT_AI.window;
  try {
    await env.DB.prepare("DELETE FROM kv_cache WHERE key LIKE ? AND value < ?").bind(`rl:%`, String(windowStart)).run();
    const row = await env.DB.prepare("SELECT value FROM kv_cache WHERE key = ?").bind(key).first();
    const count = row ? parseInt(row.value) + 1 : 1;
    if (count > RATE_LIMIT_AI.max) return false;
    await env.DB.prepare("INSERT OR REPLACE INTO kv_cache (key, value, expires_at) VALUES (?, ?, ?)").bind(key, String(count), now + RATE_LIMIT_AI.window).run();
    return true;
  } catch {
    return true;
  }
}
__name(checkRateLimit, "checkRateLimit");
__name2(checkRateLimit, "checkRateLimit");
__name22(checkRateLimit, "checkRateLimit");
async function kvGet(env, key) {
  if (!env.CACHE) return null;
  try {
    return await env.CACHE.get(key, "json");
  } catch {
    return null;
  }
}
__name(kvGet, "kvGet");
__name2(kvGet, "kvGet");
__name22(kvGet, "kvGet");
async function kvSet(env, key, value, ttlSeconds = 3600) {
  if (!env.CACHE) return;
  try {
    await env.CACHE.put(key, JSON.stringify(value), { expirationTtl: ttlSeconds });
  } catch {
  }
}
__name(kvSet, "kvSet");
__name2(kvSet, "kvSet");
__name22(kvSet, "kvSet");
async function callDeepSeek(env, messages, options = {}) {
  const {
    model = "deepseek-chat",
    maxTokens = 2e3,
    responseFormat = null,
    stream = false,
    signal = null,
    lang: lang2 = "zh"
  } = options;
  const finalMessages = lang2 === "en" ? [{ role: "system", content: "You are a professional cocktail and spirits expert. CRITICAL: Write ALL descriptive text fields (story, notes, flavorDesc, styleDesc, distilleryInfo, pairingNotes, usageNotes, shelfLife, storage, seasonality, steps) in English only. Do not use Chinese for any descriptive text." }, ...messages] : messages;
  const body = {
    model,
    messages: finalMessages,
    max_tokens: maxTokens,
    ...responseFormat ? { response_format: responseFormat } : {},
    stream
  };
  const fetchOptions = {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.DEEPSEEK_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  };
  if (signal) fetchOptions.signal = signal;
  const res = await fetch("https://api.deepseek.com/v1/chat/completions", fetchOptions);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DeepSeek API error ${res.status}: ${text.slice(0, 200)}`);
  }
  return res;
}
__name(callDeepSeek, "callDeepSeek");
__name2(callDeepSeek, "callDeepSeek");
__name22(callDeepSeek, "callDeepSeek");
async function callWorkersAI(env, messages, options = {}) {
  const {
    maxTokens = 2000,
    lang: lang2 = "zh"
  } = options;
  const systemMsg = lang2 === "en"
    ? "You are a professional cocktail and spirits expert. Write ALL descriptive text fields in English only."
    : "你是一位专业的鸡尾酒和烈酒专家，请用中文回答。";
  const finalMessages = [{ role: "system", content: systemMsg }, ...messages];
  const res = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
    messages: finalMessages,
    max_tokens: maxTokens,
  });
  // Workers AI returns { response: "..." }
  const text = res.response || "";
  // Wrap in a Response-like object with .json() method to match callDeepSeek interface
  return {
    ok: true,
    _workersAIText: text,
    json: async () => ({
      choices: [{ message: { content: text } }]
    })
  };
}

async function callAI(env, messages, options = {}) {
  // Try DeepSeek first
  try {
    const res = await callDeepSeek(env, messages, options);
    return res;
  } catch (e) {
    // Fallback to Workers AI if DeepSeek fails and AI binding is available
    if (env.AI) {
      console.warn("[AI] DEEPSEEK_FALLBACK");
      return callWorkersAI(env, messages, options);
    }
    throw e;
  }
}

function parseJsonLoose(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
  }
  const m = text.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      return JSON.parse(m[0]);
    } catch {
    }
  }
  return {};
}
__name(parseJsonLoose, "parseJsonLoose");
__name2(parseJsonLoose, "parseJsonLoose");
__name22(parseJsonLoose, "parseJsonLoose");
var VALID_FLAVOR_TAGS = ["\u9178", "\u751C", "\u82E6", "\u70C8", "\u9C9C", "\u67D1\u6A58", "\u70ED\u5E26", "\u8349\u672C", "\u82B1\u9999", "\u70DF\u718F", "\u6728\u6876", "\u9999\u6599", "\u575A\u679C\u53EF\u53EF", "\u6E05\u723D", "\u6D53\u90C1", "\u5E72\u723D", "\u590D\u6742"];
var VALID_ICE = ["\u6807\u51C6\u65B9\u51B0", "\u5927\u65B9\u51B0", "\u7403\u51B0", "\u788E\u51B0", "\u957F\u6761\u51B0", "\u65E0\u51B0"];
var VALID_METHODS = ["\u6447\u548C", "\u6405\u62CC", "\u76F4\u8C03", "\u5206\u5C42", "\u6405\u6253"];
var VALID_STRENGTHS = ["\u6E05\u723D", "\u9002\u4E2D", "\u6D53\u70C8"];
var VALID_DURATIONS = ["\u77ED\u996E", "\u957F\u996E"];
var VALID_OCCASIONS = ["\u9910\u524D\u9152", "\u9910\u540E\u9152", "\u5168\u5929\u9152", "\u7761\u524D\u9152", "\u6D3E\u5BF9\u9152"];
var CODEX_LIST = ["\u53E4\u5178 Old-Fashioned", "\u9A6C\u5929\u5C3C Martini", "\u5927\u5409\u5229 Daiquiri", "\u8FB9\u8F66 Sidecar", "\u9AD8\u7403 Highball", "\u83F2\u5179 Flip"];
var VALID_GLASSES = ["\u9A6C\u5929\u5C3C\u676F", "\u53E4\u5178\u676F", "\u9AD8\u7403\u676F", "\u67EF\u6797\u676F", "\u5E93\u4F69\u676F", "\u98D3\u98CE\u676F", "\u5B50\u5F39\u676F", "\u5C3C\u514B\u8BFA\u62C9\u676F", "\u90C1\u91D1\u9999\u676F", "\u7B1B\u578B\u676F", "\u63D0\u57FA\u676F", "\u94DC\u676F", "\u7EA2\u9152\u676F", "\u6731\u8389\u666E\u676F", "\u5176\u4ED6"];
var VALID_BASE_SPIRITS = ["\u91D1\u9152", "\u6717\u59C6", "\u4F0F\u7279\u52A0", "\u5A01\u58EB\u5FCC", "\u9F99\u820C\u5170", "\u767D\u5170\u5730", "\u6885\u65AF\u5361\u5C14", "\u5229\u53E3\u9152", "\u76AE\u65AF\u79D1", "\u5361\u6C99\u8428", "\u65E0\u9152\u7CBE", "\u5176\u4ED6"];
var VALID_CATEGORIES_BOTTLE = ["\u91D1\u9152", "\u6717\u59C6", "\u4F0F\u7279\u52A0", "\u5A01\u58EB\u5FCC", "\u9F99\u820C\u5170", "\u767D\u5170\u5730", "\u5229\u53E3\u9152", "\u82E6\u7CBE", "\u5473\u7F8E\u601D", "\u5F00\u80C3\u9152", "\u8D77\u6CE1\u9152", "\u8461\u8404\u9152", "\u6E05\u9152\u70E7\u9152", "\u4E2D\u5F0F\u767D\u9152", "\u7CD6\u6D46", "\u8F6F\u996E", "\u7CD6\u4E0E\u751C\u5473\u5242", "\u679C\u852C", "\u9999\u6599\u4E0E\u8349\u672C", "\u82B1\u5349", "\u8336\u5496\u4E0E\u53EF\u53EF", "\u575A\u679C\u4E0E\u8C37\u7269", "\u4E73\u86CB", "\u9178\u7C7B\u4E0E\u6DFB\u52A0\u5242", "\u5176\u4ED6"];
var VALID_FLAVOR_TAGS_BOTTLE = ["\u8349\u672C", "\u679C\u5473", "\u67D1\u6A58", "\u82B1\u9999", "\u751C\u6DA6", "\u9178\u723D", "\u82E6\u97F5", "\u8F9B\u9999", "\u70DF\u718F", "\u54B8\u9C9C", "\u6E05\u723D", "\u6D53\u90C1", "\u575A\u679C", "\u5976\u6CB9", "\u5E72\u723D", "\u70ED\u5E26", "\u7126\u7CD6", "\u5496\u5561", "\u5DE7\u514B\u529B", "\u6CE5\u7164", "\u8702\u871C", "\u9999\u8349", "\u575A\u786C", "\u8F9B\u8FA3"];
var BOTTLE_STYLES_MAP = {
  "金酒": ["London Dry", "Plymouth", "Old Tom", "Navy Strength", "Contemporary / New Western", "Genever", "Aged Gin", "Sloe & Flavored Gin"],
  "伏特加": ["Wheat", "Rye", "Potato", "Grape / Fruit", "Flavored"],
  "朗姆": ["White / Light", "Gold", "Aged / A\u00f1ejo", "Dark / Black", "Jamaican Pot Still", "Demerara", "Rhum Agricole Blanc", "Rhum Agricole Ambr\u00e9", "Cacha\u00e7a", "Overproof", "Spiced"],
  "威士忌": ["Bourbon", "Rye Whiskey", "Tennessee", "Scotch Single Malt", "Islay Single Malt", "Scotch Blended", "Irish", "Japanese", "Canadian", "American Single Malt"],
  "龙舌兰": ["Tequila Blanco", "Tequila Joven", "Tequila Reposado", "Tequila A\u00f1ejo", "Tequila Extra A\u00f1ejo", "Tequila Cristalino", "Mezcal Joven", "Mezcal Reposado", "Raicilla", "Sotol", "Bacanora"],
  "白兰地": ["Cognac VS", "Cognac VSOP", "Cognac XO", "Armagnac", "Calvados", "Apple Brandy / Applejack", "Pisco", "Grappa / Pomace", "Eau-de-Vie / Fruit Brandy", "Spanish Brandy"],
  "清酒烧酒": ["Junmai", "Junmai Ginjo", "Junmai Daiginjo", "Nigori", "Umeshu", "Mugi Shochu", "Imo Shochu", "Kome Shochu", "Soju"],
  "中式白酒": ["Sauce Aroma", "Strong Aroma", "Light Aroma", "Rice Aroma"],
  "利口酒": ["Orange / Triple Sec", "Herbal / Spiced", "Anise / Absinthe", "Fruit", "Cherry / Maraschino", "Coffee", "Cream", "Nut", "Floral"],
  "味美思": ["Dry Vermouth", "Sweet / Rosso", "Blanc / Bianco", "Ros\u00e9 / Ambrato", "Quinquina / Americano"],
  "阿玛罗与开胃酒": ["Aperitivo", "Amaro Leggero", "Amaro Medio", "Amaro Denso", "Fernet", "Alpine", "Carciofo / Rabarbaro", "Gentian"],
  "苦精": ["Aromatic", "Orange", "Citrus", "Spice / Mole", "Tiki", "Celery / Savory", "Fruit / Floral"],
  "加强酒": ["Sherry Fino / Manzanilla", "Sherry Amontillado", "Sherry Oloroso", "Sherry PX", "Port Ruby", "Port Tawny", "Madeira", "Marsala"],
  "起泡酒": ["Champagne", "Prosecco", "Cava", "Cr\u00e9mant", "P\u00e9t-Nat"],
  "葡萄酒": ["Dry White", "Dry Red", "Ros\u00e9", "Sweet / Sauternes"],
  "果汁": ["Citrus Juice", "Tropical Juice", "Berry Juice", "Vegetable Juice"],
  "软饮": ["Soda Water", "Tonic Water", "Ginger Beer", "Ginger Ale", "Cola & Soft Drinks", "Sparkling Water"],
  "糖浆": ["Simple Syrup", "Flavored Syrup", "Cordial", "Shrub", "Cream / Foam"],
  "糖与甜味剂": ["Refined Sugar", "Raw / Dark Sugar", "Sugar Cube", "Honey & Nectar", "Molasses & Concentrate"],
  "果蔬": ["Citrus", "Fresh Fruit", "Fresh Vegetable", "Dried Fruit", "Dried Vegetable"],
  "香料与草本": ["Dried Spice", "Fresh Herb", "Bittering Botanical"],
  "花卉": ["Dried Flowers", "Fresh Edible Flowers", "Floral Water"],
  "茶咖与可可": ["Tea", "Coffee", "Cacao"],
  "坚果与谷物": ["Nut", "Grain / Seed"],
  "乳蛋": ["Milk / Cream", "Egg", "Butter / Cheese"],
  "酸类与添加剂": ["Powdered Acid", "Vinegar", "Salt & Mineral", "Texture / Clarifier"]
};
var STYLE_ALIASES = {
  "white/blanco": "White / Light", "white": "White / Light", "light": "White / Light", "blanco": "White / Light",
  "gold/oro": "Gold", "oro": "Gold",
  "dark/anejo": "Dark / Black", "dark": "Dark / Black", "black": "Dark / Black",
  "anejo": "Aged / A\u00f1ejo", "aged": "Aged / A\u00f1ejo",
  "agricole": "Rhum Agricole Blanc", "cachaca": "Cacha\u00e7a",
  "contemporary": "Contemporary / New Western", "new western": "Contemporary / New Western",
  "sloe gin": "Sloe & Flavored Gin", "compound": "Sloe & Flavored Gin", "aged gin": "Aged Gin",
  "rye": "Rye Whiskey", "scotch": "Scotch Blended", "world": "Japanese",
  "blanco tequila": "Tequila Blanco", "reposado": "Tequila Reposado", "extra anejo": "Tequila Extra A\u00f1ejo",
  "mezcal": "Mezcal Joven", "cristalino": "Tequila Cristalino",
  "apple brandy": "Apple Brandy / Applejack", "grappa": "Grappa / Pomace", "eau de vie": "Eau-de-Vie / Fruit Brandy",
  "orange liqueur": "Orange / Triple Sec", "triple sec": "Orange / Triple Sec",
  "cherry liqueur": "Cherry / Maraschino", "coffee liqueur": "Coffee", "herbal liqueur": "Herbal / Spiced",
  "cream liqueur": "Cream", "nut liqueur": "Nut", "fruit liqueur": "Fruit", "floral liqueur": "Floral",
  "anise liqueur": "Anise / Absinthe", "amaro": "Herbal / Spiced",
  "sweet vermouth": "Sweet / Rosso", "rosso": "Sweet / Rosso", "blanc/bianco": "Blanc / Bianco", "bianco": "Blanc / Bianco",
  "ambrato": "Ros\u00e9 / Ambrato", "quinquina": "Quinquina / Americano", "americano": "Quinquina / Americano",
  "celery": "Celery / Savory", "chocolate": "Spice / Mole", "peach": "Fruit / Floral", "spice/mole": "Spice / Mole",
  "sherry fino": "Sherry Fino / Manzanilla", "port": "Port Ruby", "sauternes": "Sweet / Sauternes",
  "sauce aroma \u9171\u9999": "Sauce Aroma", "strong aroma \u6d53\u9999": "Strong Aroma",
  "light aroma \u6e05\u9999": "Light Aroma", "rice aroma \u7c73\u9999": "Rice Aroma",
  "syrup": "Simple Syrup", "cream/foam": "Cream / Foam",
  "soda": "Soda Water", "tonic": "Tonic Water", "cola": "Cola & Soft Drinks",
  "plain": "Wheat", "grain": "Wheat", "flavored vodka": "Flavored", "grape / fruit": "Grape / Fruit"
};
function normalizeBottleStyle(rawStyle, styleList) {
  if (!rawStyle) return "";
  if (styleList.includes(rawStyle)) return rawStyle;
  var key = rawStyle.toLowerCase().trim();
  var squash = function(s) { return s.toLowerCase().replace(/\s*\/\s*/g, "/").replace(/\s+/g, " ").trim(); };
  var target = squash(rawStyle);
  for (var i = 0; i < styleList.length; i++) {
    if (squash(styleList[i]) === target) return styleList[i];
  }
  var alias = STYLE_ALIASES[key] || STYLE_ALIASES[target];
  if (alias && styleList.includes(alias)) return alias;
  for (var j = 0; j < styleList.length; j++) {
    var s = squash(styleList[j]);
    if (s.indexOf(target) !== -1 || target.indexOf(s) !== -1) return styleList[j];
  }
  return "";
}
__name(normalizeBottleStyle, "normalizeBottleStyle");
var VALID_PREP_TYPES = ["infusion", "fat-wash", "butter-wash", "oil-wash", "rapid-infusion", "sous-vide-infusion", "ultrasonic-infusion", "rotovap", "cold-brew-spirit", "smoke-infusion", "liqueur", "fruit-liqueur", "herbal-liqueur", "nut-liqueur", "cream-liqueur", "amaro", "falernum", "bitters", "aromatic-bitters", "citrus-bitters", "herbal-bitters", "tincture", "spice-tincture", "citrus-tincture", "redistilled", "batch", "bottled-cocktail", "barrel-aged", "fortified", "fermented", "homebrew-beer", "homebrew-wine", "syrup", "rich-syrup", "spiced-syrup", "herbal-syrup", "floral-syrup", "fruit-syrup", "caramel-syrup", "coffee-tea-syrup", "orgeat", "oleo", "juice", "clarified-juice", "super-juice", "cordial", "solution", "acid-adjusted", "shrub", "lacto-ferment-drink", "zero-spirit", "na-bitters", "na-liqueur", "kombucha", "water-kefir", "ginger-beer", "tepache", "jun", "foam", "spherification-prep", "garnish", "other"];
var VALID_TECHNIQUES = ["rotovap", "centrifuge", "fat_wash", "milk_wash", "rapid_infusion", "sous_pression", "sous_vide", "fermentation", "barrel_age", "ultrasonic", "enzyme_pectinase", "enzyme_amylase", "spherification", "emulsification", "liquid_nitrogen", "steam_distill", "bottle_age", "oak_stave", "carbonation", "smoke", "acid_adjust", "oleo", "heat_cook", "cold_steep", "room_steep"];
var VALID_SECTIONS = ["infused-spirit", "homemade-liqueur", "bitters-tincture", "modified-spirit", "homemade-spirit", "homemade-syrup", "juice-cordial", "shrub-vinegar", "zero-proof", "na-ferment", "misc"];
var VALID_FLAVOR_TAGS_PREP = ["\u9178", "\u751C", "\u82E6", "\u70C8", "\u9C9C", "\u67D1\u6A58", "\u70ED\u5E26", "\u8349\u672C", "\u82B1\u9999", "\u70DF\u718F", "\u6728\u6876", "\u9999\u6599", "\u575A\u679C\u53EF\u53EF", "\u6E05\u723D", "\u6D53\u90C1", "\u5E72\u723D", "\u590D\u6742"];
function validConf(v) {
  return ["high", "medium", "low"].includes(v) ? v : "medium";
}
__name(validConf, "validConf");
__name2(validConf, "validConf");
__name22(validConf, "validConf");
async function handleEnrichRecipe(env, body, origin) {
  const { name, nameEn, baseSpirit, method, ingredients, story, flavorDesc, source, rawText, bookTitle, lang: lang2 = "zh" } = body;
  const isEn = lang2 === "en";
  if (!name) return err("name required", 400, origin);
  const cacheKey = `enrich-recipe:${lang2}:${(name || "").toLowerCase().trim()}:${(nameEn || "").toLowerCase().trim()}`;
  const cached = await kvGet(env, cacheKey);
  if (cached) return json({ ...cached, _cached: true }, 200, origin);
  const spiritList = VALID_BASE_SPIRITS.join("/");
  const glassList = VALID_GLASSES.join("/");
  const ingredientLine = ingredients?.length ? isEn ? `
Ingredients: ${Array.isArray(ingredients) ? ingredients.map((i) => `${i.name} ${i.amount}`).join(", ") : ingredients}` : `
\u914D\u6599: ${Array.isArray(ingredients) ? ingredients.map((i) => `${i.name} ${i.amount}`).join(", ") : ingredients}` : "";
  const rawTextSection = rawText ? isEn ? `
Original text:
"""
${rawText.slice(0, 3e3)}
"""` : `
\u539F\u59CB\u6587\u672C:
"""
${rawText.slice(0, 3e3)}
"""` : "";
  const bookTitleSection = bookTitle ? isEn ? `
Source book: ${bookTitle}` : `
\u6765\u6E90\u4E66\u7C4D: ${bookTitle}` : "";
  const systemPrompt = `${isEn ? "CRITICAL: Write ALL descriptive text in English only.\n\n" : ""}\u4F60\u662F\u4E13\u4E1A\u7684\u9E21\u5C3E\u9152\u5386\u53F2\u5B66\u5BB6\u548C\u8C03\u9152\u5E08\uFF0C\u6DF1\u5EA6\u7814\u4E60\u4EE5\u4E0B\u6743\u5A01\u8D44\u6599\uFF1A
\u3010\u6743\u5A01\u4E66\u7C4D\u3011Jerry Thomas\u300ABartender's Guide\u300B(1862) \xB7 Harry Craddock\u300AThe Savoy Cocktail Book\u300B(1930) \xB7 David Embury\u300AThe Fine Art of Mixing Drinks\u300B(1948) \xB7 Gary Regan\u300AThe Joy of Mixology\u300B(2003) \xB7 Death & Co\u300ACocktail Codex\u300B(2018) \xB7 Jeffrey Morgenthaler\u300AThe Bar Book\u300B(2014) \xB7 Dave Arnold\u300ALiquid Intelligence\u300B(2014) \xB7 Sasha Petraske\u300ARegarding Cocktails\u300B(2016) \xB7 Jim Meehan\u300AThe PDT Cocktail Book\u300B(2011) \xB7 IBA \u5B98\u65B9\u914D\u65B9\u5E93 \xB7 Difford's Guide \xB7 \u300A\u8ABF\u9152\u5E2B\u624B\u518A\u300B(\u53F0\u7063\u7248) \xB7 \u300A\u4E16\u754C\u96DE\u5C3E\u9152\u5927\u5168\u300B(\u53F0\u7063\u7248)
\u3010variantOf \u7F6E\u4FE1\u5EA6\u89C4\u5219\u3011high=\u6743\u5A01\u8D44\u6599\u660E\u786E\u8BB0\u8F7D\uFF1Bmedium=\u4E1A\u754C\u516C\u8BA4\u4F46\u65E0\u5355\u4E00\u6743\u5A01\u6765\u6E90\uFF1Blow=\u63A8\u65AD
\u98CE\u5473\u63CF\u8FF0\u5FC5\u987B\u4E25\u683C\u4F7F\u7528\u4EE5\u4E0B\u4E09\u884C\u56FA\u5B9A\u7ED3\u6784\uFF08\u4E0D\u5F97\u589E\u51CF\u884C\u6570\uFF0C\u4E0D\u5F97\u6539\u53D8\u683C\u5F0F\uFF09\uFF1A
\u7B2C\u4E00\u884C\uFF1A\u6838\u5FC3\u57FA\u8C03\uFF1A[\u5217\u4E3E2-3\u4E2A\u6838\u5FC3\u98CE\u5473\u8BCD]
\u7B2C\u4E8C\u884C\uFF1A\u98CE\u5473\u6F14\u53D8\uFF1A[\u524D\u6BB5\u98CE\u5473] \u2794 [\u4E2D\u6BB5\u9AA8\u67B6] \u2794 [\u540E\u6BB5\u4F59\u97F5]
\u7B2C\u4E09\u884C\uFF1A\u6574\u4F53\u8D28\u611F\uFF1A[2-3\u4E2A\u5173\u4E8E\u9152\u4F53\u7ED3\u6784\u7684\u8D28\u611F\u8BCD\u6C47]
" + (isEn ? "IMPORTANT: ALL descriptive text fields (story, flavorDesc, source, variantOfDetail) MUST be in English." : "\u91CD\u8981\u89C4\u5219\uFF1A\u6240\u6709\u6807\u7B7E\u5B57\u6BB5\uFF08\u676F\u578B\u3001\u57FA\u9152\u3001\u5236\u4F5C\u65B9\u6CD5\u3001\u51B0\u5757\u3001\u98CE\u5473\u3001\u5206\u7C7B\u7B49\uFF09\u5FC5\u987B\u4F7F\u7528\u4E2D\u6587\uFF0C\u4E0D\u5F97\u4F7F\u7528\u82F1\u6587\u3002") + "`;
  const userPrompt = isEn ? `Analyze the following cocktail recipe and return complete JSON:
Recipe name: ${name}${nameEn ? ` (${nameEn})` : ""}
${baseSpirit ? `Base spirit: ${baseSpirit}` : ""}
${method ? `Method: ${method}` : ""}
${ingredientLine}${rawTextSection}${bookTitleSection}
Available base spirits (must pick from this list): ${spiritList}
Available glasses (must pick from this list): ${glassList}
Output the following JSON (unknown fields return empty string ""):
{
  "flavors": ["sour","sweet"],
  "flavorConfidence": "high"|"medium"|"low",
  "story": "${story ? '(existing content, supplement if better info available, else return "")' : "History and creation story (English, within 100 words)"}",
  "flavorDesc": "${flavorDesc ? '(existing content, supplement if better info available, else return "")' : "Strict 3-line format:\\nCore profile: ...\\nFlavor evolution: ... \u2794 ... \u2794 ...\\nOverall texture: ..."}",
  "source": "${source ? '(existing content, do not modify, return "")' : "Citation source (book name/IBA/bartender name etc.)"}",
  "confidence": "high"|"medium"|"low",
  "suggestedBaseSpirit": "${baseSpirit ? '(base spirit exists, return "")' : "pick from available base spirits list, if two equal use comma like: Whiskey,Brandy"}",
  "suggestedBaseSpiritConfidence": "high"|"medium"|"low",
  "suggestedGlass": "pick from available glasses list",
  "suggestedGlassConfidence": "high"|"medium"|"low",
  "suggestedIce": "pick one from ${JSON.stringify(VALID_ICE)}",
  "suggestedIceConfidence": "high"|"medium"|"low",
  "suggestedMethod": "pick one from ${JSON.stringify(VALID_METHODS)}",
  "suggestedStrength": "pick one from ${JSON.stringify(VALID_STRENGTHS)}",
  "suggestedDrinkDuration": "pick one from ${JSON.stringify(VALID_DURATIONS)}",
  "suggestedDurationConfidence": "high"|"medium"|"low",
  "suggestedOccasion": "pick one from ${JSON.stringify(VALID_OCCASIONS)}",
  "suggestedOccasionConfidence": "high"|"medium"|"low",
  "suggestedCodexFamily": "pick one from ${JSON.stringify(CODEX_LIST)}, unknown return """,
  "suggestedVariantOf": "[Required, pick one, no blank]: 'CLASSIC_ORIGINAL' (this recipe IS the classic original) | '[parent recipe name]' (this recipe is a variant of a classic, e.g. 'Negroni') | 'MODERN_ORIGINAL' (modern creation or cannot confirm classic origin)",
  "variantOfDetail": "Expanded content (150-250 words English, must be information-rich)",
  "variantOfConfidence": "high (authority source clearly documented) | medium (industry consensus but no single authority) | low (inferred)",
  "creator": "Recipe creator name (bartender/bar name), note: creator \u2260 book author",
  "creatorConfidence": "high"|"medium"|"low",
  "createdYear": "Creation year or era (e.g. '1930' / 'circa 1920s')",
  "createdYearConfidence": "high"|"medium"|"low",
  "suggestedNameZh": "IMPORTANT: If the recipe name has no Chinese characters, provide the Chinese name (2-6 chars, e.g. 尼格罗尼/大吉利/玛格丽特). If Chinese name already exists, return \"\"",
  "suggestedNameEn": "IMPORTANT: If the recipe name has no English characters, provide the English name (e.g. Negroni/Daiquiri). If English name already exists, return \"\""
}` : `\u8BF7\u5206\u6790\u4EE5\u4E0B\u9E21\u5C3E\u9152\u914D\u65B9\uFF0C\u8FD4\u56DE\u5B8C\u6574 JSON\uFF1A
\u914D\u65B9\u540D\u79F0: ${name}${nameEn ? ` (${nameEn})` : ""}
${baseSpirit ? `\u57FA\u9152: ${baseSpirit}` : ""}
${method ? `\u8C03\u5236\u65B9\u5F0F: ${method}` : ""}
${ingredientLine}${rawTextSection}${bookTitleSection}
\u53EF\u9009\u57FA\u9152\u5217\u8868\uFF08\u53EA\u80FD\u4ECE\u6B64\u5217\u8868\u9009\uFF09: ${spiritList}
\u53EF\u9009\u676F\u578B\u5217\u8868\uFF08\u53EA\u80FD\u4ECE\u6B64\u5217\u8868\u9009\uFF09: ${glassList}
\u8BF7\u8F93\u51FA\u4EE5\u4E0B JSON\uFF08\u4E0D\u786E\u5B9A\u7684\u5B57\u6BB5\u8FD4\u56DE\u7A7A\u5B57\u7B26\u4E32 ""\uFF09:
{
  "flavors": ["\u9178","\u751C"],
  "flavorConfidence": "high"|"medium"|"low",
  "story": "${story ? '(\u5DF2\u6709\u5185\u5BB9\uFF0C\u5982\u6709\u66F4\u597D\u4FE1\u606F\u53EF\u8865\u5145\uFF0C\u5426\u5219\u8FD4\u56DE\\"\\")' : "\u5386\u53F2\u6765\u5386\u4E0E\u521B\u4F5C\u6545\u4E8B\uFF08\u4E2D\u6587\uFF0C100\u5B57\u5185\uFF09"}",
  "flavorDesc": "${flavorDesc ? '(\u5DF2\u6709\u5185\u5BB9\uFF0C\u5982\u6709\u66F4\u597D\u4FE1\u606F\u53EF\u8865\u5145\uFF0C\u5426\u5219\u8FD4\u56DE\\"\\")' : "\u4E25\u683C\u4E09\u884C\u683C\u5F0F\uFF1A\\n\u6838\u5FC3\u57FA\u8C03\uFF1A...\\n\u98CE\u5473\u6F14\u53D8\uFF1A... \u2794 ... \u2794 ...\\n\u6574\u4F53\u8D28\u611F\uFF1A..."}",
  "source": "${source ? '(\u5DF2\u6709\u5185\u5BB9\uFF0C\u4E0D\u8981\u4FEE\u6539\uFF0C\u8FD4\u56DE\\"\\")' : "\u5F15\u7528\u6765\u6E90\uFF08\u4E66\u540D/IBA/\u8C03\u9152\u5E08\u540D\u7B49\uFF09"}",
  "confidence": "high"|"medium"|"low",
  "suggestedBaseSpirit": "${baseSpirit ? '(\u5DF2\u6709\u57FA\u9152\uFF0C\u8FD4\u56DE\\"\\")' : "\u4ECE\u53EF\u9009\u57FA\u9152\u5217\u8868\u4E2D\u9009\uFF0C\u82E5\u4E24\u79CD\u7B49\u91CF\u7528\u9017\u53F7\u5206\u9694\u5982\uFF1A\u5A01\u58EB\u5FCC,\u767D\u5170\u5730"}",
  "suggestedBaseSpiritConfidence": "high"|"medium"|"low",
  "suggestedGlass": "\u4ECE\u53EF\u9009\u676F\u578B\u5217\u8868\u4E2D\u9009",
  "suggestedGlassConfidence": "high"|"medium"|"low",
  "suggestedIce": "\u4ECE ${JSON.stringify(VALID_ICE)} \u4E2D\u9009\u4E00\u4E2A",
  "suggestedIceConfidence": "high"|"medium"|"low",
  "suggestedMethod": "\u4ECE ${JSON.stringify(VALID_METHODS)} \u4E2D\u9009\u4E00\u4E2A",
  "suggestedStrength": "\u4ECE ${JSON.stringify(VALID_STRENGTHS)} \u4E2D\u9009\u4E00\u4E2A",
  "suggestedDrinkDuration": "\u4ECE ${JSON.stringify(VALID_DURATIONS)} \u4E2D\u9009\u4E00\u4E2A",
  "suggestedDurationConfidence": "high"|"medium"|"low",
  "suggestedOccasion": "\u4ECE ${JSON.stringify(VALID_OCCASIONS)} \u4E2D\u9009\u4E00\u4E2A",
  "suggestedOccasionConfidence": "high"|"medium"|"low",
  "suggestedCodexFamily": "\u4ECE ${JSON.stringify(CODEX_LIST)} \u4E2D\u9009\u4E00\u4E2A\uFF0C\u4E0D\u786E\u5B9A\u8FD4\u56DE\\"\\"",
  "suggestedVariantOf": "\u3010\u5FC5\u586B\uFF0C\u4E09\u9009\u4E00\uFF0C\u7981\u6B62\u7559\u7A7A\u3011\uFF1A'CLASSIC_ORIGINAL'\uFF08\u672C\u914D\u65B9\u672C\u8EAB\u5C31\u662F\u7ECF\u5178\u539F\u7248\uFF09| '[\u6BCD\u914D\u65B9\u540D]'\uFF08\u672C\u914D\u65B9\u662F\u67D0\u7ECF\u5178\u7684\u53D8\u4F53\uFF0C\u5982 '\u5C3C\u683C\u7F57\u5C3C Negroni'\uFF09| 'MODERN_ORIGINAL'\uFF08\u73B0\u4EE3\u521B\u4F5C\u6216\u65E0\u6CD5\u786E\u8BA4\u7ECF\u5178\u6765\u6E90\uFF09",
  "variantOfDetail": "\u5C55\u5F00\u5185\u5BB9\uFF08150-250\u5B57\u4E2D\u6587\uFF0C\u5FC5\u987B\u4FE1\u606F\u4E30\u5BCC\uFF09",
  "variantOfConfidence": "high\uFF08\u6743\u5A01\u8D44\u6599\u660E\u786E\u8BB0\u8F7D\uFF09| medium\uFF08\u4E1A\u754C\u516C\u8BA4\u4F46\u65E0\u5355\u4E00\u6743\u5A01\u6765\u6E90\uFF09| low\uFF08\u63A8\u65AD\uFF09",
  "creator": "\u914D\u65B9\u521B\u4F5C\u8005\u59D3\u540D\uFF08\u8C03\u9152\u5E08/\u9152\u5427\u540D\uFF09\uFF0C\u6CE8\u610F\uFF1A\u521B\u4F5C\u8005\u2260\u4E66\u7684\u4F5C\u8005",
  "creatorConfidence": "high"|"medium"|"low",
  "createdYear": "\u521B\u4F5C\u5E74\u4EFD\u6216\u5E74\u4EE3\uFF08\u5982 '1930' / 'circa 1920s'\uFF09",
  "createdYearConfidence": "high"|"medium"|"low",
  "suggestedNameZh": "【重要】若配方名称中没有中文字符，请给出该鸡尾酒的中文名（2-6字，如：尼格罗尼、大吉利、玛格丽特），如已有中文名则返回\"\""  ,
  "suggestedNameEn": "【重要】若配方名称中没有英文字符，请给出该鸡尾酒的英文名（如：Negroni、Daiquiri），如已有英文名则返回\"\""
}`;
  try {
    const res = await callAI(env, [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ], { lang: lang2, maxTokens: 1500, responseFormat: { type: "json_object" } });
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content ?? "";
    const p = parseJsonLoose(raw);
    const rawFlavors = Array.isArray(p.flavors) ? p.flavors : [];
    const validFlavors = rawFlavors.filter((f) => VALID_FLAVOR_TAGS.includes(f)).slice(0, 6);
    const rawFlavorDesc = typeof p.flavorDesc === "string" ? p.flavorDesc.trim() : "";
    const flavorDescLines = rawFlavorDesc.split("\n").filter((l) => l.trim());
    const isValidFlavorDesc = flavorDescLines.length === 3 && flavorDescLines[1].includes("\u2794") && (flavorDescLines[0].includes("\u6838\u5FC3\u57FA\u8C03") || flavorDescLines[0].toLowerCase().includes("core") || flavorDescLines[0].toLowerCase().includes("profile")) && (flavorDescLines[2].includes("\u6574\u4F53\u8D28\u611F") || flavorDescLines[2].toLowerCase().includes("texture") || flavorDescLines[2].toLowerCase().includes("overall"));
    const result = {
      flavors: validFlavors,
      flavorConfidence: validConf(p.flavorConfidence),
      story: typeof p.story === "string" ? p.story.trim() : "",
      flavorDesc: rawFlavorDesc,
      source: typeof p.source === "string" ? p.source.trim() : "",
      confidence: validConf(p.confidence),
      suggestedBaseSpirit: typeof p.suggestedBaseSpirit === "string" ? p.suggestedBaseSpirit.trim() : "",
      suggestedBaseSpiritConfidence: validConf(p.suggestedBaseSpiritConfidence),
      suggestedGlass: VALID_GLASSES.includes(p.suggestedGlass) ? p.suggestedGlass : "",
      suggestedGlassConfidence: validConf(p.suggestedGlassConfidence),
      suggestedIce: VALID_ICE.includes(p.suggestedIce) ? p.suggestedIce : "",
      suggestedIceConfidence: validConf(p.suggestedIceConfidence),
      suggestedMethod: VALID_METHODS.includes(p.suggestedMethod) ? p.suggestedMethod : "",
      suggestedStrength: VALID_STRENGTHS.includes(p.suggestedStrength) ? p.suggestedStrength : "",
      suggestedDrinkDuration: VALID_DURATIONS.includes(p.suggestedDrinkDuration) ? p.suggestedDrinkDuration : "",
      suggestedDurationConfidence: validConf(p.suggestedDurationConfidence),
      suggestedOccasion: VALID_OCCASIONS.includes(p.suggestedOccasion) ? p.suggestedOccasion : "",
      suggestedOccasionConfidence: validConf(p.suggestedOccasionConfidence),
      suggestedCodexFamily: CODEX_LIST.find((c) => c === p.suggestedCodexFamily || c.startsWith(p.suggestedCodexFamily || "") || (p.suggestedCodexFamily || "").includes(c.split(" ")[0])) ?? "",
      suggestedVariantOf: typeof p.suggestedVariantOf === "string" && p.suggestedVariantOf.trim() ? p.suggestedVariantOf.trim() : "MODERN_ORIGINAL",
      variantOfDetail: typeof p.variantOfDetail === "string" ? p.variantOfDetail.trim() : "",
      variantOfConfidence: validConf(p.variantOfConfidence),
      creator: typeof p.creator === "string" ? p.creator.trim() : "",
      creatorConfidence: validConf(p.creatorConfidence),
      createdYear: typeof p.createdYear === "string" ? p.createdYear.trim() : "",
      createdYearConfidence: validConf(p.createdYearConfidence),
      suggestedNameZh: typeof p.suggestedNameZh === "string" ? p.suggestedNameZh.trim() : "",
      suggestedNameEn: typeof p.suggestedNameEn === "string" ? p.suggestedNameEn.trim() : ""
    };
    if (result.confidence === "high" || result.confidence === "medium") {
      await kvSet(env, cacheKey, result, 3600 * 6);
    }
    return json(result, 200, origin);
  } catch (e) {
    return err(`AI \u5206\u6790\u5931\u8D25: ${e.message}`, 500, origin);
  }
}
__name(handleEnrichRecipe, "handleEnrichRecipe");
__name2(handleEnrichRecipe, "handleEnrichRecipe");
__name22(handleEnrichRecipe, "handleEnrichRecipe");
async function handleEnrichRecipeStream(env, body, origin) {
  const { name, nameEn, baseSpirit, method, ingredients, lang: lang2 = "zh" } = body;
  const isEn = lang2 === "en";
  if (!name) return err("name required", 400, origin);
  const spiritList = VALID_BASE_SPIRITS.join("/");
  const glassList = VALID_GLASSES.join("/");
  const ingredientLine = ingredients?.length ? `
\u914D\u6599: ${Array.isArray(ingredients) ? ingredients.map((i) => `${i.name} ${i.amount}`).join(", ") : ingredients}` : "";
  const systemPrompt = `${isEn ? "CRITICAL: Write ALL descriptive text in English only.\n\n" : ""}\u4F60\u662F\u4E13\u4E1A\u7684\u9E21\u5C3E\u9152\u5386\u53F2\u5B66\u5BB6\u548C\u8C03\u9152\u5E08\u3002\u98CE\u5473\u63CF\u8FF0\u5FC5\u987B\u4E25\u683C\u4E09\u884C\uFF1A\u6838\u5FC3\u57FA\u8C03/\u98CE\u5473\u6F14\u53D8\uFF08\u7528\u2794\uFF09/\u6574\u4F53\u8D28\u611F\u3002" + (isEn ? "IMPORTANT: ALL descriptive text fields MUST be in English." : "\u6240\u6709\u6807\u7B7E\u5FC5\u987B\u4F7F\u7528\u4E2D\u6587\u3002") + "`;
  const userPrompt = `\u5206\u6790\u9E21\u5C3E\u9152"${name}"${nameEn ? `(${nameEn})` : ""}${baseSpirit ? `\uFF0C\u57FA\u9152\uFF1A${baseSpirit}` : ""}${method ? `\uFF0C\u5236\u6CD5\uFF1A${method}` : ""}${ingredientLine}\u3002\u8FD4\u56DE JSON \u5305\u542B\uFF1Astory, flavorDesc\uFF08\u4E09\u884C\u683C\u5F0F\uFF09, suggestedGlass\uFF08\u4ECE${glassList}\u9009\uFF09, suggestedBaseSpirit\uFF08\u4ECE${spiritList}\u9009\uFF09, suggestedMethod, suggestedIce, flavors\uFF08\u6570\u7EC4\uFF09, confidence\u3002`;
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  (async () => {
    try {
      const res = await callAI(env, [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ], { lang: lang2, maxTokens: 1200, stream: true });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data === "[DONE]") {
              await writer.write(encoder.encode("data: [DONE]\n\n"));
            } else {
              await writer.write(encoder.encode(`data: ${data}

`));
            }
          }
        }
      }
    } catch (e) {
      await writer.write(encoder.encode(`data: {"error":"${e.message}"}

`));
    } finally {
      await writer.close();
    }
  })();
  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      ...corsHeaders(origin)
    }
  });
}
__name(handleEnrichRecipeStream, "handleEnrichRecipeStream");
__name2(handleEnrichRecipeStream, "handleEnrichRecipeStream");
__name22(handleEnrichRecipeStream, "handleEnrichRecipeStream");
async function handleEnrichBottle(env, body, origin) {
  const { nameZh, nameEn, category, style, brand, origin: prod_origin, imageBase64, imageMime, bookSnippets, cellarBottles, lang: lang2 = "zh" } = body;
  const isEn = lang2 === "en";
  const name = [nameEn, nameZh].filter(Boolean).join(" / ");
  if (!name && !imageBase64) return err("name or image required", 400, origin);
  const cacheKey = !imageBase64 ? `enrich-bottle:${lang2}:${[nameZh || "", nameEn || "", brand || "", category || ""].join("|").toLowerCase().trim()}` : null;
  if (cacheKey) {
    const cached = await kvGet(env, cacheKey);
    if (cached) return json({ ...cached, _cached: true }, 200, origin);
  }
  const cat = category ?? "";
  const knownStyle = style ? isEn ? `
Known style: ${style}` : `
\u5DF2\u77E5\u98CE\u683C: ${style}` : "";
  const knownBrand = brand ? isEn ? `
Brand: ${brand}` : `
\u54C1\u724C: ${brand}` : "";
  const knownOrigin = prod_origin ? isEn ? `
Origin: ${prod_origin}` : `
\u4EA7\u5730: ${prod_origin}` : "";
  const knownCategory = cat ? isEn ? `
Category: ${cat}` : `
\u5206\u7C7B: ${cat}` : "";
  const styleOptions = cat && BOTTLE_STYLES_MAP[cat] ? isEn ? `
Style sub-tag (STRONGLY prefer picking one from this exact list; only fill "" if truly unidentifiable): ${JSON.stringify(BOTTLE_STYLES_MAP[cat])}` : `
\u53EF\u9009\u98CE\u683C\u5B50\u6807\u7B7E\uFF08\u5FC5\u987B\u4ECE\u4E2D\u9009\u4E00\uFF0C\u4E0D\u786E\u5B9A\u586B""\uFF09: ${JSON.stringify(BOTTLE_STYLES_MAP[cat])}` : "";
  const bookContext = bookSnippets?.length ? `

\u3010\u7528\u6237\u4E66\u5E93\u53C2\u8003\u8D44\u6599\u3011\u4EE5\u4E0B\u662F\u7528\u6237\u4E2A\u4EBA\u4E66\u5E93\u4E2D\u4E0E\u8BE5\u9152\u6B3E\u76F8\u5173\u7684\u539F\u6587\u6BB5\u843D\uFF0C\u8BF7\u4F18\u5148\u53C2\u8003\u8FD9\u4E9B\u5185\u5BB9\u8865\u5168 story/notes/styleDesc/distilleryInfo \u7B49\u63CF\u8FF0\u6027\u5B57\u6BB5\uFF1A
${bookSnippets.map((s, i) => `[\u6BB5\u843D${i + 1}] ${s}`).join("\n")}` : "";
  const cellarContext = cellarBottles?.length ? `

\u3010\u7528\u6237\u9152\u5E93\u53C2\u8003\u3011\u7528\u6237\u5F53\u524D\u9152\u5E93\u4E2D\u6709\u4EE5\u4E0B\u76F8\u5173\u9152\u6B3E\uFF1A${cellarBottles.slice(0, 15).join("\u3001")}\u3002\u8BF7\u57FA\u4E8E\u6B64\u63A8\u65AD\uFF1A1) \u8BE5\u9152\u6B3E\u53EF\u66FF\u4EE3\u9152\u5E93\u4E2D\u7684\u54EA\u6B3E\u9152\uFF08substituteFor\uFF09\uFF1B2) \u4E0E\u9152\u5E93\u4E2D\u54EA\u6B3E\u9152\u642D\u914D\u6548\u679C\u597D\uFF08pairsWith\uFF09\u3002\u5982\u65E0\u6CD5\u63A8\u65AD\u5219\u586B""\u3002` : "";
  const BASE_SPIRITS = ["\u91D1\u9152", "\u6717\u59C6", "\u4F0F\u7279\u52A0", "\u5A01\u58EB\u5FCC", "\u9F99\u820C\u5170", "\u767D\u5170\u5730", "\u6E05\u9152\u70E7\u9152", "\u4E2D\u5F0F\u767D\u9152"];
  const WINE_SPIRITS = ["\u5229\u53E3\u9152", "\u82E6\u7CBE", "\u5473\u7F8E\u601D", "\u5F00\u80C3\u9152", "\u8D77\u6CE1\u9152", "\u8461\u8404\u9152", "\u7CD6\u6D46", "\u8F6F\u996E"];
  const RAW_MATERIALS = ["\u7CD6\u4E0E\u751C\u5473\u5242", "\u679C\u852C", "\u9999\u6599\u4E0E\u8349\u672C", "\u82B1\u5349", "\u8336\u5496\u4E0E\u53EF\u53EF", "\u575A\u679C\u4E0E\u8C37\u7269", "\u4E73\u86CB", "\u9178\u7C7B\u4E0E\u6DFB\u52A0\u5242"];
  const libraryType = BASE_SPIRITS.includes(cat) ? "base" : WINE_SPIRITS.includes(cat) ? "wine" : RAW_MATERIALS.includes(cat) ? "material" : "base";
  let librarySpecificInstructions = "";
  if (isEn) {
    if (libraryType === "base") {
      librarySpecificInstructions = `
Focus areas (spirits library):
- Distillery/region info (e.g. "Glenfiddich Distillery, Speyside region")
- Production characteristics (e.g. "double pot still distillation, sherry cask matured")
- distilleryInfo: distillery/winery introduction (English, within 60 words, unknown fill "")`;
    } else if (libraryType === "wine") {
      librarySpecificInstructions = `
Focus areas (bottle library):
- Pairing relationships with other bottles (e.g. "great for Aperol Spritz, Negroni")
- pairingNotes: pairing suggestions (English, within 40 words, unknown fill "")`;
    } else {
      librarySpecificInstructions = `
Focus areas (ingredients library):
- Origin and seasonality (e.g. "Sicilian lemon, best in spring")
- Cocktail usage (e.g. "peel oil commonly used for Martini garnish, juice for sour cocktails")
- usageNotes: cocktail usage notes (English, within 60 words, unknown fill "")
- seasonality: seasonality notes (English, within 20 words, unknown fill "")`;
    }
  } else {
    if (libraryType === "base") {
      librarySpecificInstructions = `
\u91CD\u70B9\u8865\u5168\u65B9\u5411\uFF08\u57FA\u9152\u5E93\uFF09\uFF1A
- \u84B8\u998F\u5382/\u4EA7\u533A\u4FE1\u606F\uFF08\u5982"\u683C\u5170\u83F2\u8FEA\u84B8\u998F\u5382\uFF0C\u65AF\u4F69\u585E\u4EA7\u533A"\uFF09
- \u5DE5\u827A\u7279\u70B9\uFF08\u5982"\u53CC\u84B8\u94DC\u58F6\u84B8\u998F\uFF0C\u96EA\u5229\u6876\u9648\u917F"\uFF09
- distilleryInfo: \u84B8\u998F\u5382/\u9152\u5382\u7B80\u4ECB\uFF08\u4E2D\u6587\uFF0C60\u5B57\u5185\uFF0C\u4E0D\u786E\u5B9A\u586B""\uFF09`;
    } else if (libraryType === "wine") {
      librarySpecificInstructions = `
\u91CD\u70B9\u8865\u5168\u65B9\u5411\uFF08\u9152\u6B3E\u5E93\uFF09\uFF1A
- \u4E0E\u5176\u4ED6\u9152\u6B3E\u7684\u642D\u914D\u5173\u7CFB\uFF08\u5982"\u9002\u5408 Aperol Spritz\u3001Negroni"\uFF09
- pairingNotes: \u642D\u914D\u5EFA\u8BAE\uFF08\u4E2D\u6587\uFF0C40\u5B57\u5185\uFF0C\u4E0D\u786E\u5B9A\u586B""\uFF09`;
    } else {
      librarySpecificInstructions = `
\u91CD\u70B9\u8865\u5168\u65B9\u5411\uFF08\u539F\u6750\u6599\u5E93\uFF09\uFF1A
- \u4EA7\u5730\u4E0E\u5B63\u8282\u6027\uFF08\u5982"\u897F\u897F\u91CC\u67E0\u6A6C\uFF0C\u6625\u5B63\u6700\u4F73"\uFF09
- \u8C03\u9152\u7528\u9014\uFF08\u5982"\u76AE\u6CB9\u5E38\u7528\u4E8E Martini \u88C5\u9970\uFF0C\u679C\u6C41\u7528\u4E8E\u9178\u5473\u9E21\u5C3E\u9152"\uFF09
- usageNotes: \u8C03\u9152\u7528\u9014\u8BF4\u660E\uFF08\u4E2D\u6587\uFF0C60\u5B57\u5185\uFF0C\u4E0D\u786E\u5B9A\u586B""\uFF09
- seasonality: \u5B63\u8282\u6027\u8BF4\u660E\uFF08\u4E2D\u6587\uFF0C20\u5B57\u5185\uFF0C\u4E0D\u786E\u5B9A\u586B""\uFF09`;
    }
  }
  const VALID_FLAVOR_TAGS_FULL = VALID_FLAVOR_TAGS_BOTTLE;
  const prompt = isEn ? `You are a professional spirits/beverages/ingredients expert with deep knowledge of The Oxford Companion to Spirits & Cocktails (Wondrich & Rothbaum, 2021), WSET Spirits Level 1-4, Jim Murray's Whisky Bible, Dave Broom's The World Atlas of Whisky, Brad Thomas Parsons' Bitters (2011) and Amaro (2016), IBA official recipe library, and Difford's Guide.
Based on the following product information, fill in all fields at once.
Product name: ${name || "(unknown, please identify from photo)"}${knownCategory}${knownStyle}${knownBrand}${knownOrigin}${bookContext}${cellarContext}
${librarySpecificInstructions}
Output JSON (all fields required, unknown strings fill "", numbers fill 0):
{
  "found": true/false,
  "nameZh": "Chinese name (standard Chinese market name)",
  "nameEn": "English name (official brand English name)",
  "category": "must pick exactly one from: ${VALID_CATEGORIES_BOTTLE.join("/")}",
  "style": "style sub-tag, must pick exactly one from styleOptions list${styleOptions}, unknown fill """,
  "brand": "brand name, unknown fill """,
  "origin": "origin country/region, unknown fill """,
  "volume": "common size (e.g. 700ml), unknown fill """,
  "abv": alcohol percentage (number), unknown fill 0,
  "priceCny": estimated retail price in China (RMB, number), completely unknown fill 0,
  "notes": "one-line summary: flavor profile, common uses (English, within 50 words)",
  "flavorTags": pick 2-4 most suitable from ${JSON.stringify(VALID_FLAVOR_TAGS_FULL)} (array), only values from the list,
  "story": "product story/introduction (English, within 80 words), unknown fill """,
  "styleDesc": "style characteristics description (English, within 50 words), unknown fill """,
  "distilleryInfo": "distillery/winery intro (spirits library only, English, within 60 words), unknown fill """,
  "pairingNotes": "pairing suggestions (bottle library only, English, within 40 words), unknown fill """,
  "usageNotes": "cocktail usage notes (ingredients library only, English, within 60 words), unknown fill """,
  "seasonality": "seasonality notes (ingredients library only, English, within 20 words), unknown fill """,
  "confidence": "high"/"medium"/"low",
  "notesEn": "one-line English summary (English, within 50 words), unknown fill """,
  "storyEn": "English product story (English, within 80 words), unknown fill """,
  "substituteFor": "which bottle in user's cellar this can substitute, unknown fill """,
  "pairsWith": "which bottle in user's cellar pairs well with this, unknown fill """,
  "distilleryInfo": "distillery/winery intro (English, within 60 words), unknown fill """,
  "pairingNotes": "pairing suggestions (English, within 40 words), unknown fill """,
  "usageNotes": "cocktail usage notes (English, within 60 words), unknown fill """,
  "seasonality": "seasonality notes (English, within 20 words), unknown fill """ 
}
Rules:
- category must strictly match the above enum
- style must pick exactly one from the corresponding category's styleOptions list, not in list fill ""
- flavorTags can only pick from the given list, do not create new tags
- nameZh use standard Chinese market name; nameEn use official brand English name
- Output JSON only, no explanatory text` : `\u4F60\u662F\u4E13\u4E1A\u7684\u70C8\u9152/\u996E\u6599/\u539F\u6750\u6599\u77E5\u8BC6\u4E13\u5BB6\uFF0C\u6DF1\u5EA6\u7814\u4E60\u300AThe Oxford Companion to Spirits & Cocktails\u300B(Wondrich & Rothbaum, 2021)\u3001WSET \u70C8\u9152\u6559\u6750 Level 1-4\u3001Jim Murray\u300AWhisky Bible\u300B\u3001Dave Broom\u300AThe World Atlas of Whisky\u300B\u3001Brad Thomas Parsons\u300ABitters\u300B(2011)\u3001Brad Thomas Parsons\u300AAmaro\u300B(2016)\u3001\u300A\u5A01\u58EB\u5FCC\u5B78\u300B\u90B1\u5FB7\u592B\u8457\u3001\u300A\u8461\u8404\u9152\u5168\u66F8\u300B\u6797\u88D5\u68EE\u8457\u3001IBA \u5B98\u65B9\u914D\u65B9\u5EAB\u3001Difford's Guide \u7B49\u6743\u5A01\u8D44\u6599\uFF0C\u540C\u65F6\u7CBE\u901A\u4E2D\u82F1\u53CC\u8BED\u63CF\u8FF0\u3002
\u6839\u636E\u4EE5\u4E0B\u4EA7\u54C1\u4FE1\u606F\uFF0C\u4E00\u6B21\u6027\u8865\u5168\u6240\u6709\u5B57\u6BB5\u3002
\u4EA7\u54C1\u540D\u79F0: ${name || "\uFF08\u672A\u77E5\uFF0C\u8BF7\u6839\u636E\u7167\u7247\u8BC6\u522B\uFF09"}${knownCategory}${knownStyle}${knownBrand}${knownOrigin}${bookContext}${cellarContext}
${librarySpecificInstructions}
\u8BF7\u8F93\u51FA JSON\uFF08\u6240\u6709\u5B57\u6BB5\u5FC5\u987B\u5B58\u5728\uFF0C\u4E0D\u786E\u5B9A\u7684\u5B57\u7B26\u4E32\u586B ""\uFF0C\u6570\u5B57\u586B 0\uFF09:
{
  "found": true/false,
  "nameZh": "\u4E2D\u6587\u540D\uFF08\u4E2D\u56FD\u5E02\u573A\u901A\u7528\u8BD1\u540D\uFF09",
  "nameEn": "\u82F1\u6587\u540D\uFF08\u54C1\u724C\u5B98\u65B9\u82F1\u6587\u540D\uFF09",
  "category": "\u5FC5\u987B\u4ECE\u4EE5\u4E0B\u679A\u4E3E\u7CBE\u786E\u9009\u4E00: ${VALID_CATEGORIES_BOTTLE.join("/")}",
  "style": "\u98CE\u683C\u5B50\u6807\u7B7E\uFF0C\u5FC5\u987B\u4ECE styleOptions \u5217\u8868\u4E2D\u7CBE\u786E\u9009\u4E00${styleOptions}\uFF0C\u4E0D\u786E\u5B9A\u586B """  ,
  "brand": "\u54C1\u724C\u540D\uFF0C\u4E0D\u786E\u5B9A\u586B """  ,
  "origin": "\u4EA7\u5730\u7CBE\u786E\u5230\u56FD\u5BB6/\u5730\u533A\uFF0C\u4E0D\u786E\u5B9A\u586B """  ,
  "volume": "\u5E38\u89C1\u89C4\u683C\uFF08\u5982 700ml\uFF09\uFF0C\u4E0D\u786E\u5B9A\u586B """  ,
  "abv": \u9152\u7CBE\u5EA6\u6570\uFF08\u6570\u5B57\uFF09\uFF0C\u672A\u77E5\u586B 0,
  "priceCny": \u4E2D\u56FD\u5E02\u573A\u5E38\u89C1\u96F6\u552E\u4EF7\u4F30\u8BA1\uFF08\u4EBA\u6C11\u5E01\uFF0C\u6570\u5B57\uFF09\uFF0C\u5B8C\u5168\u65E0\u4ECE\u4F30\u8BA1\u586B 0,
  "notes": "\u4E00\u53E5\u8BDD\u7B80\u4ECB\uFF1A\u98CE\u5473\u7279\u5F81\u3001\u5E38\u89C1\u7528\u9014\uFF08\u4E2D\u6587\uFF0C50\u5B57\u5185\uFF09",
  "flavorTags": \u4ECE ${JSON.stringify(VALID_FLAVOR_TAGS_FULL)} \u4E2D\u9009\u6700\u5408\u9002\u76842-4\u4E2A\uFF08\u6570\u7EC4\uFF09\uFF0C\u53EA\u80FD\u9009\u5217\u8868\u4E2D\u7684\u5024,
  "story": "\u4EA7\u54C1\u6545\u4E8B/\u4ECB\u7ECD\uFF08\u4E2D\u6587\uFF0C80\u5B57\u5185\uFF09\uFF0C\u4E0D\u786E\u5B9A\u586B """  ,
  "styleDesc": "\u98CE\u683C\u7279\u70B9\u8BE6\u7EC6\u63CF\u8FF0\uFF08\u4E2D\u6587\uFF0C50\u5B57\u5185\uFF09\uFF0C\u4E0D\u786E\u5B9A\u586B """  ,
  "distilleryInfo": "\u84B8\u998F\u5382/\u9152\u5382\u7B80\u4ECB\uFF08\u57FA\u9152\u5E93\u4E13\u7528\uFF0C\u4E2D\u6587\uFF0C60\u5B57\u5185\uFF09\uFF0C\u4E0D\u786E\u5B9A\u586B """  ,
  "pairingNotes": "\u642D\u914D\u5EFA\u8BAE\uFF08\u9152\u6B3E\u5E93\u4E13\u7528\uFF0C\u4E2D\u6587\uFF0C40\u5B57\u5185\uFF09\uFF0C\u4E0D\u786E\u5B9A\u586B """  ,
  "usageNotes": "\u8C03\u9152\u7528\u9014\u8BF4\u660E\uFF08\u539F\u6750\u6599\u5E93\u4E13\u7528\uFF0C\u4E2D\u6587\uFF0C60\u5B57\u5185\uFF09\uFF0C\u4E0D\u786E\u5B9A\u586B """  ,
  "seasonality": "\u5B63\u8282\u6027\u8BF4\u660E\uFF08\u539F\u6750\u6599\u5E93\u4E13\u7528\uFF0C\u4E2D\u6587\uFF0C20\u5B57\u5185\uFF09\uFF0C\u4E0D\u786E\u5B9A\u586B """  ,
  "confidence": "high"/"medium"/"low",
  "notesEn": "\u4E00\u53E5\u8BDD\u82F1\u6587\u7B80\u4ECB\uFF08\u82F1\u6587\uFF0C50\u5B57\u5185\uFF09\uFF0C\u4E0D\u786E\u5B9A\u586B """  ,
  "storyEn": "\u82F1\u6587\u4EA7\u54C1\u6545\u4E8B\uFF08\u82F1\u6587\uFF0C80\u5B57\u5185\uFF09\uFF0C\u4E0D\u786E\u5B9A\u586B """  ,
  "substituteFor": "\u53EF\u66FF\u4EE3\u7528\u6237\u9152\u5E93\u4E2D\u7684\u54EA\u6B3E\u9152\uFF0C\u65E0\u6CD5\u63A8\u65AD\u586B """  ,
  "pairsWith": "\u4E0E\u7528\u6237\u9152\u5E93\u4E2D\u54EA\u6B3E\u9152\u642D\u914D\u6548\u679C\u597D\uFF0C\u65E0\u6CD5\u63A8\u65AD\u586B """  ,
  "distilleryInfo": "\u84B8\u998F\u5382/\u9152\u5382\u7B80\u4ECB\uFF08\u4E2D\u6587\uFF0C60\u5B57\u5185\uFF09\uFF0C\u4E0D\u786E\u5B9A\u586B """  ,
  "pairingNotes": "\u642D\u914D\u5EFA\u8BAE\uFF08\u4E2D\u6587\uFF0C40\u5B57\u5185\uFF09\uFF0C\u4E0D\u786E\u5B9A\u586B """  ,
  "usageNotes": "\u8C03\u9152\u7528\u9014\u8BF4\u660E\uFF08\u4E2D\u6587\uFF0C60\u5B57\u5185\uFF09\uFF0C\u4E0D\u786E\u5B9A\u586B """  ,
  "seasonality": "\u5B63\u8282\u6027\u8BF4\u660E\uFF08\u4E2D\u6587\uFF0C20\u5B57\u5185\uFF09\uFF0C\u4E0D\u786E\u5B9A\u586B """  
}
\u89C4\u5219\uFF1A
- category \u5FC5\u987B\u4E25\u683C\u843D\u5728\u4E0A\u8FF0\u679A\u4E3E\u4E2D
- style \u5FC5\u987B\u4ECE\u5BF9\u5E94 category \u7684 styleOptions \u5217\u8868\u4E2D\u7CBE\u786E\u9009\u4E00\uFF0C\u4E0D\u5728\u5217\u8868\u4E2D\u7684\u586B ""
- flavorTags \u53EA\u80FD\u4ECE\u7ED9\u5B9A\u5217\u8868\u4E2D\u9009\uFF0C\u4E0D\u80FD\u81EA\u9020\u65B0\u6807\u7B7E
- nameZh \u4F7F\u7528\u4E2D\u56FD\u5E02\u573A\u901A\u7528\u8BD1\u540D\uFF1BnameEn \u4F7F\u7528\u54C1\u724C\u5B98\u65B9\u82F1\u6587\u540D\u79F0
- \u53EA\u8F93\u51FA JSON\uFF0C\u4E0D\u8981\u4EFB\u4F55\u89E3\u91CA\u6587\u5B57`;
  const messages = [];
  if (imageBase64) {
    messages.push({
      role: "user",
      content: [
        { type: "image_url", image_url: { url: `data:${imageMime || "image/jpeg"};base64,${imageBase64}` } },
        { type: "text", text: prompt }
      ]
    });
  } else {
    messages.push({ role: "user", content: prompt });
  }
  try {
    const res = await callAI(env, messages, {
      lang: lang2,
      model: imageBase64 ? "deepseek-chat" : "deepseek-chat",
      maxTokens: 1200,
      responseFormat: imageBase64 ? null : { type: "json_object" }
    });
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content ?? "";
    const p = parseJsonLoose(raw);
    const resolvedCat = VALID_CATEGORIES_BOTTLE.includes(p.category) ? p.category : cat || "";
    const styleList = BOTTLE_STYLES_MAP[resolvedCat] ?? [];
    const rawStyle = typeof p.style === "string" ? p.style.trim() : "";
    const rawFlavors = Array.isArray(p.flavorTags) ? p.flavorTags : [];
    const result = {
      found: p.found !== false,
      nameZh: typeof p.nameZh === "string" ? p.nameZh.trim() : "",
      nameEn: typeof p.nameEn === "string" ? p.nameEn.trim() : "",
      category: resolvedCat,
      style: normalizeBottleStyle(rawStyle, styleList),
      styleRaw: rawStyle,
      brand: typeof p.brand === "string" ? p.brand.trim() : "",
      origin: typeof p.origin === "string" ? p.origin.trim() : "",
      volume: typeof p.volume === "string" ? p.volume.trim() : "",
      abv: typeof p.abv === "number" && p.abv >= 0 ? p.abv : 0,
      priceCny: typeof p.priceCny === "number" && p.priceCny >= 0 ? p.priceCny : 0,
      notes: typeof p.notes === "string" ? p.notes.trim() : "",
      flavorTags: rawFlavors.filter((f) => VALID_FLAVOR_TAGS_BOTTLE.includes(f)).slice(0, 4),
      story: typeof p.story === "string" ? p.story.trim() : "",
      styleDesc: typeof p.styleDesc === "string" ? p.styleDesc.trim() : "",
      distilleryInfo: typeof p.distilleryInfo === "string" ? p.distilleryInfo.trim() : "",
      pairingNotes: typeof p.pairingNotes === "string" ? p.pairingNotes.trim() : "",
      usageNotes: typeof p.usageNotes === "string" ? p.usageNotes.trim() : "",
      seasonality: typeof p.seasonality === "string" ? p.seasonality.trim() : "",
      confidence: validConf(p.confidence),
      notesEn: typeof p.notesEn === "string" ? p.notesEn.trim() : "",
      storyEn: typeof p.storyEn === "string" ? p.storyEn.trim() : "",
      substituteFor: typeof p.substituteFor === "string" ? p.substituteFor.trim() : "",
      pairsWith: typeof p.pairsWith === "string" ? p.pairsWith.trim() : ""
    };
    if (cacheKey && (result.confidence === "high" || result.confidence === "medium")) {
      await kvSet(env, cacheKey, result, 3600 * 6);
    }
    return json(result, 200, origin);
  } catch (e) {
    return err(`AI \u5206\u6790\u5931\u8D25: ${e.message}`, 500, origin);
  }
}
__name(handleEnrichBottle, "handleEnrichBottle");
__name2(handleEnrichBottle, "handleEnrichBottle");
__name22(handleEnrichBottle, "handleEnrichBottle");
async function handleEnrichHomemade(env, body, origin) {
  const { name, nameAlt, type: prepType, ingredients, lang: lang2 = "zh" } = body;
  const isEn = lang2 === "en";
  if (!name) return err("name required", 400, origin);
  const displayName = [name, nameAlt].filter(Boolean).join(" / ");
  const ingredientList = ingredients?.length ? isEn ? `
Ingredients: ${ingredients.join(", ")}` : `
\u914D\u65B9\u539F\u6599: ${ingredients.join(", ")}` : "";
  const knownType = prepType ? isEn ? `
Known type: ${prepType}` : `
\u5DF2\u77E5\u7C7B\u578B: ${prepType}` : "";
  const prompt = `${isEn ? "CRITICAL: Write ALL descriptive text in English only.\n\n" : ""}\u4F60\u662F\u4E13\u4E1A\u7684\u8C03\u9152\u5E08\u548C\u81EA\u5236\u996E\u54C1\u4E13\u5BB6\uFF0C\u6DF1\u5EA6\u7814\u4E60 Dave Arnold\u300ALiquid Intelligence\u300B(2014)\u3001Jeffrey Morgenthaler\u300AThe Bar Book\u300B(2014)\u3001Death & Co\u300ACocktail Codex\u300B(2018)\u3001Ryan Chetiyawardana\u300AGood Things to Drink\u300B(2015)\u3001\u300A\u8ABF\u9152\u7684\u79D1\u5B78\u300B(\u53F0\u7063\u7248)\u7B49\u6743\u5A01\u8D44\u6599\u3002
\u6839\u636E\u4EE5\u4E0B\u81EA\u5236\u54C1\u4FE1\u606F\uFF0C\u4E00\u6B21\u6027\u8865\u5168\u6240\u6709\u5B57\u6BB5\u3002
\u81EA\u5236\u54C1\u540D\u79F0: ${displayName}${knownType}${ingredientList}
\u8BF7\u8F93\u51FA JSON\uFF08\u6240\u6709\u5B57\u6BB5\u5FC5\u987B\u5B58\u5728\uFF0C\u4E0D\u786E\u5B9A\u7684\u5B57\u7B26\u4E32\u586B ""\uFF0C\u6570\u7EC4\u586B []\uFF09:
{
  "section": "\u5206\u533Akey\uFF0C\u5FC5\u987B\u4ECE\u4EE5\u4E0B\u7CBE\u786E\u9009\u4E00: ${VALID_SECTIONS.join("/")}\u3002\u542B\u9152\u7CBE(\u6D78\u6E0D/\u5229\u53E3\u9152/\u82E6\u7CBE/\u6539\u5236/\u53D1\u9175)\u2192\u524D5\u4E2A\uFF1B\u65E0\u9152\u7CBE(\u7CD6\u6D46/\u679C\u6C41/\u918B\u996E/\u96F6\u5EA6/\u65E0\u9152\u7CBE\u53D1\u9175/\u88C5\u9970)\u2192\u540E6\u4E2A",
  "prepType": "\u7C7B\u578Bkey\uFF0C\u5FC5\u987B\u4ECE\u4EE5\u4E0B\u7CBE\u786E\u9009\u4E00: ${VALID_PREP_TYPES.slice(0, 20).join("/")}...\uFF0C\u4E0D\u786E\u5B9A\u586B \\"other\\"",
  "techniques": "\u8BC6\u522B\u5230\u7684\u5DE5\u827Akey\u6570\u7EC4\uFF0C\u4ECE ${JSON.stringify(VALID_TECHNIQUES.slice(0, 10))} \u7B49\u4E2D\u90090-4\u4E2A",
  "flavorTags": "\u98CE\u5473\u6807\u7B7E\u6570\u7EC4\uFF0C\u4ECE ${JSON.stringify(VALID_FLAVOR_TAGS_PREP)} \u4E2D\u90091-3\u4E2A",
  "story": "\u81EA\u5236\u54C1\u4ECB\u7ECD/\u6545\u4E8B\uFF08\u4E2D\u6587\uFF0C80\u5B57\u5185\uFF0C\u63CF\u8FF0\u98CE\u5473\u7279\u70B9\u548C\u8C03\u9152\u7528\u9014\uFF09\uFF0C\u4E0D\u786E\u5B9A\u586B \\"\\"",
  "styleDesc": "\u98CE\u683C/\u53E3\u611F\u63CF\u8FF0\uFF08\u4E2D\u6587\uFF0C40\u5B57\u5185\uFF09\uFF0C\u4E0D\u786E\u5B9A\u586B \\"\\"",
  "shelfLife": "\u5EFA\u8BAE\u4FDD\u8D28\u671F\uFF08\u5982'\u51B7\u85CF2\u5468'\u6216'\u5BC6\u5C01\u5E38\u6E291\u4E2A\u6708'\uFF09\uFF0C\u4E0D\u786E\u5B9A\u586B \\"\\"",
  "storage": "\u50A8\u5B58\u5EFA\u8BAE\uFF08\u5982'\u51B7\u85CF\u5BC6\u5C01\u4FDD\u5B58\uFF0C\u4F7F\u7528\u524D\u6447\u5300'\uFF09\uFF0C\u4E0D\u786E\u5B9A\u586B \\"\\"",
  "usageNotes": "\u8C03\u9152\u7528\u9014\u8BF4\u660E\uFF08\u4E2D\u6587\uFF0C50\u5B57\u5185\uFF0C\u5982'\u53EF\u66FF\u4EE3 Cointreau\uFF0C\u9002\u5408 Margarita'\uFF09\uFF0C\u4E0D\u786E\u5B9A\u586B \\"\\"",
  "confidence": "high"/"medium"/"low"
}
\u89C4\u5219\uFF1Asection \u548C prepType \u5FC5\u987B\u4E25\u683C\u843D\u5728\u4E0A\u8FF0\u679A\u4E3E\u4E2D\uFF1Btechniques \u548C flavorTags \u53EA\u80FD\u4ECE\u7ED9\u5B9A\u5217\u8868\u4E2D\u9009\uFF1B\u53EA\u8F93\u51FA JSON\uFF0C\u4E0D\u8981\u4EFB\u4F55\u89E3\u91CA\u6587\u5B57`;
  try {
    const res = await callAI(env, [{ role: "user", content: prompt }], {
      lang: lang2,
      maxTokens: 800,
      responseFormat: { type: "json_object" }
    });
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content ?? "";
    const p = parseJsonLoose(raw);
    const validatedSection = VALID_SECTIONS.includes(p.section) ? p.section : "misc";
    const validatedPrepType = VALID_PREP_TYPES.includes(p.prepType) ? p.prepType : "other";
    const rawTechniques = Array.isArray(p.techniques) ? p.techniques : [];
    const validatedTechniques = rawTechniques.filter((t) => VALID_TECHNIQUES.includes(t)).slice(0, 4);
    const rawFlavors = Array.isArray(p.flavorTags) ? p.flavorTags : [];
    const validatedFlavors = rawFlavors.filter((f) => VALID_FLAVOR_TAGS_PREP.includes(f)).slice(0, 3);
    return json({
      section: validatedSection,
      prepType: validatedPrepType,
      techniques: validatedTechniques,
      flavorTags: validatedFlavors,
      story: typeof p.story === "string" ? p.story.trim() : "",
      styleDesc: typeof p.styleDesc === "string" ? p.styleDesc.trim() : "",
      shelfLife: typeof p.shelfLife === "string" ? p.shelfLife.trim() : "",
      storage: typeof p.storage === "string" ? p.storage.trim() : "",
      usageNotes: typeof p.usageNotes === "string" ? p.usageNotes.trim() : "",
      confidence: validConf(p.confidence)
    }, 200, origin);
  } catch (e) {
    return err(`AI \u5206\u6790\u5931\u8D25: ${e.message}`, 500, origin);
  }
}
__name(handleEnrichHomemade, "handleEnrichHomemade");
__name2(handleEnrichHomemade, "handleEnrichHomemade");
__name22(handleEnrichHomemade, "handleEnrichHomemade");
async function handleExtractRecipes(env, body, origin) {
  const { text, lang: lang2 = "zh" } = body;
  const isEn = lang2 === "en";
  if (!text) return err("text required", 400, origin);
  const prompt = `\u4F60\u662F\u4E13\u4E1A\u8C03\u9152\u5E08\u548C\u914D\u65B9\u8BC6\u522B\u4E13\u5BB6\uFF0C\u7CBE\u901A\u4E2D\u82F1\u6587\u7E41\u4F53\u4E2D\u6587\u8C03\u9152\u6587\u732E\uFF08\u5305\u62EC Jerry Thomas\u300ABartender's Guide\u300B1862\u3001Harry Craddock\u300AThe Savoy Cocktail Book\u300B1930\u3001Death & Co\u300ACocktail Codex\u300B2018\u3001IBA \u5B98\u65B9\u914D\u65B9\u3001\u300A\u8ABF\u9152\u5E2B\u624B\u518A\u300B\u53F0\u7063\u7248\u3001\u300A\u4E16\u754C\u96DE\u5C3E\u9152\u5927\u5168\u300B\u53F0\u7063\u7248\u7B49\uFF09\u3002\u8BF7\u4ECE\u4EE5\u4E0B\u6587\u5B57\u4E2D\u8BC6\u522B\u5E76\u63D0\u53D6\u6240\u6709\u9E21\u5C3E\u9152\u914D\u65B9\u3002
\u6587\u5B57\u5185\u5BB9\uFF1A
"""
${text.slice(0, 8e3)}
"""
\u8BC6\u522B\u89C4\u5219\uFF1A
1. \u6BCF\u4E2A\u72EC\u7ACB\u7684\u9E21\u5C3E\u9152\uFF08\u6709\u540D\u79F0+\u914D\u6599\uFF09\u7B97\u4E00\u4E2A\u914D\u65B9
2. \u914D\u6599\u884C\u901A\u5E38\u5305\u542B\u6570\u91CF\uFF08oz/ml/dash/tsp\u7B49\uFF09+ \u6750\u6599\u540D
3. \u6B65\u9AA4\u901A\u5E38\u662F\u52A8\u8BCD\u5F00\u5934\u7684\u53E5\u5B50\uFF08Stir/Shake/Combine\u7B49\uFF09
4. \u5982\u679C\u6587\u5B57\u4E2D\u6CA1\u6709\u914D\u65B9\uFF0C\u8FD4\u56DE\u7A7A\u6570\u7EC4
5. unit\u5B57\u6BB5\u53EA\u586B\u5355\u4F4D\u672C\u8EAB\uFF08\u5982 oz/ml/dash/tsp\uFF09\uFF0C\u4E0D\u542B\u6570\u5B57\u3002\u53EF\u9009\u5355\u4F4D\uFF1A\u6DB2\u4F53(ml/cl/oz/fl oz/L/dl)\u3001\u5C0F\u5C3A(dash/tsp/tbsp/bsp/dsp)\u3001\u8BA1\u6570(\u4E2A/\u7247/\u679D/\u5757/\u5706/\u9897/\u6EF4/drop)\u3001\u6BD4\u4F8B(part/scsp)\u3001\u6A21\u7CCA(\u9002\u91CF/\u5C11\u8BB8/pinch/rinse/float/top)\u3002\u6587\u672C\u4E2D\u65E0\u5355\u4F4D\u65F6\u8FD4\u56DE\u7A7A\u5B57\u7B26\u4E32
\u8BF7\u8F93\u51FA JSON\uFF08\u4E25\u683C\u683C\u5F0F\uFF09\uFF0C\u5305\u542B recipes \u6570\u7EC4\uFF1A
{
  "recipes": [
    {
      "name": "\u914D\u65B9\u540D\u79F0\uFF08\u539F\u6587\uFF09",
      "nameZh": "\u4E2D\u6587\u540D\uFF08\u5982\u80FD\u63A8\u65AD\uFF0C\u5426\u5219\u7A7A\u5B57\u7B26\u4E32\uFF09",
      "author": "\u4F5C\u8005/\u6765\u6E90\uFF08\u5982\u6709\uFF0C\u5426\u5219\u7A7A\u5B57\u7B26\u4E32\uFF09",
      "year": "\u5E74\u4EFD\uFF08\u5982\u6709\uFF0C\u5426\u5219\u7A7A\u5B57\u7B26\u4E32\uFF09",
      "ingredients": [
        { "text": "2 oz Rye Whiskey", "amount": "2", "unit": "oz", "name": "Rye Whiskey", "confidence": "high" }
      ],
      "steps": "\u5B8C\u6574\u6B65\u9AA4\u8BF4\u660E\uFF08\u539F\u6587\uFF0C\u5982\u65E0\u5219\u7A7A\u5B57\u7B26\u4E32\uFF09",
      "garnish": "\u88C5\u9970\u7269\uFF08\u5982\u6709\uFF0C\u5426\u5219\u7A7A\u5B57\u7B26\u4E32\uFF09",
      "glass": "\u676F\u578B\uFF08\u5982\u80FD\u63A8\u65AD\uFF0C\u5426\u5219\u7A7A\u5B57\u7B26\u4E32\uFF09",
      "method": "\u8C03\u5236\u6CD5\uFF08\u5982 \u6447\u548C/\u6405\u62CC/\u76F4\u8C03\uFF0C\u5982\u80FD\u63A8\u65AD\uFF0C\u5426\u5219\u7A7A\u5B57\u7B26\u4E32\uFF09",
      "notes": "\u5907\u6CE8/\u8BF4\u660E\uFF08\u5982\u6709\uFF0C\u5426\u5219\u7A7A\u5B57\u7B26\u4E32\uFF09",
      "confidence": "high|medium|low",
      "missingFields": []
    }
  ]
}
\u53EA\u8F93\u51FA JSON\uFF0C\u4E0D\u8981\u4EFB\u4F55\u89E3\u91CA\u6587\u5B57\u3002`;
  try {
    const res = await callAI(env, [{ role: "user", content: prompt }], {
      lang: lang2,
      maxTokens: 3e3,
      responseFormat: { type: "json_object" }
    });
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content ?? "";
    const parsed = parseJsonLoose(raw);
    const arr = Array.isArray(parsed?.recipes) ? parsed.recipes : Array.isArray(parsed) ? parsed : [];
    const recipes = arr.slice(0, 10).map((item) => ({
      name: typeof item.name === "string" ? item.name.trim() : "",
      nameZh: typeof item.nameZh === "string" ? item.nameZh.trim() : "",
      author: typeof item.author === "string" ? item.author.trim() : "",
      year: typeof item.year === "string" ? item.year.trim() : "",
      ingredients: Array.isArray(item.ingredients) ? item.ingredients.map((ing) => ({
        text: typeof ing.text === "string" ? ing.text.trim() : "",
        amount: typeof ing.amount === "string" ? ing.amount.trim() : "",
        unit: typeof ing.unit === "string" ? ing.unit.trim() : "",
        name: typeof ing.name === "string" ? ing.name.trim() : "",
        confidence: validConf(ing.confidence)
      })) : [],
      steps: typeof item.steps === "string" ? item.steps.trim() : "",
      garnish: typeof item.garnish === "string" ? item.garnish.trim() : "",
      glass: typeof item.glass === "string" ? item.glass.trim() : "",
      method: typeof item.method === "string" ? item.method.trim() : "",
      notes: typeof item.notes === "string" ? item.notes.trim() : "",
      confidence: validConf(item.confidence),
      missingFields: Array.isArray(item.missingFields) ? item.missingFields.filter((f) => typeof f === "string") : []
    }));
    return json(recipes, 200, origin);
  } catch (e) {
    return err(`AI \u5206\u6790\u5931\u8D25: ${e.message}`, 500, origin);
  }
}
__name(handleExtractRecipes, "handleExtractRecipes");
__name2(handleExtractRecipes, "handleExtractRecipes");
__name22(handleExtractRecipes, "handleExtractRecipes");
var OCR_SYSTEM_PROMPT = `\u4F60\u662F\u4E00\u4E2A\u7CBE\u51C6\u7684\u4E66\u9875\u6587\u5B57\u8F6C\u5199(OCR)\u52A9\u624B\u3002\u7528\u6237\u63D0\u4F9B\u4E66\u9875\u56FE\u7247\u6216\u626B\u63CF\u7248 PDF\uFF0C\u8BF7\u628A\u5168\u90E8\u53EF\u8BFB\u6587\u5B57\u6309\u539F\u59CB\u9605\u8BFB\u987A\u5E8F\u5B8C\u6574\u8F6C\u5199\u4E3A\u7EAF\u6587\u672C\uFF1A
- \u7AE0\u8282\u6807\u9898\u6216\u914D\u65B9\u540D\u79F0\u884C\u52A0 "## " \u524D\u7F00
- \u914D\u6599\u884C\u4FDD\u6301"\u540D\u79F0 \u7528\u91CF"\u683C\u5F0F\uFF0C\u4E00\u884C\u4E00\u6761
- \u4FDD\u7559\u6362\u884C\u4E0E\u6761\u76EE\u8FB9\u754C\uFF0C\u4E0D\u8981\u5408\u5E76\u4E0D\u540C\u914D\u65B9
- \u4E2D\u82F1\u6587\u5747\u9700\u5B8C\u6574\u8F6C\u5199\uFF0C\u4E13\u6709\u540D\u8BCD\u4FDD\u7559\u539F\u6587
- \u53EA\u8F93\u51FA\u8F6C\u5199\u6587\u672C\uFF1A\u4E0D\u8981\u89E3\u91CA\u3001\u4E0D\u8981\u7FFB\u8BD1\u3001\u4E0D\u8981 markdown \u4EE3\u7801\u5757
- \u9875\u9762\u6CA1\u6709\u6587\u5B57\u65F6\u8F93\u51FA\u7A7A\u5B57\u7B26\u4E32`;
async function callQwenVL(env, messages, maxTokens) {
  if (!env.QWEN_API_KEY) throw new Error("QWEN_API_KEY not configured");
  const res = await fetch("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.QWEN_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "qwen-vl-max", messages, max_tokens: maxTokens || 4e3 })
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Qwen API error ${res.status}: ${t.slice(0, 300)}`);
  }
  return res;
}
__name(callQwenVL, "callQwenVL");
__name2(callQwenVL, "callQwenVL");
__name22(callQwenVL, "callQwenVL");
async function callGeminiFlash(env, images, pdfBase64) {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not configured");
  const parts = [];
  if (pdfBase64) {
    parts.push({ inline_data: { mime_type: "application/pdf", data: pdfBase64 } });
  }
  for (const img of (images || []).slice(0, 8)) {
    parts.push({ inline_data: { mime_type: img.mime || "image/jpeg", data: img.base64 } });
  }
  parts.push({ text: OCR_SYSTEM_PROMPT + "\n\n\u8BF7\u5B8C\u6574\u8F6C\u5199\u4EE5\u4E0A\u4E66\u9875\u4E2D\u7684\u5168\u90E8\u6587\u5B57\u3002" });
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts }] })
    }
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return typeof text === "string" ? text.trim() : "";
}
__name(callGeminiFlash, "callGeminiFlash");
__name2(callGeminiFlash, "callGeminiFlash");
__name22(callGeminiFlash, "callGeminiFlash");
async function handleOcr(env, body, origin) {
  const { images, pdfBase64, lang: lang2 } = body;
  if (!images?.length && !pdfBase64) return err("images or pdfBase64 required", 400, origin);
  const userContent = [];
  if (pdfBase64) {
    userContent.push({ type: "image_url", image_url: { url: `data:application/pdf;base64,${pdfBase64}` } });
  }
  for (const img of (images || []).slice(0, 8)) {
    userContent.push({ type: "image_url", image_url: { url: `data:${img.mime || "image/jpeg"};base64,${img.base64}` } });
  }
  userContent.push({ type: "text", text: "\u8BF7\u5B8C\u6574\u8F6C\u5199\u4EE5\u4E0A\u4E66\u9875\u4E2D\u7684\u5168\u90E8\u6587\u5B57\u3002" });
  const useQwenFirst = (lang2 || "zh") !== "en";
  const primaryFn = useQwenFirst ? () => callQwenVL(env, [{ role: "system", content: OCR_SYSTEM_PROMPT }, { role: "user", content: userContent }], 4e3).then((r) => r.json()).then((d) => {
    const t = d.choices?.[0]?.message?.content ?? "";
    return typeof t === "string" ? t.trim() : "";
  }) : () => callGeminiFlash(env, images, pdfBase64);
  const fallbackFn = useQwenFirst ? () => callGeminiFlash(env, images, pdfBase64) : () => callQwenVL(env, [{ role: "system", content: OCR_SYSTEM_PROMPT }, { role: "user", content: userContent }], 4e3).then((r) => r.json()).then((d) => {
    const t = d.choices?.[0]?.message?.content ?? "";
    return typeof t === "string" ? t.trim() : "";
  });
  try {
    const text = await primaryFn();
    return json({ text, _model: useQwenFirst ? "qwen-vl-max" : "gemini-2.0-flash" }, 200, origin);
  } catch (primaryErr) {
    console.warn("[OCR] PRIMARY_MODEL_FALLBACK");
    try {
      const text = await fallbackFn();
      return json({ text, _model: useQwenFirst ? "gemini-2.0-flash" : "qwen-vl-max", _fallback: true }, 200, origin);
    } catch (fallbackErr) {
      return err(`OCR \u5931\u8D25: \u4E3B\u6A21\u578B(${primaryErr.message}) \u5907\u7528\u6A21\u578B(${fallbackErr.message})`, 500, origin);
    }
  }
}
__name(handleOcr, "handleOcr");
__name2(handleOcr, "handleOcr");
__name22(handleOcr, "handleOcr");
async function handleTranslate(env, body, origin) {
  const { target, items } = body;
  if (!target || !items?.length) return err("target and items required", 400, origin);
  const TRANSLATE_SYSTEM_PROMPT = `\u4F60\u662F\u4E13\u4E1A\u7684\u8C03\u9152\u4E66\u7C4D\u8BD1\u8005\u3002\u628A\u7528\u6237 JSON \u4E2D\u7684\u6BCF\u4E2A\u914D\u65B9\u6761\u76EE\u7FFB\u8BD1\u6210${target === "zh" ? "\u4E2D\u6587" : "\u82F1\u6587(English)"}\u3002\u89C4\u5219:
- \u4F7F\u7528\u8C03\u9152\u884C\u4E1A\u6807\u51C6\u672F\u8BED(\u5982 gin\u2194\u91D1\u9152\u3001shake\u2194\u6447\u548C\u3001coupe\u2194\u5E93\u4F69\u676F)
- amount \u7528\u91CF\u4E2D\u7684\u6570\u5B57\u4E0E\u5355\u4F4D\u4FDD\u6301\u539F\u6837(\u5982 45ml\u30012 dash\u30011 bar spoon)
- \u54C1\u724C\u7B49\u4E13\u6709\u540D\u8BCD\u4FDD\u7559\u539F\u6587
- id \u539F\u6837\u8FD4\u56DE;\u4E0D\u5F97\u589E\u5220\u6761\u76EE
- \u5DF2\u662F\u76EE\u6807\u8BED\u8A00\u7684\u5185\u5BB9\u539F\u6837\u4FDD\u7559
\u8F93\u51FA JSON:{"items":[{"id":"","name":"","ingredients":[{"name":"","amount":""}],"steps":"","garnish":"","glass":"","method":""}]}`;
  try {
    const res = await callAI(env, [
      { role: "system", content: TRANSLATE_SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify({ items: items.slice(0, 20) }) }
    ], { lang, maxTokens: 4e3, responseFormat: { type: "json_object" } });
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content ?? "";
    const parsed = parseJsonLoose(raw);
    const arr = Array.isArray(parsed?.items) ? parsed.items : [];
    const translatedItems = arr.slice(0, 20).filter((it) => it && it.id);
    return json({ items: translatedItems }, 200, origin);
  } catch (e) {
    return err(`\u7FFB\u8BD1\u5931\u8D25: ${e.message}`, 500, origin);
  }
}
__name(handleTranslate, "handleTranslate");
__name2(handleTranslate, "handleTranslate");
__name22(handleTranslate, "handleTranslate");
async function handleBulkImport(env, body, origin) {
  const { text, imageBase64, imageMime, lang: lang2 = "zh" } = body;
  const isEnBulk = lang2 === "en";
  if (!text && !imageBase64) return err("text or image required", 400, origin);
  const EXTRACT_SYSTEM_PROMPT = isEnBulk ? `You are a data import assistant for a cocktail app. The user will provide text (possibly from PDF/Excel/Word/paste) that may contain:
1. bottle (bar stock): commercially bottled spirits/ingredients, e.g. gin, whiskey, liqueur, bitters, syrup, juice, soft drinks
2. prep (homemade): homemade syrups, liqueurs, infused spirits, etc., usually with recipe/shelf life/storage info
3. recipe (cocktail recipe): cocktail recipes with ingredient list and preparation steps
4. material (raw ingredients): fresh fruit, herbs/spices, sugar, eggs/dairy, tea/coffee, etc.
Extract all identifiable items from the text and output JSON:
{"items":[{
  "type":"bottle"|"prep"|"recipe"|"material",
  "nameZh":"Chinese name (translate if missing)","nameEn":"English name (translate or romanize if missing)",
  "category":"bottle category e.g. Gin/Whiskey/Liqueur/Bitters/Syrup/Juice/Soft Drink; material fixed as Raw Material","style":"style sub-category","brand":"brand","origin":"origin","volume":"size e.g. 700ml","abv":40,"priceCny":0,"packQty":10,"packUnit":"pc",
  "prepIngredients":["prep ingredient one per line"],"prepRecipe":"recipe","prepYield":"yield e.g. ~750ml","shelfLife":"shelf life","storage":"storage method",
  "baseSpirit":"recipe base spirit","glass":"glass type","method":"preparation method","ingredients":[{"name":"ingredient name","amount":"amount e.g. 45ml"}],"steps":"steps","garnish":"garnish","source":"source",
  "variantOf":"classic variant source only if explicitly stated in text","codexFamily":"Codex family only if explicitly stated",
  "notes":"notes"
}]}
Rules:
- Numeric fields abv/priceCny/packQty output numbers, unknown fill 0. packQty+packUnit = packaging quantity+unit, e.g. "10pcs/8CNY" -> packQty:10 packUnit:"pc" priceCny:8; "24cans/60CNY" -> packQty:24 packUnit:"can" priceCny:60; "700ml/120CNY" -> packQty:1 packUnit:"bottle" priceCny:120. If not stated, leave packQty:0 packUnit:""
- Unknown string fields fill ""
- variantOf/codexFamily only extract when explicitly stated (do not infer)
- Both nameZh and nameEn must be provided
- Do not fabricate items not in the text
- Extract at most 60 items` : `\u4F60\u662F\u4E00\u4E2A\u9E21\u5C3E\u9152\u5E94\u7528\u7684\u6570\u636E\u5BFC\u5165\u52A9\u624B\u3002\u7528\u6237\u4F1A\u63D0\u4F9B\u4E00\u6BB5\u6587\u672C(\u53EF\u80FD\u6765\u81EA PDF/Excel/Word/\u7C98\u8D34),\u5185\u5BB9\u53EF\u80FD\u5305\u542B:
1. bottle(\u9152\u5E93\u6761\u76EE):\u5E02\u552E\u7684\u74F6\u88C5\u9152/\u539F\u6599,\u5982\u91D1\u9152\u3001\u5A01\u58EB\u5FCC\u3001\u5229\u53E3\u9152\u3001\u82E6\u7CBE\u3001\u7CD6\u6D46\u3001\u679C\u6C41\u3001\u8F6F\u996E\u7B49
2. prep(\u81EA\u5236\u5E93\u6761\u76EE):\u81EA\u5236\u7684\u7CD6\u6D46\u3001\u5229\u53E3\u9152\u3001\u98CE\u5473\u6DB2\u4F53\u3001\u6D78\u6E0D\u9152\u7B49,\u901A\u5E38\u6709\u505A\u6CD5/\u4FDD\u8D28\u671F/\u50A8\u5B58\u65B9\u5F0F
3. recipe(\u9152\u5355\u914D\u65B9):\u9E21\u5C3E\u9152\u914D\u65B9,\u6709\u914D\u6599\u8868\u548C\u8C03\u5236\u6B65\u9AA4
4. material(\u539F\u6750\u6599\u5E93\u6761\u76EE):\u65B0\u9C9C\u6C34\u679C\u3001\u9999\u8349\u9999\u6599\u3001\u7CD6\u7C7B\u3001\u86CB\u5976\u3001\u8336\u5496\u7B49\u8C03\u9152\u539F\u6750\u6599
\u8BF7\u4ECE\u6587\u672C\u4E2D\u63D0\u53D6\u6240\u6709\u53EF\u8BC6\u522B\u7684\u6761\u76EE,\u8F93\u51FA JSON:
{"items":[{
  "type":"bottle"|"prep"|"recipe"|"material",
  "nameZh":"\u4E2D\u6587\u540D(\u6CA1\u6709\u5219\u8BD1)","nameEn":"\u82F1\u6587\u540D(\u6CA1\u6709\u5219\u8BD1\u6216\u62FC\u97F3)",
  "category":"bottle\u5206\u7C7B,\u5982 \u91D1\u9152/\u5A01\u58EB\u5FCC/\u5229\u53E3\u9152/\u82E6\u7CBE/\u7CD6\u6D46/\u679C\u6C41/\u8F6F\u996E;material\u56FA\u5B9A\u4E3A \u539F\u6750\u6599","style":"\u98CE\u683C\u5B50\u5206\u7C7B","brand":"\u54C1\u724C","origin":"\u4EA7\u5730","volume":"\u89C4\u683C\u5982 700ml","abv":40,"priceCny":0,"packQty":10,"packUnit":"\u4E2A",
  "prepIngredients":["prep\u914D\u6599\u4E00\u884C\u4E00\u6761"],"prepRecipe":"\u505A\u6CD5","prepYield":"\u4EA7\u91CF\u5982 ~750ml","shelfLife":"\u4FDD\u8D28\u671F","storage":"\u50A8\u5B58\u65B9\u5F0F",
  "baseSpirit":"recipe\u57FA\u9152","glass":"\u676F\u578B","method":"\u8C03\u5236\u6CD5","ingredients":[{"name":"\u914D\u6599\u540D","amount":"\u7528\u91CF\u5982 45ml"}],"steps":"\u6B65\u9AA4","garnish":"\u88C5\u9970","source":"\u51FA\u5904",
  "variantOf":"\u6587\u672C\u660E\u786E\u5199\u660E\u7684\u7ECF\u5178\u53D8\u4F53\u6765\u6E90","codexFamily":"\u6587\u672C\u660E\u786E\u5199\u660E\u7684 Codex \u516D\u5927\u5BB6\u65CF\u5F52\u5C5E",
  "notes":"\u5907\u6CE8"
}]}
\u89C4\u5219:
- \u6570\u503C\u5B57\u6BB5 abv/priceCny/packQty \u8F93\u51FA\u6570\u5B57,\u672A\u77E5\u586B 0\u3002packQty+packUnit=\u5305\u88C5\u6570\u91CF+\u5355\u4F4D,\u5982"10\u4E2A/\u00A58"->packQty:10 packUnit:"\u4E2A" priceCny:8;"24\u542C/\u00A560"->packQty:24 packUnit:"\u542C" priceCny:60;\u672A\u6CE8\u660E\u5219packQty:0 packUnit:""
- \u672A\u77E5\u7684\u5B57\u7B26\u4E32\u5B57\u6BB5\u586B ""
- variantOf/codexFamily \u53EA\u5728\u539F\u6587\u660E\u786E\u58F0\u660E\u65F6\u63D0\u53D6(\u4E0D\u8981\u81EA\u884C\u63A8\u65AD)
- nameZh \u4E0E nameEn \u5FC5\u987B\u90FD\u7ED9\u51FA
- \u4E0D\u8981\u7F16\u9020\u6587\u672C\u4E2D\u4E0D\u5B58\u5728\u7684\u6761\u76EE
- \u6700\u591A\u63D0\u53D6 60 \u6761`;
  const parseItems = /* @__PURE__ */ __name22((raw) => {
    const parsed = parseJsonLoose(raw);
    const arr = Array.isArray(parsed?.items) ? parsed.items : [];
    return arr.slice(0, 60).filter((it) => it && (it.nameZh?.trim() || it.nameEn?.trim())).map((it) => ({
      type: ["bottle", "prep", "recipe", "material"].includes(it.type) ? it.type : "bottle",
      nameZh: String(it.nameZh || ""),
      nameEn: String(it.nameEn || ""),
      category: String(it.category || ""),
      style: String(it.style || ""),
      brand: String(it.brand || ""),
      origin: String(it.origin || ""),
      volume: String(it.volume || ""),
      abv: typeof it.abv === "number" ? it.abv : 0,
      priceCny: typeof it.priceCny === "number" ? it.priceCny : 0,
      packQty: typeof it.packQty === "number" && it.packQty > 0 ? it.packQty : undefined,
      packUnit: it.packUnit && String(it.packUnit).trim() ? String(it.packUnit).trim() : undefined,
      prepIngredients: Array.isArray(it.prepIngredients) ? it.prepIngredients : [],
      prepRecipe: String(it.prepRecipe || ""),
      prepYield: String(it.prepYield || ""),
      shelfLife: String(it.shelfLife || ""),
      storage: String(it.storage || ""),
      baseSpirit: String(it.baseSpirit || ""),
      glass: String(it.glass || ""),
      method: String(it.method || ""),
      ingredients: Array.isArray(it.ingredients) ? it.ingredients : [],
      steps: String(it.steps || ""),
      garnish: String(it.garnish || ""),
      source: String(it.source || ""),
      variantOf: String(it.variantOf || ""),
      codexFamily: String(it.codexFamily || ""),
      notes: String(it.notes || "")
    }));
  }, "parseItems");
  if (imageBase64) {
    const qwenMessages = [
      { role: "system", content: EXTRACT_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:${imageMime || "image/jpeg"};base64,${imageBase64}` } },
          { type: "text", text: "\u8BF7\u8BC6\u522B\u56FE\u7247\u4E2D\u7684\u9152\u7C7B/\u914D\u65B9\u4FE1\u606F\u5E76\u63D0\u53D6\u4E3A\u7ED3\u6784\u5316\u6570\u636E\uFF0C\u8F93\u51FA JSON" }
        ]
      }
    ];
    try {
      const qwenRes = await callQwenVL(env, qwenMessages, 6e3);
      const data = await qwenRes.json();
      const raw = data.choices?.[0]?.message?.content ?? "";
      const items = parseItems(raw);
      return json({ items, _model: "qwen-vl-max" }, 200, origin);
    } catch (qwenErr) {
      console.warn("[OCR] BULK_MODEL_FALLBACK");
    }
    try {
      if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not configured");
      const geminiParts = [
        { inline_data: { mime_type: imageMime || "image/jpeg", data: imageBase64 } },
        { text: EXTRACT_SYSTEM_PROMPT + "\n\n\u8BF7\u8BC6\u522B\u56FE\u7247\u4E2D\u7684\u9152\u7C7B/\u914D\u65B9\u4FE1\u606F\u5E76\u63D0\u53D6\u4E3A\u7ED3\u6784\u5316\u6570\u636E\uFF0C\u8F93\u51FA JSON" }
      ];
      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${env.GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: geminiParts }] })
        }
      );
      if (!geminiRes.ok) {
        const t = await geminiRes.text();
        throw new Error(`Gemini ${geminiRes.status}: ${t.slice(0, 200)}`);
      }
      const geminiData = await geminiRes.json();
      const raw = geminiData.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      const items = parseItems(raw);
      return json({ items, _model: "gemini-2.0-flash", _fallback: true }, 200, origin);
    } catch (geminiErr) {
      return err(`\u56FE\u7247\u8BC6\u522B\u5931\u8D25: Qwen \u548C Gemini \u5747\u4E0D\u53EF\u7528 (${geminiErr.message})`, 500, origin);
    }
  }
  try {
    const userContent = (text || "").slice(0, 1e5);
    const res = await callAI(env, [
      { role: "system", content: EXTRACT_SYSTEM_PROMPT },
      { role: "user", content: userContent }
    ], { lang: lang2, maxTokens: 6e3, responseFormat: { type: "json_object" } });
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content ?? "";
    const items = parseItems(raw);
    return json({ items, _model: "deepseek" }, 200, origin);
  } catch (e) {
    return err(`AI \u63D0\u53D6\u5931\u8D25: ${e.message}`, 500, origin);
  }
}
__name(handleBulkImport, "handleBulkImport");
__name2(handleBulkImport, "handleBulkImport");
__name22(handleBulkImport, "handleBulkImport");
async function handleEnrichBottles(env, body, origin) {
  const { names, lang: lang2 = "zh" } = body;
  const isEn = lang2 === "en";
  if (!names || !Array.isArray(names) || names.length === 0) return json({ items: [] }, 200, origin);
  const nameList = names.slice(0, 8).map((n) => String(n).trim()).filter(Boolean);
  if (nameList.length === 0) return json({ items: [] }, 200, origin);
  const systemPrompt = isEn ? `You are a cocktail/spirits knowledge expert. The user will provide one or more names of spirits, ingredients, or products. Based on your industry knowledge, provide accurate information for each product as structured fields.

For each product, output the following fields (leave unknown fields as empty string or 0):
- nameZh: Chinese name
- nameEn: English name
- category: category (Gin/Rum/Vodka/Whiskey/Brandy/Tequila/Mezcal/Liqueur/Pisco/Beer/Wine/Bitters/Syrup/Juice/Other)
- style: style/sub-type
- brand: brand name
- origin: country of origin
- volume: volume (e.g. 700ml)
- abv: alcohol percentage (number, e.g. 40)
- priceCny: CNY reference price (number)
- notes: tasting notes (English, within 100 chars)
- flavorTags: flavor tags array (pick from: sour/sweet/bitter/spicy/umami/citrus/tropical/herbal/floral/smoky/oaky/spiced/nutty/fresh/rich/dry/complex)
- story: brand/product story (English, within 80 chars)
- usageNotes: cocktail usage suggestions (English, within 60 chars)
- confidence: confidence level (high/medium/low)
Output as JSON with items array.` : `${isEn ? "CRITICAL: Write ALL descriptive text in English only.\n\n" : ""}\u4F60\u662F\u4E00\u4E2A\u9E21\u5C3E\u9152/\u9152\u7C7B\u77E5\u8BC6\u4E13\u5BB6\u3002\u7528\u6237\u4F1A\u7ED9\u51FA\u4E00\u4E2A\u6216\u591A\u4E2A\u9152\u3001\u539F\u6599\u6216\u4EA7\u54C1\u7684\u540D\u79F0\uFF0C\u8BF7\u6839\u636E\u4F60\u5DF2\u6709\u7684\u884C\u4E1A\u77E5\u8BC6\uFF0C\u5C3D\u529B\u8FD8\u539F\u6BCF\u4EF6\u4EA7\u54C1\u7684\u771F\u5B9E\u8D44\u6599\uFF0C\u8865\u5168\u4E3A\u7ED3\u6784\u5316\u6761\u76EE\u3002
\u5BF9\u4E8E\u6BCF\u4EF6\u4EA7\u54C1\uFF0C\u8BF7\u8F93\u51FA\u4EE5\u4E0B\u5B57\u6BB5\uFF08\u4E0D\u786E\u5B9A\u7684\u5B57\u6BB5\u7559\u7A7A\u5B57\u7B26\u4E32\u62160\uFF09\uFF1A
- nameZh: \u4E2D\u6587\u540D\u79F0
- nameEn: \u82F1\u6587\u540D\u79F0
- category: \u54C1\u7C7B\uFF08\u70C8\u9152/\u5229\u53E3\u9152/\u8461\u8404\u9152/\u5564\u9152/\u82E6\u7CBE/\u7CD6\u6D46/\u679C\u6C41/\u5176\u4ED6\uFF09
- style: \u98CE\u683C/\u5B50\u7C7B\u578B
- brand: \u54C1\u724C
- origin: \u4EA7\u5730
- volume: \u5BB9\u91CF\uFF08\u5982 700ml\uFF09
- abv: \u9152\u7CBE\u5EA6\uFF08\u6570\u5B57\uFF0C\u5982 40\uFF09
- priceCny: \u4EBA\u6C11\u5E01\u53C2\u8003\u4EF7\uFF08\u6570\u5B57\uFF09
- notes: \u54C1\u9274\u7B14\u8BB0\uFF08\u4E2D\u6587\uFF0C100\u5B57\u5185\uFF09
- flavorTags: \u98CE\u5473\u6807\u7B7E\u6570\u7EC4\uFF08\u4ECE \u9178/\u751C/\u82E6/\u70C8/\u9C9C/\u67D1\u6A58/\u70ED\u5E26/\u8349\u672C/\u82B1\u9999/\u70DF\u718F/\u6728\u6876/\u9999\u6599/\u575A\u679C\u53EF\u53EF/\u6E05\u723D/\u6D53\u90C1/\u5E72\u723D/\u590D\u6742 \u4E2D\u9009\uFF09
- story: \u54C1\u724C/\u4EA7\u54C1\u6545\u4E8B\uFF08\u4E2D\u6587\uFF0C80\u5B57\u5185\uFF09
- usageNotes: \u8C03\u9152\u4F7F\u7528\u5EFA\u8BAE\uFF08\u4E2D\u6587\uFF0C60\u5B57\u5185\uFF09
- confidence: \u7F6E\u4FE1\u5EA6\uFF08high/medium/low\uFF09
\u8BF7\u4EE5 JSON \u683C\u5F0F\u8F93\u51FA\uFF0C\u5305\u542B items \u6570\u7EC4\u3002`;
  const userPrompt = isEn ? `Please provide complete information for the following products:
${nameList.map((n) => `- ${n}`).join("\n")}` : `\u8BF7\u8865\u5168\u4EE5\u4E0B\u4EA7\u54C1\u7684\u8D44\u6599:
${nameList.map((n) => `- ${n}`).join("\n")}`;
  try {
    const res = await callAI(env, [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ], { lang: lang2, maxTokens: 2e3, responseFormat: { type: "json_object" } });
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content ?? "";
    const p = parseJsonLoose(raw);
    const items = Array.isArray(p.items) ? p.items.slice(0, 8).map((it) => ({
      nameZh: typeof it.nameZh === "string" ? it.nameZh : "",
      nameEn: typeof it.nameEn === "string" ? it.nameEn : "",
      category: typeof it.category === "string" ? it.category : "",
      style: typeof it.style === "string" ? it.style : "",
      brand: typeof it.brand === "string" ? it.brand : "",
      origin: typeof it.origin === "string" ? it.origin : "",
      volume: typeof it.volume === "string" ? it.volume : "",
      abv: typeof it.abv === "number" ? it.abv : 0,
      priceCny: typeof it.priceCny === "number" ? it.priceCny : 0,
      notes: typeof it.notes === "string" ? it.notes : "",
      flavorTags: Array.isArray(it.flavorTags) ? it.flavorTags : [],
      story: typeof it.story === "string" ? it.story : "",
      usageNotes: typeof it.usageNotes === "string" ? it.usageNotes : "",
      confidence: validConf(it.confidence)
    })) : [];
    return json({ items }, 200, origin);
  } catch (e) {
    return err(`AI \u6279\u91CF\u8865\u5168\u5931\u8D25: ${e.message}`, 500, origin);
  }
}
__name(handleEnrichBottles, "handleEnrichBottles");
__name2(handleEnrichBottles, "handleEnrichBottles");
__name22(handleEnrichBottles, "handleEnrichBottles");
async function handleDeepAnalyzeRecipe(env, body, origin) {
  const { name, nameEn, ingredients, baseSpirit, source, lang: lang2 = "zh" } = body;
  const isEn = lang2 === "en";
  if (!name) return err("name required", 400, origin);
  const context = [
    `\u914D\u65B9\u540D\u79F0: ${name}${nameEn ? ` (${nameEn})` : ""}`,
    baseSpirit ? `\u57FA\u9152: ${baseSpirit}` : "",
    ingredients ? `\u914D\u6599: ${ingredients}` : "",
    source ? `\u6765\u6E90: ${source}` : ""
  ].filter(Boolean).join("\n");
  const systemPrompt = `\u4F60\u662F\u4E13\u4E1A\u7684\u9E21\u5C3E\u9152\u5386\u53F2\u5B66\u5BB6\u548C\u8C03\u9152\u5E08\uFF0C\u6DF1\u5EA6\u7814\u4E60\u4EE5\u4E0B\u6743\u5A01\u8D44\u6599\uFF1A
Jerry Thomas\u300ABartender's Guide\u300B(1862) \xB7 Harry Craddock\u300AThe Savoy Cocktail Book\u300B(1930) \xB7 David Embury\u300AThe Fine Art of Mixing Drinks\u300B(1948) \xB7 Gary Regan\u300AThe Joy of Mixology\u300B(2003) \xB7 Death & Co\u300ACocktail Codex\u300B(2018) \xB7 Jeffrey Morgenthaler\u300AThe Bar Book\u300B(2014) \xB7 Dave Arnold\u300ALiquid Intelligence\u300B(2014) \xB7 Sasha Petraske\u300ARegarding Cocktails\u300B(2016) \xB7 Jim Meehan\u300AThe PDT Cocktail Book\u300B(2011) \xB7 IBA \u5B98\u65B9\u914D\u65B9\u5E93 \xB7 Difford's Guide
\u98CE\u5473\u63CF\u8FF0\u5FC5\u987B\u4E25\u683C\u4E09\u884C\uFF1A\u6838\u5FC3\u57FA\u8C03/\u98CE\u5473\u6F14\u53D8\uFF08\u7528\u2794\uFF09/\u6574\u4F53\u8D28\u611F\u3002" + (isEn ? "IMPORTANT: ALL descriptive text fields MUST be in English." : "\u6240\u6709\u6807\u7B7E\u5FC5\u987B\u4F7F\u7528\u4E2D\u6587\u3002") + "`;
  const userPrompt = isEn ? `Analyze the following cocktail recipe and return complete JSON:
${context}
{
  "story": "Recipe history and origin (2-4 sentences in English)",
  "flavorDesc": "Core profile: ...
Flavor evolution: ... \u2794 ... \u2794 ...
Overall texture: ...",
  "source": "Source book or reference",
  "creator": "Bartender or creator name",
  "createdYear": "Creation year",
  "suggestedBaseSpirit": "pick from Gin/Rum/Vodka/Whiskey/Brandy/Tequila/Mezcal/Liqueur/Pisco/Non-alcoholic/Other",
  "suggestedCodexFamily": "pick from Old-Fashioned/Martini/Daiquiri/Sidecar/Highball/Flip, unknown leave empty",
  "suggestedVariantOf": "CLASSIC_ORIGINAL | [parent recipe name] | MODERN_ORIGINAL",
  "variantOfDetail": "150-250 words detailed explanation in English",
  "variantOfConfidence": "high | medium | low",
  "suggestedMethod": "pick from Shake/Stir/Build/Layer/Blend",
  "suggestedStrength": "pick from Light/Medium/Strong",
  "suggestedIce": "pick from Standard cube/Large cube/Sphere/Crushed/Spear/No ice",
  "suggestedGlass": "pick from Martini/Old-Fashioned/Highball/Collins/Coupe/Hurricane/Shot/Nick & Nora/Champagne flute/Flute/Tiki/Copper mug/Wine/Julep/Other",
  "flavors": ["sour", "sweet"],
  "confidence": "high | medium | low",
  "isDeepAnalysis": true
}` : `\u8BF7\u5206\u6790\u4EE5\u4E0B\u9E21\u5C3E\u9152\u914D\u65B9\uFF0C\u8FD4\u56DE\u5B8C\u6574 JSON\uFF1A
${context}
{
  "story": "\u914D\u65B9\u5386\u53F2\u6765\u5386\uFF082-4\u53E5\u8BDD\uFF09",
  "flavorDesc": "\u6838\u5FC3\u57FA\u8C03\uFF1A...
\u98CE\u5473\u6F14\u53D8\uFF1A... \u2794 ... \u2794 ...
\u6574\u4F53\u8D28\u611F\uFF1A...",
  "source": "\u6765\u6E90\u4E66\u7C4D\u6216\u51FA\u5904",
  "creator": "\u8C03\u9152\u5E08\u6216\u521B\u4F5C\u8005\u59D3\u540D",
  "createdYear": "\u521B\u4F5C\u5E74\u4EFD",
  "suggestedBaseSpirit": "\u4ECE \u91D1\u9152/\u6717\u59C6/\u4F0F\u7279\u52A0/\u5A01\u58EB\u5FCC/\u9F99\u820C\u5170/\u767D\u5170\u5730/\u6885\u65AF\u5361\u5C14/\u5229\u53E3\u9152/\u76AE\u65AF\u79D1/\u5361\u6C99\u8428/\u65E0\u9152\u7CBE/\u5176\u4ED6 \u4E2D\u9009",
  "suggestedCodexFamily": "\u4ECE \u53E4\u5178 Old-Fashioned/\u9A6C\u5929\u5C3C Martini/\u5927\u5409\u5229 Daiquiri/\u8FB9\u8F66 Sidecar/\u9AD8\u7403 Highball/\u83F2\u5179 Flip \u4E2D\u9009\uFF0C\u4E0D\u786E\u5B9A\u7559\u7A7A",
  "suggestedVariantOf": "CLASSIC_ORIGINAL | [\u6BCD\u914D\u65B9\u540D] | MODERN_ORIGINAL",
  "variantOfDetail": "150-250\u5B57\u8BE6\u7EC6\u8BF4\u660E",
  "variantOfConfidence": "high | medium | low",
  "suggestedMethod": "\u4ECE \u6447\u548C/\u6405\u62CC/\u76F4\u8C03/\u5206\u5C42/\u6405\u6253 \u4E2D\u9009",
  "suggestedStrength": "\u4ECE \u6E05\u723D/\u9002\u4E2D/\u6D53\u70C8 \u4E2D\u9009",
  "suggestedIce": "\u4ECE \u6807\u51C6\u65B9\u51B0/\u5927\u65B9\u51B0/\u7403\u51B0/\u788E\u51B0/\u957F\u6761\u51B0/\u65E0\u51B0 \u4E2D\u9009",
  "suggestedGlass": "\u4ECE \u9A6C\u5929\u5C3C\u676F/\u53E4\u5178\u676F/\u9AD8\u7403\u676F/\u67EF\u6797\u676F/\u5E93\u4F69\u676F/\u98D3\u98CE\u676F/\u5B50\u5F39\u676F/\u5C3C\u514B\u8BFA\u62C9\u676F/\u90C1\u91D1\u9999\u676F/\u7B1B\u578B\u676F/\u63D0\u57FA\u676F/\u94DC\u676F/\u7EA2\u9152\u676F/\u6731\u8389\u666E\u676F/\u5176\u4ED6 \u4E2D\u9009",
  "flavors": ["\u9178", "\u751C"],
  "confidence": "high | medium | low",
  "isDeepAnalysis": true
}`;
  try {
    const res = await callAI(env, [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ], { lang: lang2, maxTokens: 1500, responseFormat: { type: "json_object" } });
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content ?? "";
    const p = parseJsonLoose(raw);
    return json({
      story: typeof p.story === "string" ? p.story.trim() : "",
      flavorDesc: typeof p.flavorDesc === "string" ? p.flavorDesc.trim() : "",
      source: typeof p.source === "string" ? p.source.trim() : "",
      creator: typeof p.creator === "string" ? p.creator.trim() : "",
      createdYear: typeof p.createdYear === "string" ? p.createdYear.trim() : "",
      suggestedBaseSpirit: typeof p.suggestedBaseSpirit === "string" ? p.suggestedBaseSpirit.trim() : "",
      suggestedCodexFamily: typeof p.suggestedCodexFamily === "string" ? p.suggestedCodexFamily.trim() : "",
      suggestedVariantOf: typeof p.suggestedVariantOf === "string" && p.suggestedVariantOf.trim() ? p.suggestedVariantOf.trim() : "MODERN_ORIGINAL",
      variantOfDetail: typeof p.variantOfDetail === "string" ? p.variantOfDetail.trim() : "",
      variantOfConfidence: validConf(p.variantOfConfidence),
      suggestedMethod: typeof p.suggestedMethod === "string" ? p.suggestedMethod.trim() : "",
      suggestedStrength: typeof p.suggestedStrength === "string" ? p.suggestedStrength.trim() : "",
      suggestedIce: typeof p.suggestedIce === "string" ? p.suggestedIce.trim() : "",
      suggestedGlass: typeof p.suggestedGlass === "string" ? p.suggestedGlass.trim() : "",
      flavors: Array.isArray(p.flavors) ? p.flavors.filter((f) => VALID_FLAVOR_TAGS.includes(f)).slice(0, 6) : [],
      confidence: validConf(p.confidence),
      isDeepAnalysis: true,
      suggestedNameZh: typeof p.suggestedNameZh === "string" ? p.suggestedNameZh.trim() : "",
      suggestedNameEn: typeof p.suggestedNameEn === "string" ? p.suggestedNameEn.trim() : ""
    }, 200, origin);
  } catch (e) {
    return err(`AI \u6DF1\u5EA6\u5206\u6790\u5931\u8D25: ${e.message}`, 500, origin);
  }
}
__name(handleDeepAnalyzeRecipe, "handleDeepAnalyzeRecipe");
__name2(handleDeepAnalyzeRecipe, "handleDeepAnalyzeRecipe");
__name22(handleDeepAnalyzeRecipe, "handleDeepAnalyzeRecipe");
function generateToken() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(generateToken, "generateToken");
__name2(generateToken, "generateToken");
__name22(generateToken, "generateToken");
const WEB_DEVICE_SESSION_COOKIE = "cr_sync_session";
const WEB_DEVICE_SESSION_TTL_MS = 60 * 60 * 1000;
const WEB_DEVICE_MEMORY_TICKET_TTL_MS = 10 * 60 * 1000;

function isWebOrigin(origin) {
  return ALLOWED_ORIGINS.includes(origin);
}

function readCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === name) return rawValue.join("=") || null;
  }
  return null;
}

function webSessionCookie(sessionId, maxAgeSeconds) {
  return `${WEB_DEVICE_SESSION_COOKIE}=${sessionId}; Path=/api; HttpOnly; Secure; SameSite=None; Max-Age=${maxAgeSeconds}`;
}

function jsonWithWebSession(data, origin, sessionId) {
  const headers = { "Content-Type": "application/json", ...corsHeaders(origin) };
  if (sessionId && isWebOrigin(origin)) headers["Set-Cookie"] = webSessionCookie(sessionId, Math.floor(WEB_DEVICE_SESSION_TTL_MS / 1000));
  return new Response(JSON.stringify(data), { status: 200, headers });
}

async function ensureWebDeviceSessions(env) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS web_device_sessions (session_id TEXT PRIMARY KEY, device_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_web_device_sessions_expiry ON web_device_sessions(expires_at)").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS web_device_memory_tickets (ticket TEXT PRIMARY KEY, device_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_web_device_memory_tickets_expiry ON web_device_memory_tickets(expires_at)").run();
}

async function issueWebDeviceSession(env, deviceId, origin) {
  if (!isWebOrigin(origin)) return null;
  await ensureWebDeviceSessions(env);
  const now = Date.now();
  const sessionId = generateToken();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM web_device_sessions WHERE expires_at <= ?").bind(now),
    env.DB.prepare("INSERT INTO web_device_sessions (session_id, device_id, created_at, expires_at) VALUES (?, ?, ?, ?)").bind(sessionId, deviceId, now, now + WEB_DEVICE_SESSION_TTL_MS)
  ]);
  return sessionId;
}

async function clearWebDeviceSessions(env, deviceId) {
  try {
    await ensureWebDeviceSessions(env);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM web_device_sessions WHERE device_id = ?").bind(deviceId),
      env.DB.prepare("DELETE FROM web_device_memory_tickets WHERE device_id = ?").bind(deviceId)
    ]);
  } catch {}
}

async function issueWebMemoryTicket(env, deviceId, origin) {
  if (!isWebOrigin(origin)) return null;
  await ensureWebDeviceSessions(env);
  const now = Date.now();
  const ticket = generateToken();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM web_device_memory_tickets WHERE expires_at <= ?").bind(now),
    env.DB.prepare("INSERT INTO web_device_memory_tickets (ticket, device_id, created_at, expires_at) VALUES (?, ?, ?, ?)").bind(ticket, deviceId, now, now + WEB_DEVICE_MEMORY_TICKET_TTL_MS)
  ]);
  return ticket;
}

async function verifyDevice(env, deviceId, token) {
  if (!deviceId || !token) return null;
  const row = await env.DB.prepare(
    "SELECT d.device_id, d.group_id, d.role, d.name, d.token FROM devices d WHERE d.device_id = ? AND d.token = ? AND d.is_active = 1"
  ).bind(deviceId, token).first();
  if (!row || !normalizeDeviceRole(row.role)) return null;
  try {
    await env.DB.prepare("UPDATE devices SET last_seen = ? WHERE device_id = ?").bind(Date.now(), deviceId).run();
  } catch {}
  return row;
}

async function verifyRequestDevice(env, headers) {
  const requestedDeviceId = headers.get("X-Device-Id");
  const token = headers.get("X-Device-Token");
  if (requestedDeviceId && token) return verifyDevice(env, requestedDeviceId, token);
  const sessionId = readCookie(headers.get("Cookie"), WEB_DEVICE_SESSION_COOKIE);
  const memoryTicket = headers.get("X-Web-Device-Ticket");
  if (!sessionId && !memoryTicket) return null;
  await ensureWebDeviceSessions(env);
  const now = Date.now();
  const row = sessionId
    ? await env.DB.prepare("SELECT d.device_id, d.group_id, d.role, d.name, d.token FROM web_device_sessions s JOIN devices d ON d.device_id = s.device_id WHERE s.session_id = ? AND s.expires_at > ? AND d.is_active = 1").bind(sessionId, now).first()
    : await env.DB.prepare("SELECT d.device_id, d.group_id, d.role, d.name, d.token FROM web_device_memory_tickets t JOIN devices d ON d.device_id = t.device_id WHERE t.ticket = ? AND t.expires_at > ? AND d.is_active = 1").bind(memoryTicket, now).first();
  if (!row || !normalizeDeviceRole(row.role) || (requestedDeviceId && row.device_id !== requestedDeviceId)) return null;
  try { await env.DB.prepare("UPDATE devices SET last_seen = ? WHERE device_id = ?").bind(now, row.device_id).run(); } catch {}
  return row;
}
__name(verifyDevice, "verifyDevice");
__name2(verifyDevice, "verifyDevice");
__name22(verifyDevice, "verifyDevice");
async function handleSyncPull(env, body, headers, origin) {
  const session = await resolveDeviceSessionV2(env, headers);
  if (!session) return err("DEVICE_AUTH_UNAUTHORIZED", 401, origin);
  const { since } = body || {};
  let query = "SELECT storage_key, value, client_updated_at, updated_at FROM sync_data WHERE group_id = ?";
  const params = [session.membership.groupId];
  if (since) {
    query += " AND client_updated_at > ?";
    params.push(since);
  }
  const rows = await env.DB.prepare(query).bind(...params).all();
  const tombstones = await env.DB.prepare("SELECT storage_key, deleted_at FROM sync_tombstones WHERE group_id = ?").bind(session.membership.groupId).all();
  const entries = filterSyncEntriesForSession(session, (rows.results || []).map((r) => ({
    storageKey: r.storage_key,
    value: r.value,
    clientUpdatedAt: r.client_updated_at,
  })), "read");
  const visibleTombstones = filterSyncEntriesForSession(session, (tombstones.results || []).map((t) => ({
    storageKey: t.storage_key,
    deletedAt: t.deleted_at,
  })), "read");
  return json({ entries, tombstones: visibleTombstones, policyRevision: session.policy.revision, serverTime: Date.now() }, 200, origin);
}
__name(handleSyncPull, "handleSyncPull");
__name2(handleSyncPull, "handleSyncPull");
__name22(handleSyncPull, "handleSyncPull");
async function handleSyncPush(env, body, headers, origin) {
  const session = await resolveDeviceSessionV2(env, headers);
  if (!session) return err("DEVICE_AUTH_UNAUTHORIZED", 401, origin);
  const { entries, policyRevision } = body || {};
  if (!Array.isArray(entries)) return err("SYNC_ENTRIES_REQUIRED", 400, origin);
  if (Number(policyRevision) !== session.policy.revision) {
    return json({ error: "POLICY_OUTDATED", session }, 409, origin);
  }
  const denied = entries.filter((entry) => !isSessionStorageAllowed(session, entry?.storageKey, "write"));
  if (denied.length > 0) {
    return json({ error: "CAPABILITY_DENIED", rejectedStorageKeys: denied.map((entry) => entry?.storageKey).filter(Boolean), policyRevision: session.policy.revision }, 403, origin);
  }
  let pushed = 0;
  for (const entry of entries.slice(0, 40)) {
    if (!entry.storageKey || entry.value === void 0) continue;
    await env.DB.prepare(
      "INSERT INTO sync_data (group_id, storage_key, value, client_updated_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(group_id, storage_key) DO UPDATE SET value = excluded.value, client_updated_at = excluded.client_updated_at, updated_at = excluded.updated_at WHERE excluded.client_updated_at > sync_data.client_updated_at"
    ).bind(session.membership.groupId, entry.storageKey, entry.value, entry.clientUpdatedAt || Date.now(), Date.now()).run();
    pushed++;
  }
  return json({ success: true, count: pushed, policyRevision: session.policy.revision }, 200, origin);
}
__name(handleSyncPush, "handleSyncPush");
__name2(handleSyncPush, "handleSyncPush");
__name22(handleSyncPush, "handleSyncPush");
async function handleSyncNotify(env, headers, origin) {
  const device = await verifyRequestDevice(env, headers);
  if (!device) return err("Unauthorized", 401, origin);
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO group_ts (group_id, last_push_at) VALUES (?, ?) ON CONFLICT(group_id) DO UPDATE SET last_push_at = excluded.last_push_at"
  ).bind(device.group_id, now).run();
  return json({ ok: true, ts: now }, 200, origin);
}
__name(handleSyncNotify, "handleSyncNotify");
__name2(handleSyncNotify, "handleSyncNotify");
__name22(handleSyncNotify, "handleSyncNotify");
async function handleSyncCheck(env, headers, origin) {
  const device = await verifyRequestDevice(env, headers);
  if (!device) return err("Unauthorized", 401, origin);
  const row = await env.DB.prepare(
    "SELECT last_push_at FROM group_ts WHERE group_id = ?"
  ).bind(device.group_id).first();
  return json({ ts: row ? row.last_push_at : 0 }, 200, origin);
}
__name(handleSyncCheck, "handleSyncCheck");
__name2(handleSyncCheck, "handleSyncCheck");
__name22(handleSyncCheck, "handleSyncCheck");




let photosTableReady = false;
async function ensurePhotosTable(env) {
  if (photosTableReady) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS photos (group_id TEXT NOT NULL, photo_id TEXT NOT NULL, recipe_id TEXT, data_base64 TEXT, content_type TEXT, size INTEGER, client_updated_at INTEGER, deleted INTEGER DEFAULT 0, PRIMARY KEY (group_id, photo_id))").run();
  photosTableReady = true;
}
__name(ensurePhotosTable, "ensurePhotosTable");

// ─── Photo sync (D1 base64 storage) ──────────────────────────────────────────
async function handlePhotoUpload(env, body, headers, origin) {
  await ensurePhotosTable(env);
  const device = await verifyRequestDevice(env, headers);
  if (!device) return err("Unauthorized", 401, origin);
  if (device.role === "guest") return err("Guest devices cannot upload", 403, origin);
  const { photoId, recipeId, dataBase64, contentType } = body || {};
  if (!photoId || !dataBase64) return err("photoId and dataBase64 required", 400, origin);
  if (typeof dataBase64 !== "string" || dataBase64.length > 1500000) {
    return err("photo too large (max ~1.1MB)", 413, origin);
  }
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO photos (group_id, photo_id, recipe_id, data_base64, content_type, size, client_updated_at, deleted) VALUES (?, ?, ?, ?, ?, ?, ?, 0) ON CONFLICT(group_id, photo_id) DO UPDATE SET data_base64 = excluded.data_base64, content_type = excluded.content_type, size = excluded.size, client_updated_at = excluded.client_updated_at, deleted = 0"
  ).bind(device.group_id, photoId, recipeId || "", dataBase64, contentType || "image/jpeg", dataBase64.length, now).run();
  return json({ success: true, photoId, uploadedAt: now }, 200, origin);
}
__name(handlePhotoUpload, "handlePhotoUpload");

async function handlePhotoList(env, body, headers, origin) {
  await ensurePhotosTable(env);
  const device = await verifyRequestDevice(env, headers);
  if (!device) return err("Unauthorized", 401, origin);
  const { since } = body || {};
  let query = "SELECT photo_id, recipe_id, content_type, size, client_updated_at, deleted FROM photos WHERE group_id = ?";
  const params = [device.group_id];
  if (since) { query += " AND client_updated_at > ?"; params.push(since); }
  const rows = await env.DB.prepare(query).bind(...params).all();
  const photos = (rows.results || []).map((r) => ({
    photoId: r.photo_id,
    recipeId: r.recipe_id,
    contentType: r.content_type,
    size: r.size,
    clientUpdatedAt: r.client_updated_at,
    deleted: !!r.deleted
  }));
  return json({ photos, serverTime: Date.now() }, 200, origin);
}
__name(handlePhotoList, "handlePhotoList");

async function handlePhotoDownload(env, body, headers, origin) {
  await ensurePhotosTable(env);
  const device = await verifyRequestDevice(env, headers);
  if (!device) return err("Unauthorized", 401, origin);
  const { photoId } = body || {};
  if (!photoId) return err("photoId required", 400, origin);
  const row = await env.DB.prepare(
    "SELECT photo_id, recipe_id, data_base64, content_type FROM photos WHERE group_id = ? AND photo_id = ? AND deleted = 0"
  ).bind(device.group_id, photoId).first();
  if (!row) return err("Photo not found", 404, origin);
  return json({ photoId: row.photo_id, recipeId: row.recipe_id, dataBase64: row.data_base64, contentType: row.content_type }, 200, origin);
}
__name(handlePhotoDownload, "handlePhotoDownload");

async function handlePhotoDelete(env, body, headers, origin) {
  await ensurePhotosTable(env);
  const device = await verifyRequestDevice(env, headers);
  if (!device) return err("Unauthorized", 401, origin);
  if (device.role === "guest") return err("Guest devices cannot delete", 403, origin);
  const { photoId } = body || {};
  if (!photoId) return err("photoId required", 400, origin);
  await env.DB.prepare(
    "UPDATE photos SET data_base64 = '', deleted = 1, client_updated_at = ? WHERE group_id = ? AND photo_id = ?"
  ).bind(Date.now(), device.group_id, photoId).run();
  return json({ success: true }, 200, origin);
}
__name(handlePhotoDelete, "handlePhotoDelete");

async function hashSwitchTicket(ticket) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ticket));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isValidSwitchId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(value);
}

let switchAuditPrunedAt = 0;

async function ensureSwitchSchema(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS group_switches (
    switch_id TEXT PRIMARY KEY,
    state TEXT NOT NULL,
    source_device_id TEXT NOT NULL,
    source_group_id TEXT NOT NULL,
    target_group_id TEXT NOT NULL,
    target_device_id TEXT NOT NULL,
    target_token TEXT NOT NULL,
    target_name TEXT NOT NULL,
    target_platform TEXT,
    target_role TEXT NOT NULL,
    target_capabilities_json TEXT NOT NULL,
    handoff_device_id TEXT,
    pair_code TEXT NOT NULL,
    recovery_ticket_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    committed_at INTEGER,
    cancelled_at INTEGER,
    last_error_code TEXT
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS group_switch_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    switch_id TEXT NOT NULL,
    event TEXT NOT NULL,
    error_code TEXT,
    created_at INTEGER NOT NULL
  )`).run();
  for (const statement of [
    "ALTER TABLE pair_codes ADD COLUMN reserved_switch_id TEXT",
    "ALTER TABLE pair_codes ADD COLUMN reserved_at INTEGER",
    "ALTER TABLE group_switches ADD COLUMN target_capabilities_json TEXT NOT NULL DEFAULT '[]'"
  ]) {
    try { await env.DB.prepare(statement).run(); } catch {}
  }
  try { await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_group_switches_source ON group_switches(source_device_id, state)").run(); } catch {}
  try { await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_pair_code_reservations ON pair_codes(reserved_switch_id)").run(); } catch {}
  // 仅保留90天的切组诊断元数据；不涉及任何同步业务表或业务内容。
  if (Date.now() - switchAuditPrunedAt > 24 * 60 * 60 * 1000) {
    switchAuditPrunedAt = Date.now();
    try { await env.DB.prepare("DELETE FROM group_switch_events WHERE created_at < ?").bind(Date.now() - 90 * 24 * 60 * 60 * 1000).run(); } catch {}
  }
}

async function logSwitchEvent(env, switchId, event, errorCode = null) {
  try {
    await env.DB.prepare("INSERT INTO group_switch_events (switch_id, event, error_code, created_at) VALUES (?, ?, ?, ?)").bind(switchId, event, errorCode, Date.now()).run();
  } catch {}
}

function switchMemberPayload(row, includeToken = true) {
  return {
    deviceId: row.device_id,
    ...(includeToken ? { deviceToken: row.token } : {}),
    groupId: row.group_id,
    role: row.role,
    deviceName: row.name || "Unknown"
  };
}

async function deviceMembershipResponse(env, membership, origin, isWeb) {
  if (!isWeb) return json({ membership }, 200, origin);
  const [sessionId, webMemoryTicket] = await Promise.all([
    issueWebDeviceSession(env, membership.deviceId, origin),
    issueWebMemoryTicket(env, membership.deviceId, origin)
  ]);
  const payload = { ...membership, deviceToken: undefined, webMemoryTicket };
  return jsonWithWebSession({ membership: payload }, origin, sessionId);
}

async function committedSwitchResponse(env, origin, row) {
  const isWeb = isWebOrigin(origin);
  const membership = switchMemberPayload(row, !isWeb);
  if (!isWeb) return json({ state: "committed", membership }, 200, origin);
  const [sessionId, webMemoryTicket] = await Promise.all([
    issueWebDeviceSession(env, membership.deviceId, origin),
    issueWebMemoryTicket(env, membership.deviceId, origin)
  ]);
  return jsonWithWebSession({
    state: "committed",
    membership: { ...membership, deviceToken: undefined, webMemoryTicket }
  }, origin, sessionId);
}

async function getSwitchByTicket(env, switchId, recoveryTicket) {
  if (!isValidSwitchId(switchId) || typeof recoveryTicket !== "string" || recoveryTicket.length < 32) return null;
  const row = await env.DB.prepare("SELECT * FROM group_switches WHERE switch_id = ?").bind(switchId).first();
  if (!row) return null;
  return (await hashSwitchTicket(recoveryTicket)) === row.recovery_ticket_hash ? row : null;
}

async function ownerHandoffError(env, source, handoffDeviceId) {
  if (source.role !== "owner") return null;
  const countRow = await env.DB.prepare("SELECT COUNT(*) AS count FROM devices WHERE group_id = ? AND is_active = 1 AND device_id <> ?").bind(source.group_id, source.device_id).first();
  if (Number(countRow?.count || 0) === 0) return null;
  if (!handoffDeviceId) return "OWNER_HANDOFF_REQUIRED";
  const candidate = await env.DB.prepare("SELECT device_id FROM devices WHERE device_id = ? AND group_id = ? AND is_active = 1 AND device_id <> ?").bind(handoffDeviceId, source.group_id, source.device_id).first();
  return candidate ? null : "OWNER_HANDOFF_INVALID";
}

async function handleDevicePrepareSwitch(env, body, headers, origin) {
  await ensureSwitchSchema(env);
  const source = await verifyRequestDevice(env, headers);
  // 失效的来源成员资格可通过显式恢复加入处理；绝不能用笼统Unauthorized诱导客户端走不安全降级。
  if (!source) {
    console.warn("[cf-sync] source_membership_unavailable", { hasDeviceId: Boolean(headers.get("X-Device-Id")) });
    return err("SOURCE_MEMBERSHIP_UNAVAILABLE", 401, origin);
  }
  const { code, switchId, deviceName, platform, handoffDeviceId } = body || {};
  if (!isValidSwitchId(switchId) || typeof code !== "string" || !/^\d{6}$/.test(code)) return err("Invalid switch request", 400, origin);
  const existing = await env.DB.prepare("SELECT switch_id FROM group_switches WHERE switch_id = ?").bind(switchId).first();
  if (existing) return err("SWITCH_ID_ALREADY_EXISTS", 409, origin);
  const pair = await env.DB.prepare("SELECT * FROM pair_codes WHERE code = ? AND used = 0 AND expires_at > ? AND reserved_switch_id IS NULL").bind(code, Date.now()).first();
  if (!pair) return err("PAIR_CODE_UNAVAILABLE", 400, origin);
  const pairPolicy = await env.DB.prepare("SELECT capabilities_json FROM pair_code_policies WHERE code = ? AND group_id = ?").bind(code, pair.group_id).first();
  if (!pairPolicy) return err("PAIR_POLICY_MISSING", 409, origin);
  if (pair.group_id === source.group_id) return err("TARGET_GROUP_SAME_AS_SOURCE", 400, origin);
  const handoffError = await ownerHandoffError(env, source, handoffDeviceId);
  if (handoffError) return err(handoffError, 409, origin);
  const recoveryTicket = generateToken();
  const targetDeviceId = generateToken().slice(0, 16);
  const targetToken = generateToken();
  const targetCapabilitiesJson = encodeBusinessTabs(parseBusinessTabs(pairPolicy.capabilities_json));
  await env.DB.prepare("INSERT INTO group_switches (switch_id, state, source_device_id, source_group_id, target_group_id, target_device_id, target_token, target_name, target_platform, target_role, target_capabilities_json, handoff_device_id, pair_code, recovery_ticket_hash, created_at) VALUES (?, 'prepared', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(
    switchId,
    source.device_id,
    source.group_id,
    pair.group_id,
    targetDeviceId,
    targetToken,
    typeof deviceName === "string" && deviceName.trim() ? deviceName.trim().slice(0, 80) : source.name || "Device",
    normalizeDevicePlatform(platform),
    normalizeDeviceRole(pair.role) ?? "guest",
    targetCapabilitiesJson,
    handoffDeviceId || null,
    code,
    await hashSwitchTicket(recoveryTicket),
    Date.now()
  ).run();
  await logSwitchEvent(env, switchId, "switch_prepared");
  return json({ switchId, recoveryTicket, target: { groupId: pair.group_id, role: pair.role, expiresAt: pair.expires_at } }, 200, origin);
}

async function handleDeviceRecoverJoin(env, body, origin) {
  await ensureSwitchSchema(env);
  const { code, deviceId, deviceName, platform } = body || {};
  if (!/^\d{6}$/.test(code || "") || typeof deviceId !== "string" || deviceId.length < 8 || deviceId.length > 64) {
    return err("RECOVERY_JOIN_INVALID", 400, origin);
  }
  const normalizedName = typeof deviceName === "string" ? deviceName.trim().slice(0, 40) : "";
  if (!normalizedName || /[\u0000-\u001F\u007F]/.test(normalizedName)) return err("DEVICE_NAME_INVALID", 400, origin);

  const pair = await env.DB.prepare("SELECT * FROM pair_codes WHERE code = ? AND used = 0 AND expires_at > ? AND reserved_switch_id IS NULL").bind(code, Date.now()).first();
  if (!pair) return err("PAIR_CODE_UNAVAILABLE", 400, origin);
  const existing = await env.DB.prepare("SELECT device_id FROM devices WHERE device_id = ? AND is_active = 1").bind(deviceId).first();
  if (existing) return err("RECOVERY_DEVICE_ID_COLLISION", 409, origin);

  // 先保留一次性码，避免并发恢复或普通配对重复消费；插入失败时立即释放保留。
  const reservationId = `recovery-${deviceId}`;
  const reservation = await env.DB.prepare("UPDATE pair_codes SET reserved_switch_id = ?, reserved_at = ? WHERE code = ? AND used = 0 AND expires_at > ? AND reserved_switch_id IS NULL").bind(reservationId, Date.now(), code, Date.now()).run();
  if (Number(reservation.meta?.changes || 0) !== 1) return err("PAIR_CODE_UNAVAILABLE", 409, origin);

  const policy = await env.DB.prepare("SELECT revision, capabilities_json FROM pair_code_policies WHERE code = ? AND group_id = ?").bind(code, pair.group_id).first();
  if (!policy) return err("PAIR_POLICY_MISSING", 409, origin);
  const token = generateToken();
  const now = Date.now();
  const tabs = parseBusinessTabs(policy.capabilities_json);
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO devices (device_id, group_id, token, name, platform, role, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)").bind(deviceId, pair.group_id, token, normalizedName, normalizeDevicePlatform(platform), normalizeDeviceRole(pair.role) ?? "guest", now),
      env.DB.prepare("INSERT INTO device_policies (device_id, group_id, revision, capabilities_json, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?)").bind(deviceId, pair.group_id, Number(policy.revision || 1), encodeBusinessTabs(tabs), now, deviceId),
      env.DB.prepare("UPDATE pair_codes SET used = 1 WHERE code = ? AND reserved_switch_id = ?").bind(code, reservationId),
      env.DB.prepare("DELETE FROM pair_code_policies WHERE code = ?").bind(code),
      env.DB.prepare("INSERT INTO group_ts (group_id, last_push_at) VALUES (?, ?) ON CONFLICT(group_id) DO UPDATE SET last_push_at = excluded.last_push_at").bind(pair.group_id, now)
    ]);
  } catch (error) {
    await env.DB.prepare("UPDATE pair_codes SET reserved_switch_id = NULL, reserved_at = NULL WHERE code = ? AND reserved_switch_id = ? AND used = 0").bind(code, reservationId).run();
    console.error("[cf-sync] recovery_join_failed", { code: "RECOVERY_JOIN_WRITE_FAILED" });
    return err("RECOVERY_JOIN_WRITE_FAILED", 500, origin);
  }
  console.info("[cf-sync] recovery_join_completed", { targetGroup: String(pair.group_id).slice(0, 8), role: pair.role });
  return deviceMembershipResponse(env, { deviceId, deviceToken: token, groupId: pair.group_id, role: normalizeDeviceRole(pair.role) ?? "guest", deviceName: normalizedName }, origin, normalizeDevicePlatform(platform) === "web");
}

async function handleDeviceCommitSwitch(env, body, headers, origin) {
  await ensureSwitchSchema(env);
  const source = await verifyRequestDevice(env, headers);
  if (!source) return err("Unauthorized", 401, origin);
  const record = await getSwitchByTicket(env, body?.switchId, body?.recoveryTicket);
  if (!record || record.source_device_id !== source.device_id) return err("SWITCH_RECOVERY_UNAUTHORIZED", 403, origin);
  if (record.state === "committed") {
    const target = await env.DB.prepare("SELECT device_id, group_id, token, name, role FROM devices WHERE device_id = ? AND is_active = 1").bind(record.target_device_id).first();
    if (!target) return err("SWITCH_TARGET_MISSING", 409, origin);
    return committedSwitchResponse(env, origin, target);
  }
  if (record.state !== "prepared") return err("SWITCH_NOT_COMMITTABLE", 409, origin);
  const handoffError = await ownerHandoffError(env, source, record.handoff_device_id);
  if (handoffError) return err(handoffError, 409, origin);

  const reservation = await env.DB.prepare("UPDATE pair_codes SET reserved_switch_id = ?, reserved_at = ? WHERE code = ? AND used = 0 AND expires_at > ? AND (reserved_switch_id IS NULL OR reserved_switch_id = ?)").bind(record.switch_id, Date.now(), record.pair_code, Date.now(), record.switch_id).run();
  if (Number(reservation.meta?.changes || 0) !== 1) return err("PAIR_CODE_UNAVAILABLE", 409, origin);
  const now = Date.now();
  const statements = [
    env.DB.prepare("INSERT OR IGNORE INTO devices (id, device_id, group_id, token, name, platform, role, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)").bind(record.target_device_id, record.target_device_id, record.target_group_id, record.target_token, record.target_name, record.target_platform, record.target_role, now),
    env.DB.prepare("INSERT OR REPLACE INTO device_policies (device_id, group_id, revision, capabilities_json, updated_at, updated_by) VALUES (?, ?, 1, ?, ?, ?)").bind(record.target_device_id, record.target_group_id, record.target_capabilities_json, now, source.device_id),
    env.DB.prepare("UPDATE devices SET is_active = 0 WHERE device_id = ? AND group_id = ? AND token = ? AND is_active = 1").bind(source.device_id, source.group_id, source.token),
    env.DB.prepare("UPDATE pair_codes SET used = 1 WHERE code = ? AND reserved_switch_id = ?").bind(record.pair_code, record.switch_id),
    env.DB.prepare("DELETE FROM pair_code_policies WHERE code = ?").bind(record.pair_code),
    env.DB.prepare("UPDATE group_switches SET state = 'committed', committed_at = ?, last_error_code = NULL WHERE switch_id = ?").bind(now, record.switch_id)
  ];
  if (source.role === "owner" && record.handoff_device_id) {
    statements.splice(1, 0,
      env.DB.prepare("UPDATE devices SET role = 'collaborator' WHERE device_id = ? AND group_id = ?").bind(source.device_id, source.group_id),
      env.DB.prepare("UPDATE devices SET role = 'owner' WHERE device_id = ? AND group_id = ? AND is_active = 1").bind(record.handoff_device_id, source.group_id),
      env.DB.prepare("UPDATE device_groups SET owner_device_id = ? WHERE id = ?").bind(record.handoff_device_id, source.group_id)
    );
  }
  await env.DB.batch(statements);
  await clearWebDeviceSessions(env, source.device_id);
  await logSwitchEvent(env, record.switch_id, "switch_committed");
  const target = await env.DB.prepare("SELECT device_id, group_id, token, name, role FROM devices WHERE device_id = ? AND is_active = 1").bind(record.target_device_id).first();
  if (!target) return err("SWITCH_TARGET_MISSING", 409, origin);
  return committedSwitchResponse(env, origin, target);
}

async function handleDeviceSwitchStatus(env, body, origin) {
  await ensureSwitchSchema(env);
  const record = await getSwitchByTicket(env, body?.switchId, body?.recoveryTicket);
  if (!record) return err("SWITCH_RECOVERY_UNAUTHORIZED", 403, origin);
  if (record.state !== "committed") return json({ state: record.state }, 200, origin);
  const target = await env.DB.prepare("SELECT device_id, group_id, token, name, role FROM devices WHERE device_id = ? AND is_active = 1").bind(record.target_device_id).first();
  if (!target) return err("SWITCH_TARGET_MISSING", 409, origin);
  return committedSwitchResponse(env, origin, target);
}

async function handleDeviceCancelSwitch(env, body, origin) {
  await ensureSwitchSchema(env);
  const record = await getSwitchByTicket(env, body?.switchId, body?.recoveryTicket);
  if (!record) return err("SWITCH_RECOVERY_UNAUTHORIZED", 403, origin);
  if (record.state !== "prepared") return err("SWITCH_NOT_CANCELLABLE", 409, origin);
  await env.DB.batch([
    env.DB.prepare("UPDATE pair_codes SET reserved_switch_id = NULL, reserved_at = NULL WHERE reserved_switch_id = ? AND used = 0").bind(record.switch_id),
    env.DB.prepare("UPDATE group_switches SET state = 'cancelled', cancelled_at = ? WHERE switch_id = ?").bind(Date.now(), record.switch_id)
  ]);
  await logSwitchEvent(env, record.switch_id, "switch_cancelled");
  return json({ state: "cancelled" }, 200, origin);
}

async function handleSyncCompleteSnapshot(env, headers, origin) {
  const session = await resolveDeviceSessionV2(env, headers);
  if (!session) return err("DEVICE_AUTH_UNAUTHORIZED", 401, origin);
  const rows = await env.DB.prepare("SELECT storage_key, value, client_updated_at FROM sync_data WHERE group_id = ? ORDER BY storage_key ASC").bind(session.membership.groupId).all();
  const entries = filterSyncEntriesForSession(session, (rows.results || []).map((row) => ({ storageKey: row.storage_key, value: row.value, clientUpdatedAt: row.client_updated_at })), "read");
  const revision = `${entries.length}:${entries.reduce((max, entry) => Math.max(max, Number(entry.clientUpdatedAt) || 0), 0)}`;
  return json({ groupId: session.membership.groupId, revision, complete: true, presentKeys: entries.map((entry) => entry.storageKey), entries }, 200, origin);
}

function normalizeDevicePlatform(value) {
  return ["ios", "android", "web", "macos", "unknown"].includes(value) ? value : "unknown";
}

function normalizeDeviceRole(value, allowedRoles = ["owner", "collaborator", "guest"]) {
  return allowedRoles.includes(value) ? value : null;
}

// ─── DeviceSessionV2 policy core ─────────────────────────────────────────────
// 角色仅描述设备成员身份；资源、动作和逐键策略由前端唯一能力注册表自动生成。
// V2_STORAGE_CAPABILITY_GENERATED
// Generated from lib/sync/capabilities.ts by scripts/generate-device-policy-v2-worker-map.mjs.
// Do not edit manually; regenerate whenever capabilities or storage policy changes.
const V2_ACTIONS = ["view","edit","import","export","close","manage"];
const V2_RESOURCES = ["devices","sync_diagnostics","backup","data","recipes","bottles","homemade","lab_projects","lab_batches","lab_plan","books","menu","shopping","wine_catalog","food_menu","food_ingredients","inventory_spirits","inventory_wine","inventory_fruit","inventory_food","inventory_beer","inventory_ice","shop_glassware","shop_tableware","shop_supplies","shop_equipment","suppliers","reports_monthly","accounts","analytics_business","analytics_period","petty_cash","store_schedule","labor_employees","labor_schedule","labor_attendance","labor_comp_off","payroll","preferences"];
const V2_BUSINESS_TABS = ["cocktail","wine","lab","food","store"];
const V2_BUSINESS_TAB_RESOURCES = {"cocktail":["recipes","bottles","homemade","books","menu","shopping"],"wine":["wine_catalog","inventory_wine"],"lab":["lab_projects","lab_batches","lab_plan"],"food":["food_menu","food_ingredients","inventory_food"],"store":["inventory_spirits","inventory_fruit","inventory_beer","inventory_ice","shop_glassware","shop_tableware","shop_supplies","shop_equipment","suppliers","reports_monthly","accounts","analytics_business","analytics_period","petty_cash","store_schedule","labor_employees","labor_schedule","labor_attendance","labor_comp_off","payroll"]};
const V2_RESOURCE_TAB = {"recipes":"cocktail","bottles":"cocktail","homemade":"cocktail","books":"cocktail","menu":"cocktail","shopping":"cocktail","wine_catalog":"wine","inventory_wine":"wine","lab_projects":"lab","lab_batches":"lab","lab_plan":"lab","food_menu":"food","food_ingredients":"food","inventory_food":"food","inventory_spirits":"store","inventory_fruit":"store","inventory_beer":"store","inventory_ice":"store","shop_glassware":"store","shop_tableware":"store","shop_supplies":"store","shop_equipment":"store","suppliers":"store","reports_monthly":"store","accounts":"store","analytics_business":"store","analytics_period":"store","petty_cash":"store","store_schedule":"store","labor_employees":"store","labor_schedule":"store","labor_attendance":"store","labor_comp_off":"store","payroll":"store"};
const V2_ALL_CAPABILITIES = V2_RESOURCES.flatMap((resource) => V2_ACTIONS.map((action) => `${resource}.${action}`));
const V2_CAPABILITY_SET = new Set(V2_ALL_CAPABILITIES);
const V2_TAB_GRANT_SET = new Set(V2_BUSINESS_TABS.map((tab) => `${tab}.access`));
const V2_STORAGE_CAPABILITY = {
  "cocktail.recipes": [
    "recipes.view",
    "recipes.edit"
  ],
  "cocktail.categories": [
    "recipes.view",
    "recipes.manage"
  ],
  "cocktail.tags": [
    "recipes.view",
    "recipes.manage"
  ],
  "cocktail.tagGroups": [
    "recipes.view",
    "recipes.manage"
  ],
  "cocktail.categoryGroups": [
    "recipes.view",
    "recipes.manage"
  ],
  "cocktail.seeded": [
    "recipes.view",
    "recipes.manage"
  ],
  "cocktail_waldorf_imported_v1": [
    "recipes.view",
    "recipes.import"
  ],
  "cocktail.bottles": [
    "bottles.view",
    "bottles.edit"
  ],
  "bottles.price-alerts.v1": [
    "bottles.view",
    "bottles.edit"
  ],
  "cocktail.bottles.seeded": [
    "bottles.view",
    "bottles.manage"
  ],
  "cocktail.bottles.waldorf.v1": [
    "bottles.view",
    "bottles.import"
  ],
  "bottles.taxonomy.categories.v1": [
    "bottles.view",
    "bottles.manage"
  ],
  "bottles.taxonomy.styles.v1": [
    "bottles.view",
    "bottles.manage"
  ],
  "homemade.preps.v1": [
    "homemade.view",
    "homemade.edit"
  ],
  "homemade.seeded.v1": [
    "homemade.view",
    "homemade.manage"
  ],
  "homemade.sections.v1": [
    "homemade.view",
    "homemade.manage"
  ],
  "homemade.types.v1": [
    "homemade.view",
    "homemade.manage"
  ],
  "homemade.taxonomy.v2": [
    "homemade.view",
    "homemade.manage"
  ],
  "homemade.waldorf.v1": [
    "homemade.view",
    "homemade.import"
  ],
  "homemade.waldorf.v2": [
    "homemade.view",
    "homemade.import"
  ],
  "homemade.source.v3": [
    "homemade.view",
    "homemade.manage"
  ],
  "cocktail.lab.projects": [
    "lab_projects.view",
    "lab_projects.edit"
  ],
  "cocktail.lab.batches": [
    "lab_batches.view",
    "lab_batches.edit"
  ],
  "lab.plan.v1": [
    "lab_plan.view",
    "lab_plan.edit"
  ],
  "cocktail.books.v1": [
    "books.view",
    "books.manage"
  ],
  "menu_store_v1": [
    "menu.view",
    "menu.edit"
  ],
  "menu.packages.v1": [
    "menu.view",
    "menu.edit"
  ],
  "shopping_store_v1": [
    "shopping.view",
    "shopping.edit"
  ],
  "cocktail.prefs.v1": [
    "preferences.view",
    "preferences.edit"
  ],
  "app.lang.v1": [
    "preferences.view",
    "preferences.edit"
  ],
  "wine.bottles.v1": [
    "wine_catalog.view",
    "wine_catalog.edit"
  ],
  "wine.snapshots.v2": [
    "inventory_wine.view",
    "inventory_wine.close"
  ],
  "wine.manual_purchases.v1": [
    "inventory_wine.view",
    "inventory_wine.edit"
  ],
  "food.menu.v1": [
    "food_menu.view",
    "food_menu.edit"
  ],
  "food.ingredients.v2": [
    "food_ingredients.view",
    "food_ingredients.edit"
  ],
  "food.purchases.v1": [
    "inventory_food.view",
    "inventory_food.edit"
  ],
  "store.revenue.v1": [
    "accounts.view",
    "accounts.edit"
  ],
  "store.petty.v1": [
    "petty_cash.view",
    "petty_cash.edit"
  ],
  "store.petty_categories.v1": [
    "petty_cash.view",
    "petty_cash.manage"
  ],
  "store.petty_inv_links.v1": [
    "petty_cash.view",
    "petty_cash.manage"
  ],
  "store.petty_labor_links.v1": [
    "petty_cash.view",
    "petty_cash.manage"
  ],
  "store.employee_name_aliases.v1": [
    "labor_employees.view",
    "labor_employees.manage"
  ],
  "store.inventory.v1": [
    "shop_equipment.view",
    "shop_equipment.edit"
  ],
  "monthly_summary.reports.v1": [
    "reports_monthly.view",
    "reports_monthly.edit"
  ],
  "monthly_summary.suppliers.v1": [
    "suppliers.view",
    "suppliers.edit"
  ],
  "monthly_summary.payments.v1": [
    "accounts.view",
    "accounts.edit"
  ],
  "monthly_summary.balances.v1": [
    "accounts.view",
    "accounts.edit"
  ],
  "monthly_summary.petty_configs.v1": [
    "petty_cash.view",
    "petty_cash.manage"
  ],
  "monthly_summary.inventory_configs.v1": [
    "reports_monthly.view",
    "reports_monthly.manage"
  ],
  "monthly_reports_v1": [
    "reports_monthly.view",
    "reports_monthly.import"
  ],
  "period_analysis.reports.v1": [
    "analytics_period.view",
    "analytics_period.edit"
  ],
  "period_analysis.settings.v1": [
    "analytics_period.view",
    "analytics_period.manage"
  ],
  "dish_analysis.snapshots.v1": [
    "analytics_business.view",
    "analytics_business.edit"
  ],
  "schedule.business_hours.v1": [
    "store_schedule.view",
    "store_schedule.manage"
  ],
  "schedule.shift_templates.v1": [
    "store_schedule.view",
    "store_schedule.manage"
  ],
  "labor_employees_v1": [
    "labor_employees.view",
    "labor_employees.edit"
  ],
  "labor_employee_groups_v1": [
    "labor_employees.view",
    "labor_employees.manage"
  ],
  "labor_custom_depts_v1": [
    "labor_employees.view",
    "labor_employees.manage"
  ],
  "labor_dept_order_v1": [
    "labor_employees.view",
    "labor_employees.manage"
  ],
  "labor_shifts_v1": [
    "labor_schedule.view",
    "labor_schedule.edit"
  ],
  "labor_shift_templates_v1": [
    "labor_schedule.view",
    "labor_schedule.manage"
  ],
  "labor_shift_groups_v1": [
    "labor_schedule.view",
    "labor_schedule.manage"
  ],
  "labor_fill_presets_v1": [
    "labor_schedule.view",
    "labor_schedule.manage"
  ],
  "labor_business_hours_v1": [
    "labor_schedule.view",
    "labor_schedule.manage"
  ],
  "labor_attendance_v1": [
    "labor_attendance.view",
    "labor_attendance.edit"
  ],
  "labor_month_configs_v1": [
    "labor_schedule.view",
    "labor_schedule.manage"
  ],
  "labor_holiday_configs_v1": [
    "labor_schedule.view",
    "labor_schedule.manage"
  ],
  "labor_comp_off_v1": [
    "labor_comp_off.view",
    "labor_comp_off.edit"
  ],
  "labor_comp_off_entries_v1": [
    "labor_comp_off.view",
    "labor_comp_off.edit"
  ],
  "labor_holiday_comp_off_v1": [
    "labor_comp_off.view",
    "labor_comp_off.edit"
  ],
  "labor_unexplained_rest_alerts_v1": [
    "labor_comp_off.view",
    "labor_comp_off.manage"
  ],
  "labor_special_statuses_v1": [
    "labor_attendance.view",
    "labor_attendance.manage"
  ],
  "labor_payslips_v1": [
    "payroll.view",
    "payroll.edit"
  ],
  "labor_month_close_archives_v1": [
    "payroll.view",
    "payroll.close"
  ],
  "labor_month_adjustment_sessions_v1": [
    "payroll.view",
    "payroll.edit"
  ],
  "labor.salary_advances.v1": [
    "payroll.view",
    "payroll.edit"
  ],
  "labor.advance_categories.v1": [
    "payroll.view",
    "payroll.manage"
  ],
  "labor_performance_templates_v1": [
    "payroll.view",
    "payroll.manage"
  ],
  "labor_performance_records_v1": [
    "payroll.view",
    "payroll.edit"
  ],
  "labor_global_payroll_settings_v1": [
    "payroll.view",
    "payroll.manage"
  ],
  "spirits.items.v3": [
    "inventory_spirits.view",
    "inventory_spirits.edit"
  ],
  "spirits.purchases.v3": [
    "inventory_spirits.view",
    "inventory_spirits.edit"
  ],
  "spirits.ledger.v3": [
    "inventory_spirits.view",
    "inventory_spirits.edit"
  ],
  "spirits.refPrices.v1": [
    "inventory_spirits.view",
    "inventory_spirits.manage"
  ],
  "spirits.suppliers.v1": [
    "inventory_spirits.view",
    "suppliers.edit"
  ],
  "spirits.groups.v1": [
    "inventory_spirits.view",
    "inventory_spirits.manage"
  ],
  "spirits.matchMemory.v1": [
    "inventory_spirits.view",
    "inventory_spirits.manage"
  ],
  "spirits.selfBuyConfig.v1": [
    "inventory_spirits.view",
    "inventory_spirits.manage"
  ],
  "spirits.customCategories.v1": [
    "inventory_spirits.view",
    "inventory_spirits.manage"
  ],
  "spirits.groupMatchMemory.v1": [
    "inventory_spirits.view",
    "inventory_spirits.manage"
  ],
  "fruit.items.v1": [
    "inventory_fruit.view",
    "inventory_fruit.edit"
  ],
  "fruit.transactions.v1": [
    "inventory_fruit.view",
    "inventory_fruit.edit"
  ],
  "fruit.snapshots.v1": [
    "inventory_fruit.view",
    "inventory_fruit.close"
  ],
  "beer.items.v1": [
    "inventory_beer.view",
    "inventory_beer.edit"
  ],
  "beer.transactions.v1": [
    "inventory_beer.view",
    "inventory_beer.edit"
  ],
  "beer.snapshots.v1": [
    "inventory_beer.view",
    "inventory_beer.close"
  ],
  "ice.inv.items.v1": [
    "inventory_ice.view",
    "inventory_ice.edit"
  ],
  "ice.inv.tx.v1": [
    "inventory_ice.view",
    "inventory_ice.edit"
  ],
  "ice.inventory.v1": [
    "inventory_ice.view",
    "inventory_ice.close"
  ],
  "cocktail.iceSettings.v2": [
    "inventory_ice.view",
    "inventory_ice.manage"
  ],
  "equipment.inventory.v1": [
    "shop_equipment.view",
    "shop_equipment.edit"
  ],
  "supplier.match.memory.v1": [
    "suppliers.view",
    "suppliers.manage"
  ]
};
// V2_STORAGE_CAPABILITY_GENERATED_END

function parseBusinessTabs(raw) {
  try {
    const values = JSON.parse(raw || "[]");
    if (!Array.isArray(values)) return [];
    const grants = new Set(values.filter((value) => typeof value === "string" && V2_TAB_GRANT_SET.has(value))
      .map((grant) => grant.replace(/\.access$/, "")));
    if (grants.size > 0) return V2_BUSINESS_TABS.filter((tab) => grants.has(tab));

    // 仅用于一次性迁移窗口：历史资源策略只有在一个Tab的全部资源均具备view时，
    // 才安全折算为该Tab，绝不因任一单项授权扩大设备权限。
    const legacy = new Set(values.filter((value) => typeof value === "string" && V2_CAPABILITY_SET.has(value)));
    return V2_BUSINESS_TABS.filter((tab) => V2_BUSINESS_TAB_RESOURCES[tab].every((resource) => legacy.has(`${resource}.view`)));
  } catch {
    return [];
  }
}

function encodeBusinessTabs(tabs) {
  return JSON.stringify([...new Set(tabs)].filter((tab) => V2_BUSINESS_TABS.includes(tab)).map((tab) => `${tab}.access`));
}

function capabilitiesForBusinessTabs(tabs, role) {
  const grants = new Set(tabs);
  const actions = role === "guest" ? ["view"] : V2_ACTIONS;
  const businessCapabilities = V2_BUSINESS_TABS.flatMap((tab) => grants.has(tab)
    ? V2_BUSINESS_TAB_RESOURCES[tab].flatMap((resource) => actions.map((action) => `${resource}.${action}`))
    : []);
  const systemCapabilities = role === "owner"
    ? V2_RESOURCES.filter((resource) => !V2_RESOURCE_TAB[resource]).flatMap((resource) => V2_ACTIONS.map((action) => `${resource}.${action}`))
    : [];
  return [...new Set([...businessCapabilities, ...systemCapabilities])];
}

function isSessionCapabilityAllowed(session, required) {
  if (typeof required !== "string") return false;
  const [resource] = required.split(".");
  const tab = V2_RESOURCE_TAB[resource];
  return tab ? session.policy.tabs.includes(tab) && session.policy.capabilities.includes(required) : session.policy.capabilities.includes(required);
}

function isSessionStorageAllowed(session, storageKey, operation) {
  if (typeof storageKey !== "string") return false;
  const rule = V2_STORAGE_CAPABILITY[storageKey];
  if (!rule) return false;
  const required = operation === "read" ? rule[0] : rule[1];
  return isSessionCapabilityAllowed(session, required);
}

function filterSyncEntriesForSession(session, entries, operation) {
  return entries.filter((entry) => isSessionStorageAllowed(session, entry?.storageKey, operation));
}

async function resolveDeviceSessionV2(env, headers) {
  const device = await verifyRequestDevice(env, headers);
  if (!device) return null;
  const [group, policy, revision] = await Promise.all([
    env.DB.prepare("SELECT owner_device_id FROM device_groups WHERE id = ?").bind(device.group_id).first(),
    env.DB.prepare("SELECT revision, capabilities_json, updated_at FROM device_policies WHERE device_id = ? AND group_id = ?").bind(device.device_id, device.group_id).first(),
    env.DB.prepare("SELECT revision, updated_at FROM group_policy_revisions WHERE group_id = ?").bind(device.group_id).first(),
  ]);
  const role = normalizeDeviceRole(device.role) || "guest";
  // 主设备总是拥有五个业务Tab；其他成员仅以五Tab策略作为唯一授权事实。
  const tabs = role === "owner" ? [...V2_BUSINESS_TABS] : parseBusinessTabs(policy?.capabilities_json);
  const capabilities = capabilitiesForBusinessTabs(tabs, role);
  const policyRevision = Number(policy?.revision || revision?.revision || 0);
  const policyUpdatedAt = Number(policy?.updated_at || revision?.updated_at || 0);
  return {
    schemaVersion: 2,
    device: {
      id: device.device_id,
      name: device.name || "Unknown Device",
      platform: normalizeDevicePlatform(device.platform),
    },
    membership: {
      groupId: device.group_id,
      status: "active",
      role,
      ownerDeviceId: group?.owner_device_id || null,
      lastVerifiedAt: Date.now(),
    },
    policy: {
      revision: policyRevision,
      issuedAt: policyUpdatedAt,
      tabs,
      capabilities,
    },
    sync: {
      freshness: "verified_online",
      serverTime: Date.now(),
      latestGroupChangeAt: Number(revision?.updated_at || 0),
    },
  };
}

async function handlePriceAlertsUpsert(env, body, headers, origin) {
  const device = await verifyRequestDevice(env, headers);
  if (!device) return err("DEVICE_AUTH_UNAUTHORIZED", 401, origin);
  const inputs = Array.isArray(body?.alerts) ? body.alerts.slice(0, 100) : [];
  const now = new Date().toISOString();
  const statements = [];
  for (const input of inputs) {
    const fingerprint = typeof input?.fingerprint === "string" ? input.fingerprint.slice(0, 240) : "";
    const bottleId = typeof input?.bottleId === "string" ? input.bottleId.slice(0, 120) : "";
    const rule = typeof input?.rule === "string" ? input.rule.slice(0, 64) : "";
    const severity = typeof input?.severity === "string" ? input.severity.slice(0, 32) : "";
    if (!fingerprint || !bottleId || !rule || !severity) continue;
    const id = typeof input.id === "string" ? input.id.slice(0, 120) : crypto.randomUUID();
    const version = Math.max(1, Number(input.version) || 1);
    statements.push(env.DB.prepare("INSERT INTO price_alerts (id, sync_group_id, fingerprint, bottle_id, channel_id, rule, severity, status, price, reference_price, delta, delta_percent, unit, detail, source, first_detected_at, last_detected_at, detected_count, version, resolution, suppression_until, operation_id, updated_by_device_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(sync_group_id, fingerprint) DO UPDATE SET severity = excluded.severity, status = CASE WHEN excluded.version >= price_alerts.version THEN excluded.status ELSE price_alerts.status END, price = excluded.price, reference_price = excluded.reference_price, delta = excluded.delta, delta_percent = excluded.delta_percent, detail = excluded.detail, last_detected_at = MAX(price_alerts.last_detected_at, excluded.last_detected_at), detected_count = MAX(price_alerts.detected_count, excluded.detected_count), version = MAX(price_alerts.version, excluded.version), resolution = CASE WHEN excluded.version >= price_alerts.version THEN excluded.resolution ELSE price_alerts.resolution END, suppression_until = CASE WHEN excluded.version >= price_alerts.version THEN excluded.suppression_until ELSE price_alerts.suppression_until END, updated_by_device_id = excluded.updated_by_device_id, updated_at = excluded.updated_at").bind(id, device.group_id, fingerprint, bottleId, typeof input.channelId === "string" ? input.channelId.slice(0, 120) : null, rule, severity, typeof input.status === "string" ? input.status.slice(0, 32) : "open", Number.isFinite(input.price) ? input.price : null, Number.isFinite(input.referencePrice) ? input.referencePrice : null, Number.isFinite(input.delta) ? input.delta : null, Number.isFinite(input.deltaPercent) ? input.deltaPercent : null, typeof input.unit === "string" ? input.unit.slice(0, 32) : null, typeof input.detail === "string" ? input.detail.slice(0, 600) : "", typeof input.source === "string" ? input.source.slice(0, 48) : "recovery_scan", typeof input.firstDetectedAt === "string" ? input.firstDetectedAt : now, typeof input.lastDetectedAt === "string" ? input.lastDetectedAt : now, Math.max(1, Number(input.detectedCount) || 1), version, typeof input.resolution === "string" ? input.resolution.slice(0, 48) : null, typeof input.suppressionUntil === "string" ? input.suppressionUntil : null, typeof input.operationId === "string" ? input.operationId.slice(0, 120) : null, device.device_id, now, now));
  }
  if (statements.length) await env.DB.batch(statements);
  return json({ accepted: statements.length }, 200, origin);
}
async function runPriceAlertDailySweep(env) {
  const now = new Date().toISOString();
  const groups = await env.DB.prepare("SELECT DISTINCT sync_group_id FROM price_alerts WHERE status IN ('open', 'suppressed')").all();
  for (const row of groups.results || []) {
    const groupId = String(row.sync_group_id || "");
    if (!groupId) continue;
    const counts = await env.DB.prepare("SELECT COUNT(*) AS scanned, SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_count FROM price_alerts WHERE sync_group_id = ?").bind(groupId).first();
    await env.DB.prepare("INSERT INTO price_alert_runs (id, sync_group_id, source, started_at, finished_at, status, scanned_count, created_count, updated_count) VALUES (?, ?, 'daily_sweep', ?, ?, 'completed', ?, 0, ?)").bind(crypto.randomUUID(), groupId, now, now, Number(counts?.scanned || 0), Number(counts?.open_count || 0)).run();
  }
}

async function handlePriceAlertsList(env, headers, origin) {
  const device = await verifyRequestDevice(env, headers);
  if (!device) return err("DEVICE_AUTH_UNAUTHORIZED", 401, origin);
  const rows = await env.DB.prepare("SELECT * FROM price_alerts WHERE sync_group_id = ? AND status IN ('open', 'suppressed') ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'attention' THEN 2 WHEN 'notice' THEN 3 ELSE 4 END, last_detected_at DESC LIMIT 200").bind(device.group_id).all();
  return json({ alerts: rows.results || [] }, 200, origin);
}

async function handleDeviceSessionV2(env, headers, origin) {
  const session = await resolveDeviceSessionV2(env, headers);
  if (!session) return err("DEVICE_AUTH_UNAUTHORIZED", 401, origin);
  return json(session, 200, origin);
}

function normalizeRequestedTabs(value) {
  if (!Array.isArray(value)) return null;
  const unique = [...new Set(value)];
  if (!unique.every((item) => typeof item === "string" && V2_BUSINESS_TABS.includes(item))) return null;
  return unique;
}

async function writeDevicePolicyV2(env, input) {
  const now = Date.now();
  const current = await env.DB.prepare("SELECT revision FROM group_policy_revisions WHERE group_id = ?").bind(input.groupId).first();
  const revision = Number(current?.revision || 0) + 1;
  const tabsJson = encodeBusinessTabs(input.tabs);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO group_policy_revisions (group_id, revision, updated_at) VALUES (?, ?, ?) ON CONFLICT(group_id) DO UPDATE SET revision = excluded.revision, updated_at = excluded.updated_at").bind(input.groupId, revision, now),
    env.DB.prepare("INSERT INTO device_policies (device_id, group_id, revision, capabilities_json, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(device_id) DO UPDATE SET group_id = excluded.group_id, revision = excluded.revision, capabilities_json = excluded.capabilities_json, updated_at = excluded.updated_at, updated_by = excluded.updated_by").bind(input.targetDeviceId, input.groupId, revision, tabsJson, now, input.actorDeviceId),
    env.DB.prepare("INSERT INTO device_policy_audit (group_id, target_device_id, revision, actor_device_id, event_type, capabilities_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(input.groupId, input.targetDeviceId, revision, input.actorDeviceId, input.eventType, tabsJson, now),
    env.DB.prepare("INSERT INTO group_ts (group_id, last_push_at) VALUES (?, ?) ON CONFLICT(group_id) DO UPDATE SET last_push_at = excluded.last_push_at").bind(input.groupId, now),
  ]);
  return { revision, updatedAt: now };
}

async function handleDeviceUpdatePolicyV2(env, body, headers, origin) {
  const actor = await verifyRequestDevice(env, headers);
  if (!actor) return err("DEVICE_AUTH_UNAUTHORIZED", 401, origin);
  if (actor.role !== "owner") return err("DEVICE_POLICY_OWNER_REQUIRED", 403, origin);
  const targetDeviceId = typeof body?.targetDeviceId === "string" ? body.targetDeviceId : "";
  const tabs = normalizeRequestedTabs(body?.tabs);
  if (!targetDeviceId || !tabs) return err("DEVICE_TAB_POLICY_INVALID", 400, origin);
  const target = await env.DB.prepare("SELECT device_id, role FROM devices WHERE device_id = ? AND group_id = ? AND is_active = 1").bind(targetDeviceId, actor.group_id).first();
  if (!target) return err("DEVICE_POLICY_TARGET_NOT_FOUND", 404, origin);

  const written = await writeDevicePolicyV2(env, {
    groupId: actor.group_id,
    targetDeviceId,
    actorDeviceId: actor.device_id,
    tabs,
    eventType: "tab_policy_updated",
  });
  return json({ success: true, targetDeviceId, tabs, policyRevision: written.revision, updatedAt: written.updatedAt }, 200, origin);
}

async function handleDeviceUpdateMetadata(env, body, headers, origin) {
  const device = await verifyRequestDevice(env, headers);
  if (!device) return err("DEVICE_AUTH_UNAUTHORIZED", 401, origin);
  if (!body || !["ios", "android", "web", "macos", "unknown"].includes(body.platform)) return err("DEVICE_PLATFORM_INVALID", 400, origin);
  const platform = normalizeDevicePlatform(body.platform);
  await env.DB.prepare("UPDATE devices SET platform = ? WHERE device_id = ? AND group_id = ? AND is_active = 1").bind(platform, device.device_id, device.group_id).run();
  return json({ platform }, 200, origin);
}

async function handleDeviceRegister(env, body, origin) {
  const { deviceName, platform } = body || {};
  const deviceId = (body && typeof body.deviceId === "string" && body.deviceId.length >= 8 && body.deviceId.length <= 64) ? body.deviceId : generateToken().slice(0, 16);
  const token = generateToken();
  const groupId = generateToken().slice(0, 16);
  await env.DB.prepare(
    "INSERT INTO device_groups (id, owner_device_id, created_at) VALUES (?, ?, ?)"
  ).bind(groupId, deviceId, Date.now()).run();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO devices (device_id, group_id, token, name, platform, role, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)").bind(deviceId, groupId, token, deviceName || "Unknown", normalizeDevicePlatform(platform), "owner", now),
    env.DB.prepare("INSERT INTO group_policy_revisions (group_id, revision, updated_at) VALUES (?, 1, ?)").bind(groupId, now),
    env.DB.prepare("INSERT INTO device_policies (device_id, group_id, revision, capabilities_json, updated_at, updated_by) VALUES (?, ?, 1, ?, ?, ?)").bind(deviceId, groupId, encodeBusinessTabs(V2_BUSINESS_TABS), now, deviceId),
  ]);
  const membership = { deviceId, deviceToken: token, groupId, role: "owner", deviceName: deviceName || "Unknown" };
  return deviceMembershipResponse(env, membership, origin, normalizeDevicePlatform(platform) === "web");
}
__name(handleDeviceRegister, "handleDeviceRegister");
__name2(handleDeviceRegister, "handleDeviceRegister");
__name22(handleDeviceRegister, "handleDeviceRegister");
async function handleDeviceGenerateCode(env, body, headers, origin) {
  const session = await resolveDeviceSessionV2(env, headers);
  if (!session) return err("DEVICE_AUTH_UNAUTHORIZED", 401, origin);
  if (!session.policy.capabilities.includes("devices.manage")) return err("CAPABILITY_DENIED", 403, origin);
  const { role = "collaborator", expiresInMinutes = 10, tabs = [] } = body || {};
  const normalizedRole = normalizeDeviceRole(role, ["collaborator", "guest"]);
  if (!normalizedRole) return err("INVALID_DEVICE_ROLE", 400, origin);
  const normalizedTabs = normalizeRequestedTabs(tabs);
  if (!normalizedTabs) return err("DEVICE_TAB_POLICY_INVALID", 400, origin);
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const now = Date.now();
  const expiresAt = now + Math.min(60, Math.max(1, Number(expiresInMinutes) || 10)) * 60 * 1e3;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO pair_codes (code, group_id, role, expires_at, used) VALUES (?, ?, ?, ?, 0)").bind(code, session.membership.groupId, normalizedRole, expiresAt),
    env.DB.prepare("INSERT INTO pair_code_policies (code, group_id, revision, capabilities_json, created_at) VALUES (?, ?, 1, ?, ?)").bind(code, session.membership.groupId, encodeBusinessTabs(normalizedTabs), now),
  ]);
  return json({ code, expiresAt, role: normalizedRole, tabs: normalizedTabs }, 200, origin);
}
__name(handleDeviceGenerateCode, "handleDeviceGenerateCode");
__name2(handleDeviceGenerateCode, "handleDeviceGenerateCode");
__name22(handleDeviceGenerateCode, "handleDeviceGenerateCode");
async function handleDevicePair(env, body, origin) {
  const { code, deviceName, platform } = body || {};
  if (!code) return err("code required", 400, origin);
  const pairRow = await env.DB.prepare(
    "SELECT * FROM pair_codes WHERE code = ? AND used = 0 AND expires_at > ? AND reserved_switch_id IS NULL"
  ).bind(code, Date.now()).first();
  if (!pairRow) return err("Invalid or expired code", 400, origin);
  const deviceId = (body && typeof body.deviceId === "string" && body.deviceId.length >= 8 && body.deviceId.length <= 64) ? body.deviceId : generateToken().slice(0, 16);
  const token = generateToken();
  const policy = await env.DB.prepare("SELECT revision, capabilities_json FROM pair_code_policies WHERE code = ? AND group_id = ?").bind(code, pairRow.group_id).first();
  if (!policy) return err("PAIR_POLICY_MISSING", 409, origin);
  const now = Date.now();
  const tabs = parseBusinessTabs(policy.capabilities_json);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO devices (device_id, group_id, token, name, platform, role, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)").bind(deviceId, pairRow.group_id, token, deviceName || "Unknown", normalizeDevicePlatform(platform), normalizeDeviceRole(pairRow.role) ?? "guest", now),
    env.DB.prepare("INSERT INTO device_policies (device_id, group_id, revision, capabilities_json, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?)").bind(deviceId, pairRow.group_id, Number(policy.revision || 1), encodeBusinessTabs(tabs), now, deviceId),
    env.DB.prepare("UPDATE pair_codes SET used = 1 WHERE code = ?").bind(code),
    env.DB.prepare("DELETE FROM pair_code_policies WHERE code = ?").bind(code),
  ]);
  const membership = { deviceId, deviceToken: token, groupId: pairRow.group_id, role: normalizeDeviceRole(pairRow.role) ?? "guest", tabs, deviceName: deviceName || "Unknown" };
  const isWeb = normalizeDevicePlatform(platform) === "web";
  if (!isWeb) return json({ ...membership, token }, 200, origin);
  const [sessionId, webMemoryTicket] = await Promise.all([
    issueWebDeviceSession(env, deviceId, origin),
    issueWebMemoryTicket(env, deviceId, origin),
  ]);
  return jsonWithWebSession({ ...membership, deviceToken: undefined, webMemoryTicket }, origin, sessionId);
}
__name(handleDevicePair, "handleDevicePair");
__name2(handleDevicePair, "handleDevicePair");
__name22(handleDevicePair, "handleDevicePair");
async function handleDeviceList(env, headers, origin) {
  const device = await verifyRequestDevice(env, headers);
  if (!device) return err("Unauthorized", 401, origin);
  const rows = await env.DB.prepare(
    "SELECT d.device_id, d.name, d.platform, d.role, d.is_active, d.last_seen, d.created_at, p.capabilities_json, p.revision AS policy_revision FROM devices d LEFT JOIN device_policies p ON p.device_id = d.device_id AND p.group_id = d.group_id WHERE d.group_id = ? AND d.is_active = 1"
  ).bind(device.group_id).all();
  const mapped = (rows.results || []).map((r) => {
    const role = normalizeDeviceRole(r.role) ?? "guest";
    return {
      id: r.device_id,
      name: r.name,
      platform: normalizeDevicePlatform(r.platform),
      role,
      tabs: role === "owner" ? [...V2_BUSINESS_TABS] : parseBusinessTabs(r.capabilities_json),
      policyRevision: Number(r.policy_revision || 0),
      last_seen: r.last_seen ?? null,
      created_at: r.created_at,
      isCurrentDevice: r.device_id === device.device_id
    };
  });
  return json({ devices: mapped, currentDeviceId: device.device_id }, 200, origin);
}
__name(handleDeviceList, "handleDeviceList");
__name2(handleDeviceList, "handleDeviceList");
__name22(handleDeviceList, "handleDeviceList");
async function handleDeviceRename(env, body, headers, origin) {
  const device = await verifyRequestDevice(env, headers);
  if (!device) return err("DEVICE_AUTH_UNAUTHORIZED", 401, origin);
  const requestedName = typeof body?.deviceName === "string" ? body.deviceName.trim() : "";
  if (!requestedName || requestedName.length > 40 || /[\u0000-\u001F\u007F]/.test(requestedName)) return err("DEVICE_NAME_INVALID", 400, origin);
  const rows = await env.DB.prepare("SELECT name FROM devices WHERE group_id = ? AND is_active = 1 AND device_id <> ?").bind(device.group_id, device.device_id).all();
  const names = new Set((rows.results || []).map((row) => String(row.name || "").toLocaleLowerCase()));
  let deviceName = requestedName;
  for (let index = 2; names.has(deviceName.toLocaleLowerCase()); index += 1) {
    const suffix = ` (${index})`;
    deviceName = `${requestedName.slice(0, Math.max(1, 40 - suffix.length))}${suffix}`;
  }
  await env.DB.batch([
    env.DB.prepare("UPDATE devices SET name = ? WHERE device_id = ? AND group_id = ? AND is_active = 1").bind(deviceName, device.device_id, device.group_id),
    env.DB.prepare("INSERT INTO group_ts (group_id, last_push_at) VALUES (?, ?) ON CONFLICT(group_id) DO UPDATE SET last_push_at = excluded.last_push_at").bind(device.group_id, Date.now())
  ]);
  console.info("[cf-sync] device_renamed", { group: String(device.group_id).slice(0, 8), self: true });
  return json({ deviceName }, 200, origin);
}

async function handleDeviceKick(env, body, headers, origin) {
  const device = await verifyRequestDevice(env, headers);
  if (!device) return err("Unauthorized", 401, origin);
  if (device.role !== "owner") return err("Only owner can kick devices", 403, origin);
  const { targetDeviceId } = body || {};
  if (!targetDeviceId) return err("targetDeviceId required", 400, origin);
  await env.DB.batch([
    env.DB.prepare("UPDATE devices SET is_active = 0 WHERE device_id = ? AND group_id = ? AND is_active = 1").bind(targetDeviceId, device.group_id),
    env.DB.prepare("INSERT INTO group_ts (group_id, last_push_at) VALUES (?, ?) ON CONFLICT(group_id) DO UPDATE SET last_push_at = excluded.last_push_at").bind(device.group_id, Date.now())
  ]);
  await clearWebDeviceSessions(env, targetDeviceId);
  return json({ success: true }, 200, origin);
}
__name(handleDeviceKick, "handleDeviceKick");
__name2(handleDeviceKick, "handleDeviceKick");
__name22(handleDeviceKick, "handleDeviceKick");

/**
 * 当前设备主动离开同步组。远端成员撤销必须先成功，客户端才允许清除本机凭据。
 * 主设备在仍有其他活跃成员时必须先走原有的交接流程，禁止制造无主组。
 */
async function handleDeviceLeave(env, headers, origin) {
  const device = await verifyRequestDevice(env, headers);
  if (!device) return err("DEVICE_AUTH_UNAUTHORIZED", 401, origin);
  const others = await env.DB.prepare("SELECT COUNT(*) AS count FROM devices WHERE group_id = ? AND is_active = 1 AND device_id <> ?").bind(device.group_id, device.device_id).first();
  if (device.role === "owner" && Number(others?.count || 0) > 0) return err("OWNER_HANDOFF_REQUIRED", 409, origin);
  const now = Date.now();
  const statements = [
    env.DB.prepare("UPDATE devices SET is_active = 0 WHERE device_id = ? AND group_id = ? AND token = ? AND is_active = 1").bind(device.device_id, device.group_id, device.token),
    env.DB.prepare("INSERT INTO group_ts (group_id, last_push_at) VALUES (?, ?) ON CONFLICT(group_id) DO UPDATE SET last_push_at = excluded.last_push_at").bind(device.group_id, now)
  ];
  if (device.role === "owner") statements.splice(1, 0, env.DB.prepare("UPDATE device_groups SET owner_device_id = NULL WHERE id = ? AND owner_device_id = ?").bind(device.group_id, device.device_id));
  await env.DB.batch(statements);
  await clearWebDeviceSessions(env, device.device_id);
  console.info("[cf-sync] device_left_group", { group: String(device.group_id).slice(0, 8), self: true });
  return json({ success: true }, 200, origin);
}

/**
 * 已知主设备失联的恢复入口。仅活跃协作设备可执行；旧主设备必须超过 7 天未在线。
 * 操作仅撤销旧成员资格并交接所有者，不会删除组内同步数据。
 */
async function handleDeviceRecoverStaleOwner(env, headers, origin) {
  const device = await verifyRequestDevice(env, headers);
  if (!device) return err("DEVICE_AUTH_UNAUTHORIZED", 401, origin);
  const group = await env.DB.prepare("SELECT id, owner_device_id FROM device_groups WHERE id = ?").bind(device.group_id).first();
  if (!group) return err("DEVICE_GROUP_NOT_FOUND", 404, origin);
  const owner = await env.DB.prepare("SELECT device_id, last_seen FROM devices WHERE group_id = ? AND is_active = 1 AND role = 'owner' LIMIT 1").bind(device.group_id).first();
  const membership = () => ({ deviceId: device.device_id, deviceToken: device.token, groupId: device.group_id, role: "owner", deviceName: device.name });
  const now = Date.now();

  // 没有活跃主设备时，同样必须原子地提升当前成员并修复 group owner 指针；不能只返回一份伪 owner 凭据。
  if (!owner) {
    await env.DB.batch([
      env.DB.prepare("UPDATE devices SET role = 'owner' WHERE device_id = ? AND group_id = ? AND is_active = 1").bind(device.device_id, device.group_id),
      env.DB.prepare("UPDATE device_groups SET owner_device_id = ? WHERE id = ?").bind(device.device_id, device.group_id),
      env.DB.prepare("INSERT INTO group_ts (group_id, last_push_at) VALUES (?, ?) ON CONFLICT(group_id) DO UPDATE SET last_push_at = excluded.last_push_at").bind(device.group_id, now),
    ]);
    console.warn("[cf-sync] owner_recovered_without_active_owner", { group: String(device.group_id).slice(0, 8) });
    return json({ outcome: "RECOVERED", membership: membership(), previousOwnerDeviceId: null }, 200, origin);
  }

  // 已是活跃主设备时只校正 group 指针并返回幂等结果，不撤销任何成员。
  if (owner.device_id === device.device_id) {
    if (group.owner_device_id !== device.device_id) {
      await env.DB.prepare("UPDATE device_groups SET owner_device_id = ? WHERE id = ?").bind(device.device_id, device.group_id).run();
    }
    return json({ outcome: "ALREADY_OWNER", membership: membership(), previousOwnerDeviceId: device.device_id }, 200, origin);
  }

  const offlineFor = Date.now() - Number(owner.last_seen || 0);
  const minimumOffline = 7 * 24 * 60 * 60 * 1000;
  if (owner.last_seen && offlineFor < minimumOffline) return err("STALE_OWNER_RECOVERY_TOO_EARLY", 409, origin);
  await env.DB.batch([
    env.DB.prepare("UPDATE devices SET is_active = 0 WHERE device_id = ? AND group_id = ? AND role = 'owner' AND is_active = 1").bind(owner.device_id, device.group_id),
    env.DB.prepare("UPDATE devices SET role = 'owner' WHERE device_id = ? AND group_id = ? AND is_active = 1").bind(device.device_id, device.group_id),
    env.DB.prepare("UPDATE device_groups SET owner_device_id = ? WHERE id = ?").bind(device.device_id, device.group_id),
    env.DB.prepare("INSERT INTO group_ts (group_id, last_push_at) VALUES (?, ?) ON CONFLICT(group_id) DO UPDATE SET last_push_at = excluded.last_push_at").bind(device.group_id, now),
  ]);
  await clearWebDeviceSessions(env, owner.device_id);
  console.warn("[cf-sync] stale_owner_recovered", { group: String(device.group_id).slice(0, 8) });
  return json({ outcome: "RECOVERED", membership: membership(), previousOwnerDeviceId: owner.device_id }, 200, origin);
}
async function handleDeviceUpdateRole(env, body, headers, origin) {
  const session = await resolveDeviceSessionV2(env, headers);
  if (!session) return err("DEVICE_AUTH_UNAUTHORIZED", 401, origin);
  if (!session.policy.capabilities.includes("devices.manage")) return err("CAPABILITY_DENIED", 403, origin);
  const { targetDeviceId, role } = body || {};
  const normalizedRole = normalizeDeviceRole(role);
  if (!targetDeviceId || !normalizedRole) return err("INVALID_ROLE_UPDATE", 400, origin);
  const target = await env.DB.prepare(
    "SELECT device_id FROM devices WHERE device_id = ? AND group_id = ? AND is_active = 1"
  ).bind(targetDeviceId, session.membership.groupId).first();
  if (!target) return err("Target device not found", 404, origin);
  if (normalizedRole === "owner") {
    await env.DB.batch([
      env.DB.prepare("UPDATE devices SET role = 'collaborator' WHERE group_id = ? AND role = 'owner'").bind(session.membership.groupId),
      env.DB.prepare("UPDATE devices SET role = 'owner' WHERE device_id = ? AND group_id = ? AND is_active = 1").bind(targetDeviceId, session.membership.groupId),
      env.DB.prepare("UPDATE device_groups SET owner_device_id = ? WHERE id = ?").bind(targetDeviceId, session.membership.groupId)
    ]);
  } else {
    await env.DB.prepare(
      "UPDATE devices SET role = ? WHERE device_id = ? AND group_id = ?"
    ).bind(normalizedRole, targetDeviceId, session.membership.groupId).run();
  }
  // 权限不是sync_data条目；单独更新时间戳以唤醒目标设备的实时刷新。
  await env.DB.prepare(
    "INSERT INTO group_ts (group_id, last_push_at) VALUES (?, ?) ON CONFLICT(group_id) DO UPDATE SET last_push_at = excluded.last_push_at"
  ).bind(session.membership.groupId, Date.now()).run();
  return json({ success: true, targetDeviceId, role: normalizedRole }, 200, origin);
}
__name(handleDeviceUpdateRole, "handleDeviceUpdateRole");
__name2(handleDeviceUpdateRole, "handleDeviceUpdateRole");
__name22(handleDeviceUpdateRole, "handleDeviceUpdateRole");
async function checkDeepSeekBalance(env) {
  const res = await fetch("https://api.deepseek.com/user/balance", {
    headers: { "Authorization": `Bearer ${env.DEEPSEEK_API_KEY}` }
  });
  if (!res.ok) throw new Error(`Balance API ${res.status}`);
  const data = await res.json();
  const balance = data?.balance_infos?.find((b) => b.currency === "CNY");
  return balance ? parseFloat(balance.total_balance) : null;
}
__name(checkDeepSeekBalance, "checkDeepSeekBalance");
__name2(checkDeepSeekBalance, "checkDeepSeekBalance");
__name22(checkDeepSeekBalance, "checkDeepSeekBalance");
async function sendAlertEmail(env, balance) {
  const alertEmail = env.ALERT_EMAIL || "326978666@qq.com";
  const res = await fetch("https://api.mailchannels.net/tx/v1/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: alertEmail }] }],
      from: { email: "noreply@cocktail-ai.kikikong2017.workers.dev", name: "Cocktail R" },
      subject: `\u26A0\uFE0F DeepSeek \u4F59\u989D\u4E0D\u8DB3\u63D0\u9192 (\xA5${balance?.toFixed(2) ?? "?"})`,
      content: [{
        type: "text/plain",
        value: `\u60A8\u7684 DeepSeek API \u4F59\u989D\u5DF2\u4F4E\u4E8E \xA55\uFF0C\u5F53\u524D\u4F59\u989D\uFF1A\xA5${balance?.toFixed(2) ?? "\u672A\u77E5"}\u3002

\u8BF7\u53CA\u65F6\u5145\u503C\u4EE5\u786E\u4FDD Cocktail R AI \u529F\u80FD\u6B63\u5E38\u4F7F\u7528\u3002

\u5145\u503C\u5730\u5740\uFF1Ahttps://platform.deepseek.com/top_up`
      }]
    })
  });
  return res.ok;
}
__name(sendAlertEmail, "sendAlertEmail");
__name2(sendAlertEmail, "sendAlertEmail");
__name22(sendAlertEmail, "sendAlertEmail");

// ─── Build55: D1 auto schema init ────────────────────────────────────────────
var __dbInitialized = false;
async function initDB(env) {
  if (__dbInitialized) return;
  const create = [
    `CREATE TABLE IF NOT EXISTS device_groups (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      name TEXT,
      role TEXT NOT NULL DEFAULT 'collaborator',
      last_seen INTEGER,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS pair_codes (
      code TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'collaborator',
      expires_at INTEGER NOT NULL,
      used INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS sync_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id TEXT NOT NULL,
      storage_key TEXT NOT NULL,
      value TEXT NOT NULL,
      client_updated_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(group_id, storage_key)
    )`,
    `CREATE TABLE IF NOT EXISTS sync_tombstones (
      group_id TEXT NOT NULL,
      storage_key TEXT NOT NULL,
      deleted_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (group_id, storage_key)
    )`,
    `CREATE TABLE IF NOT EXISTS kv_cache (
      cache_key TEXT PRIMARY KEY,
      value TEXT,
      expires_at INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS balance_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      balance REAL,
      checked_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS ai_usage_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip TEXT,
      kind TEXT,
      ts INTEGER NOT NULL
    )`
  ];
  for (const s of create) {
    await env.DB.prepare(s).run();
  }
  const alters = [
    "ALTER TABLE device_groups ADD COLUMN owner_device_id TEXT",
    "ALTER TABLE devices ADD COLUMN device_id TEXT",
    "ALTER TABLE devices ADD COLUMN token TEXT",
    "ALTER TABLE devices ADD COLUMN platform TEXT",
    "ALTER TABLE devices ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE pair_codes ADD COLUMN reserved_switch_id TEXT",
    "ALTER TABLE pair_codes ADD COLUMN reserved_at INTEGER"
  ];
  // Build 97: ensure group_ts table exists
  try {
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS group_ts (group_id TEXT PRIMARY KEY, last_push_at INTEGER NOT NULL DEFAULT 0)"
    ).run();
  } catch (e) {}
  for (const s of alters) {
    try {
      await env.DB.prepare(s).run();
    } catch (e) {
      // duplicate column -> already migrated, ignore
    }
  }
  try {
    await env.DB.prepare("UPDATE devices SET device_id = id WHERE device_id IS NULL").run();
  } catch (e) {}
  try {
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_devices_token ON devices(token)").run();
  } catch (e) {}
  __dbInitialized = true;
}
__name(initDB);

let archiveSchemaReady = false;
async function ensureArchiveSchema(env) {
  if (archiveSchemaReady) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS archive_entries (entry_id TEXT NOT NULL, group_id TEXT NOT NULL, month TEXT NOT NULL, file_type TEXT NOT NULL, filename TEXT NOT NULL, object_key TEXT NOT NULL, sha256 TEXT NOT NULL, size_bytes INTEGER NOT NULL, revision INTEGER NOT NULL, status TEXT NOT NULL CHECK (status IN ('active', 'deleted')), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (entry_id, group_id))"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS archive_operations (group_id TEXT NOT NULL, operation_id TEXT NOT NULL, response_json TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (group_id, operation_id))"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_archive_entries_group_status ON archive_entries (group_id, status, updated_at DESC)"),
  ]);
  archiveSchemaReady = true;
}
function archiveError(code, status, origin, extra = {}) { return json({ code, ...extra }, status, origin); }
function archiveString(value, max) { return typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000\r\n]/.test(value); }
function archiveObjectKey(groupId, entryId, operationId) {
  const entry = entryId.replace(/[^A-Za-z0-9._-]/g, "_");
  const operation = operationId.replace(/[^A-Za-z0-9._-]/g, "_");
  return `groups/${groupId}/monthly-raw/objects/${entry}-${operation}.xlsx`;
}
function archiveBytes(base64) {
  if (typeof base64 !== "string" || base64.length === 0 || base64.length > 16e6 || !/^[A-Za-z0-9+/=]+$/.test(base64)) return null;
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch { return null; }
}
async function archiveDigest(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function archiveSession(env, headers, capability, origin) {
  const session = await resolveDeviceSessionV2(env, headers);
  if (!session) return { error: archiveError("DEVICE_AUTH_UNAUTHORIZED", 401, origin) };
  if (!isSessionCapabilityAllowed(session, capability)) return { error: archiveError("CAPABILITY_DENIED", 403, origin) };
  return { session };
}
async function handleArchiveIndex(env, headers, origin) {
  const resolved = await archiveSession(env, headers, "reports_monthly.view", origin);
  if (resolved.error) return resolved.error;
  await ensureArchiveSchema(env);
  const rows = await env.DB.prepare("SELECT entry_id, object_key, revision, status, month, file_type, filename, size_bytes, updated_at FROM archive_entries WHERE group_id = ? ORDER BY updated_at DESC, entry_id ASC").bind(resolved.session.membership.groupId).all();
  const entries = (rows.results || []).map((row) => ({ entryId: row.entry_id, objectKey: row.object_key, revision: Number(row.revision), status: row.status, month: row.month, fileType: row.file_type, filename: row.filename, sizeBytes: Number(row.size_bytes), updatedAt: Number(row.updated_at) }));
  return json({ entries, serverTime: Date.now() }, 200, origin);
}
async function handleArchiveCommit(env, body, headers, origin) {
  let uploadedObjectKey = null;
  try {
    const resolved = await archiveSession(env, headers, "reports_monthly.import", origin);
    if (resolved.error) return resolved.error;
    if (!env.ARCHIVES) return archiveError("ARCHIVE_STORAGE_NOT_CONFIGURED", 503, origin);
    await ensureArchiveSchema(env);
    const groupId = resolved.session.membership.groupId;
    const operationId = body?.operationId;
    const entryId = body?.entryId;
    const parentRevision = body?.parentRevision;
    if (!archiveString(operationId, 128) || !archiveString(entryId, 160) || !Number.isInteger(parentRevision) || parentRevision < 0) return archiveError("ARCHIVE_REQUEST_INVALID", 400, origin);
    const previous = await env.DB.prepare("SELECT response_json FROM archive_operations WHERE group_id = ? AND operation_id = ?").bind(groupId, operationId).first();
    if (previous?.response_json) return json(JSON.parse(previous.response_json), 200, origin);
    const existing = await env.DB.prepare("SELECT revision, status FROM archive_entries WHERE group_id = ? AND entry_id = ?").bind(groupId, entryId).first();
    if (existing?.status === "deleted") return archiveError("ENTRY_DELETED", 409, origin, { tombstoneRevision: Number(existing.revision) });
    if (existing && Number(existing.revision) !== parentRevision) return archiveError("ARCHIVE_REVISION_CONFLICT", 409, origin, { currentRevision: Number(existing.revision), currentStatus: existing.status });
    if (!archiveString(body?.month, 16) || !/^\d{4}-\d{2}$/.test(body.month) || !archiveString(body?.fileType, 80) || !archiveString(body?.filename, 200)) return archiveError("ARCHIVE_METADATA_INVALID", 400, origin);
    const bytes = archiveBytes(body?.dataBase64);
    if (!bytes || bytes.byteLength > 12e6) return archiveError("ARCHIVE_FILE_INVALID", 413, origin);
    const objectKey = archiveObjectKey(groupId, entryId, operationId);
    const now = Date.now();
    const revision = parentRevision + 1;
    const sha256 = await archiveDigest(bytes);
    await env.ARCHIVES.put(objectKey, bytes, { httpMetadata: { contentType: body.filename.toLowerCase().endsWith(".xls") ? "application/vnd.ms-excel" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }, customMetadata: { groupId, entryId, revision: String(revision), sha256 } });
    uploadedObjectKey = objectKey;
    let changed = false;
    if (existing) {
      const result = await env.DB.prepare("UPDATE archive_entries SET month = ?, file_type = ?, filename = ?, object_key = ?, sha256 = ?, size_bytes = ?, revision = ?, status = 'active', updated_at = ? WHERE group_id = ? AND entry_id = ? AND revision = ? AND status = 'active'").bind(body.month, body.fileType, body.filename, objectKey, sha256, bytes.byteLength, revision, now, groupId, entryId, parentRevision).run();
      changed = Number(result.meta?.changes || 0) === 1;
    } else {
      try {
        await env.DB.prepare("INSERT INTO archive_entries (entry_id, group_id, month, file_type, filename, object_key, sha256, size_bytes, revision, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)").bind(entryId, groupId, body.month, body.fileType, body.filename, objectKey, sha256, bytes.byteLength, revision, now, now).run();
        changed = true;
      } catch { changed = false; }
    }
    if (!changed) {
      await env.ARCHIVES.delete(objectKey);
      uploadedObjectKey = null;
      const current = await env.DB.prepare("SELECT revision, status FROM archive_entries WHERE group_id = ? AND entry_id = ?").bind(groupId, entryId).first();
      if (current?.status === "deleted") return archiveError("ENTRY_DELETED", 409, origin, { tombstoneRevision: Number(current.revision) });
      return archiveError("ARCHIVE_REVISION_CONFLICT", 409, origin, { currentRevision: Number(current?.revision || 0), currentStatus: "active" });
    }
    const response = { entryId, revision };
    await env.DB.prepare("INSERT OR IGNORE INTO archive_operations (group_id, operation_id, response_json, created_at) VALUES (?, ?, ?, ?)").bind(groupId, operationId, JSON.stringify(response), now).run();
    return json(response, 201, origin);
  } catch (error) {
    if (uploadedObjectKey && env.ARCHIVES) {
      try { await env.ARCHIVES.delete(uploadedObjectKey); } catch {}
    }
    console.error("[archive] ARCHIVE_STORAGE_FAILURE", error instanceof Error ? error.name : "unknown");
    return archiveError("ARCHIVE_STORAGE_FAILURE", 503, origin);
  }
}
var worker_v3_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const origin = request.headers.get("Origin") || "";
    try {
      await initDB(env);
    } catch (e) {
      console.error("[initDB] INIT_DB_FAILED");
    }
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (path === "/health") {
      return json({ status: "ok", version: "v4", release: "five-tab-device-session", timestamp: Date.now() }, 200, origin);
    }
    if (path === "/api/device/health/session-v2" && method === "GET") {
      return json({
        status: "ok",
        schemaVersion: 2,
        policyModel: "five_business_tabs",
        tabs: V2_BUSINESS_TABS,
        routes: ["/api/device/session-v2", "/api/device/update-policy-v2", "/api/device/recover-stale-owner", "/api/device/leave"],
        timestamp: Date.now(),
      }, 200, origin);
    }
    if (path.startsWith("/api/ai/")) {
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const allowed = await checkRateLimit(env, ip, "ai");
      if (!allowed) return err("Too many requests. Please try again later.", 429, origin);
      let body = {};
      if (method === "POST") {
        try {
          body = await request.json();
        } catch {
        }
      }
      if (path === "/api/ai/enrich-recipe") return handleEnrichRecipe(env, body, origin);
      if (path === "/api/ai/enrich-recipe/stream") return handleEnrichRecipeStream(env, body, origin);
      if (path === "/api/ai/enrich-bottle") return handleEnrichBottle(env, body, origin);
      if (path === "/api/ai/enrich-homemade") return handleEnrichHomemade(env, body, origin);
      if (path === "/api/ai/extract-recipes") return handleExtractRecipes(env, body, origin);
      if (path === "/api/ai/ocr") return handleOcr(env, body, origin);
      if (path === "/api/ai/translate") return handleTranslate(env, body, origin);
      if (path === "/api/ai/bulk-import") return handleBulkImport(env, body, origin);
      if (path === "/api/ai/deep-analyze-recipe") return handleDeepAnalyzeRecipe(env, body, origin);
      if (path === "/api/ai/enrich-bottles") return handleEnrichBottles(env, body, origin);
      if (path === "/v1/chat/completions") {
        const res = await callAI(env, body.messages || [], {
          lang,
          model: body.model || "deepseek-chat",
          maxTokens: body.max_tokens || 2e3,
          responseFormat: body.response_format || null,
          stream: body.stream || false
        });
        const data = await res.json();
        return json(data, 200, origin);
      }
      return err("Not found", 404, origin);
    }
    if (path === "/api/sync/snapshot" && method === "GET") {
      return handleSyncCompleteSnapshot(env, request.headers, origin);
    }
    if (path === "/api/sync/pull" && method === "POST") {
      let body = {};
      try {
        body = await request.json();
      } catch {
      }
      return handleSyncPull(env, body, request.headers, origin);
    }
    if (path === "/api/sync/notify" && method === "POST") {
      return handleSyncNotify(env, request.headers, origin);
    }
    if (path === "/api/sync/check" && method === "GET") {
      return handleSyncCheck(env, request.headers, origin);
    }
    if (path === "/api/sync/push" && method === "POST") {
      let body = {};
      try {
        body = await request.json();
      } catch {
      }
      return handleSyncPush(env, body, request.headers, origin);
    }
    if (path === "/api/photos/upload" && method === "POST") {
      let body = {};
      try { body = await request.json(); } catch {}
      return handlePhotoUpload(env, body, request.headers, origin);
    }
    if (path === "/api/photos/list" && method === "POST") {
      let body = {};
      try { body = await request.json(); } catch {}
      return handlePhotoList(env, body, request.headers, origin);
    }
    if (path === "/api/photos/download" && method === "POST") {
      let body = {};
      try { body = await request.json(); } catch {}
      return handlePhotoDownload(env, body, request.headers, origin);
    }
    if (path === "/api/photos/delete" && method === "POST") {
      let body = {};
      try { body = await request.json(); } catch {}
      return handlePhotoDelete(env, body, request.headers, origin);
    }
    if (path === "/api/device/prepare-switch" && method === "POST") {
      let body = {};
      try { body = await request.json(); } catch {}
      return handleDevicePrepareSwitch(env, body, request.headers, origin);
    }
    if (path === "/api/device/recover-join" && method === "POST") {
      let body = {};
      try { body = await request.json(); } catch {}
      return handleDeviceRecoverJoin(env, body, origin);
    }
    if (path === "/api/device/commit-switch" && method === "POST") {
      let body = {};
      try { body = await request.json(); } catch {}
      return handleDeviceCommitSwitch(env, body, request.headers, origin);
    }
    if (path === "/api/device/switch-status" && method === "POST") {
      let body = {};
      try { body = await request.json(); } catch {}
      return handleDeviceSwitchStatus(env, body, origin);
    }
    if (path === "/api/device/cancel-switch" && method === "POST") {
      let body = {};
      try { body = await request.json(); } catch {}
      return handleDeviceCancelSwitch(env, body, origin);
    }
    if (path === "/api/device/session-v2" && method === "GET") {
      return handleDeviceSessionV2(env, request.headers, origin);
    }
    if (path === "/api/archives/index" && method === "GET") {
      return handleArchiveIndex(env, request.headers, origin);
    }
    if (path === "/api/archives/commit" && method === "POST") {
      let body = {};
      try { body = await request.json(); } catch {}
      return handleArchiveCommit(env, body, request.headers, origin);
    }
    if (path === "/api/price-alerts/upsert" && method === "POST") {
      let body = {};
      try { body = await request.json(); } catch {}
      return handlePriceAlertsUpsert(env, body, request.headers, origin);
    }
    if (path === "/api/price-alerts" && method === "GET") {
      return handlePriceAlertsList(env, request.headers, origin);
    }
    if (path === "/api/device/update-policy-v2" && method === "POST") {
      let body = {};
      try { body = await request.json(); } catch {}
      return handleDeviceUpdatePolicyV2(env, body, request.headers, origin);
    }
    if (path === "/api/device/register" && method === "POST") {
      let body = {};
      try {
        body = await request.json();
      } catch {
      }
      return handleDeviceRegister(env, body, origin);
    }
    if (path === "/api/device/generate-code" && method === "POST") {
      let body = {};
      try {
        body = await request.json();
      } catch {
      }
      return handleDeviceGenerateCode(env, body, request.headers, origin);
    }
    if (path === "/api/device/pair" && method === "POST") {
      let body = {};
      try {
        body = await request.json();
      } catch {
      }
      return handleDevicePair(env, body, origin);
    }
    if (path === "/api/device/list" && method === "GET") {
      return handleDeviceList(env, request.headers, origin);
    }
    if (path === "/api/device/update-metadata" && method === "POST") {
      let body = {};
      try { body = await request.json(); } catch {}
      return handleDeviceUpdateMetadata(env, body, request.headers, origin);
    }
    if (path === "/api/device/rename" && method === "POST") {
      let body = {};
      try { body = await request.json(); } catch {}
      return handleDeviceRename(env, body, request.headers, origin);
    }
    if (path === "/api/device/kick" && method === "POST") {
      let body = {};
      try {
        body = await request.json();
      } catch {
      }
      return handleDeviceKick(env, body, request.headers, origin);
    }
    if (path === "/api/device/leave" && method === "POST") {
      return handleDeviceLeave(env, request.headers, origin);
    }
    if (path === "/api/device/recover-stale-owner" && method === "POST") {
      return handleDeviceRecoverStaleOwner(env, request.headers, origin);
    }
    if (path === "/api/device/update-role" && method === "POST") {
      let body = {};
      try {
        body = await request.json();
      } catch {
      }
      return handleDeviceUpdateRole(env, body, request.headers, origin);
    }
    if (path === "/api/balance" && method === "GET") {
      try {
        const balance = await checkDeepSeekBalance(env);
        return json({ balance, currency: "CNY", timestamp: Date.now(), checkedAt: Date.now() }, 200, origin);
      } catch (e) {
        return err(`Balance check failed: ${e.message}`, 500, origin);
      }
    }
    return err("Not found", 404, origin);
  },
  // ?????? Cron: ?????? 17:00 ???????????????????????? ???????????????????????????????????????????????????????????????????????????????????????????????????????????????
  async scheduled(event, env, ctx) {
    try {
      await runPriceAlertDailySweep(env);
      console.log("[Cron] PRICE_ALERT_SWEEP_SUCCEEDED");
    } catch (e) {
      console.error("[Cron] PRICE_ALERT_SWEEP_FAILED");
    }
    try {
      const balance = await checkDeepSeekBalance(env);
      console.log("[Cron] BALANCE_CHECK_SUCCEEDED");
      if (balance !== null && balance < 5) {
        const sent = await sendAlertEmail(env, balance);
        console.log("[Cron] BALANCE_ALERT_DISPATCHED");
      }
    } catch (e) {
      console.error("[Cron] BALANCE_CHECK_FAILED");
    }
  }
};
export {
  worker_v3_default as default
};
