// Los datos de una empresa en GTFS, el formato que leen Google Maps, Moovit,
// Transit y casi cualquier app de transporte.
//
//   GET /functions/v1/gtfs?empresa=<uuid>        → ZIP con el GTFS estático
//                                                  (rutas, paradas, horarios).
//   GET /functions/v1/gtfs?empresa=<uuid>&rt=1   → GTFS-Realtime (protobuf) con
//                                                  la posición de sus buses.
//
// Es público a propósito (verify_jwt = false): Google y Moovit lo descargan
// solos, sin cabeceras. Solo expone lo que la app ya muestra sin cuenta:
// rutas, paradas, horarios y el último punto de cada bus en servicio, sin
// chofer ni historial.
//
// Lo que no sabemos se aproxima y se marca: los horarios que carga la empresa
// son salidas desde el origen, así que el paso por cada parada se estima a
// 25 km/h con medio minuto por parada (timepoint = 0, "aproximado"), y solo
// se publica el sentido de ida.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { strToU8, zipSync } from "npm:fflate@0.8.2";

const APP = "https://buxi.vercel.app";
const KMH = 25;
const MIN_POR_PARADA = 0.5;
const FACTOR_CALLE = 1.2;

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const cors = { "Access-Control-Allow-Origin": "*" };

function error(status: number, mensaje: string): Response {
  return new Response(JSON.stringify({ error: mensaje }), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

// ---- CSV ----
function campo(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function csv(columnas: string[], filas: Record<string, unknown>[]): string {
  return [columnas.join(","), ...filas.map((f) => columnas.map((c) => campo(f[c])).join(","))].join("\r\n") + "\r\n";
}

function km(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const r = (x: number) => (x * Math.PI) / 180;
  const dLat = r(bLat - aLat), dLng = r(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

// "05:30:00" + 37.4 min → "06:07:24". GTFS admite horas ≥ 24 (viajes que
// cruzan la medianoche).
function sumarMinutos(hora: string, minutos: number): string {
  const [h, m, s] = hora.split(":").map(Number);
  const total = Math.round(h * 3600 + m * 60 + (s || 0) + minutos * 60);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(total / 3600))}:${p(Math.floor((total % 3600) / 60))}:${p(total % 60)}`;
}

const hex = (c: string | null, porDefecto: string) => (c && /^#?[0-9a-f]{6}$/i.test(c) ? c.replace("#", "").toUpperCase() : porDefecto);
// Texto blanco o negro según el color de la ruta (luminancia relativa).
function textoSobre(color: string): string {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(color.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? "000000" : "FFFFFF";
}

const yyyymmdd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");

async function estatico(empresaId: string): Promise<Response> {
  const { data: empresa } = await admin.from("empresas").select("id, nombre, telefono, email, estado").eq("id", empresaId).maybeSingle();
  if (!empresa || empresa.estado !== "activo") return error(404, "No existe esa empresa o no está activa.");

  const { data: rutas } = await admin.from("rutas")
    .select("id, nombre, codigo_ruta, color, geometria, origen, destino").eq("empresa_id", empresaId).eq("estado", "activa");
  const rutaIds = (rutas || []).map((r) => r.id);
  const [{ data: paradas }, { data: salidas }, { data: horarios }] = rutaIds.length
    ? await Promise.all([
      admin.from("paradas").select("id, ruta_id, nombre, latitud, longitud, orden").in("ruta_id", rutaIds).order("orden"),
      admin.from("horario_salidas").select("id, ruta_id, dia, hora").in("ruta_id", rutaIds).order("hora"),
      admin.from("horarios").select("id, ruta_id, dia, primera_salida, ultima_salida, frecuencia_minutos").in("ruta_id", rutaIds),
    ])
    : [{ data: [] }, { data: [] }, { data: [] }];

  const hoy = new Date();
  const enUnAnio = new Date(hoy.getTime() + 365 * 86400000);
  const DIAS: Record<string, number[]> = { lunes_viernes: [1, 1, 1, 1, 1, 0, 0], sabado: [0, 0, 0, 0, 0, 1, 0], domingo: [0, 0, 0, 0, 0, 0, 1] };
  const NOMBRES = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

  const routes: Record<string, unknown>[] = [];
  const stops: Record<string, unknown>[] = [];
  const trips: Record<string, unknown>[] = [];
  const stopTimes: Record<string, unknown>[] = [];
  const shapes: Record<string, unknown>[] = [];
  const frequencies: Record<string, unknown>[] = [];
  const serviciosUsados = new Set<string>();

  for (const r of rutas || []) {
    const ps = (paradas || []).filter((p) => p.ruta_id === r.id).sort((a, b) => a.orden - b.orden);
    if (ps.length < 2) continue; // sin al menos origen y destino no hay viaje que describir
    const color = hex(r.color, "00C853");
    routes.push({
      route_id: r.id, agency_id: empresa.id,
      route_short_name: r.codigo_ruta || "", route_long_name: r.nombre,
      route_type: 3, route_color: color, route_text_color: textoSobre(color),
    });
    for (const p of ps) {
      stops.push({ stop_id: p.id, stop_name: p.nombre, stop_lat: p.latitud.toFixed(6), stop_lon: p.longitud.toFixed(6) });
    }
    // geometria se guarda como [lat, lng] (formato Leaflet).
    const geo = Array.isArray(r.geometria) ? r.geometria as [number, number][] : [];
    geo.forEach(([lat, lng], i) => shapes.push({ shape_id: r.id, shape_pt_lat: lat.toFixed(6), shape_pt_lon: lng.toFixed(6), shape_pt_sequence: i }));

    // Minutos desde la salida hasta cada parada.
    const offsets: number[] = [0];
    for (let i = 1; i < ps.length; i++) {
      const d = km(ps[i - 1].latitud, ps[i - 1].longitud, ps[i].latitud, ps[i].longitud) * FACTOR_CALLE;
      offsets.push(offsets[i - 1] + (d / KMH) * 60 + MIN_POR_PARADA);
    }
    const agregarViaje = (tripId: string, dia: string, salida: string) => {
      serviciosUsados.add(dia);
      trips.push({ route_id: r.id, service_id: dia, trip_id: tripId, trip_headsign: r.destino, direction_id: 0, shape_id: geo.length ? r.id : "" });
      ps.forEach((p, i) => {
        const t = sumarMinutos(salida, offsets[i]);
        stopTimes.push({ trip_id: tripId, arrival_time: t, departure_time: t, stop_id: p.id, stop_sequence: i, timepoint: i === 0 ? 1 : 0 });
      });
    };

    // Salidas exactas si la empresa las cargó; si no, el horario por
    // frecuencia ("cada 10 min de 4:30 a 22:00").
    const exactas = (salidas || []).filter((s) => s.ruta_id === r.id);
    const diasConExactas = new Set(exactas.map((s) => s.dia));
    for (const s of exactas) agregarViaje(s.id, s.dia, s.hora);
    for (const h of (horarios || []).filter((x) => x.ruta_id === r.id && !diasConExactas.has(x.dia))) {
      if (!h.frecuencia_minutos || !h.primera_salida || !h.ultima_salida) continue;
      agregarViaje(h.id, h.dia, h.primera_salida);
      frequencies.push({
        trip_id: h.id, start_time: h.primera_salida,
        // end_time no se incluye: la última salida es ultima_salida.
        end_time: sumarMinutos(h.ultima_salida, 1),
        headway_secs: h.frecuencia_minutos * 60, exact_times: 0,
      });
    }
  }

  const calendar = [...serviciosUsados].map((dia) => {
    const fila: Record<string, unknown> = { service_id: dia, start_date: yyyymmdd(hoy), end_date: yyyymmdd(enUnAnio) };
    DIAS[dia].forEach((v, i) => fila[NOMBRES[i]] = v);
    return fila;
  });

  const archivos: Record<string, Uint8Array> = {
    "agency.txt": strToU8(csv(["agency_id", "agency_name", "agency_url", "agency_timezone", "agency_lang", "agency_phone", "agency_email"], [{
      agency_id: empresa.id, agency_name: empresa.nombre, agency_url: `${APP}/passenger/map`,
      agency_timezone: "America/Costa_Rica", agency_lang: "es", agency_phone: empresa.telefono || "", agency_email: empresa.email || "",
    }])),
    "routes.txt": strToU8(csv(["route_id", "agency_id", "route_short_name", "route_long_name", "route_type", "route_color", "route_text_color"], routes)),
    "stops.txt": strToU8(csv(["stop_id", "stop_name", "stop_lat", "stop_lon"], stops)),
    "trips.txt": strToU8(csv(["route_id", "service_id", "trip_id", "trip_headsign", "direction_id", "shape_id"], trips)),
    "stop_times.txt": strToU8(csv(["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence", "timepoint"], stopTimes)),
    "calendar.txt": strToU8(csv(["service_id", ...NOMBRES, "start_date", "end_date"], calendar)),
    "feed_info.txt": strToU8(csv(["feed_publisher_name", "feed_publisher_url", "feed_lang", "feed_start_date", "feed_end_date", "feed_version"], [{
      feed_publisher_name: "Buxmap", feed_publisher_url: APP, feed_lang: "es",
      feed_start_date: yyyymmdd(hoy), feed_end_date: yyyymmdd(enUnAnio), feed_version: hoy.toISOString(),
    }])),
  };
  if (shapes.length) archivos["shapes.txt"] = strToU8(csv(["shape_id", "shape_pt_lat", "shape_pt_lon", "shape_pt_sequence"], shapes));
  if (frequencies.length) archivos["frequencies.txt"] = strToU8(csv(["trip_id", "start_time", "end_time", "headway_secs", "exact_times"], frequencies));

  const nombre = empresa.nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return new Response(zipSync(archivos) as unknown as BodyInit, {
    headers: {
      ...cors,
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="gtfs-${nombre}.zip"`,
      "Cache-Control": "public, max-age=3600",
    },
  });
}

// ---- GTFS-Realtime (protobuf) ----
// Codificador mínimo para FeedMessage con VehiclePosition (gtfs-realtime.proto).
class Proto {
  private partes: number[] = [];
  private varint(n: number) {
    while (n > 127) { this.partes.push((n % 128) | 128); n = Math.floor(n / 128); }
    this.partes.push(n);
  }
  private tag(campo: number, tipo: number) { this.varint(campo * 8 + tipo); }
  uint(campo: number, n: number) { this.tag(campo, 0); this.varint(n); return this; }
  texto(campo: number, s: string) { const b = new TextEncoder().encode(s); this.tag(campo, 2); this.varint(b.length); this.partes.push(...b); return this; }
  mensaje(campo: number, m: Proto) { const b = m.bytes(); this.tag(campo, 2); this.varint(b.length); this.partes.push(...b); return this; }
  float(campo: number, x: number) {
    const v = new DataView(new ArrayBuffer(4)); v.setFloat32(0, x, true);
    this.tag(campo, 5); for (let i = 0; i < 4; i++) this.partes.push(v.getUint8(i)); return this;
  }
  bytes(): Uint8Array { return Uint8Array.from(this.partes); }
}

async function enVivo(empresaId: string): Promise<Response> {
  const { data: empresa } = await admin.from("empresas").select("estado").eq("id", empresaId).maybeSingle();
  if (!empresa || empresa.estado !== "activo") return error(404, "No existe esa empresa o no está activa.");
  const { data: buses } = await admin.from("buses").select("id, ruta_id, placa, numero_unidad")
    .eq("empresa_id", empresaId).in("estado", ["activo", "en_ruta"]);
  const ahora = Math.floor(Date.now() / 1000);
  const feed = new Proto().mensaje(1, new Proto().texto(1, "2.0").uint(2, 0).uint(3, ahora));
  if (buses?.length) {
    const { data: locs } = await admin.from("bus_locations")
      .select("bus_id, latitud, longitud, velocidad, heading, timestamp")
      .in("bus_id", buses.map((b) => b.id))
      .gt("timestamp", new Date(Date.now() - 10 * 60000).toISOString())
      .order("timestamp", { ascending: false });
    const vistos = new Set<string>();
    for (const l of locs || []) {
      if (vistos.has(l.bus_id)) continue; // solo el último punto de cada bus
      vistos.add(l.bus_id);
      const bus = buses.find((b) => b.id === l.bus_id)!;
      const posicion = new Proto().float(1, l.latitud).float(2, l.longitud);
      if (l.heading !== null) posicion.float(3, l.heading);
      if (l.velocidad !== null) posicion.float(5, l.velocidad / 3.6); // m/s
      const vehiculo = new Proto();
      if (bus.ruta_id) vehiculo.mensaje(1, new Proto().texto(5, bus.ruta_id));
      vehiculo.mensaje(2, posicion)
        .uint(5, Math.floor(Date.parse(l.timestamp) / 1000))
        .mensaje(8, new Proto().texto(1, bus.id).texto(2, bus.numero_unidad || bus.placa).texto(3, bus.placa));
      feed.mensaje(2, new Proto().texto(1, bus.id).mensaje(4, vehiculo));
    }
  }
  return new Response(feed.bytes() as unknown as BodyInit, {
    headers: { ...cors, "Content-Type": "application/x-protobuf", "Cache-Control": "public, max-age=10" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Allow-Headers": "*" } });
  if (req.method !== "GET") return error(405, "Usá GET.");
  const url = new URL(req.url);
  const empresa = url.searchParams.get("empresa") || "";
  if (!/^[0-9a-f-]{36}$/i.test(empresa)) return error(400, "Falta ?empresa=<id>.");
  try {
    return url.searchParams.get("rt") ? await enVivo(empresa) : await estatico(empresa);
  } catch (e) {
    console.error("gtfs", String(e).slice(0, 300));
    return error(500, "No se pudo armar el GTFS.");
  }
});
