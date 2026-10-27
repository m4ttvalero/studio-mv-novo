/* Studio MV · Painel administrativo (/boss)
 * Todos os dados são lidos e gravados no Supabase. As regras de acesso ficam no banco (RLS).
 */

/* ===================== Configuração ===================== */
const SUPABASE_URL = "https://gndnnjjxzmarwnvkeaba.supabase.co";
const SUPABASE_KEY = "sb_publishable_L_58cKj5-Zc9_bsMSsc3Hg_jTmaOEwH";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PAY = ["Pix", "Dinheiro", "Transferência", "Cartão", "Outra"];
const MSG_STATUS = [
  "Nova",
  "Em análise",
  "Respondida",
  "Convertida em cliente",
  "Arquivada",
];
const PROJ_STATUS = [
  "Aguardando início",
  "Em andamento",
  "Aguardando aprovação do cliente",
  "Em ajustes",
  "Concluído",
  "Entregue",
  "Cancelado",
];
const CONTRACT_STATUS = [
  "Em elaboração",
  "Aguardando assinatura",
  "Ativo",
  "Concluído",
  "Cancelado",
  "Vencido",
];
const BILLING = ["Único", "Mensal", "Trimestral", "Anual"];
const EXP_CAT = [
  "Ferramentas",
  "Plataformas",
  "Domínios",
  "Marketing",
  "Operacional",
  "Outros",
];
const RECURR = ["Nenhuma", "Mensal", "Anual"];
const SERVICES = [
  "Landing page",
  "Site institucional",
  "Funcionalidade personalizada",
  "Ainda não sei",
];
const TABLE_LABEL = {
  clients: "Cliente",
  projects: "Projeto",
  project_stages: "Etapa",
  waitlist: "Fila de espera",
  messages: "Solicitação",
  contracts: "Contrato",
  contract_files: "Anexo",
  receivables: "Cobrança",
  payments: "Pagamento",
  expenses: "Despesa",
  portfolio: "Portfólio",
};
const ACTION_LABEL = {
  insert: "Criado",
  update: "Atualizado",
  delete: "Excluído",
};

/* Cache dos dados de apoio (clientes, projetos, contratos) e financeiro */
const DB = { clients: [], projects: [], contracts: [] };
let FIN = { receivables: [], payments: [], expenses: [] };
const CACHE = {
  clients: () => DB.clients,
  projects: () => DB.projects,
  contracts: () => DB.contracts,
};

/* Registros de ações por atributo data-act, data-change, data-input e data-submit */
const GACT = {}; /* ações globais (botões) */
let CHG = {}; /* alterações de campos, por view */
let INP = {}; /* digitação em campos de busca, por view */
let SUB = {}; /* envio de formulários embutidos, por view */

/* ===================== Utilitários ===================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const MAIN = $("#main");
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const brl = (v) =>
  (Number(v) || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
const pad = (n) => String(n).padStart(2, "0");
const isoToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const monthOf = (iso) => String(iso).slice(0, 7);
const fmtDate = (d) =>
  d ? String(d).slice(0, 10).split("-").reverse().join("/") : "—";
const fmtDateTime = (d) =>
  new Date(d).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const sum = (arr) => arr.reduce((t, x) => t + Number(x || 0), 0);
const cname = (id) => (DB.clients.find((c) => c.id === id) || {}).name || "—";
const hit = (q, fields) => {
  const t = (q || "").trim().toLowerCase();
  return (
    !t ||
    fields.some((f) =>
      String(f ?? "")
        .toLowerCase()
        .includes(t),
    )
  );
};

/* Campo de busca compartilhado — mesmo visual em todas as telas do painel (/boss) */
const searchInput = (name, placeholder, ariaLabel) =>
  `<input class="search-input" type="search" data-input="${esc(name)}" placeholder="${esc(placeholder)}" aria-label="${esc(ariaLabel)}">`;

const safeName = (n) =>
  n
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 120);
const numCSV = (v) =>
  Number(v || 0)
    .toFixed(2)
    .replace(".", ",");

function parseMoney(v) {
  if (v === null || v === undefined) return null;
  let s = String(v).trim().replace(/R\$/gi, "").replace(/\s/g, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function friendly(e) {
  const code = e && e.code;
  if (code === "23505")
    return "Já existe um registro com estes dados (por exemplo, um cliente com o mesmo e-mail).";
  if (code === "23503")
    return 'Este registro está vinculado a outros e não pode ser removido. Use "Arquivar" quando disponível.';
  if (code === "23514")
    return "Algum valor não respeita as regras (datas, valores ou campos obrigatórios).";
  if (code === "42501")
    return "Você não tem permissão para esta ação. Confirme se entrou com a conta administradora.";
  if (e && e.message) return e.message;
  return "Não foi possível concluir a ação. Tente novamente.";
}

function toast(msg, ok = true) {
  const t = document.createElement("div");
  t.className = "toast " + (ok ? "ok" : "bad");
  t.setAttribute("role", "status");
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), 3800);
}

async function q(builder) {
  const { data, error } = await builder;
  if (error) throw error;
  return data;
}

async function run(fn, okMsg) {
  try {
    await fn();
    if (okMsg) toast(okMsg);
    await route();
  } catch (e) {
    toast(friendly(e), false);
  }
}

async function removeRecord(table, id, msg) {
  if (!confirm(msg)) return;
  await run(async () => {
    const { error } = await sb.from(table).delete().eq("id", id);
    if (error) throw error;
  }, "Registro excluído.");
}

async function toggleArchive(table, id) {
  const row = CACHE[table]().find((x) => x.id === id);
  await run(
    () => saveEntity(table, { archived: !row.archived }, id),
    row.archived ? "Restaurado." : "Arquivado.",
  );
}

async function saveEntity(table, payload, id) {
  const req = id
    ? sb.from(table).update(payload).eq("id", id).select("id").single()
    : sb.from(table).insert(payload).select("id").single();
  const { data, error } = await req;
  if (error) throw error;
  return data;
}

/* Troca a posição de um item com o vizinho (dir = -1 sobe, 1 desce) e renumera a sequência. */
async function swapOrder(table, field, id, dir, filter) {
  let qb = sb
    .from(table)
    .select(`id,${field}`)
    .order(field, { ascending: true });
  if (filter) qb = qb.eq(filter[0], filter[1]);
  const data = await q(qb);
  const i = data.findIndex((r) => r.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= data.length) return;
  const arr = [...data];
  const [moved] = arr.splice(i, 1);
  arr.splice(j, 0, moved);
  for (let k = 0; k < arr.length; k++) {
    if (arr[k][field] !== k + 1) {
      const { error } = await sb
        .from(table)
        .update({ [field]: k + 1 })
        .eq("id", arr[k].id);
      if (error) throw error;
    }
  }
}

/* ===================== Carregamento de dados ===================== */
async function loadRefs() {
  const [clients, projects, contracts] = await Promise.all([
    q(sb.from("clients").select("*").order("name")),
    q(
      sb.from("projects").select("*").order("created_at", { ascending: false }),
    ),
    q(
      sb
        .from("contracts")
        .select("*")
        .order("created_at", { ascending: false }),
    ),
  ]);
  DB.clients = clients;
  DB.projects = projects;
  DB.contracts = contracts;
}

async function loadFinance() {
  const [rec, pay, exp] = await Promise.all([
    q(
      sb.from("receivables").select("*").order("due_date", { ascending: true }),
    ),
    q(sb.from("payments").select("*").order("paid_on", { ascending: false })),
    q(sb.from("expenses").select("*").order("spent_on", { ascending: false })),
  ]);
  const paid = {};
  for (const p of pay)
    paid[p.receivable_id] = (paid[p.receivable_id] || 0) + Number(p.amount);
  const today = isoToday();
  for (const r of rec) {
    r.paid = paid[r.id] || 0;
    r.remaining = Math.max(0, Number(r.amount) - r.paid);
    r.status =
      r.remaining < 0.005
        ? "Recebido"
        : r.due_date < today
          ? "Vencido"
          : r.paid > 0
            ? "Parcial"
            : "A receber";
  }
  FIN = { receivables: rec, payments: pay, expenses: exp };
}

/* Meses (AAAA-MM) desde o início da manutenção até o mês atual, com o dia de vencimento. */
function competencesUntil(startISO) {
  const [Y, M, D] = String(startISO).slice(0, 10).split("-").map(Number);
  const now = new Date();
  const last = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  const out = [];
  let y = Y,
    m = M;
  while (true) {
    const key = `${y}-${pad(m)}`;
    if (key > last) break;
    const days = new Date(y, m, 0).getDate();
    out.push({ key, due: `${key}-${pad(Math.min(D, days))}` });
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/* Gera as mensalidades que faltam. O banco impede duplicidade (contrato + competência). */
async function ensureMaintenance() {
  const contracts = await q(
    sb
      .from("contracts")
      .select("id,client_id,project_id,maintenance_value,maintenance_start")
      .eq("status", "Ativo")
      .gt("maintenance_value", 0)
      .not("maintenance_start", "is", null),
  );
  const rows = [];
  for (const c of contracts) {
    for (const m of competencesUntil(c.maintenance_start)) {
      rows.push({
        client_id: c.client_id,
        contract_id: c.id,
        project_id: c.project_id,
        description: `Mensalidade de manutenção · ${m.key.split("-").reverse().join("/")}`,
        amount: c.maintenance_value,
        due_date: m.due,
        competence: m.key,
        kind: "Mensalidade",
      });
    }
  }
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb
      .from("receivables")
      .upsert(rows.slice(i, i + 500), {
        onConflict: "contract_id,competence",
        ignoreDuplicates: true,
      });
    if (error) throw error;
  }
}

function contractFin(c) {
  const recs = FIN.receivables.filter((r) => r.contract_id === c.id);
  const received = recs
    .filter((r) => r.kind === "Pontual")
    .reduce((t, r) => t + r.paid, 0);
  return {
    received,
    balance: Math.max(0, Number(c.total_value) - received),
    charges: recs,
  };
}

/* ===================== Componentes de interface ===================== */
function badge(s) {
  const cls =
    /Recebido|Ativo|Concluído|Entregue|Publicado|Convertida|Movido/.test(s)
      ? "ok"
      : /Vencido|Cancelado|Arquivada/.test(s)
        ? "bad"
        : /Parcial|A receber|Aguardando|Nova|Em /.test(s)
          ? "warn"
          : "";
  return `<span class="badge ${cls}">${esc(s)}</span>`;
}

function kpi(label, value, neg = false) {
  return `<div class="card kpi ${neg ? "neg" : ""}"><div class="label">${esc(label)}</div><div class="value">${value}</div></div>`;
}

function section(title, body) {
  return `<div class="section"><div class="section-head"><h2>${esc(title)}</h2></div>${body}</div>`;
}

function shell(main, title, actions, body) {
  main.innerHTML = `<div class="page-head"><h1>${esc(title)}</h1><div class="page-actions">${actions || ""}</div></div>${body}`;
}

function notFound(main, what) {
  main.innerHTML = `<div class="notice bad">${esc(what)} não encontrado. Ele pode ter sido removido.</div>`;
}

function table(cols, rows, actionsFn) {
  if (!rows.length)
    return '<div class="empty">Nenhum registro encontrado.</div>';
  return `<div class="table-wrap"><table>
    <thead><tr>${cols.map((c) => `<th>${c.l}</th>`).join("")}<th class="actions-col"></th></tr></thead>
    <tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td>${c.f(r)}</td>`).join("")}<td class="actions-col">${actionsFn ? actionsFn(r) : ""}</td></tr>`).join("")}</tbody>
  </table></div>`;
}

function waLink(num) {
  const d = String(num || "").replace(/\D/g, "");
  if (d.length < 10) return esc(num || "—");
  const full = d.startsWith("55") ? d : "55" + d;
  return `<a href="https://wa.me/${full}" target="_blank" rel="noopener noreferrer">${esc(num)}</a>`;
}

function barChart(labels, a, b) {
  const W = 640,
    H = 230,
    P = 30;
  const max = Math.max(1, ...a, ...b);
  const gap = (W - P * 2) / labels.length;
  const bw = Math.min(18, gap / 3);
  const bars = labels
    .map((l, i) => {
      const x = P + i * gap + gap / 2 - bw;
      const ha = (a[i] / max) * (H - 60);
      const hb = (b[i] / max) * (H - 60);
      return `<rect class="bar-in" x="${x}" y="${H - 30 - ha}" width="${bw}" height="${ha}" rx="4"/>
      <rect class="bar-out" x="${x + bw + 4}" y="${H - 30 - hb}" width="${bw}" height="${hb}" rx="4"/>
      <text x="${x + bw + 2}" y="${H - 10}" text-anchor="middle">${esc(l.slice(5))}/${esc(l.slice(2, 4))}</text>`;
    })
    .join("");
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Receitas e despesas dos últimos seis meses">${bars}</svg>
    <div class="legend"><span><span class="sw in"></span>Recebido</span><span><span class="sw out"></span>Despesas</span></div>`;
}

/* ===================== Modal e formulários ===================== */
function openModal(title, html, onMount) {
  const wrap = document.createElement("div");
  wrap.className = "modal-bg";
  wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <div class="modal-h"><h2 id="modal-title">${esc(title)}</h2><button class="icon" type="button" data-close aria-label="Fechar">✕</button></div>
    <div class="modal-b">${html}</div></div>`;
  document.body.append(wrap);
  const onKey = (e) => {
    if (e.key === "Escape") close();
  };
  const close = () => {
    wrap.remove();
    document.removeEventListener("keydown", onKey);
  };
  document.addEventListener("keydown", onKey);
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap || e.target.closest("[data-close]")) close();
  });
  if (onMount) onMount(wrap, close);
  const first = wrap.querySelector("input,select,textarea,button");
  if (first) first.focus();
  return close;
}

function fieldInput(f, values) {
  const id = "f-" + f.k;
  let v = values[f.k];
  if (v === undefined || v === null) v = f.def ?? "";
  const req = f.req ? " <em>*</em>" : "";
  if (f.t === "bool") {
    return `<div class="field check ${f.full ? "full" : ""}"><input type="checkbox" id="${id}" name="${f.k}" ${v ? "checked" : ""}><label for="${id}">${esc(f.l)}</label></div>`;
  }
  const label = `<label for="${id}">${esc(f.l)}${req}</label>`;
  if (f.t === "file") {
    const current = values[f.k + "_name"]
      ? `<small class="hint">Atual: ${esc(values[f.k + "_name"])}</small>`
      : "";
    return `<div class="field ${f.full ? "full" : ""}">${label}<input type="file" id="${id}" name="${f.k}" accept="${esc(f.accept || "")}">${current}</div>`;
  }
  let control;
  if (f.t === "textarea") {
    control = `<textarea id="${id}" name="${f.k}" rows="3">${esc(v)}</textarea>`;
  } else if (f.t === "select" || f.t === "ref") {
    const opts =
      f.t === "ref"
        ? DB[f.ref].map((r) => [r.id, r.name || r.title || "—"])
        : (f.opts || []).map((o) => (Array.isArray(o) ? o : [o, o]));
    const head =
      f.t === "ref" || f.empty
        ? `<option value="">${esc(f.empty || "Selecione")}</option>`
        : "";
    control = `<select id="${id}" name="${f.k}">${head}${opts
      .map(
        ([val, lab]) =>
          `<option value="${esc(val)}" ${String(v) === String(val) ? "selected" : ""}>${esc(lab)}</option>`,
      )
      .join("")}</select>`;
  } else if (f.t === "money") {
    const shown = typeof v === "number" ? v.toFixed(2).replace(".", ",") : v;
    control = `<input id="${id}" name="${f.k}" inputmode="decimal" placeholder="0,00" value="${esc(shown)}">`;
  } else {
    const type =
      {
        date: "date",
        email: "email",
        tel: "tel",
        number: "number",
        url: "url",
      }[f.t] || "text";
    const shown = f.t === "date" ? String(v || "").slice(0, 10) : v;
    const extra =
      f.t === "number" ? ` min="${f.min}" max="${f.max}" step="1"` : "";
    control = `<input id="${id}" type="${type}" name="${f.k}" value="${esc(shown)}"${extra}>`;
  }
  return `<div class="field ${f.full ? "full" : ""}">${label}${control}${f.hint ? `<small class="hint">${esc(f.hint)}</small>` : ""}</div>`;
}

function readFields(form, fields) {
  const out = {},
    errs = [];
  for (const f of fields) {
    const el = form.elements[f.k];
    if (f.t === "file") {
      out[f.k] = (el.files && el.files[0]) || null;
      continue;
    }
    if (f.t === "bool") {
      out[f.k] = el.checked;
      continue;
    }
    const v = (el.value || "").trim();
    if (f.req && !v) {
      errs.push(`Preencha: ${f.l}.`);
      continue;
    }
    if (!v) {
      out[f.k] = null;
      continue;
    }
    if (f.t === "email" && !EMAIL_RE.test(v)) {
      errs.push(`${f.l}: e-mail inválido.`);
      continue;
    }
    if (f.t === "url" && !/^https:\/\//.test(v)) {
      errs.push(`${f.l}: use um endereço que comece com https://`);
      continue;
    }
    if (f.t === "money") {
      const n = parseMoney(v);
      if (!Number.isFinite(n) || n < 0) {
        errs.push(`${f.l}: valor inválido.`);
        continue;
      }
      out[f.k] = n;
      continue;
    }
    if (f.t === "number") {
      const n = Number(v);
      if (!Number.isInteger(n) || n < f.min || n > f.max) {
        errs.push(`${f.l}: use um número inteiro entre ${f.min} e ${f.max}.`);
        continue;
      }
      out[f.k] = n;
      continue;
    }
    if (f.t === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      errs.push(`${f.l}: data inválida.`);
      continue;
    }
    out[f.k] = v;
  }
  return { out, errs };
}

function formModal(title, fields, values, onSave) {
  const html = `<form class="form" novalidate>${fields.map((f) => fieldInput(f, values || {})).join("")}
    <div class="form-msg" role="alert"></div>
    <div class="form-actions"><button type="button" class="ghost" data-close>Cancelar</button><button type="submit" class="btn-primary">Salvar</button></div></form>`;
  openModal(title, html, (wrap, close) => {
    const form = $("form", wrap),
      msg = $(".form-msg", wrap),
      submit = $("button[type=submit]", wrap);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const { out, errs } = readFields(form, fields);
      if (errs.length) {
        msg.textContent = errs.join(" ");
        return;
      }
      submit.disabled = true;
      submit.textContent = "Salvando…";
      try {
        await onSave(out, close);
      } catch (err) {
        msg.textContent = friendly(err);
        submit.disabled = false;
        submit.textContent = "Salvar";
      }
    });
  });
}

/* ===================== Autenticação ===================== */
const SCREENS = {
  login: $("#screen-login"),
  forgot: $("#screen-forgot"),
  reset: $("#screen-reset"),
  app: $("#screen-app"),
};
function showScreen(name) {
  Object.entries(SCREENS).forEach(([k, el]) => {
    el.hidden = k !== name;
  });
}
function authMsg(id, text, ok = false) {
  const el = $("#" + id);
  el.textContent = text;
  el.className = "notice " + (ok ? "ok" : "bad");
  el.hidden = !text;
}

async function enterApp() {
  const {
    data: { session },
  } = await sb.auth.getSession();
  if (!session) {
    showScreen("login");
    return;
  }
  const { data: isAdmin, error } = await sb.rpc("is_admin");
  if (error || !isAdmin) {
    await sb.auth.signOut();
    showScreen("login");
    authMsg("login-msg", "Esta conta não tem acesso ao painel.");
    return;
  }
  $("#user-email").textContent = session.user.email;
  showScreen("app");
  await route();
}

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("#login-email").value.trim(),
    pass = $("#login-pass").value;
  if (!EMAIL_RE.test(email) || !pass) {
    authMsg("login-msg", "Informe e-mail e senha.");
    return;
  }
  const btn = $("button", e.target);
  btn.disabled = true;
  const { error } = await sb.auth.signInWithPassword({ email, password: pass });
  btn.disabled = false;
  if (error) {
    authMsg("login-msg", "E-mail ou senha inválidos.");
    return;
  }
  $("#login-pass").value = "";
  await enterApp();
});

$("#show-forgot").addEventListener("click", (e) => {
  e.preventDefault();
  showScreen("forgot");
});
$("#back-login").addEventListener("click", (e) => {
  e.preventDefault();
  showScreen("login");
});

$("#forgot-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("#forgot-email").value.trim();
  if (!EMAIL_RE.test(email)) {
    authMsg("forgot-msg", "Informe um e-mail válido.");
    return;
  }
  await sb.auth.resetPasswordForEmail(email, {
    redirectTo: location.origin + "/boss/",
  });
  authMsg(
    "forgot-msg",
    "Se o e-mail estiver cadastrado, você receberá um link para criar uma nova senha.",
    true,
  );
});

$("#reset-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const p1 = $("#reset-pass").value,
    p2 = $("#reset-pass2").value;
  if (p1.length < 10) {
    authMsg("reset-msg", "Use pelo menos 10 caracteres.");
    return;
  }
  if (p1 !== p2) {
    authMsg("reset-msg", "As senhas não coincidem.");
    return;
  }
  const { error } = await sb.auth.updateUser({ password: p1 });
  if (error) {
    authMsg("reset-msg", friendly(error));
    return;
  }
  await sb.auth.signOut();
  history.replaceState(null, "", "/boss/");
  showScreen("login");
  authMsg("login-msg", "Senha atualizada. Entre com a nova senha.", true);
});

$("#logout").addEventListener("click", async () => {
  closeMobileSidebar();
  await sb.auth.signOut();
  showScreen("login");
});

/* ===================== Navegação Móvel (Gaveta/Drawer) ===================== */
const SIDEBAR = $("#sidebar");
const SIDEBAR_BACKDROP = $("#sidebar-backdrop");
const MENU_TOGGLE = $("#menu-toggle");
const SIDEBAR_CLOSE = $("#sidebar-close");
const MOBILE_PAGE_TITLE = $("#mobile-page-title");

const PAGE_TITLES = {
  "visao-geral": "Visão geral",
  projetos: "Projetos",
  projeto: "Projeto",
  fila: "Fila de espera",
  clientes: "Clientes",
  cliente: "Cliente",
  contratos: "Contratos",
  contrato: "Contrato",
  financeiro: "Financeiro",
  mensagens: "Mensagens",
  portfolio: "Portfólio",
  configuracoes: "Configurações",
};

function openMobileSidebar() {
  if (!SIDEBAR) return;
  SIDEBAR.classList.add("open");
  SIDEBAR_BACKDROP?.classList.add("open");
  MENU_TOGGLE?.setAttribute("aria-expanded", "true");
  document.body.style.overflow = "hidden";
}

function closeMobileSidebar() {
  if (!SIDEBAR) return;
  SIDEBAR.classList.remove("open");
  SIDEBAR_BACKDROP?.classList.remove("open");
  MENU_TOGGLE?.setAttribute("aria-expanded", "false");
  document.body.style.overflow = "";
}

MENU_TOGGLE?.addEventListener("click", () => {
  if (SIDEBAR?.classList.contains("open")) {
    closeMobileSidebar();
  } else {
    openMobileSidebar();
  }
});

SIDEBAR_CLOSE?.addEventListener("click", closeMobileSidebar);
SIDEBAR_BACKDROP?.addEventListener("click", closeMobileSidebar);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && SIDEBAR?.classList.contains("open")) {
    closeMobileSidebar();
  }
});

SIDEBAR?.addEventListener("click", (e) => {
  if (e.target.closest("a")) {
    closeMobileSidebar();
  }
});

/* ===================== Rotas ===================== */
const VIEWS = {
  "visao-geral": viewOverview,
  projetos: viewProjects,
  projeto: viewProject,
  fila: viewWaitlist,
  clientes: viewClients,
  cliente: viewClient,
  contratos: viewContracts,
  contrato: viewContract,
  financeiro: viewFinance,
  mensagens: viewMessages,
  portfolio: viewPortfolio,
  configuracoes: viewSettings,
};
let ROUTE_TOKEN = 0;

async function route() {
  if ($("#screen-app").hidden) return;
  closeMobileSidebar();
  const parts = location.hash
    .replace(/^#\/?/, "")
    .split("/")
    .map(decodeURIComponent);
  const page = VIEWS[parts[0]] ? parts[0] : "visao-geral";
  const id = parts[1] || "";
  if (MOBILE_PAGE_TITLE) {
    MOBILE_PAGE_TITLE.textContent =
      PAGE_TITLES[parts[0]] || PAGE_TITLES[page] || "Painel";
  }
  $$("[data-nav]").forEach((a) =>
    a.classList.toggle("on", a.dataset.nav === page),
  );
  CHG = {};
  INP = {};
  SUB = {};
  MAIN.innerHTML = '<div class="loading">Carregando…</div>';
  const token = ++ROUTE_TOKEN;
  try {
    await loadRefs();
    if (
      page === "visao-geral" ||
      (page === "financeiro" && id === "mensalidades")
    )
      await ensureMaintenance();
    await loadFinance();
    if (token !== ROUTE_TOKEN) return;
    await VIEWS[page](MAIN, id, parts[2] || "");
  } catch (e) {
    if (token === ROUTE_TOKEN)
      MAIN.innerHTML = `<div class="notice bad">${esc(friendly(e))}</div>`;
  }
}

/* Delegação de eventos (uma única vez, no painel inteiro) */
MAIN.addEventListener("click", (e) => {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const fn = GACT[b.dataset.act];
  if (fn) {
    e.preventDefault();
    fn(b.dataset.id, b);
  }
});
MAIN.addEventListener("change", (e) => {
  const el = e.target.closest("[data-change]");
  if (el && CHG[el.dataset.change]) CHG[el.dataset.change](el.value, el);
});
MAIN.addEventListener("input", (e) => {
  const el = e.target.closest("[data-input]");
  if (el && INP[el.dataset.input]) INP[el.dataset.input](el.value, el);
});
MAIN.addEventListener("submit", (e) => {
  const f = e.target;
  if (f.dataset && f.dataset.submit && SUB[f.dataset.submit]) {
    e.preventDefault();
    SUB[f.dataset.submit](f);
  }
});
window.addEventListener("hashchange", route);

/* ===================== Visão geral ===================== */
async function viewOverview(main) {
  const today = isoToday(),
    ym = monthOf(today),
    yr = today.slice(0, 4);
  const payMonth = sum(
    FIN.payments.filter((p) => p.paid_on.startsWith(ym)).map((p) => p.amount),
  );
  const payYear = sum(
    FIN.payments.filter((p) => p.paid_on.startsWith(yr)).map((p) => p.amount),
  );
  const expMonth = sum(
    FIN.expenses.filter((e) => e.spent_on.startsWith(ym)).map((e) => e.amount),
  );
  const expYear = sum(
    FIN.expenses.filter((e) => e.spent_on.startsWith(yr)).map((e) => e.amount),
  );
  const pending = sum(FIN.receivables.map((r) => r.remaining));
  const late = FIN.receivables.filter(
    (r) => r.remaining > 0.005 && r.due_date < today,
  );
  const mrr = sum(
    DB.contracts
      .filter((c) => c.status === "Ativo")
      .map((c) => c.maintenance_value),
  );
  const inProgress = DB.projects.filter(
    (p) => p.status === "Em andamento" && !p.archived,
  ).length;
  const activeClients = DB.clients.filter((c) => !c.archived).length;
  const queue = (
    await q(sb.from("waitlist").select("id").eq("state", "Na fila"))
  ).length;
  const newMsgs = (
    await q(sb.from("messages").select("id").eq("status", "Nova"))
  ).length;
  const acts = await q(
    sb
      .from("activity_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(8),
  );

  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
  }
  const recvBy = months.map((m) =>
    sum(
      FIN.payments.filter((p) => p.paid_on.startsWith(m)).map((p) => p.amount),
    ),
  );
  const expBy = months.map((m) =>
    sum(
      FIN.expenses.filter((e) => e.spent_on.startsWith(m)).map((e) => e.amount),
    ),
  );
  const dues = FIN.receivables.filter((r) => r.remaining > 0.005).slice(0, 6);

  shell(
    main,
    "Visão geral",
    "",
    `
    <div class="card-grid">
      ${kpi("Projetos em andamento", inProgress)}
      ${kpi("Itens na fila de espera", queue)}
      ${kpi("Clientes ativos", activeClients)}
      ${kpi("Solicitações novas", newMsgs)}
      ${kpi("Recebido no mês", brl(payMonth))}
      ${kpi("Recebido no ano", brl(payYear))}
      ${kpi("Valores pendentes", brl(pending))}
      ${kpi("Mensalidades em atraso", late.length)}
      ${kpi("Despesas do mês", brl(expMonth))}
      ${kpi("Saldo do mês", brl(payMonth - expMonth), payMonth - expMonth < 0)}
      ${kpi("Saldo do ano", brl(payYear - expYear), payYear - expYear < 0)}
      ${kpi("Receita mensal recorrente", brl(mrr))}
    </div>
    <div class="two-col">
      <div class="card"><h2>Receitas e despesas · últimos 6 meses</h2>${barChart(months, recvBy, expBy)}</div>
      <div class="card"><h2>Próximos vencimentos</h2>
        ${
          dues.length
            ? `<ul class="feed">${dues
                .map(
                  (r) => `<li><strong>${esc(cname(r.client_id))}</strong>
          <span class="muted small">${esc(r.description)} · vence ${fmtDate(r.due_date)} · saldo ${brl(r.remaining)}</span></li>`,
                )
                .join("")}</ul>`
            : '<p class="muted">Nenhum valor em aberto.</p>'
        }
      </div>
    </div>
    <div class="section card"><h2>Atividade recente</h2>
      ${
        acts.length
          ? `<ul class="feed">${acts.map((a) => `<li><span>${esc(ACTION_LABEL[a.action] || a.action)} · ${esc(TABLE_LABEL[a.table_name] || a.table_name)}${a.label ? " · " + esc(a.label) : ""}</span><time>${fmtDateTime(a.created_at)}</time></li>`).join("")}</ul>`
          : '<p class="muted">Nenhuma atividade registrada ainda.</p>'
      }
    </div>`,
  );
}

/* ===================== Projetos ===================== */
const PROJECT_FIELDS = [
  { k: "name", l: "Nome do projeto", req: 1, full: 1 },
  { k: "client_id", l: "Cliente", t: "ref", ref: "clients", req: 1 },
  {
    k: "service",
    l: "Tipo de serviço",
    t: "select",
    opts: SERVICES,
    empty: "—",
  },
  { k: "agreed_value", l: "Valor acordado (R$)", t: "money" },
  { k: "start_date", l: "Data de entrada", t: "date" },
  { k: "due_date", l: "Prazo previsto", t: "date" },
  {
    k: "status",
    l: "Status",
    t: "select",
    opts: PROJ_STATUS,
    def: "Aguardando início",
    req: 1,
  },
  { k: "progress", l: "Progresso (%)", t: "number", min: 0, max: 100, def: 0 },
  { k: "description", l: "Descrição", t: "textarea", full: 1 },
  { k: "notes", l: "Observações", t: "textarea", full: 1 },
];

function projectForm(p) {
  formModal(
    p ? "Editar projeto" : "Novo projeto",
    PROJECT_FIELDS,
    p,
    async (out, close) => {
      if (out.start_date && out.due_date && out.due_date < out.start_date) {
        throw new Error("O prazo não pode ser anterior à data de entrada.");
      }
      const payload = {
        ...out,
        agreed_value: out.agreed_value ?? 0,
        progress: out.progress ?? 0,
      };
      await saveEntity("projects", payload, p && p.id);
      close();
      toast("Projeto salvo.");
      await route();
    },
  );
}

async function viewProjects(main) {
  const st = { q: "", status: "", archived: false };
  shell(
    main,
    "Projetos",
    '<button class="btn-primary" data-act="proj-new">+ Novo projeto</button>',
    `
    <div class="toolbar">
      ${searchInput("proj-q", "Pesquisar por nome, cliente ou serviço", "Pesquisar projetos")}
      <select data-change="proj-status" aria-label="Filtrar por situação"><option value="">Todos os status</option>${PROJ_STATUS.map((s) => `<option>${esc(s)}</option>`).join("")}</select>
      <label class="check"><input type="checkbox" data-change="proj-showarch"> Mostrar arquivados</label>
    </div>
    <div id="list"></div>`,
  );
  const draw = () => {
    const rows = DB.projects.filter(
      (p) =>
        p.archived === st.archived &&
        (!st.status || p.status === st.status) &&
        hit(st.q, [p.name, cname(p.client_id), p.service, p.status]),
    );
    $("#list", main).innerHTML = table(
      [
        {
          l: "Projeto",
          f: (r) => `<a href="#/projeto/${r.id}">${esc(r.name)}</a>`,
        },
        { l: "Cliente", f: (r) => esc(cname(r.client_id)) },
        { l: "Status", f: (r) => badge(r.status) },
        { l: "Prazo", f: (r) => fmtDate(r.due_date) },
        {
          l: "Valor",
          f: (r) => `<span class="money">${brl(r.agreed_value)}</span>`,
        },
      ],
      rows,
      (
        r,
      ) => `<button class="ghost sm" data-act="proj-edit" data-id="${r.id}">Editar</button>
      <button class="ghost sm" data-act="proj-arch" data-id="${r.id}">${r.archived ? "Restaurar" : "Arquivar"}</button>
      <button class="danger sm" data-act="proj-del" data-id="${r.id}">Excluir</button>`,
    );
  };
  INP["proj-q"] = (v) => {
    st.q = v;
    draw();
  };
  CHG["proj-status"] = (v) => {
    st.status = v;
    draw();
  };
  CHG["proj-showarch"] = (v, el) => {
    st.archived = el.checked;
    draw();
  };
  draw();
}

async function viewProject(main, id) {
  const p = DB.projects.find((x) => x.id === id);
  if (!p) return notFound(main, "Projeto");
  const [stages, hist] = await Promise.all([
    q(
      sb
        .from("project_stages")
        .select("*")
        .eq("project_id", id)
        .order("position"),
    ),
    q(
      sb
        .from("activity_log")
        .select("*")
        .eq("table_name", "projects")
        .eq("record_id", id)
        .order("created_at", { ascending: false })
        .limit(20),
    ),
  ]);
  const done = stages.filter((s) => s.done).length;
  const recs = FIN.receivables.filter((r) => r.project_id === id);

  CHG["stage-toggle"] = async (_v, el) => {
    await run(async () => {
      const { error } = await sb
        .from("project_stages")
        .update({ done: el.checked })
        .eq("id", el.dataset.id);
      if (error) throw error;
    });
  };
  SUB["stage-add"] = async (form) => {
    const title = form.elements.title.value.trim();
    if (!title) {
      toast("Informe o nome da etapa.", false);
      return;
    }
    await run(async () => {
      const { error } = await sb
        .from("project_stages")
        .insert({ project_id: id, title, position: stages.length + 1 });
      if (error) throw error;
    }, "Etapa adicionada.");
  };

  shell(
    main,
    p.name,
    `
      <button class="ghost" data-act="proj-edit" data-id="${id}">Editar</button>
      <a class="ghost btn sm" href="#/projetos">Voltar</a>`,
    `
    <div class="two-col">
      <div class="card">
        <h2>Dados do projeto</h2>
        <dl class="dl">
          <dt>Cliente</dt><dd>${esc(cname(p.client_id))}</dd>
          <dt>Serviço</dt><dd>${esc(p.service || "—")}</dd>
          <dt>Situação</dt><dd>${badge(p.status)}</dd>
          <dt>Entrada</dt><dd>${fmtDate(p.start_date)}</dd>
          <dt>Prazo previsto</dt><dd>${fmtDate(p.due_date)}</dd>
          <dt>Valor acordado</dt><dd class="money">${brl(p.agreed_value)}</dd>
        </dl>
        ${p.description ? `<h3 style="margin-top:16px">Descrição</h3><div class="detail-text">${esc(p.description)}</div>` : ""}
        ${p.notes ? `<h3>Observações</h3><div class="detail-text">${esc(p.notes)}</div>` : ""}
      </div>
      <div class="card">
        <h2>Progresso</h2>
        <div class="progress" role="progressbar" aria-valuenow="${p.progress}" aria-valuemin="0" aria-valuemax="100"><span style="width:${p.progress}%"></span></div>
        <p class="muted small" style="margin-top:8px">${p.progress}% · ${done} de ${stages.length} etapas concluídas</p>
        <h2 style="margin-top:18px">Etapas</h2>
        ${
          stages.length
            ? stages
                .map(
                  (s) => `<div class="stage ${s.done ? "done" : ""}">
            <label class="check"><input type="checkbox" data-change="stage-toggle" data-id="${s.id}" ${s.done ? "checked" : ""}> <span>${esc(s.title)}</span></label>
            <button class="danger sm" data-act="stage-del" data-id="${s.id}">Remover</button></div>`,
                )
                .join("")
            : '<p class="muted">Nenhuma etapa cadastrada.</p>'
        }
        <form class="stage-add" data-submit="stage-add" novalidate>
          <input name="title" maxlength="160" placeholder="Nova etapa" aria-label="Nome da nova etapa">
          <button class="ghost" type="submit">Adicionar</button>
        </form>
      </div>
    </div>
    ${section(
      "Cobranças deste projeto",
      recs.length
        ? table(
            [
              { l: "Vencimento", f: (r) => fmtDate(r.due_date) },
              { l: "Descrição", f: (r) => esc(r.description) },
              {
                l: "Valor",
                f: (r) => `<span class="money">${brl(r.amount)}</span>`,
              },
              {
                l: "Saldo",
                f: (r) => `<span class="money">${brl(r.remaining)}</span>`,
              },
              { l: "Situação", f: (r) => badge(r.status) },
            ],
            recs,
          )
        : '<div class="empty">Nenhuma cobrança vinculada a este projeto.</div>',
    )}
    ${section("Histórico de alterações", hist.length ? `<ul class="feed">${hist.map((a) => `<li><span>${esc(ACTION_LABEL[a.action] || a.action)}${a.label ? " · " + esc(a.label) : ""}</span><time>${fmtDateTime(a.created_at)}</time></li>`).join("")}</ul>` : '<p class="muted">Sem alterações registradas.</p>')}`,
  );
}

/* ===================== Fila de espera ===================== */
const WAIT_FIELDS = [
  { k: "client_id", l: "Cliente", t: "ref", ref: "clients", req: 1, full: 1 },
  {
    k: "service",
    l: "Serviço desejado",
    t: "select",
    opts: SERVICES,
    empty: "—",
  },
  { k: "estimated_value", l: "Valor estimado (R$)", t: "money" },
  { k: "entry_date", l: "Data de entrada", t: "date", req: 1, def: isoToday() },
  { k: "expected_start", l: "Previsão de início", t: "date" },
  { k: "description", l: "Descrição", t: "textarea", full: 1 },
  { k: "notes", l: "Observações", t: "textarea", full: 1 },
];

function waitForm(item) {
  formModal(
    item ? "Editar item da fila" : "Novo item na fila",
    WAIT_FIELDS,
    item,
    async (out, close) => {
      const payload = { ...out };
      if (!item) {
        const { data, error } = await sb
          .from("waitlist")
          .select("priority")
          .order("priority", { ascending: false })
          .limit(1);
        if (error) throw error;
        payload.priority = ((data && data[0] && data[0].priority) || 0) + 1;
      }
      await saveEntity("waitlist", payload, item && item.id);
      close();
      toast("Item da fila salvo.");
      await route();
    },
  );
}

async function viewWaitlist(main) {
  const st = { q: "", state: "Na fila" };
  const items = await q(
    sb.from("waitlist").select("*").order("priority", { ascending: true }),
  );
  shell(
    main,
    "Fila de espera",
    '<button class="btn-primary" data-act="wl-new">+ Novo item</button>',
    `
    <p class="muted">Ordem de atendimento. Use as setas para reorganizar os itens que estão na fila.</p>
    <div class="toolbar">
      ${searchInput("wl-q", "Pesquisar por cliente ou serviço", "Pesquisar na fila")}
      <select data-change="wl-state" aria-label="Filtrar por estado">
        <option value="Na fila">Na fila</option><option value="">Todos</option><option value="Movido para projeto">Movidos para projeto</option>
      </select>
    </div><div id="list"></div>`,
  );
  const draw = () => {
    const rows = items.filter(
      (w) =>
        (!st.state || w.state === st.state) &&
        hit(st.q, [cname(w.client_id), w.service, w.description]),
    );
    const queueNumber = new Map(
      items.filter((w) => w.state === "Na fila").map((w, i) => [w.id, i + 1]),
    );
    $("#list", main).innerHTML = table(
      [
        {
          l: "Ordem",
          f: (r) =>
            r.state === "Na fila"
              ? `<strong>${queueNumber.get(r.id)}º</strong>`
              : "—",
        },
        { l: "Cliente", f: (r) => esc(cname(r.client_id)) },
        { l: "Serviço", f: (r) => esc(r.service || "—") },
        {
          l: "Valor estimado",
          f: (r) =>
            `<span class="money">${r.estimated_value != null ? brl(r.estimated_value) : "—"}</span>`,
        },
        { l: "Entrada", f: (r) => fmtDate(r.entry_date) },
        { l: "Previsão", f: (r) => fmtDate(r.expected_start) },
        { l: "Estado", f: (r) => badge(r.state) },
      ],
      rows,
      (r) =>
        r.state === "Na fila"
          ? `<button class="ghost sm" data-act="wl-up" data-id="${r.id}" aria-label="Subir na fila">↑</button>
         <button class="ghost sm" data-act="wl-down" data-id="${r.id}" aria-label="Descer na fila">↓</button>
         <button class="ghost sm" data-act="wl-edit" data-id="${r.id}">Editar</button>
         <button class="btn-primary sm" data-act="wl-move" data-id="${r.id}">Mover para projeto</button>
         <button class="danger sm" data-act="wl-del" data-id="${r.id}">Excluir</button>`
          : `<span class="muted small">Projeto criado</span>`,
    );
  };
  INP["wl-q"] = (v) => {
    st.q = v;
    draw();
  };
  CHG["wl-state"] = (v) => {
    st.state = v;
    draw();
  };
  draw();
}

/* ===================== Clientes ===================== */
const CLIENT_FIELDS = [
  { k: "name", l: "Responsável", req: 1 },
  { k: "company", l: "Empresa" },
  { k: "email", l: "E-mail", t: "email" },
  { k: "phone", l: "Telefone" },
  { k: "whatsapp", l: "WhatsApp" },
  { k: "instagram", l: "Instagram" },
  { k: "address", l: "Endereço (opcional)", full: 1 },
  { k: "notes", l: "Observações", t: "textarea", full: 1 },
];

function clientForm(c) {
  formModal(
    c ? "Editar cliente" : "Novo cliente",
    CLIENT_FIELDS,
    c,
    async (out, close) => {
      if (
        out.email &&
        DB.clients.some(
          (x) =>
            x.id !== (c && c.id) &&
            (x.email || "").toLowerCase() === out.email.toLowerCase(),
        )
      ) {
        throw new Error("Já existe um cliente com este e-mail.");
      }
      await saveEntity("clients", out, c && c.id);
      close();
      toast("Cliente salvo.");
      await route();
    },
  );
}

async function viewClients(main) {
  const st = { q: "", archived: false };
  shell(
    main,
    "Clientes",
    '<button class="btn-primary" data-act="cli-new">+ Novo cliente</button>',
    `
    <div class="toolbar">
      ${searchInput("cli-q", "Pesquisar por nome, empresa, e-mail ou telefone", "Pesquisar clientes")}
      <label class="check"><input type="checkbox" data-change="cli-showarch"> Mostrar arquivados</label>
    </div><div id="list"></div>`,
  );
  const draw = () => {
    const rows = DB.clients.filter(
      (c) =>
        c.archived === st.archived &&
        hit(st.q, [c.name, c.company, c.email, c.phone, c.whatsapp]),
    );
    $("#list", main).innerHTML = table(
      [
        {
          l: "Responsável",
          f: (r) => `<a href="#/cliente/${r.id}">${esc(r.name)}</a>`,
        },
        { l: "Empresa", f: (r) => esc(r.company || "—") },
        { l: "E-mail", f: (r) => esc(r.email || "—") },
        { l: "Telefone", f: (r) => esc(r.phone || r.whatsapp || "—") },
        { l: "Cadastro", f: (r) => fmtDate(r.created_at) },
      ],
      rows,
      (
        r,
      ) => `<button class="ghost sm" data-act="cli-edit" data-id="${r.id}">Editar</button>
      <button class="ghost sm" data-act="cli-arch" data-id="${r.id}">${r.archived ? "Restaurar" : "Arquivar"}</button>
      <button class="danger sm" data-act="cli-del" data-id="${r.id}">Excluir</button>`,
    );
  };
  INP["cli-q"] = (v) => {
    st.q = v;
    draw();
  };
  CHG["cli-showarch"] = (v, el) => {
    st.archived = el.checked;
    draw();
  };
  draw();
}

async function viewClient(main, id) {
  const c = DB.clients.find((x) => x.id === id);
  if (!c) return notFound(main, "Cliente");
  const [msgs, wl, hist] = await Promise.all([
    q(
      sb
        .from("messages")
        .select("id,type,status,created_at")
        .eq("converted_client_id", id)
        .order("created_at", { ascending: false }),
    ),
    q(sb.from("waitlist").select("*").eq("client_id", id).order("priority")),
    q(
      sb
        .from("activity_log")
        .select("*")
        .eq("table_name", "clients")
        .eq("record_id", id)
        .order("created_at", { ascending: false })
        .limit(20),
    ),
  ]);
  const projects = DB.projects.filter((p) => p.client_id === id);
  const contracts = DB.contracts.filter((x) => x.client_id === id);
  const charges = FIN.receivables.filter((r) => r.client_id === id);

  shell(
    main,
    c.name,
    `
      <button class="ghost" data-act="cli-edit" data-id="${id}">Editar</button>
      <a class="ghost btn sm" href="#/clientes">Voltar</a>`,
    `
    <div class="two-col">
      <div class="card">
        <h2>Dados</h2>
        <dl class="dl">
          <dt>Empresa</dt><dd>${esc(c.company || "—")}</dd>
          <dt>E-mail</dt><dd>${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : "—"}</dd>
          <dt>Telefone</dt><dd>${esc(c.phone || "—")}</dd>
          <dt>WhatsApp</dt><dd>${waLink(c.whatsapp)}</dd>
          <dt>Instagram</dt><dd>${esc(c.instagram || "—")}</dd>
          <dt>Endereço</dt><dd>${esc(c.address || "—")}</dd>
          <dt>Cadastro</dt><dd>${fmtDate(c.created_at)}</dd>
        </dl>
        ${c.notes ? `<h3 style="margin-top:16px">Observações</h3><div class="detail-text">${esc(c.notes)}</div>` : ""}
      </div>
      <div class="card">
        <h2>Resumo</h2>
        <dl class="dl">
          <dt>Projetos</dt><dd>${projects.length}</dd>
          <dt>Contratos</dt><dd>${contracts.length}</dd>
          <dt>Em aberto</dt><dd class="money">${brl(sum(charges.map((r) => r.remaining)))}</dd>
          <dt>Recebido</dt><dd class="money">${brl(sum(charges.map((r) => r.paid)))}</dd>
          <dt>Fila de espera</dt><dd>${wl.filter((w) => w.state === "Na fila").length}</dd>
        </dl>
      </div>
    </div>
    ${section(
      "Projetos",
      projects.length
        ? table(
            [
              {
                l: "Projeto",
                f: (r) => `<a href="#/projeto/${r.id}">${esc(r.name)}</a>`,
              },
              { l: "Status", f: (r) => badge(r.status) },
              { l: "Prazo", f: (r) => fmtDate(r.due_date) },
            ],
            projects,
          )
        : '<div class="empty">Nenhum projeto.</div>',
    )}
    ${section(
      "Contratos",
      contracts.length
        ? table(
            [
              {
                l: "Contrato",
                f: (r) => `<a href="#/contrato/${r.id}">${esc(r.title)}</a>`,
              },
              {
                l: "Valor total",
                f: (r) => `<span class="money">${brl(r.total_value)}</span>`,
              },
              { l: "Situação", f: (r) => badge(r.status) },
            ],
            contracts,
          )
        : '<div class="empty">Nenhum contrato.</div>',
    )}
    ${section(
      "Cobranças e pagamentos",
      charges.length
        ? table(
            [
              { l: "Vencimento", f: (r) => fmtDate(r.due_date) },
              { l: "Descrição", f: (r) => esc(r.description) },
              {
                l: "Valor",
                f: (r) => `<span class="money">${brl(r.amount)}</span>`,
              },
              {
                l: "Saldo",
                f: (r) => `<span class="money">${brl(r.remaining)}</span>`,
              },
              { l: "Situação", f: (r) => badge(r.status) },
            ],
            charges,
          )
        : '<div class="empty">Nenhuma cobrança.</div>',
    )}
    ${section(
      "Solicitações que originaram este cliente",
      msgs.length
        ? table(
            [
              { l: "Recebida em", f: (r) => fmtDateTime(r.created_at) },
              { l: "Serviço", f: (r) => esc(r.type) },
              { l: "Situação", f: (r) => badge(r.status) },
            ],
            msgs,
          )
        : '<div class="empty">Nenhuma solicitação vinculada.</div>',
    )}
    ${section(
      "Fila de espera",
      wl.length
        ? table(
            [
              { l: "Serviço", f: (r) => esc(r.service || "—") },
              { l: "Entrada", f: (r) => fmtDate(r.entry_date) },
              { l: "Estado", f: (r) => badge(r.state) },
            ],
            wl,
          )
        : '<div class="empty">Nenhum item na fila.</div>',
    )}
    ${section("Histórico de relacionamento", hist.length ? `<ul class="feed">${hist.map((a) => `<li><span>${esc(ACTION_LABEL[a.action] || a.action)}${a.label ? " · " + esc(a.label) : ""}</span><time>${fmtDateTime(a.created_at)}</time></li>`).join("")}</ul>` : '<p class="muted">Sem registros.</p>')}`,
  );
}

/* ===================== Contratos ===================== */
const CONTRACT_FIELDS = [
  { k: "title", l: "Título do contrato", req: 1, full: 1 },
  { k: "client_id", l: "Cliente", t: "ref", ref: "clients", req: 1 },
  { k: "project_id", l: "Projeto relacionado", t: "ref", ref: "projects" },
  {
    k: "service",
    l: "Tipo de serviço",
    t: "select",
    opts: SERVICES,
    empty: "—",
  },
  { k: "total_value", l: "Valor total (R$)", t: "money", req: 1 },
  { k: "start_date", l: "Data de início", t: "date", req: 1 },
  { k: "end_date", l: "Término (opcional)", t: "date" },
  {
    k: "billing_period",
    l: "Periodicidade de cobrança",
    t: "select",
    opts: BILLING,
    def: "Único",
  },
  { k: "maintenance_value", l: "Manutenção mensal (R$)", t: "money" },
  {
    k: "maintenance_start",
    l: "Início da manutenção",
    t: "date",
    hint: "A mensalidade só começa nesta data.",
  },
  {
    k: "status",
    l: "Situação",
    t: "select",
    opts: CONTRACT_STATUS,
    def: "Em elaboração",
    req: 1,
  },
  { k: "conditions", l: "Condições", t: "textarea", full: 1 },
  { k: "notes", l: "Observações", t: "textarea", full: 1 },
];

function contractForm(c) {
  formModal(
    c ? "Editar contrato" : "Novo contrato",
    CONTRACT_FIELDS,
    c,
    async (out, close) => {
      const payload = {
        ...out,
        total_value: out.total_value ?? 0,
        maintenance_value: out.maintenance_value ?? 0,
      };
      if (payload.end_date && payload.end_date < payload.start_date)
        throw new Error("O término não pode ser anterior ao início.");
      if (payload.maintenance_value > 0 && !payload.maintenance_start)
        throw new Error("Informe o início da manutenção mensal.");
      await saveEntity("contracts", payload, c && c.id);
      close();
      toast("Contrato salvo.");
      await route();
    },
  );
}

async function viewContracts(main) {
  const st = { q: "", status: "", archived: false };
  shell(
    main,
    "Contratos",
    '<button class="btn-primary" data-act="con-new">+ Novo contrato</button>',
    `
    <div class="toolbar">
      ${searchInput("con-q", "Pesquisar por título ou cliente", "Pesquisar contratos")}
      <select data-change="con-status" aria-label="Filtrar por situação"><option value="">Todas as situações</option>${CONTRACT_STATUS.map((s) => `<option>${esc(s)}</option>`).join("")}</select>
      <label class="check"><input type="checkbox" data-change="con-showarch"> Mostrar arquivados</label>
    </div><div id="list"></div>`,
  );
  const draw = () => {
    const rows = DB.contracts.filter(
      (c) =>
        c.archived === st.archived &&
        (!st.status || c.status === st.status) &&
        hit(st.q, [c.title, cname(c.client_id), c.service]),
    );
    $("#list", main).innerHTML = table(
      [
        {
          l: "Contrato",
          f: (r) => `<a href="#/contrato/${r.id}">${esc(r.title)}</a>`,
        },
        { l: "Cliente", f: (r) => esc(cname(r.client_id)) },
        {
          l: "Valor total",
          f: (r) => `<span class="money">${brl(r.total_value)}</span>`,
        },
        {
          l: "Recebido",
          f: (r) =>
            `<span class="money">${brl(contractFin(r).received)}</span>`,
        },
        {
          l: "Saldo",
          f: (r) => `<span class="money">${brl(contractFin(r).balance)}</span>`,
        },
        { l: "Situação", f: (r) => badge(r.status) },
      ],
      rows,
      (
        r,
      ) => `<button class="ghost sm" data-act="con-edit" data-id="${r.id}">Editar</button>
      <button class="ghost sm" data-act="con-arch" data-id="${r.id}">${r.archived ? "Restaurar" : "Arquivar"}</button>
      <button class="danger sm" data-act="con-del" data-id="${r.id}">Excluir</button>`,
    );
  };
  INP["con-q"] = (v) => {
    st.q = v;
    draw();
  };
  CHG["con-status"] = (v) => {
    st.status = v;
    draw();
  };
  CHG["con-showarch"] = (v, el) => {
    st.archived = el.checked;
    draw();
  };
  draw();
}

async function viewContract(main, id) {
  const c = DB.contracts.find((x) => x.id === id);
  if (!c) return notFound(main, "Contrato");
  const fin = contractFin(c);
  const [files, hist] = await Promise.all([
    q(
      sb
        .from("contract_files")
        .select("*")
        .eq("contract_id", id)
        .order("created_at", { ascending: false }),
    ),
    q(
      sb
        .from("activity_log")
        .select("*")
        .eq("table_name", "contracts")
        .eq("record_id", id)
        .order("created_at", { ascending: false })
        .limit(20),
    ),
  ]);

  CHG["con-upload"] = async (_v, el) => {
    const file = el.files && el.files[0];
    el.value = "";
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      toast("O arquivo passa de 20 MB.", false);
      return;
    }
    const path = `${id}/${Date.now()}-${safeName(file.name)}`;
    try {
      const { error: e1 } = await sb.storage
        .from("contract-files")
        .upload(path, file);
      if (e1) throw e1;
      const { error: e2 } = await sb
        .from("contract_files")
        .insert({
          contract_id: id,
          file_name: file.name,
          storage_path: path,
          size_bytes: file.size,
        });
      if (e2) {
        await sb.storage.from("contract-files").remove([path]);
        throw e2;
      }
      toast("Anexo enviado.");
      await route();
    } catch (err) {
      toast(friendly(err), false);
    }
  };

  shell(
    main,
    c.title,
    `
      <button class="ghost" data-act="con-edit" data-id="${id}">Editar</button>
      <a class="ghost btn sm" href="#/contratos">Voltar</a>`,
    `
    <div class="card-grid">
      ${kpi("Valor total", brl(c.total_value))}
      ${kpi("Recebido (pontual)", brl(fin.received))}
      ${kpi("Saldo pendente", brl(fin.balance), fin.balance > 0)}
      ${kpi("Manutenção mensal", brl(c.maintenance_value))}
    </div>
    <div class="two-col">
      <div class="card">
        <h2>Dados do contrato</h2>
        <dl class="dl">
          <dt>Cliente</dt><dd><a href="#/cliente/${c.client_id}">${esc(cname(c.client_id))}</a></dd>
          <dt>Projeto</dt><dd>${c.project_id ? `<a href="#/projeto/${c.project_id}">${esc((DB.projects.find((p) => p.id === c.project_id) || {}).name || "—")}</a>` : "—"}</dd>
          <dt>Serviço</dt><dd>${esc(c.service || "—")}</dd>
          <dt>Situação</dt><dd>${badge(c.status)}</dd>
          <dt>Início</dt><dd>${fmtDate(c.start_date)}</dd>
          <dt>Término</dt><dd>${fmtDate(c.end_date)}</dd>
          <dt>Periodicidade</dt><dd>${esc(c.billing_period)}</dd>
          <dt>Início da manutenção</dt><dd>${fmtDate(c.maintenance_start)}</dd>
        </dl>
        ${c.conditions ? `<h3 style="margin-top:16px">Condições</h3><div class="detail-text">${esc(c.conditions)}</div>` : ""}
        ${c.notes ? `<h3>Observações</h3><div class="detail-text">${esc(c.notes)}</div>` : ""}
      </div>
      <div class="card">
        <h2>Anexos</h2>
        <div class="field"><label for="con-file">Enviar documento (até 20 MB)</label>
          <input type="file" id="con-file" data-change="con-upload" data-id="${id}" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"></div>
        ${
          files.length
            ? `<ul class="feed">${files
                .map(
                  (f) => `<li>
            <span>${esc(f.file_name)}</span>
            <span class="row-actions" style="margin:0">
              <button class="ghost sm" data-act="file-open" data-bucket="contract-files" data-path="${esc(f.storage_path)}">Abrir</button>
              <button class="danger sm" data-act="file-del" data-id="${f.id}" data-bucket="contract-files" data-path="${esc(f.storage_path)}" data-table="contract_files">Remover</button>
            </span></li>`,
                )
                .join("")}</ul>`
            : '<p class="muted">Nenhum anexo enviado.</p>'
        }
      </div>
    </div>
    ${section(
      "Cobranças deste contrato",
      fin.charges.length
        ? table(
            [
              { l: "Vencimento", f: (r) => fmtDate(r.due_date) },
              {
                l: "Descrição",
                f: (r) =>
                  esc(r.description) +
                  (r.kind === "Mensalidade"
                    ? ' <span class="badge info">mensalidade</span>'
                    : ""),
              },
              {
                l: "Valor",
                f: (r) => `<span class="money">${brl(r.amount)}</span>`,
              },
              {
                l: "Recebido",
                f: (r) => `<span class="money">${brl(r.paid)}</span>`,
              },
              {
                l: "Saldo",
                f: (r) => `<span class="money">${brl(r.remaining)}</span>`,
              },
              { l: "Situação", f: (r) => badge(r.status) },
            ],
            fin.charges,
            (r) =>
              r.remaining > 0.005
                ? `<button class="btn-primary sm" data-act="rec-pay" data-id="${r.id}">Registrar pagamento</button>`
                : "",
          )
        : '<div class="empty">Nenhuma cobrança vinculada. Crie cobranças pelo módulo Financeiro.</div>',
    )}
    ${section("Histórico de alterações", hist.length ? `<ul class="feed">${hist.map((a) => `<li><span>${esc(ACTION_LABEL[a.action] || a.action)}${a.label ? " · " + esc(a.label) : ""}</span><time>${fmtDateTime(a.created_at)}</time></li>`).join("")}</ul>` : '<p class="muted">Sem alterações registradas.</p>')}`,
  );
}

/* ===================== Financeiro ===================== */
const RECEIVABLE_FIELDS = [
  { k: "client_id", l: "Cliente", t: "ref", ref: "clients", req: 1 },
  { k: "contract_id", l: "Contrato (opcional)", t: "ref", ref: "contracts" },
  { k: "project_id", l: "Projeto (opcional)", t: "ref", ref: "projects" },
  { k: "description", l: "Descrição", req: 1, full: 1 },
  { k: "amount", l: "Valor (R$)", t: "money", req: 1 },
  { k: "due_date", l: "Vencimento", t: "date", req: 1 },
  { k: "notes", l: "Observações", t: "textarea", full: 1 },
];

function receivableForm(r) {
  formModal(
    r ? "Editar cobrança" : "Nova cobrança",
    RECEIVABLE_FIELDS,
    r,
    async (out, close) => {
      if (r && out.amount < r.paid - 0.005)
        throw new Error(
          `O valor não pode ser menor que o já recebido (${brl(r.paid)}).`,
        );
      const payload = { ...out };
      if (!r) payload.kind = "Pontual";
      await saveEntity("receivables", payload, r && r.id);
      close();
      toast("Cobrança salva.");
      await route();
    },
  );
}

function paymentForm(r) {
  formModal(
    "Registrar pagamento",
    [
      {
        k: "amount",
        l: `Valor recebido · saldo ${brl(r.remaining)}`,
        t: "money",
        req: 1,
      },
      {
        k: "paid_on",
        l: "Data do recebimento",
        t: "date",
        req: 1,
        def: isoToday(),
      },
      {
        k: "method",
        l: "Forma de pagamento",
        t: "select",
        opts: PAY,
        req: 1,
        def: "Pix",
      },
      { k: "notes", l: "Observações", t: "textarea", full: 1 },
    ],
    { amount: r.remaining.toFixed(2).replace(".", ",") },
    async (out, close) => {
      if (out.amount > r.remaining + 0.005)
        throw new Error(`O valor excede o saldo de ${brl(r.remaining)}.`);
      await saveEntity(
        "payments",
        {
          receivable_id: r.id,
          client_id: r.client_id,
          amount: out.amount,
          paid_on: out.paid_on,
          method: out.method,
          notes: out.notes,
        },
        null,
      );
      close();
      toast("Pagamento registrado.");
      await route();
    },
  );
}

const EXPENSE_FIELDS = [
  { k: "description", l: "Descrição", req: 1, full: 1 },
  {
    k: "category",
    l: "Categoria",
    t: "select",
    opts: EXP_CAT,
    def: "Outros",
    req: 1,
  },
  { k: "amount", l: "Valor (R$)", t: "money", req: 1 },
  { k: "spent_on", l: "Data", t: "date", req: 1, def: isoToday() },
  {
    k: "payment_method",
    l: "Forma de pagamento",
    t: "select",
    opts: PAY,
    empty: "—",
  },
  {
    k: "recurrence",
    l: "Recorrência",
    t: "select",
    opts: RECURR,
    def: "Nenhuma",
  },
  {
    k: "receipt",
    l: "Comprovante (PDF ou imagem)",
    t: "file",
    accept: ".pdf,.jpg,.jpeg,.png,.webp",
    full: 1,
  },
  { k: "notes", l: "Observações", t: "textarea", full: 1 },
];

function expenseForm(e) {
  const values = e
    ? {
        ...e,
        receipt_name: e.receipt_path ? e.receipt_path.split("/").pop() : "",
      }
    : {};
  formModal(
    e ? "Editar despesa" : "Nova despesa",
    EXPENSE_FIELDS,
    values,
    async (out, close) => {
      const file = out.receipt;
      delete out.receipt;
      const saved = await saveEntity("expenses", out, e && e.id);
      if (file) {
        const path = `${saved.id}/${Date.now()}-${safeName(file.name)}`;
        const { error: e1 } = await sb.storage
          .from("expense-receipts")
          .upload(path, file);
        if (e1) throw e1;
        const { error: e2 } = await sb
          .from("expenses")
          .update({ receipt_path: path })
          .eq("id", saved.id);
        if (e2) throw e2;
      }
      close();
      toast("Despesa salva.");
      await route();
    },
  );
}

function reportData(de, ate, cli, proj) {
  const inR = (d) => d && d >= de && d <= ate;
  const byId = Object.fromEntries(FIN.receivables.map((r) => [r.id, r]));
  const okR = (r) =>
    (!cli || r.client_id === cli) && (!proj || r.project_id === proj);
  const recs = FIN.receivables.filter((r) => inR(r.due_date) && okR(r));
  const pays = FIN.payments.filter(
    (p) =>
      inR(p.paid_on) && byId[p.receivable_id] && okR(byId[p.receivable_id]),
  );
  const exps = FIN.expenses.filter((e) => inR(e.spent_on));
  const recebido = sum(pays.map((p) => p.amount));
  const despesas = sum(exps.map((e) => e.amount));
  return {
    recs,
    pays,
    exps,
    byId,
    contratado: sum(recs.map((r) => r.amount)),
    recebido,
    pendente: sum(recs.map((r) => r.remaining)),
    despesas,
    resultado: recebido - despesas,
  };
}

function buildCSV(d) {
  const rows = [
    ...d.recs.map((r) => [
      "Cobrança",
      fmtDate(r.due_date),
      cname(r.client_id),
      r.description,
      numCSV(r.amount),
      numCSV(r.paid),
      numCSV(r.remaining),
      r.status,
      "",
    ]),
    ...d.pays.map((p) => [
      "Pagamento",
      fmtDate(p.paid_on),
      cname(p.client_id),
      (d.byId[p.receivable_id] || {}).description || "",
      numCSV(p.amount),
      "",
      "",
      "",
      p.method,
    ]),
    ...d.exps.map((e) => [
      "Despesa",
      fmtDate(e.spent_on),
      e.category,
      e.description,
      numCSV(e.amount),
      "",
      "",
      "",
      e.payment_method || "",
    ]),
  ];
  const head = [
    "Tipo",
    "Data",
    "Cliente / Categoria",
    "Descrição",
    "Valor",
    "Recebido",
    "Saldo",
    "Situação",
    "Forma",
  ];
  const line = (cols) =>
    cols.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";");
  return "\ufeff" + [line(head), ...rows.map(line)].join("\r\n");
}

function downloadCSV(name, text) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function financeTabs(tab) {
  const tabs = [
    ["recebimentos", "Recebimentos"],
    ["despesas", "Despesas"],
    ["mensalidades", "Mensalidades"],
    ["relatorios", "Relatórios"],
  ];
  return `<div class="tabs">${tabs.map(([k, l]) => `<a href="#/financeiro/${k}" class="${k === tab ? "on" : ""}">${l}</a>`).join("")}</div>`;
}

async function viewFinance(main, tab) {
  tab = tab || "recebimentos";
  if (tab === "despesas") return financeExpenses(main);
  if (tab === "mensalidades") return financeMaintenance(main);
  if (tab === "relatorios") return financeReports(main);
  return financeReceivables(main);
}

function financeReceivables(main) {
  const st = { q: "", status: "" };
  shell(
    main,
    "Financeiro",
    '<button class="btn-primary" data-act="rec-new">+ Nova cobrança</button>',
    `
    ${financeTabs("recebimentos")}
    <div class="toolbar">
      ${searchInput("rec-q", "Pesquisar por cliente ou descrição", "Pesquisar cobranças")}
      <select data-change="rec-status" aria-label="Filtrar por situação"><option value="">Todas as situações</option>${["A receber", "Parcial", "Vencido", "Recebido"].map((s) => `<option>${s}</option>`).join("")}</select>
    </div><div id="list"></div>`,
  );
  const draw = () => {
    const rows = FIN.receivables.filter(
      (r) =>
        (!st.status || r.status === st.status) &&
        hit(st.q, [cname(r.client_id), r.description, r.status]),
    );
    $("#list", main).innerHTML = table(
      [
        { l: "Vencimento", f: (r) => fmtDate(r.due_date) },
        { l: "Cliente", f: (r) => esc(cname(r.client_id)) },
        {
          l: "Descrição",
          f: (r) =>
            esc(r.description) +
            (r.kind === "Mensalidade"
              ? ' <span class="badge info">mensalidade</span>'
              : ""),
        },
        { l: "Valor", f: (r) => `<span class="money">${brl(r.amount)}</span>` },
        {
          l: "Recebido",
          f: (r) => `<span class="money">${brl(r.paid)}</span>`,
        },
        {
          l: "Saldo",
          f: (r) => `<span class="money">${brl(r.remaining)}</span>`,
        },
        { l: "Situação", f: (r) => badge(r.status) },
      ],
      rows,
      (
        r,
      ) => `${r.remaining > 0.005 ? `<button class="btn-primary sm" data-act="rec-pay" data-id="${r.id}">Registrar pagamento</button> ` : ""}
      <button class="ghost sm" data-act="rec-hist" data-id="${r.id}">Pagamentos</button>
      <button class="ghost sm" data-act="rec-edit" data-id="${r.id}">Editar</button>
      ${r.paid === 0 ? `<button class="danger sm" data-act="rec-del" data-id="${r.id}">Excluir</button>` : ""}`,
    );
  };
  INP["rec-q"] = (v) => {
    st.q = v;
    draw();
  };
  CHG["rec-status"] = (v) => {
    st.status = v;
    draw();
  };
  draw();
}

function financeExpenses(main) {
  const st = { q: "", cat: "" };
  shell(
    main,
    "Financeiro",
    '<button class="btn-primary" data-act="exp-new">+ Nova despesa</button>',
    `
    ${financeTabs("despesas")}
    <div class="toolbar">
      ${searchInput("exp-q", "Pesquisar por descrição", "Pesquisar despesas")}
      <select data-change="exp-cat" aria-label="Filtrar por categoria"><option value="">Todas as categorias</option>${EXP_CAT.map((c) => `<option>${c}</option>`).join("")}</select>
    </div><div id="list"></div>`,
  );
  const draw = () => {
    const rows = FIN.expenses.filter(
      (e) =>
        (!st.cat || e.category === st.cat) &&
        hit(st.q, [e.description, e.category]),
    );
    $("#list", main).innerHTML = table(
      [
        { l: "Data", f: (r) => fmtDate(r.spent_on) },
        { l: "Descrição", f: (r) => esc(r.description) },
        { l: "Categoria", f: (r) => esc(r.category) },
        { l: "Valor", f: (r) => `<span class="money">${brl(r.amount)}</span>` },
        { l: "Recorrência", f: (r) => esc(r.recurrence) },
        {
          l: "Comprovante",
          f: (r) =>
            r.receipt_path
              ? `<button class="ghost sm" data-act="file-open" data-bucket="expense-receipts" data-path="${esc(r.receipt_path)}">Abrir</button>`
              : '<span class="muted small">—</span>',
        },
      ],
      rows,
      (
        r,
      ) => `<button class="ghost sm" data-act="exp-edit" data-id="${r.id}">Editar</button>
      <button class="danger sm" data-act="exp-del" data-id="${r.id}">Excluir</button>`,
    );
  };
  INP["exp-q"] = (v) => {
    st.q = v;
    draw();
  };
  CHG["exp-cat"] = (v) => {
    st.cat = v;
    draw();
  };
  draw();
}

async function financeMaintenance(main) {
  const active = DB.contracts.filter(
    (c) => c.status === "Ativo" && Number(c.maintenance_value) > 0,
  );
  const rows = FIN.receivables.filter((r) => r.kind === "Mensalidade");
  const open = rows
    .filter((r) => r.remaining > 0.005)
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
  const nextDue = (contractId) =>
    (open.find((r) => r.contract_id === contractId) || {}).due_date;
  const openSum = (contractId) =>
    sum(
      open.filter((r) => r.contract_id === contractId).map((r) => r.remaining),
    );
  shell(
    main,
    "Financeiro",
    "",
    `
    ${financeTabs("mensalidades")}
    <p class="muted">As mensalidades são geradas automaticamente a partir do mês de início da manutenção de cada contrato ativo, uma por mês, sem duplicar. Elas só aparecem como recebidas quando você registra o pagamento.</p>
    ${section(
      "Contratos de manutenção ativos",
      active.length
        ? table(
            [
              { l: "Cliente", f: (r) => esc(cname(r.client_id)) },
              {
                l: "Contrato",
                f: (r) => `<a href="#/contrato/${r.id}">${esc(r.title)}</a>`,
              },
              {
                l: "Valor mensal",
                f: (r) =>
                  `<span class="money">${brl(r.maintenance_value)}</span>`,
              },
              { l: "Início", f: (r) => fmtDate(r.maintenance_start) },
              { l: "Próximo vencimento", f: (r) => fmtDate(nextDue(r.id)) },
              {
                l: "Em aberto",
                f: (r) => `<span class="money">${brl(openSum(r.id))}</span>`,
              },
            ],
            active,
          )
        : '<div class="empty">Nenhum contrato ativo com manutenção mensal.</div>',
    )}
    ${section(
      "Mensalidades",
      rows.length
        ? table(
            [
              { l: "Vencimento", f: (r) => fmtDate(r.due_date) },
              { l: "Cliente", f: (r) => esc(cname(r.client_id)) },
              { l: "Descrição", f: (r) => esc(r.description) },
              {
                l: "Valor",
                f: (r) => `<span class="money">${brl(r.amount)}</span>`,
              },
              {
                l: "Recebido",
                f: (r) => `<span class="money">${brl(r.paid)}</span>`,
              },
              { l: "Situação", f: (r) => badge(r.status) },
            ],
            rows,
            (r) =>
              r.remaining > 0.005
                ? `<button class="btn-primary sm" data-act="rec-pay" data-id="${r.id}">Registrar pagamento</button>`
                : "",
          )
        : '<div class="empty">Nenhuma mensalidade gerada ainda.</div>',
    )}`,
  );
}

function financeReports(main) {
  const st = {
    de: isoToday().slice(0, 8) + "01",
    ate: isoToday(),
    cli: "",
    proj: "",
  };
  shell(
    main,
    "Financeiro",
    '<button class="ghost" data-act="rep-csv">Exportar CSV</button>',
    `
    ${financeTabs("relatorios")}
    <div class="toolbar">
      <div class="field" style="margin:0"><label for="rep-de">De</label><input type="date" id="rep-de" data-change="rep-de" value="${st.de}"></div>
      <div class="field" style="margin:0"><label for="rep-ate">Até</label><input type="date" id="rep-ate" data-change="rep-ate" value="${st.ate}"></div>
      <div class="field" style="margin:0"><label for="rep-cli">Cliente</label><select id="rep-cli" data-change="rep-cli"><option value="">Todos</option>${DB.clients.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></div>
      <div class="field" style="margin:0"><label for="rep-proj">Projeto</label><select id="rep-proj" data-change="rep-proj"><option value="">Todos</option>${DB.projects.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select></div>
    </div>
    <div id="report"></div>`,
  );
  const draw = () => {
    const d = reportData(st.de, st.ate, st.cli, st.proj);
    $("#report", main).innerHTML = `
      <div class="card-grid">
        ${kpi("Cobranças com vencimento no período", brl(d.contratado))}
        ${kpi("Recebido no período", brl(d.recebido))}
        ${kpi("Pendente das cobranças do período", brl(d.pendente))}
        ${kpi("Despesas no período", brl(d.despesas))}
        ${kpi("Resultado (recebido − despesas)", brl(d.resultado), d.resultado < 0)}
      </div>
      <p class="muted small">Cobranças são contadas pela data de vencimento. Recebido, pela data do pagamento. Despesas não são vinculadas a cliente ou projeto, então aparecem sempre no total.</p>`;
  };
  CHG["rep-de"] = (v) => {
    st.de = v || st.de;
    draw();
  };
  CHG["rep-ate"] = (v) => {
    st.ate = v || st.ate;
    draw();
  };
  CHG["rep-cli"] = (v) => {
    st.cli = v;
    draw();
  };
  CHG["rep-proj"] = (v) => {
    st.proj = v;
    draw();
  };
  GACT["rep-csv"] = () => {
    const d = reportData(st.de, st.ate, st.cli, st.proj);
    downloadCSV(`studio-mv-financeiro-${st.de}_${st.ate}.csv`, buildCSV(d));
  };
  draw();
}

/* ===================== Mensagens e orçamentos ===================== */
async function viewMessages(main, openId) {
  const st = { q: "", status: "" };
  const msgs = await q(
    sb
      .from("messages")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500),
  );
  shell(
    main,
    "Mensagens e orçamentos",
    "",
    `
    <div class="toolbar">
      ${searchInput("msg-q", "Pesquisar por nome, empresa, e-mail ou serviço", "Pesquisar solicitações")}
      <select data-change="msg-status" aria-label="Filtrar por situação"><option value="">Todas as situações</option>${MSG_STATUS.map((s) => `<option>${esc(s)}</option>`).join("")}</select>
    </div><div id="list"></div>`,
  );
  const draw = () => {
    const rows = msgs.filter(
      (m) =>
        (!st.status || m.status === st.status) &&
        hit(st.q, [m.name, m.company, m.email, m.type, m.status]),
    );
    $("#list", main).innerHTML = table(
      [
        { l: "Recebida em", f: (r) => fmtDateTime(r.created_at) },
        {
          l: "Nome",
          f: (r) =>
            `<button class="link-btn" data-act="msg-open" data-id="${r.id}">${esc(r.name)}</button>`,
        },
        { l: "Empresa", f: (r) => esc(r.company) },
        { l: "Serviço", f: (r) => esc(r.type) },
        { l: "Situação", f: (r) => badge(r.status) },
      ],
      rows,
      (r) =>
        `<div class="row-actions" style="margin:0">
          <button class="ghost sm" data-act="msg-open" data-id="${r.id}">Abrir</button>
          <button class="danger sm" data-act="msg-del" data-id="${r.id}">Excluir</button>
        </div>`,
    );
  };
  INP["msg-q"] = (v) => {
    st.q = v;
    draw();
  };
  CHG["msg-status"] = (v) => {
    st.status = v;
    draw();
  };
  draw();
  if (openId) {
    const target = msgs.find((m) => m.id === openId);
    if (target) {
      openMessage(target);
    } else {
      q(sb.from("messages").select("*").eq("id", openId).single())
        .then(openMessage)
        .catch((e) => toast(friendly(e), false));
    }
  }
}

function openMessage(m) {
  const digits = String(m.phone || "").replace(/\D/g, "");
  const wa =
    digits.length >= 10
      ? `https://wa.me/${digits.startsWith("55") ? digits : "55" + digits}`
      : "";
  const html = `
    <dl class="dl">
      <dt>Nome</dt><dd>${esc(m.name)}</dd>
      <dt>Empresa</dt><dd>${esc(m.company)}</dd>
      <dt>E-mail</dt><dd>${esc(m.email)}</dd>
      <dt>Telefone</dt><dd>${esc(m.phone)}</dd>
      <dt>Serviço</dt><dd>${esc(m.type)}</dd>
      <dt>Orçamento</dt><dd>${esc(m.budget || "Não informado")}</dd>
      <dt>Recebida em</dt><dd>${fmtDateTime(m.created_at)}</dd>
    </dl>
    <h3 style="margin-top:16px">Descrição</h3>
    <div class="detail-text">${esc(m.description)}</div>
    <div class="row-actions">
      <button class="ghost sm" type="button" data-copy="${esc(m.email)}">Copiar e-mail</button>
      <button class="ghost sm" type="button" data-copy="${esc(m.phone)}">Copiar telefone</button>
      ${wa ? `<a class="btn sm" href="${wa}" target="_blank" rel="noopener noreferrer">Abrir WhatsApp</a>` : ""}
    </div>
    <form class="form" id="msg-form" novalidate>
      <div class="field full"><label for="m-status">Situação</label>
        <select id="m-status" name="status">${MSG_STATUS.map((s) => `<option ${s === m.status ? "selected" : ""}>${s}</option>`).join("")}</select></div>
      <div class="field full"><label for="m-notes">Anotações internas</label>
        <textarea id="m-notes" name="notes" rows="3">${esc(m.internal_notes || "")}</textarea></div>
      <div class="form-msg" role="alert"></div>
      <div class="form-actions" style="justify-content:space-between">
        <button type="submit" class="ghost">Salvar</button>
        <button type="button" class="danger" data-del-msg="${m.id}">Excluir mensagem</button>
      </div>
    </form>
    <div style="margin-top:18px">
      <h3>Converter em cliente</h3>
      ${
        m.converted_client_id
          ? `<p class="muted">Esta solicitação já foi convertida. <a href="#/cliente/${m.converted_client_id}">Abrir cliente</a></p>`
          : `<div class="row-actions">
             <select id="m-dest" style="width:auto">
               <option value="Nenhum">Somente cliente</option>
               <option value="Fila de espera">Cliente + item na fila de espera</option>
               <option value="Projeto">Cliente + projeto</option>
             </select>
             <button class="btn-primary" type="button" data-convert>Converter</button>
           </div>
           <p class="hint">Se já existir um cliente com o mesmo e-mail, ele será reaproveitado.</p>`
      }
    </div>`;
  openModal(`Solicitação de ${m.name}`, html, (wrap, close) => {
    wrap.addEventListener("click", async (e) => {
      const cp = e.target.closest("[data-copy]");
      if (cp) {
        try {
          await navigator.clipboard.writeText(cp.dataset.copy);
          toast("Copiado.");
        } catch (err) {
          toast("Não foi possível copiar.", false);
        }
        return;
      }
      if (e.target.closest("[data-del-msg]")) {
        if (!confirm("Excluir esta mensagem permanentemente?")) return;
        try {
          const { error } = await sb.from("messages").delete().eq("id", m.id);
          if (error) throw error;
          close();
          toast("Mensagem excluída.");
          await route();
        } catch (err) {
          toast(friendly(err), false);
        }
        return;
      }
      if (e.target.closest("[data-convert]")) {
        const dest = $("#m-dest", wrap).value;
        if (!confirm("Converter esta solicitação em cliente?")) return;
        try {
          const { error } = await sb.rpc("convert_message", {
            p_message: m.id,
            p_destination: dest,
          });
          if (error) throw error;
          close();
          toast("Solicitação convertida em cliente.");
          await route();
        } catch (err) {
          toast(friendly(err), false);
        }
      }
    });
    $("#msg-form", wrap).addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target;
      try {
        const { error } = await sb
          .from("messages")
          .update({
            status: f.elements.status.value,
            internal_notes: f.elements.notes.value.trim() || null,
          })
          .eq("id", m.id);
        if (error) throw error;
        close();
        toast("Solicitação atualizada.");
        await route();
      } catch (err) {
        $(".form-msg", wrap).textContent = friendly(err);
      }
    });
  });
}

/* ===================== Portfólio ===================== */
const PORTFOLIO_FIELDS = [
  { k: "title", l: "Título", req: 1 },
  { k: "category", l: "Categoria" },
  { k: "link", l: "Link público (https)", t: "url", full: 1 },
  { k: "description", l: "Descrição", t: "textarea", full: 1 },
  { k: "published", l: "Publicar no site", t: "bool", full: 1 },
  { k: "image", l: "Imagem de capa", t: "file", accept: "image/*", full: 1 },
];

function portfolioForm(item) {
  formModal(
    item ? "Editar projeto do portfólio" : "Novo projeto do portfólio",
    PORTFOLIO_FIELDS,
    item,
    async (out, close) => {
      const file = out.image;
      delete out.image;
      if (!item) {
        const { data, error } = await sb
          .from("portfolio")
          .select("sort_order")
          .order("sort_order", { ascending: false })
          .limit(1);
        if (error) throw error;
        out.sort_order = ((data && data[0] && data[0].sort_order) || 0) + 1;
      }
      if (file) {
        const path = `${Date.now()}-${safeName(file.name)}`;
        const { error: e1 } = await sb.storage
          .from("portfolio-images")
          .upload(path, file);
        if (e1) throw e1;
        out.image_url = sb.storage
          .from("portfolio-images")
          .getPublicUrl(path).data.publicUrl;
      }
      await saveEntity("portfolio", out, item && item.id);
      close();
      toast("Item do portfólio salvo.");
      await route();
    },
  );
}

async function viewPortfolio(main) {
  const items = await q(
    sb.from("portfolio").select("*").order("sort_order", { ascending: true }),
  );
  shell(
    main,
    "Portfólio",
    '<button class="btn-primary" data-act="pf-new">+ Novo projeto</button>',
    `
    <p class="muted">Somente os itens publicados aparecem no site. A ordem definida aqui é a ordem da vitrine.</p>
    <div id="list">${table(
      [
        { l: "Ordem", f: (r) => `${items.indexOf(r) + 1}` },
        {
          l: "Capa",
          f: (r) =>
            r.image_url
              ? `<img src="${esc(r.image_url)}" alt="" style="width:64px;height:40px;object-fit:cover;border-radius:6px">`
              : '<span class="muted small">Sem imagem</span>',
        },
        { l: "Título", f: (r) => esc(r.title) },
        { l: "Categoria", f: (r) => esc(r.category || "—") },
        {
          l: "Situação",
          f: (r) => badge(r.published ? "Publicado" : "Oculto"),
        },
      ],
      items,
      (
        r,
      ) => `<button class="ghost sm" data-act="pf-up" data-id="${r.id}" aria-label="Subir">↑</button>
      <button class="ghost sm" data-act="pf-down" data-id="${r.id}" aria-label="Descer">↓</button>
      <button class="ghost sm" data-act="pf-pub" data-id="${r.id}">${r.published ? "Ocultar" : "Publicar"}</button>
      <button class="ghost sm" data-act="pf-edit" data-id="${r.id}">Editar</button>
      <button class="danger sm" data-act="pf-del" data-id="${r.id}">Excluir</button>`,
    )}</div>`,
  );
}

/* ===================== Configurações ===================== */
const SETTINGS_FIELDS = [
  { k: "company_name", l: "Nome da empresa" },
  { k: "footer_text", l: "Descrição do rodapé", t: "textarea", full: 1 },
  { k: "email", l: "E-mail de contato", t: "email" },
  { k: "instagram", l: "Instagram (link completo)", t: "url" },
  { k: "phone", l: "Telefone / WhatsApp" },
  { k: "site_url", l: "Endereço do site", t: "url" },
];

async function viewSettings(main) {
  const rows = await q(sb.from("settings").select("*"));
  const values = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  SUB["settings"] = async (form) => {
    const msg = $(".form-msg", form);
    const { out, errs } = readFields(form, SETTINGS_FIELDS);
    if (errs.length) {
      msg.textContent = errs.join(" ");
      return;
    }
    const data = Object.entries(out).map(([key, value]) => ({
      key,
      value: value ?? null,
    }));
    const { error } = await sb
      .from("settings")
      .upsert(data, { onConflict: "key" });
    if (error) {
      msg.textContent = friendly(error);
      return;
    }
    msg.className = "form-msg ok";
    msg.textContent = "Configurações salvas.";
    toast("Configurações salvas.");
  };
  shell(
    main,
    "Configurações",
    "",
    `
    <p class="muted">Informações institucionais usadas no site público. Não altere o código para mudar estes dados.</p>
    <form class="card form" data-submit="settings" novalidate style="max-width:760px">
      ${SETTINGS_FIELDS.map((f) => fieldInput(f, values)).join("")}
      <div class="form-msg" role="alert"></div>
      <div class="form-actions"><button type="submit" class="btn-primary">Salvar configurações</button></div>
    </form>`,
  );
}

/* ===================== Ações globais (botões) ===================== */
GACT["proj-new"] = () => projectForm();
GACT["proj-edit"] = (id) => projectForm(DB.projects.find((x) => x.id === id));
GACT["proj-arch"] = (id) => toggleArchive("projects", id);
GACT["proj-del"] = (id) =>
  removeRecord(
    "projects",
    id,
    "Excluir este projeto? As etapas também serão removidas. Esta ação não pode ser desfeita.",
  );

GACT["stage-del"] = (id) =>
  removeRecord("project_stages", id, "Remover esta etapa?");

GACT["wl-new"] = () => waitForm();
GACT["wl-edit"] = (id) => {
  q(sb.from("waitlist").select("*").eq("id", id).single())
    .then((row) => waitForm(row))
    .catch((e) => toast(friendly(e), false));
};
GACT["wl-del"] = (id) =>
  removeRecord("waitlist", id, "Excluir este item da fila de espera?");
GACT["wl-up"] = (id) =>
  run(() => swapOrder("waitlist", "priority", id, -1, ["state", "Na fila"]));
GACT["wl-down"] = (id) =>
  run(() => swapOrder("waitlist", "priority", id, 1, ["state", "Na fila"]));
GACT["wl-move"] = (id) => {
  if (
    !confirm(
      "Mover este item para um projeto? Ele sai da fila e o projeto é criado com os dados dele.",
    )
  )
    return;
  run(async () => {
    const { error } = await sb.rpc("move_waitlist_to_project", { p_item: id });
    if (error) throw error;
  }, "Projeto criado a partir da fila.");
};

GACT["cli-new"] = () => clientForm();
GACT["cli-edit"] = (id) => clientForm(DB.clients.find((x) => x.id === id));
GACT["cli-arch"] = (id) => toggleArchive("clients", id);
GACT["cli-del"] = (id) =>
  removeRecord(
    "clients",
    id,
    'Excluir este cliente? Clientes com projetos, contratos, cobranças ou solicitações não podem ser excluídos. Nesses casos, use "Arquivar".',
  );

GACT["con-new"] = () => contractForm();
GACT["con-edit"] = (id) => contractForm(DB.contracts.find((x) => x.id === id));
GACT["con-arch"] = (id) => toggleArchive("contracts", id);
GACT["con-del"] = (id) =>
  removeRecord(
    "contracts",
    id,
    "Excluir este contrato? Anexos e histórico serão removidos. Esta ação não pode ser desfeita.",
  );

GACT["rec-new"] = () => receivableForm();
GACT["rec-edit"] = (id) =>
  receivableForm(FIN.receivables.find((r) => r.id === id));
GACT["rec-del"] = (id) =>
  removeRecord("receivables", id, "Excluir esta cobrança?");
GACT["rec-pay"] = (id) => paymentForm(FIN.receivables.find((r) => r.id === id));
GACT["rec-hist"] = (id) => {
  const r = FIN.receivables.find((x) => x.id === id);
  const list = FIN.payments.filter((p) => p.receivable_id === id);
  openModal(
    `Pagamentos · ${r.description}`,
    list.length
      ? `<div class="table-wrap"><table><thead><tr><th>Data</th><th>Forma</th><th>Valor</th><th></th></tr></thead><tbody>
        ${list
          .map(
            (
              p,
            ) => `<tr><td>${fmtDate(p.paid_on)}</td><td>${esc(p.method)}</td><td class="money">${brl(p.amount)}</td>
          <td class="actions-col"><button class="danger sm" type="button" data-pay-del="${p.id}">Excluir</button></td></tr>`,
          )
          .join("")}
        </tbody></table></div>`
      : '<p class="muted">Nenhum pagamento registrado.</p>',
    (wrap) => {
      wrap.addEventListener("click", async (e) => {
        const b = e.target.closest("[data-pay-del]");
        if (!b) return;
        if (
          !confirm(
            "Excluir este pagamento? O saldo da cobrança será recalculado.",
          )
        )
          return;
        try {
          const { error } = await sb
            .from("payments")
            .delete()
            .eq("id", b.dataset.payDel);
          if (error) throw error;
          toast("Pagamento excluído.");
          wrap.remove();
          await route();
        } catch (err) {
          toast(friendly(err), false);
        }
      });
    },
  );
};

GACT["exp-new"] = () => expenseForm();
GACT["exp-edit"] = (id) => expenseForm(FIN.expenses.find((x) => x.id === id));
GACT["exp-del"] = (id) => removeRecord("expenses", id, "Excluir esta despesa?");

GACT["msg-open"] = (id) => {
  q(sb.from("messages").select("*").eq("id", id).single())
    .then(openMessage)
    .catch((e) => toast(friendly(e), false));
};
GACT["msg-del"] = (id) =>
  removeRecord("messages", id, "Excluir esta mensagem permanentemente?");

GACT["pf-new"] = () => portfolioForm();
GACT["pf-edit"] = (id) =>
  q(sb.from("portfolio").select("*").eq("id", id).single())
    .then(portfolioForm)
    .catch((e) => toast(friendly(e), false));
GACT["pf-del"] = async (id) => {
  if (
    !confirm("Excluir este item do portfólio? Esta ação não pode ser desfeita.")
  )
    return;
  await run(async () => {
    const { data } = await sb
      .from("portfolio")
      .select("image_url")
      .eq("id", id)
      .single();
    const { error } = await sb.from("portfolio").delete().eq("id", id);
    if (error) throw error;
    const marker = "/portfolio-images/";
    if (data && data.image_url && data.image_url.includes(marker)) {
      const path = decodeURIComponent(
        data.image_url.split(marker)[1].split("?")[0],
      );
      await sb.storage.from("portfolio-images").remove([path]);
    }
  }, "Item excluído do portfólio.");
};
GACT["pf-up"] = (id) => run(() => swapOrder("portfolio", "sort_order", id, -1));
GACT["pf-down"] = (id) =>
  run(() => swapOrder("portfolio", "sort_order", id, 1));
GACT["pf-pub"] = (id) =>
  run(async () => {
    const row = await q(
      sb.from("portfolio").select("published").eq("id", id).single(),
    );
    const { error } = await sb
      .from("portfolio")
      .update({ published: !row.published })
      .eq("id", id);
    if (error) throw error;
  }, "Situação do item atualizada.");

GACT["file-open"] = async (_id, btn) => {
  const { data, error } = await sb.storage
    .from(btn.dataset.bucket)
    .createSignedUrl(btn.dataset.path, 300);
  if (error) {
    toast(friendly(error), false);
    return;
  }
  window.open(data.signedUrl, "_blank", "noopener");
};
GACT["file-del"] = (id, btn) => {
  if (!confirm("Remover este anexo? Esta ação não pode ser desfeita.")) return;
  run(async () => {
    const { error: e1 } = await sb.storage
      .from(btn.dataset.bucket)
      .remove([btn.dataset.path]);
    if (e1) throw e1;
    const { error: e2 } = await sb
      .from(btn.dataset.table)
      .delete()
      .eq("id", id);
    if (e2) throw e2;
  }, "Anexo removido.");
};

/* ===================== Início ===================== */
if (location.hash.includes("type=recovery")) {
  showScreen("reset");
} else {
  enterApp();
}
sb.auth.onAuthStateChange((event) => {
  if (event === "PASSWORD_RECOVERY") showScreen("reset");
  if (event === "SIGNED_OUT") showScreen("login");
});
