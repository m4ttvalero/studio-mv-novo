import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const modules = [
  "projects",
  "waitlist",
  "clients",
  "contracts",
  "finance",
  "messages",
  "portfolio",
];

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function validPermissions(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value).every(([key, access]) => {
    if (!modules.includes(key) || !access || typeof access !== "object") {
      return false;
    }
    const item = access as Record<string, unknown>;
    return (
      (item.read === undefined || typeof item.read === "boolean") &&
      (item.write === undefined || typeof item.write === "boolean") &&
      (!item.write || item.read === true)
    );
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") return response({ error: "Método inválido." }, 405);

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return response({ error: "Autenticação necessária." }, 401);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    return response({ error: "A função não está configurada no Supabase." }, 500);
  }

  const service = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const accessToken = authorization.slice("Bearer ".length);
  const {
    data: { user },
    error: userError,
  } = await service.auth.getUser(accessToken);
  if (userError || !user) {
    return response({ error: "Sessão inválida ou expirada. Entre novamente no painel." }, 401);
  }

  const { data: admins, error: adminError } = await service
    .from("admins")
    .select("email");
  if (adminError) {
    return response({ error: "Não foi possível verificar a permissão administrativa." }, 500);
  }
  if (!admins.some((admin) => admin.email.toLowerCase() === user.email?.toLowerCase())) {
    return response({ error: "Somente a conta administradora pode gerenciar membros." }, 403);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return response({ error: "Dados inválidos." }, 400);
  }

  const action = payload.action;

  if (action === "create") {
    const email = String(payload.email || "").trim().toLowerCase();
    const password = String(payload.password || "");
    const name = String(payload.name || "").trim();
    const jobTitle = String(payload.job_title || "").trim();
    const permissions = payload.permissions;
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      password.length < 10 ||
      name.length < 2 ||
      name.length > 120 ||
      jobTitle.length < 2 ||
      jobTitle.length > 80 ||
      !validPermissions(permissions)
    ) {
      return response({ error: "Confira nome, função, permissões, e-mail e senha (mínimo 10 caracteres)." }, 400);
    }

    const { data, error } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: name },
    });
    if (error || !data.user) return response({ error: error?.message || "Não foi possível criar a conta." }, 400);

    const { error: memberError } = await service.from("members").insert({
      user_id: data.user.id,
      email,
      name,
      job_title: jobTitle,
      permissions,
    });
    if (memberError) {
      const { error: cleanupError } = await service.auth.admin.deleteUser(data.user.id);
      return response({
        error: cleanupError
          ? `${memberError.message} A conta criada não pôde ser removida automaticamente: ${cleanupError.message}`
          : memberError.message,
      }, 400);
    }
    return response({ user_id: data.user.id });
  }

  const userId = String(payload.user_id || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
    return response({ error: "Membro inválido." }, 400);
  }

  if (action === "update") {
    const email = String(payload.email || "").trim().toLowerCase();
    const password = String(payload.password || "");
    const name = String(payload.name || "").trim();
    const jobTitle = String(payload.job_title || "").trim();
    const permissions = payload.permissions;
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      (password !== "" && password.length < 10) ||
      name.length < 2 ||
      name.length > 120 ||
      jobTitle.length < 2 ||
      jobTitle.length > 80 ||
      !validPermissions(permissions)
    ) {
      return response({ error: "Confira nome, função, permissões, e-mail e senha (mínimo 10 caracteres)." }, 400);
    }

    const { data: current, error: currentError } = await service
      .from("members")
      .select("email,name,job_title,permissions")
      .eq("user_id", userId)
      .single();
    if (currentError) return response({ error: currentError.message }, 404);

    const { error: memberError } = await service
      .from("members")
      .update({ email, name, job_title: jobTitle, permissions })
      .eq("user_id", userId);
    if (memberError) return response({ error: memberError.message }, 400);

    const authUpdates: { email: string; email_confirm: boolean; password?: string } = {
      email,
      email_confirm: true,
    };
    if (password) authUpdates.password = password;
    const { error: authError } = await service.auth.admin.updateUserById(userId, authUpdates);
    if (authError) {
      const { error: rollbackError } = await service
        .from("members")
        .update(current)
        .eq("user_id", userId);
      return response({
        error: rollbackError
          ? `${authError.message} A reversão dos dados do membro também falhou: ${rollbackError.message}`
          : authError.message,
      }, 400);
    }
    return response({ user_id: userId });
  }

  if (action === "delete") {
    const { error } = await service.auth.admin.deleteUser(userId);
    if (error) return response({ error: error.message }, 400);
    return response({ user_id: userId });
  }

  return response({ error: "Ação inválida." }, 400);
});
