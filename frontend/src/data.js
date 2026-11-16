import { supabase } from "./supabase";

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

function localDateISO(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function mapCourt(row, timers, blockedToday, availability, liveMatches, availabilityError) {
  return {
    id: row.id_cancha,
    name: row.nombre,
    description: row.descripcion,
    price: row.precio === null ? null : Number(row.precio),
    image: row.imagen_url || "imagenes/logo1.png",
    timerMinutes: timers.get(row.id_cancha) || 0,
    blockedToday: blockedToday.has(row.id_cancha),
    openingTime: row.hora_apertura?.slice(0, 5) || "16:00",
    closingTime: row.hora_cierre?.slice(0, 5) || "23:00",
    availableSlots: availabilityError ? null : availability.get(row.id_cancha) || 0,
    availabilityError,
    liveMatch: liveMatches.get(row.id_cancha) || null,
  };
}

export function courtSlots(court) {
  if (!court) return [];
  const [openingHour, openingMinute] = court.openingTime.split(":").map(Number);
  const [closingHour, closingMinute] = court.closingTime.split(":").map(Number);
  const opening = openingHour * 60 + openingMinute;
  const closing = closingHour * 60 + closingMinute;
  const slots = [];

  for (let start = opening; start + 60 <= closing; start += 60) {
    const end = start + 60;
    const format = (minutes) =>
      `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    slots.push(`${format(start)} - ${format(end)}`);
  }

  return slots;
}

function mapLiveMatch(row) {
  return {
    courtId: row.cancha_id,
    reservationId: row.reserva_id,
    homeTeam: row.equipo_local,
    awayTeam: row.equipo_visitante,
    homeScore: row.marcador_local,
    awayScore: row.marcador_visitante,
    status: row.estado,
    startedAt: row.iniciado_en,
    endedAt: row.finalizado_en,
  };
}

function mapAdvertiser(row) {
  return {
    id: row.id,
    company: row.company_name,
    description: row.description || "",
    logo: row.logo_url || "",
    contact: row.contact_name || "",
    email: row.email || "",
    phone: row.phone || "",
    whatsapp: row.whatsapp || "",
    website: row.website || "",
    social: row.social_handle || "",
    city: row.city || "",
    status: row.status === "active" ? "activo" : row.status === "paused" ? "pausado" : "archivado",
  };
}

export function courtImageUrl(image) {
  if (image && /^https?:\/\//i.test(image)) return image;
  const filename = (image || "imagenes/logo1.png")
    .replace(/^\/?static\//, "")
    .replace(/^\/+/, "");
  return `/${filename.split("/").map(encodeURIComponent).join("/")}`;
}

export async function getProfile(userId) {
  const profile = unwrap(
    await supabase
      .from("usuarios")
      .select("id, nombre, correo, rol, bloqueado")
      .eq("id", userId)
      .maybeSingle(),
  );
  if (!profile) {
    throw new Error("La cuenta no tiene un perfil. Contacta al administrador.");
  }
  if (profile.bloqueado) {
    throw new Error("Tu cuenta ha sido bloqueada por un administrador.");
  }
  return {
    id: profile.id,
    name: profile.nombre,
    email: profile.correo,
    role: profile.rol,
  };
}

export async function getCourts() {
  const today = localDateISO();
  const currentTime = new Date().toTimeString().slice(0, 8);
  const [courtResult, timerResult, blockedResult, liveResult] = await Promise.all([
    supabase
      .from("canchas")
      .select("id_cancha, nombre, descripcion, precio, imagen_url, hora_apertura, hora_cierre")
      .order("id_cancha"),
    supabase.from("timers").select("cancha_id, minutos"),
    supabase
      .from("horarios_bloqueados")
      .select("cancha_id, horario")
      .eq("fecha", today),
    supabase
      .from("partidos_en_vivo")
      .select("cancha_id, reserva_id, equipo_local, equipo_visitante, marcador_local, marcador_visitante, estado, iniciado_en, finalizado_en"),
  ]);
  const availabilityResult = await supabase.rpc("get_public_court_status", {
    p_date: today,
    p_current_time: currentTime,
  });
  const courts = unwrap(courtResult) || [];
  const timers = new Map(
    (unwrap(timerResult) || []).map((timer) => [timer.cancha_id, timer.minutos]),
  );
  const blockedToday = new Set((unwrap(blockedResult) || []).map((slot) => slot.cancha_id));
  const availabilityError = availabilityResult.error
    ? `No se pudo consultar la disponibilidad de hoy. Verifica que hayas ejecutado la versión actualizada de supabase/schema.sql (${availabilityResult.error.message}).`
    : "";
  const availability = new Map(
    (availabilityResult.data || []).map((item) => [item.cancha_id, item.horarios_disponibles]),
  );
  const liveMatches = new Map(
    (unwrap(liveResult) || []).map((item) => {
      const match = mapLiveMatch(item);
      return [match.courtId, match];
    }),
  );
  return courts.map((court) => mapCourt(court, timers, blockedToday, availability, liveMatches, availabilityError));
}

export async function getCourtAvailability(courtId, date) {
  return unwrap(
    await supabase.rpc("get_court_availability", {
      p_court_id: Number(courtId),
      p_date: date,
    }),
  );
}

export async function getLiveMatch(courtId) {
  const row = unwrap(
    await supabase
      .from("partidos_en_vivo")
      .select("cancha_id, reserva_id, equipo_local, equipo_visitante, marcador_local, marcador_visitante, estado, iniciado_en, finalizado_en")
      .eq("cancha_id", Number(courtId))
      .maybeSingle(),
  );
  return row ? mapLiveMatch(row) : null;
}

export async function getLiveMatches(courtIds) {
  if (!courtIds.length) return [];
  const rows = unwrap(
    await supabase
      .from("partidos_en_vivo")
      .select("cancha_id, reserva_id, equipo_local, equipo_visitante, marcador_local, marcador_visitante, estado, iniciado_en, finalizado_en")
      .in("cancha_id", courtIds),
  );
  return (rows || []).map(mapLiveMatch);
}

export async function getAdminReservations() {
  const rows = unwrap(
    await supabase
      .from("reservas")
      .select("id_reserva, cancha, horario, fecha, usuarios(nombre, correo)")
      .gte("fecha", localDateISO())
      .order("fecha")
      .order("horario"),
  );
  return (rows || []).map((row) => {
    const player = Array.isArray(row.usuarios) ? row.usuarios[0] : row.usuarios;
    return {
      id: row.id_reserva,
      courtName: row.cancha,
      date: row.fecha,
      time: row.horario,
      playerName: player?.nombre?.trim() || player?.correo?.split("@")[0] || "Jugador",
    };
  });
}

export async function getAdvertisers() {
  const rows = unwrap(
    await supabase
      .from("advertisers")
      .select("id, company_name, description, logo_url, contact_name, email, phone, whatsapp, website, social_handle, city, status")
      .order("company_name"),
  );
  return (rows || []).map(mapAdvertiser);
}

export async function getPublicAdvertisers() {
  const feed = unwrap(await supabase.rpc("get_active_advertising_feed"));
  return (feed?.advertisers || []).map((advertiser) => ({
    id: advertiser.id,
    company: advertiser.company_name,
    description: advertiser.description || "",
    logo: advertiser.logo_url || "",
    city: advertiser.city || "",
    website: advertiser.website || "",
  }));
}

export async function createAdvertiserRecord(advertiser) {
  const row = unwrap(
    await supabase
      .from("advertisers")
      .insert({
        company_name: advertiser.company,
        description: advertiser.description,
        contact_name: advertiser.contact,
        email: advertiser.email,
        phone: advertiser.phone,
        whatsapp: advertiser.whatsapp,
        website: advertiser.website,
        social_handle: advertiser.social,
        city: advertiser.city,
        status: advertiser.status === "pausado" ? "paused" : "active",
      })
      .select("id, company_name, description, logo_url, contact_name, email, phone, whatsapp, website, social_handle, city, status")
      .single(),
  );
  return mapAdvertiser(row);
}

export async function updateAdvertiserLogo(advertiserId, logoUrl) {
  unwrap(
    await supabase
      .from("advertisers")
      .update({ logo_url: logoUrl })
      .eq("id", advertiserId)
      .select("id")
      .single(),
  );
}

export async function uploadBrandAsset(path, file) {
  unwrap(
    await supabase.storage
      .from("brand-assets")
      .upload(path, file, {
        cacheControl: "3600",
        contentType: file.type,
        upsert: false,
      }),
  );
  return supabase.storage.from("brand-assets").getPublicUrl(path).data.publicUrl;
}

export async function deleteBrandAsset(path) {
  unwrap(await supabase.storage.from("brand-assets").remove([path]));
}

export async function startLiveMatch({ courtId, reservationId, homeTeam, awayTeam }) {
  unwrap(
    await supabase.from("partidos_en_vivo").upsert(
      {
        cancha_id: Number(courtId),
        reserva_id: Number(reservationId),
        equipo_local: homeTeam.trim(),
        equipo_visitante: awayTeam.trim(),
        marcador_local: 0,
        marcador_visitante: 0,
        estado: "en_vivo",
        iniciado_en: new Date().toISOString(),
        finalizado_en: null,
      },
      { onConflict: "cancha_id" },
    ),
  );
}

export async function updateLiveScore(courtId, side, change) {
  if (!["local", "visitante"].includes(side) || ![-1, 1].includes(change)) {
    throw new Error("El cambio del marcador no es válido.");
  }
  const column = side === "local" ? "marcador_local" : "marcador_visitante";
  const current = unwrap(
    await supabase
      .from("partidos_en_vivo")
      .select(column)
      .eq("cancha_id", Number(courtId))
      .eq("estado", "en_vivo")
      .single(),
  );
  const score = Math.max(0, current[column] + change);
  unwrap(
    await supabase
      .from("partidos_en_vivo")
      .update({ [column]: score })
      .eq("cancha_id", Number(courtId))
      .eq("estado", "en_vivo"),
  );
}

export async function finishLiveMatch(courtId) {
  unwrap(
    await supabase
      .from("partidos_en_vivo")
      .update({ estado: "finalizado", finalizado_en: new Date().toISOString() })
      .eq("cancha_id", Number(courtId))
      .eq("estado", "en_vivo"),
  );
}

export async function createReservation({ courtId, date, time, message }) {
  return unwrap(
    await supabase.rpc("create_reservation", {
      p_court_id: Number(courtId),
      p_date: date,
      p_time: time,
      p_message: message,
    }),
  );
}

export async function getReservations(userId) {
  const rows = unwrap(
    await supabase
      .from("reservas")
      .select("id_reserva, cancha, horario, fecha, mensaje")
      .eq("id_usuario", userId)
      .order("fecha", { ascending: false })
      .order("horario", { ascending: false }),
  );
  return (rows || []).map((row) => ({
    id: row.id_reserva,
    court: row.cancha,
    time: row.horario,
    date: row.fecha,
    message: row.mensaje,
  }));
}

export async function cancelReservation(reservationId) {
  const row = unwrap(
    await supabase
      .from("reservas")
      .delete()
      .eq("id_reserva", reservationId)
      .select("id_reserva")
      .maybeSingle(),
  );
  if (!row) {
    throw new Error("No se pudo cancelar la reserva. Verifica que aún esté vigente.");
  }
}

export async function getAdminOverview(userId) {
  const [courtResult, timerResult, usersResult, blockedResult] =
    await Promise.all([
      supabase
        .from("canchas")
        .select("id_cancha, nombre, descripcion, precio, imagen_url, hora_apertura, hora_cierre")
        .eq("admin_id", userId)
        .order("id_cancha"),
      supabase.from("timers").select("cancha_id, minutos"),
      supabase
        .from("usuarios")
        .select("id, nombre, correo, rol, bloqueado")
        .order("creado_en", { ascending: false })
        .limit(200),
      supabase
        .from("horarios_bloqueados")
        .select("cancha_id, fecha, horario")
        .gte("fecha", localDateISO())
        .order("fecha")
        .order("cancha_id")
        .order("horario"),
    ]);

  const courts = unwrap(courtResult) || [];
  const timers = new Map(
    (unwrap(timerResult) || []).map((timer) => [timer.cancha_id, timer.minutos]),
  );
  const users = unwrap(usersResult) || [];
  const blockedSlots = unwrap(blockedResult) || [];
  return {
    courts: courts.map((court) => mapCourt(court, timers, new Set(), new Map(), new Map())),
    users: users.map((user) => ({
      id: user.id,
      name: user.nombre,
      email: user.correo,
      role: user.rol,
      blocked: user.bloqueado,
    })),
    blockedSlots: blockedSlots.map((slot) => ({
      courtId: slot.cancha_id,
      date: slot.fecha,
      time: slot.horario,
    })),
  };
}

export async function saveTimer(courtId, minutes) {
  unwrap(
    await supabase.from("timers").upsert(
      { cancha_id: Number(courtId), minutos: Number(minutes) },
      { onConflict: "cancha_id" },
    ),
  );
}

export async function updateBlockedSlot({ courtId, date, time, action }) {
  const query =
    action === "block"
      ? supabase
          .from("horarios_bloqueados")
          .upsert(
            {
              cancha_id: Number(courtId),
              fecha: date,
              horario: time,
            },
            { onConflict: "cancha_id,fecha,horario" },
          )
      : supabase
          .from("horarios_bloqueados")
          .delete()
          .eq("cancha_id", Number(courtId))
          .eq("fecha", date)
          .eq("horario", time);
  unwrap(await query);
}

export async function setUserBlocked(userId, blocked) {
  unwrap(
    await supabase
      .from("usuarios")
      .update({ bloqueado: blocked })
      .eq("id", userId),
  );
}

async function invokeAdminUsers(action, values) {
  const { data, error } = await supabase.functions.invoke("admin-users", {
    body: { action, ...values },
  });
  if (error) {
    let message = error.message;
    try {
      const details = await error.context?.json();
      if (details?.error) message = details.error;
    } catch {
      // The response can be empty for network errors.
    }
    throw new Error(message);
  }
  return data;
}

export function createAdminUser(user) {
  return invokeAdminUsers("create", user);
}

export function updateAdminUser(user) {
  return invokeAdminUsers("update", user);
}

export function changeAdminUserPassword(userId, password) {
  return invokeAdminUsers("password", { userId, password });
}

export function deleteAdminUser(userId) {
  return invokeAdminUsers("delete", { userId });
}
