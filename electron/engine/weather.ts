// Quip V3 — weather (Skales "Weather (always on)" parity, zero keys).
// ─────────────────────────────────────────────────────────────────────────────
// Port of the Skales weather skill's contract onto open-meteo's free public
// APIs: geocode a place name → current + 3-day forecast. No API key, honest
// failures, safe-URL gate on every request.
// ─────────────────────────────────────────────────────────────────────────────

import { isSafePublicUrl } from "./browser-automation";

const FETCH_TIMEOUT_MS = 12_000;

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { "User-Agent": "Quip/1.0 (weather skill)" },
  });
  if (!res.ok) throw new Error(`http-${res.status}`);
  return res.json();
}

export interface WeatherResult {
  ok: boolean;
  summary: string;
  evidence: string[];
}

const WMO_CODES: Record<number, string> = {
  0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast",
  45: "fog", 48: "freezing fog", 51: "light drizzle", 53: "drizzle", 55: "heavy drizzle",
  56: "freezing drizzle", 57: "freezing drizzle", 61: "light rain", 63: "rain", 65: "heavy rain",
  66: "freezing rain", 67: "freezing rain", 71: "light snow", 73: "snow", 75: "heavy snow",
  77: "snow grains", 80: "rain showers", 81: "rain showers", 82: "violent rain showers",
  85: "snow showers", 86: "snow showers", 95: "thunderstorm", 96: "thunderstorm with hail",
  99: "thunderstorm with hail",
};

function describe(code: number | undefined): string {
  return WMO_CODES[Number(code ?? -1)] ?? "unknown conditions";
}

/** Real weather: geocode + forecast, no key needed. */
export async function weatherRead(place: string): Promise<WeatherResult> {
  const q = (place ?? "").trim();
  if (!q) {
    return { ok: false, summary: "Tell me which city to check the weather for.", evidence: [] };
  }
  const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=en&format=json`;
  const geoGate = isSafePublicUrl(geoUrl);
  if (!geoGate.safe) return { ok: false, summary: "That place lookup was blocked for safety.", evidence: [] };

  try {
    const geo = await fetchJson(geoGate.url!);
    const hit = geo?.results?.[0];
    if (!hit) {
      return { ok: false, summary: `I couldn't find a place called "${q}" — check the spelling.`, evidence: ["geocoding"] };
    }
    const lat = Number(hit.latitude).toFixed(3);
    const lon = Number(hit.longitude).toFixed(3);
    const where = [hit.name, hit.admin1, hit.country].filter(Boolean).join(", ");

    const fcUrl =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=4&timezone=auto`;
    const fcGate = isSafePublicUrl(fcUrl);
    if (!fcGate.safe) return { ok: false, summary: "That forecast request was blocked for safety.", evidence: [] };

    const fc = await fetchJson(fcGate.url!);
    const cur = fc?.current ?? {};
    const daily = fc?.daily ?? {};
    const days: string[] = [];
    const dates: string[] = daily.time ?? [];
    for (let i = 0; i < Math.min(4, dates.length); i++) {
      const day = i === 0 ? "Today" : dates[i];
      days.push(
        `${day}: ${describe(daily.weather_code?.[i])}, ` +
        `${Math.round(Number(daily.temperature_2m_min?.[i] ?? 0))}–${Math.round(Number(daily.temperature_2m_max?.[i] ?? 0))}°C, ` +
        `rain chance ${Number(daily.precipitation_probability_max?.[i] ?? 0)}%`
      );
    }
    const summary =
      `Weather in ${where}:\n` +
      `Now: ${Math.round(Number(cur.temperature_2m ?? 0))}°C (feels ${Math.round(Number(cur.apparent_temperature ?? 0))}°C), ` +
      `${describe(cur.weather_code)}, humidity ${Math.round(Number(cur.relative_humidity_2m ?? 0))}%, wind ${Math.round(Number(cur.wind_speed_10m ?? 0))} km/h\n` +
      days.join("\n");
    return { ok: true, summary, evidence: ["open-meteo", where] };
  } catch (e: any) {
    return {
      ok: false,
      summary: `I couldn't fetch the weather — ${e?.message ?? e}. The service may be briefly down.`,
      evidence: ["weather fetch failed"],
    };
  }
}
