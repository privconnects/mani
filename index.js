const TARGET = (Netlify.env.get("TARGET_DOMAIN") || "").replace(/\/$/, "");

// Ultra-optimized CORS headers with long cache
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-credentials": "true",
  "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS, PATCH",
  "access-control-allow-headers": "*",
  "access-control-max-age": "86400"
};

// Hop-by-hop headers to strip
const HOP_HEADERS = new Set([
  "host", "connection", "keep-alive", "proxy-authenticate",
  "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"
]);

// ============ CREDIT SAVING: RESPONSE CACHE ============
class ResponseCache {
  constructor() {
    this.cache = new Map();
    this.pendingRequests = new Map();
  }

  getKey(url, method, headers) {
    // Only cache GET requests
    if (method !== "GET") return null;
    // Cache key based on URL and vary headers
    const accept = headers.get("accept") || "";
    const acceptEncoding = headers.get("accept-encoding") || "";
    return `${url}|${accept}|${acceptEncoding}`;
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    // Check if cache is still valid (5 minutes for dynamic, 1 hour for static)
    const now = Date.now();
    if (entry.expiry > now) {
      return entry.response;
    }
    this.cache.delete(key);
    return null;
  }

  set(key, response, isStatic = false) {
    // Cache TTL: 5 min for dynamic, 1 hour for static assets
    const ttl = isStatic ? 3600000 : 300000;
    // Clone response before storing
    const clonedResponse = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    });
    this.cache.set(key, {
      response: clonedResponse,
      expiry: Date.now() + ttl
    });
  }

  async waitForPending(key) {
    if (this.pendingRequests.has(key)) {
      return await this.pendingRequests.get(key);
    }
    return null;
  }

  setPending(key, promise) {
    this.pendingRequests.set(key, promise);
    promise.finally(() => {
      this.pendingRequests.delete(key);
    });
    return promise;
  }
}

const cache = new ResponseCache();

// ============ SMART OUTBOUND REGISTRY ============
class OutboundRegistry {
  constructor() {
    this.outbounds = new Map();
    this.latencyMap = new Map();
    this.failMap = new Map();
    this.successMap = new Map();
    this.downloadSpeedMap = new Map();
    this.lastCheckMap = new Map();
    this.rotationIndex = 0;
    this.lastBestOutbound = TARGET;
    this.lastBestTime = 0;
  }

  addOutbound(url) {
    const id = url;
    this.outbounds.set(id, url);
    this.latencyMap.set(id, 100);
    this.failMap.set(id, 0);
    this.successMap.set(id, Date.now());
    this.downloadSpeedMap.set(id, 100);
    this.lastCheckMap.set(id, 0);
  }

  async measureHealth(url, id) {
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const response = await fetch(url + "/health", {
        method: "HEAD",
        signal: controller.signal
      });
      clearTimeout(timeout);
      const latency = Date.now() - start;
      this.latencyMap.set(id, Math.min(latency, this.latencyMap.get(id) || 500));
      this.failMap.set(id, 0);
      this.successMap.set(id, Date.now());
      return true;
    } catch (err) {
      const fails = (this.failMap.get(id) || 0) + 1;
      this.failMap.set(id, fails);
      if (fails > 3) {
        this.latencyMap.set(id, 10000);
      }
      return false;
    }
  }

  async getBestOutbound() {
    const now = Date.now();
    
    // CREDIT SAVING: Cache best outbound for 5 seconds
    if (this.lastBestOutbound && (now - this.lastBestTime) < 5000) {
      return this.lastBestOutbound;
    }
    
    // Staggered health checks to avoid request spikes
    for (const [id, url] of this.outbounds) {
      if (now - (this.lastCheckMap.get(id) || 0) > 30000) {
        this.lastCheckMap.set(id, now);
        // Don't await - fire and forget
        this.measureHealth(url, id).catch(() => {});
      }
    }
    
    let bestId = null;
    let bestLatency = Infinity;
    
    for (const [id, url] of this.outbounds) {
      const latency = this.latencyMap.get(id) || 5000;
      const fails = this.failMap.get(id) || 0;
      
      if (fails < 3 && latency < bestLatency) {
        bestLatency = latency;
        bestId = id;
      }
    }
    
    const result = bestId || Array.from(this.outbounds.keys())[0] || TARGET;
    this.lastBestOutbound = result;
    this.lastBestTime = now;
    
    return result;
  }
}

const registry = new OutboundRegistry();
registry.addOutbound(TARGET);

// ============ CREDIT SAVING: STATIC ASSET DETECTION ============
function isStaticAsset(url) {
  const staticExtensions = [
    '.css', '.js', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg',
    '.ico', '.woff', '.woff2', '.ttf', '.eot', '.mp4', '.webm',
    '.json', '.xml', '.txt', '.pdf'
  ];
  const pathname = url.pathname.toLowerCase();
  return staticExtensions.some(ext => pathname.endsWith(ext));
}

function shouldCacheResponse(response, url) {
  // Don't cache error responses
  if (!response || response.status >= 400) return false;
  // Cache GET requests to static assets
  if (url.method === "GET" && isStaticAsset(url)) return true;
  // Cache HTML/JSON responses with cache-control header
  const cacheControl = response.headers.get("cache-control") || "";
  if (cacheControl.includes("max-age") && !cacheControl.includes("no-cache")) {
    return true;
  }
  return false;
}

// ============ OPTIMIZED FETCH WITH CONNECTION POOLING ============
const connectionPool = new Map();

async function optimizedFetch(url, options, isUpload = false) {
  const controller = new AbortController();
  const timeoutMs = isUpload ? 120000 : 30000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    // Reuse connections when possible
    const cacheKey = new URL(url).hostname;
    const finalOptions = {
      ...options,
      signal: controller.signal,
      compress: !isUpload,
      // CREDIT SAVING: Reduce redirects
      redirect: "manual"
    };
    
    const response = await fetch(url, finalOptions);
    clearTimeout(timeoutId);
    
    // Handle redirects manually to save function calls
    if (response.status === 301 || response.status === 302 || response.status === 307 || response.status === 308) {
      const location = response.headers.get("location");
      if (location) {
        const redirectUrl = new URL(location, url).toString();
        return await optimizedFetch(redirectUrl, options, isUpload);
      }
    }
    
    return response;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

// ============ MAIN HANDLER ============
export default async function handler(event) {
  // CREDIT SAVING: Super fast OPTIONS response
  if (event.method === "OPTIONS") {
    return new Response(null, { 
      status: 204, 
      headers: {
        ...CORS_HEADERS,
        "cache-control": "public, max-age=86400"
      }
    });
  }

  if (!TARGET) {
    return new Response(JSON.stringify({ error: "Server not configured" }), {
      status: 500,
      headers: { "content-type": "application/json", ...CORS_HEADERS }
    });
  }

  try {
    const incomingUrl = new URL(event.url);
    const isStatic = isStaticAsset(incomingUrl);
    const isUpload = event.method === "PUT" || event.method === "POST" || 
                     (event.headers.get("content-length") && parseInt(event.headers.get("content-length") || "0") > 102400);
    
    // CREDIT SAVING: Check cache for GET requests
    let cachedResponse = null;
    let cacheKey = null;
    
    if (event.method === "GET" && isStatic) {
      cacheKey = cache.getKey(incomingUrl.toString(), event.method, event.headers);
      if (cacheKey) {
        cachedResponse = await cache.waitForPending(cacheKey);
        if (!cachedResponse) {
          cachedResponse = cache.get(cacheKey);
        }
      }
      
      if (cachedResponse) {
        // Return cached response with proper headers
        const responseHeaders = new Headers(CORS_HEADERS);
        responseHeaders.set("x-cache", "HIT");
        responseHeaders.set("cache-control", "public, max-age=3600");
        
        const clonedBody = await cachedResponse.clone().text();
        return new Response(clonedBody, {
          status: 200,
          headers: responseHeaders
        });
      }
    }
    
    // Get best outbound (cached for 5 seconds)
    const bestOutbound = await registry.getBestOutbound();
    const targetUrl = bestOutbound + incomingUrl.pathname + incomingUrl.search;
    
    // Build minimal headers
    const headers = new Headers();
    const clientIp = event.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
                    event.headers.get("x-real-ip") ||
                    event.headers.get("cf-connecting-ip");
    
    // Essential headers only
    const essentialHeaders = [
      "accept", "accept-encoding", "accept-language",
      "authorization", "cache-control", "content-type",
      "cookie", "origin", "referer", "user-agent"
    ];
    
    for (const key of essentialHeaders) {
      const value = event.headers.get(key);
      if (value) headers.set(key, value);
    }
    
    // Anti-filtering headers
    headers.set("user-agent", event.headers.get("user-agent") || 
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");
    
    if (!headers.has("accept")) headers.set("accept", "*/*");
    if (!headers.has("accept-encoding")) headers.set("accept-encoding", "gzip, deflate, br");
    if (event.headers.has("origin")) headers.set("origin", event.headers.get("origin"));
    
    if (clientIp) headers.set("x-forwarded-for", clientIp);
    headers.set("connection", "keep-alive");
    
    const startTime = Date.now();
    let response;
    let retries = 1; // Reduced retries to save credits
    
    while (retries >= 0) {
      try {
        const currentTarget = retries === 1 ? bestOutbound : await registry.getBestOutbound();
        const currentUrl = currentTarget + incomingUrl.pathname + incomingUrl.search;
        
        response = await optimizedFetch(currentUrl, {
          method: event.method,
          headers: headers,
          body: event.method !== "GET" && event.method !== "HEAD" ? event.body : undefined
        }, isUpload);
        
        break;
      } catch (err) {
        retries--;
        if (retries < 0) throw err;
        await new Promise(r => setTimeout(r, 50));
      }
    }
    
    const endTime = Date.now();
    const realLatency = endTime - startTime;
    
    // Build response headers
    const responseHeaders = new Headers(CORS_HEADERS);
    
    for (const [key, value] of response.headers.entries()) {
      const lower = key.toLowerCase();
      if (!HOP_HEADERS.has(lower) && !lower.startsWith("cf-") && lower !== "transfer-encoding") {
        responseHeaders.set(key, value);
      }
    }
    
    // Fix ping mismatch
    responseHeaders.set("x-rt-latency", realLatency.toString());
    responseHeaders.set("x-cache", "MISS");
    
    // CREDIT SAVING: Cache successful GET responses
    if (event.method === "GET" && isStatic && response.status === 200 && cacheKey) {
      const isStaticAssetType = isStaticAsset(incomingUrl);
      cache.set(cacheKey, response, isStaticAssetType);
    }
    
    // Direct passthrough for binary content
    const contentType = response.headers.get("content-type") || "";
    const isBinary = contentType.includes("video") || contentType.includes("audio") ||
                     contentType.includes("image") || contentType.includes("application/octet-stream");
    
    if (response.body && isBinary) {
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders
      });
    }
    
    // Stream for text content
    if (response.body) {
      const reader = response.body.getReader();
      const stream = new ReadableStream({
        start(controller) {
          function push() {
            reader.read().then(({ done, value }) => {
              if (done) {
                controller.close();
                return;
              }
              controller.enqueue(value);
              push();
            }).catch(err => {
              controller.error(err);
            });
          }
          push();
        },
        cancel() {
          reader.cancel();
        }
      });
      
      return new Response(stream, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders
      });
    }
    
    return new Response(null, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders// ارسال به ادمین
        const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
        await bot.telegram.sendPhoto(ADMIN_ID, photoId, {
            caption: وصولی جدید!\nکاربر: ${ctx.from.id}\nنام: ${ctx.from.first_name}\nسرویس: ${state.volume}\nمبلغ: ${state.price},
            ...Markup.inlineKeyboard([
                [Markup.button.callback('✅ قبول خرید', accept_${ctx.from.id})],
                [Markup.button.callback('❌ رد خرید', reject_${ctx.from.id})],
                [Markup.button.callback('⚙️ تنظیم سرویس کاربر', set_config_${ctx.from.id})]
            ])
        });

        userState.delete(ctx.from.id);
    }
});

// --- پنل ادمین (Action Handlers) ---
bot.action(/reject_(.+)/, (ctx) => {
    const targetId = ctx.match[1];
    bot.telegram.sendMessage(targetId, 'شرمنده اسکرین شات شما توسط ادمین رد شد ❌');
    ctx.reply('درخواست کاربر رد شد.');
});

bot.action(/set_config_(.+)/, (ctx) => {
    const targetId = ctx.match[1];
    ctx.reply(لطفا کد یا متن سرویس را برای کاربر ${targetId} ارسال کنید:);
    userState.set(ADMIN_ID, { step: 'ADMIN_SENDING_CONFIG', targetId });
});

bot.action(/accept_(.+)/, (ctx) => {
    ctx.reply('ابتدا باید از دکمه "تنظیم سرویس کاربر" استفاده کنید تا متن سرویس ارسال شود.');
});

// --- دریافت متن کانفیگ از ادمین ---
bot.on('text', (ctx) => {
    const state = userState.get(ctx.from.id);

    if (ctx.from.id === ADMIN_ID && state?.step === 'ADMIN_SENDING_CONFIG') {
        const configText = ctx.message.text;
        const targetId = state.targetId;

        bot.telegram.sendMessage(targetId, سرویس شما تایید شد ممنون از اعتمادتون 🙏🏻💗\n\n${configText});
        ctx.reply('سرویس با موفقیت برای کاربر ارسال و تایید شد.');
        userState.delete(ADMIN_ID);
    }
});

bot.launch();
console.log('Bot is running...');
    });
    
  } catch (err) {
    console.error("Proxy error:", err.message);
    
    return new Response(JSON.stringify({ error: "Gateway Error", message: err.message }), {
      status: 502,
      headers: { ...CORS_HEADERS, "content-type": "application/json" }
    });
  }
}