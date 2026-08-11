/* ==========================================================
   WOLF BETS V5 - game.js
   Frontend compatible with the SQL supplied by the project.
   IMPORTANT: replace SUPABASE_URL and SUPABASE_ANON_KEY.
   ========================================================== */

const SUPABASE_URL = "PEGA_AQUI_TU_SUPABASE_URL";
const SUPABASE_ANON_KEY = "PEGA_AQUI_TU_SUPABASE_ANON_KEY";

const { createClient } = window.supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;
let profile = null;
let matches = [];
let markets = [];
let combo = new Map();

const $ = id => document.getElementById(id);

function money(value) {
  return Number(value || 0).toLocaleString("es-ES", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}

function msg(text, type = "") {
  $("globalMessage").textContent = text || "";
  $("globalMessage").className = `message ${type}`;
}

function authMsg(text, type = "") {
  $("authMessage").textContent = text || "";
  $("authMessage").className = `message ${type}`;
}

function loading(on) {
  $("loading").classList.toggle("hidden", !on);
}

function getMatchTitle(match) {
  const home = match.home_team ?? match.home ?? match.team_home ?? "Local";
  const away = match.away_team ?? match.away ?? match.team_away ?? "Visitante";
  return `${home} — ${away}`;
}

function getMatchDate(match) {
  const raw = match.starts_at ?? match.start_time ?? match.match_date ?? match.date ?? match.kickoff;
  if (!raw) return "";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return String(raw);
  return d.toLocaleString("es-ES", { dateStyle:"short", timeStyle:"short" });
}

async function loadProfile() {
  const { data, error } = await sb.from("profiles")
    .select("id,username,balance,is_admin")
    .eq("id", currentUser.id)
    .maybeSingle();

  if (error) throw error;
  profile = data;
  $("userName").textContent = profile?.username || currentUser.email;
  $("balance").textContent = profile?.is_admin ? "ADMIN" : `${money(profile?.balance)} créditos`;
}

async function loadData() {
  loading(true);
  try {
    const [matchesRes, marketsRes] = await Promise.all([
      sb.from("matches").select("*").order("id", { ascending: true }),
      sb.from("markets").select("*").eq("is_open", true).order("match_id").order("sort_order").order("id")
    ]);

    if (matchesRes.error) throw matchesRes.error;
    if (marketsRes.error) throw marketsRes.error;

    matches = matchesRes.data || [];
    markets = marketsRes.data || [];
    renderMatches();
    await loadHistory();
  } catch (e) {
    console.error(e);
    msg(e.message || "No se pudieron cargar los datos.", "error");
  } finally {
    loading(false);
  }
}

function renderMatches() {
  const root = $("matchesList");

  if (!matches.length) {
    root.innerHTML = `<div class="card empty-state">No hay partidos creados todavía.</div>`;
    return;
  }

  root.innerHTML = matches.map(match => {
    const ms = markets.filter(m => Number(m.match_id) === Number(match.id));
    if (!ms.length) {
      return `
        <article class="card match-card">
          <div class="match-header">
            <div class="match-title">${esc(getMatchTitle(match))}</div>
            <span class="muted">${esc(getMatchDate(match))}</span>
          </div>
          <div class="empty-state">No hay mercados abiertos.</div>
        </article>`;
    }

    const groups = {};
    ms.forEach(m => (groups[m.category] ||= []).push(m));

    const marketHtml = Object.entries(groups).map(([category, list]) => `
      <div class="market-group">
        <h3>${esc(category)}</h3>
        ${list.map(m => {
          const selected = combo.has(String(m.id));
          return `
            <button class="market-btn ${selected ? "selected" : ""}"
                    data-market-id="${m.id}">
              <span class="market-name">${esc(m.name)}</span>
              <span class="odd">${Number(m.odd).toFixed(2)}</span>
            </button>`;
        }).join("")}
      </div>
    `).join("");

    return `
      <article class="card match-card">
        <div class="match-header">
          <div class="match-title">${esc(getMatchTitle(match))}</div>
          <span class="muted">${esc(getMatchDate(match))}</span>
        </div>
        <div class="market-grid">${marketHtml}</div>
      </article>`;
  }).join("");

  root.querySelectorAll(".market-btn").forEach(btn => {
    btn.addEventListener("click", () => toggleCombo(btn.dataset.marketId));
  });
}

function toggleCombo(id) {
  id = String(id);
  const market = markets.find(m => String(m.id) === id);
  if (!market) return;

  if (combo.has(id)) {
    combo.delete(id);
  } else {
    combo.set(id, market);
  }

  renderMatches();
  renderCombo();
}

function renderCombo() {
  const root = $("comboSelections");
  const footer = $("comboFooter");

  if (!combo.size) {
    root.className = "empty-state";
    root.innerHTML = "No has seleccionado ninguna apuesta.";
    footer.classList.add("hidden");
    return;
  }

  root.className = "";
  root.innerHTML = [...combo.values()].map(m => `
    <div class="combo-item">
      <div>
        <strong>${esc(m.name)}</strong>
        <div class="muted">${esc(m.category)}</div>
      </div>
      <div>
        <strong>${Number(m.odd).toFixed(2)}</strong>
        <button class="combo-remove" data-remove="${m.id}" title="Quitar">×</button>
      </div>
    </div>
  `).join("");

  root.querySelectorAll("[data-remove]").forEach(btn => {
    btn.addEventListener("click", () => {
      combo.delete(String(btn.dataset.remove));
      renderMatches();
      renderCombo();
    });
  });

  let total = 1;
  combo.forEach(m => total *= Number(m.odd));
  const stake = Math.max(0, Number($("comboStake").value || 0));

  $("comboOdd").textContent = total.toFixed(2);
  $("comboPotential").textContent = money(stake * total);
  footer.classList.remove("hidden");
}

async function placeSimpleBet(market) {
  const stakeText = prompt(`¿Cuánto quieres apostar a "${market.name}"?`, "10");
  if (stakeText === null) return;

  const stake = Number(stakeText);
  if (!Number.isInteger(stake) || stake <= 0) {
    msg("La cantidad debe ser un número entero positivo.", "error");
    return;
  }

  loading(true);
  try {
    const { error } = await sb.rpc("place_market_bet", {
      p_market_id: Number(market.id),
      p_stake: stake
    });
    if (error) throw error;

    msg(`Apuesta realizada: ${market.name} · ${stake} créditos.`, "ok");
    await loadProfile();
    await loadHistory();
  } catch (e) {
    console.error(e);
    msg(e.message || "No se pudo realizar la apuesta.", "error");
  } finally {
    loading(false);
  }
}

async function placeCombo() {
  const ids = [...combo.keys()].map(Number);
  const stake = Number($("comboStake").value);

  if (ids.length < 2) {
    msg("Una combinada necesita al menos 2 selecciones.", "error");
    return;
  }
  if (!Number.isInteger(stake) || stake <= 0) {
    msg("La cantidad debe ser un número entero positivo.", "error");
    return;
  }

  loading(true);
  try {
    const { error } = await sb.rpc("place_combo_bet", {
      p_market_ids: ids,
      p_stake: stake
    });
    if (error) throw error;

    combo.clear();
    $("comboStake").value = 10;
    renderMatches();
    renderCombo();
    msg(`Combinada realizada con ${ids.length} selecciones.`, "ok");
    await loadProfile();
    await loadHistory();
  } catch (e) {
    console.error(e);
    msg(e.message || "No se pudo realizar la combinada.", "error");
  } finally {
    loading(false);
  }
}

async function loadHistory() {
  const [betsRes, combosRes] = await Promise.all([
    sb.from("bets")
      .select("id,match_id,market_id,selection,stake,odd,potential_win,status,created_at")
      .eq("user_id", currentUser.id)
      .order("created_at", { ascending: false }),
    sb.from("combo_bets")
      .select("id,stake,total_odd,potential_win,status,created_at")
      .eq("user_id", currentUser.id)
      .order("created_at", { ascending: false })
  ]);

  if (betsRes.error) throw betsRes.error;
  if (combosRes.error) throw combosRes.error;

  const combos = combosRes.data || [];
  let html = "";

  (betsRes.data || []).forEach(b => {
    const match = matches.find(m => Number(m.id) === Number(b.match_id));
    html += `
      <div class="history-item">
        <div class="history-head">
          <div>
            <strong>Simple · ${esc(b.selection)}</strong>
            <div class="muted">${esc(match ? getMatchTitle(match) : `Partido #${b.match_id}`)}</div>
          </div>
          <span class="status ${esc(b.status)}">${esc(statusText(b.status))}</span>
        </div>
        <div class="muted">Apuesta ${money(b.stake)} · Cuota ${Number(b.odd).toFixed(2)} · Premio ${money(b.potential_win)}</div>
      </div>`;
  });

  for (const cb of combos) {
    const { data: legs, error } = await sb.from("combo_bet_legs")
      .select("market_id,selection,odd,status")
      .eq("combo_bet_id", cb.id)
      .order("id");

    if (error) throw error;

    html += `
      <div class="history-item">
        <div class="history-head">
          <div>
            <strong>Combinada #${cb.id}</strong>
            <div class="muted">Apuesta ${money(cb.stake)} · Cuota ${Number(cb.total_odd).toFixed(2)} · Premio ${money(cb.potential_win)}</div>
          </div>
          <span class="status ${esc(cb.status)}">${esc(statusText(cb.status))}</span>
        </div>
        <ul class="legs">
          ${(legs || []).map(l => `<li>${esc(l.selection)} · ${Number(l.odd).toFixed(2)} · ${esc(statusText(l.status))}</li>`).join("")}
        </ul>
      </div>`;
  }

  $("betsHistory").innerHTML = html || `<div class="empty-state">Todavía no tienes apuestas.</div>`;
}

function statusText(s) {
  return ({ pending:"Pendiente", won:"Ganada", lost:"Perdida" })[s] || s;
}

async function register() {
  const email = $("email").value.trim();
  const password = $("password").value;

  if (!email || password.length < 6) {
    authMsg("Introduce un email y una contraseña de al menos 6 caracteres.", "error");
    return;
  }

  loading(true);
  try {
    const username = email.split("@")[0].slice(0, 30);
    const { error } = await sb.auth.signUp({
      email,
      password,
      options: { data: { username } }
    });
    if (error) throw error;
    authMsg("Cuenta creada. Si Supabase pide confirmación por email, confírmala y vuelve a entrar.", "ok");
  } catch (e) {
    authMsg(e.message || "No se pudo crear la cuenta.", "error");
  } finally {
    loading(false);
  }
}

async function login(e) {
  e.preventDefault();
  loading(true);
  authMsg("");

  try {
    const { error } = await sb.auth.signInWithPassword({
      email: $("email").value.trim(),
      password: $("password").value
    });
    if (error) throw error;
    await boot();
  } catch (e) {
    authMsg(e.message || "No se pudo iniciar sesión.", "error");
  } finally {
    loading(false);
  }
}

async function logout() {
  await sb.auth.signOut();
}

async function boot() {
  const { data: { user } } = await sb.auth.getUser();
  currentUser = user;

  const logged = Boolean(user);
  $("authView").classList.toggle("hidden", logged);
  $("appView").classList.toggle("hidden", !logged);
  $("logoutBtn").classList.toggle("hidden", !logged);

  if (!logged) {
    $("userName").textContent = "No conectado";
    $("balance").textContent = "—";
    return;
  }

  try {
    await loadProfile();
    await loadData();
  } catch (e) {
    console.error(e);
    msg(e.message || "Error cargando la cuenta.", "error");
  }
}

$("authForm").addEventListener("submit", login);
$("registerBtn").addEventListener("click", register);
$("logoutBtn").addEventListener("click", logout);
$("refreshBtn").addEventListener("click", loadData);
$("refreshHistoryBtn").addEventListener("click", loadHistory);
$("clearComboBtn").addEventListener("click", () => {
  combo.clear();
  renderMatches();
  renderCombo();
});
$("placeComboBtn").addEventListener("click", placeCombo);
$("comboStake").addEventListener("input", renderCombo);

sb.auth.onAuthStateChange(() => {
  setTimeout(boot, 0);
});

boot();
