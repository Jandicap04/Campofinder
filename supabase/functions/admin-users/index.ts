import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const allowedRoles = new Set(["usuario", "jugador", "administrador"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return response({ error: "Método no permitido." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Faltan secretos requeridos para la Edge Function admin-users.");
    return response({ error: "El servicio de administración no está configurado." }, 500);
  }

  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) {
    return response({ error: "Debes iniciar sesión." }, 401);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const {
      data: { user: actor },
      error: authError,
    } = await supabase.auth.getUser(token);
    if (authError || !actor) {
      return response({ error: "La sesión no es válida." }, 401);
    }

    const { data: actorProfile, error: profileError } = await supabase
      .from("usuarios")
      .select("rol, bloqueado")
      .eq("id", actor.id)
      .single();
    if (profileError || actorProfile?.rol !== "administrador" || actorProfile.bloqueado) {
      return response({ error: "Acceso denegado." }, 403);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return response({ error: "El cuerpo de la solicitud no es JSON válido." }, 400);
    }
    if (!body || typeof body !== "object" || typeof body.action !== "string") {
      return response({ error: "La solicitud no es válida." }, 400);
    }

    if (body.action === "create") {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const password = body.password;
      const role = body.role;
      if (
        !name ||
        name.length > 100 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        typeof password !== "string" ||
        password.length < 8 ||
        !allowedRoles.has(role)
      ) {
        return response({ error: "Revisa nombre, correo, rol y contraseña (mínimo 8 caracteres)." }, 400);
      }

      const { data, error } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: name },
      });
      if (error || !data.user) {
        return response({ error: error?.message || "No se pudo crear el usuario." }, 400);
      }

      const { error: updateError } = await supabase
        .from("usuarios")
        .update({ nombre: name, correo: email, rol: role })
        .eq("id", data.user.id);
      if (updateError) {
        const { error: deleteError } = await supabase.auth.admin.deleteUser(data.user.id);
        if (deleteError) {
          console.error("No se pudo revertir la cuenta tras fallar su perfil.", deleteError);
        }
        return response({ error: "No se pudo guardar el perfil del usuario." }, 500);
      }
      return response({ message: "Usuario creado." }, 201);
    }

    const userId = body.userId;
    if (typeof userId !== "string" || !uuidPattern.test(userId)) {
      return response({ error: "El identificador del usuario no es válido." }, 400);
    }

    if (body.action === "update") {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const role = body.role;
      if (
        !name ||
        name.length > 100 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        !allowedRoles.has(role)
      ) {
        return response({ error: "Revisa nombre, correo y rol." }, 400);
      }

      const { error: authUpdateError } = await supabase.auth.admin.updateUserById(
        userId,
        {
          email,
          email_confirm: true,
          user_metadata: { full_name: name },
        },
      );
      if (authUpdateError) {
        return response({ error: "No se pudo actualizar la cuenta. Verifica el correo." }, 400);
      }

      const { data, error } = await supabase
        .from("usuarios")
        .update({ nombre: name, correo: email, rol: role })
        .eq("id", userId)
        .select("id")
        .maybeSingle();
      if (error || !data) {
        return response({ error: "No se pudo actualizar el perfil del usuario." }, 500);
      }
      return response({ message: "Usuario actualizado." });
    }

    if (body.action === "password") {
      if (typeof body.password !== "string" || body.password.length < 8) {
        return response({ error: "La contraseña debe tener al menos 8 caracteres." }, 400);
      }
      const { error } = await supabase.auth.admin.updateUserById(userId, {
        password: body.password,
      });
      if (error) {
        return response({ error: "No se pudo cambiar la contraseña." }, 400);
      }
      return response({ message: "Contraseña actualizada." });
    }

    if (body.action === "delete") {
      if (userId === actor.id) {
        return response({ error: "No puedes eliminar tu propia cuenta." }, 400);
      }
      const { error } = await supabase.auth.admin.deleteUser(userId);
      if (error) {
        return response({ error: "No se pudo eliminar al usuario." }, 400);
      }
      return response({ message: "Usuario eliminado." });
    }

    return response({ error: "La acción solicitada no es válida." }, 400);
  } catch (error) {
    console.error("Error en la función admin-users.", error);
    return response({ error: "No se pudo completar la acción administrativa." }, 500);
  }
});
