/* PABLO23 BETS V5 - Supabase */
const SUPABASE_URL = "https://acfctgzevmstoqqhtwfs.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_7b9I48CTSngMxXthiYMvqQ_UeIwiFMs";

const { createClient } = window.supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;
let profile = null;
let matches = [];
let markets = [];
let combo = new Map();

// Escudos: puedes usar una URL en la fila de matches o un archivo local en GitHub.
// Ejemplo: TEAM_LOGOS["Real Madrid"] = "team-logos/real-madrid.png";
const TEAM_LOGOS = {
  // "Real Madrid": "team-logos/real-madrid.png",
  // "Barcelona": "team-logos/barcelona.png",
};

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

function normalizeTeamName(value) {
  return String(value ?? "").trim().toLowerCase();
}

function getTeamLogo(match, side, teamName) {
  const candidates = side === "home"
    ? [match.home_logo, match.home_team_logo, match.home_crest, match.home_badge, match.home_image]
    : [match.away_logo, match.away_team_logo, match.away_crest, match.away_badge, match.away_image];
  const direct = candidates.find(Boolean);
  if (direct) return String(direct);

  const key = normalizeTeamName(teamName);
  const mapped = Object.entries(TEAM_LOGOS).find(([name]) => normalizeTeamName(name) === key);
  return mapped ? mapped[1] : "";
}

function teamBadge(teamName, logo, side) {
  const initials = String(teamName || "?").split(/\s+/).filter(Boolean).slice(0,2).map(x => x[0]).join("").toUpperCase() || "?";
  return `<div class="team-badge" data-side="${side}">
    ${logo ? `<img src="${esc(logo)}" alt="Escudo ${esc(teamName)}" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'">` : ""}
    <span class="team-fallback" ${logo ? 'style="display:none"' : ""}>${esc(initials)}</span>
  </div>`;
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
    const home = match.home_team ?? match.home ?? match.team_home ?? "Local";
    const away = match.away_team ?? match.away ?? match.team_away ?? "Visitante";
    const homeLogo = getTeamLogo(match, "home", home);
    const awayLogo = getTeamLogo(match, "away", away);

    if (!ms.length) {
      return `
        <article class="card match-card">
          <div class="match-header">
            <div class="teams-line">
              ${teamBadge(home, homeLogo, "home")}
              <div class="team-names"><strong>${esc(home)}</strong><span>VS</span><strong>${esc(away)}</strong></div>
              ${teamBadge(away, awayLogo, "away")}
            </div>
            <span class="muted match-date">${esc(getMatchDate(match))}</span>
          </div>
          <div class="empty-state">No hay mercados abiertos.</div>
        </article>`;
    }

    const groups = {};
    ms.forEach(m => (groups[m.category || "Mercados"] ||= []).push(m));

    const marketHtml = Object.entries(groups).map(([category, list]) => `
      <div class="market-group">
        <h3>${esc(category)}</h3>
        <div class="market-list">
          ${list.map(m => {
            const selected = combo.has(String(m.id));
            return `
              <div class="market-row ${selected ? "selected" : ""}">
                <button class="market-main ${selected ? "selected" : ""}" data-market-id="${m.id}" title="Añadir a combinada">
                  <span class="market-name">${esc(m.name)}</span>
                  <span class="odd">${Number(m.odd).toFixed(2)}</span>
                </button>
                <button class="simple-action" data-simple-id="${m.id}" title="Apuesta simple">Simple</button>
              </div>`;
          }).join("")}
        </div>
      </div>
    `).join("");

    return `
      <article class="card match-card">
        <div class="match-header">
          <div class="teams-line">
            ${teamBadge(home, homeLogo, "home")}
            <div class="team-names"><strong>${esc(home)}</strong><span>VS</span><strong>${esc(away)}</strong></div>
            ${teamBadge(away, awayLogo, "away")}
          </div>
          <div class="match-meta">
            <span class="match-live-dot"></span>
            <span class="muted match-date">${esc(getMatchDate(match))}</span>
          </div>
        </div>
        <div class="market-grid">${marketHtml}</div>
      </article>`;
  }).join("");

  root.querySelectorAll("[data-market-id]").forEach(btn => {
    btn.addEventListener("click", () => toggleCombo(btn.dataset.marketId));
  });
  root.querySelectorAll("[data-simple-id]").forEach(btn => {
    btn.addEventListener("click", () => {
      const market = markets.find(m => String(m.id) === String(btn.dataset.simpleId));
      if (market) placeSimpleBet(market);
    });
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

  const count = document.getElementById("comboCount");
  if (count) count.textContent = String(combo.size);

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



// ==========================================================
// PABLO23 BETS - PANEL ADMIN
// ==========================================================
let adminSelectedMatchId = null;
let adminMatches = [];
let adminMarkets = [];

function adminMsg(text, type = "") {
  const el = $("adminMessage");
  if (!el) return;
  el.textContent = text || "";
  el.className = `message ${type}`;
}

function localDateTimeValue(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function adminResetForm() {
  $("adminMatchId").value = "";
  $("adminEditorTitle").textContent = "Nuevo partido";
  $("adminHome").value = "";
  $("adminAway").value = "";
  $("adminDate").value = localDateTimeValue(new Date(Date.now() + 3600000));
  $("adminSport").value = "Fútbol";
  $("adminCompetition").value = "";
  $("adminOddHome").value = "2.00";
  $("adminOddDraw").value = "3.00";
  $("adminOddAway").value = "2.00";
  $("adminStatus").value = "open";
  $("adminResult").value = "";
  $("adminHomeLogo").value = "";
  $("adminAwayLogo").value = "";
  $("adminHomeShirt").value = "";
  $("adminAwayShirt").value = "";
  $("adminMatchImage").value = "";
  $("adminBanner").value = "";
  $("adminFeatured").checked = false;
  $("adminSortOrder").value = "0";
}

function adminFillForm(match) {
  $("adminMatchId").value = match.id;
  $("adminEditorTitle").textContent = `Editar #${match.id}`;
  $("adminHome").value = match.home || "";
  $("adminAway").value = match.away || "";
  $("adminDate").value = localDateTimeValue(match.match_date);
  $("adminSport").value = match.sport || "Fútbol";
  $("adminCompetition").value = match.competition || "";
  $("adminOddHome").value = match.odd_home ?? "2.00";
  $("adminOddDraw").value = match.odd_draw ?? "3.00";
  $("adminOddAway").value = match.odd_away ?? "2.00";
  $("adminStatus").value = match.status || "open";
  $("adminResult").value = match.result || "";
  $("adminHomeLogo").value = match.home_logo_url || "";
  $("adminAwayLogo").value = match.away_logo_url || "";
  $("adminHomeShirt").value = match.home_shirt_url || "";
  $("adminAwayShirt").value = match.away_shirt_url || "";
  $("adminMatchImage").value = match.match_image_url || "";
  $("adminBanner").value = match.banner_url || "";
  $("adminFeatured").checked = Boolean(match.featured);
  $("adminSortOrder").value = match.sort_order ?? 0;
}

async function adminLoadData() {
  if (!profile?.is_admin) return;
  const [mr, kr] = await Promise.all([
    sb.from("matches").select("*").order("featured", { ascending: false }).order("sort_order", { ascending: true }).order("match_date", { ascending: true }),
    sb.from("markets").select("*").order("match_id").order("sort_order").order("id")
  ]);
  if (mr.error) throw mr.error;
  if (kr.error) throw kr.error;
  adminMatches = mr.data || [];
  adminMarkets = kr.data || [];
  renderAdminMatches();
  if (adminSelectedMatchId != null) {
    const selected = adminMatches.find(m => Number(m.id) === Number(adminSelectedMatchId));
    if (selected) renderAdminMarkets(selected);
    else adminSelectedMatchId = null;
  }
}

function renderAdminMatches() {
  const root = $("adminMatchesList");
  if (!root) return;
  $("adminMatchCount").textContent = String(adminMatches.length);
  if (!adminMatches.length) {
    root.innerHTML = `<div class="empty-state">Todavía no hay partidos. Pulsa «Añadir partido».</div>`;
    return;
  }
  root.innerHTML = adminMatches.map(m => {
    const active = Number(adminSelectedMatchId) === Number(m.id);
    const openMarkets = adminMarkets.filter(x => Number(x.match_id) === Number(m.id) && x.is_open).length;
    return `<article class="admin-match-item ${active ? "active" : ""}">
      <div class="admin-match-top">
        <div class="admin-match-teams">${esc(m.home)} <span class="muted">vs</span> ${esc(m.away)}</div>
        <span class="status ${m.status === "open" ? "won" : "pending"}">${esc(m.status || "open")}</span>
      </div>
      <div class="admin-match-meta"><span>${esc(m.sport || "Fútbol")}</span><span>${esc(m.competition || "Sin competición")}</span><span>${esc(getMatchDate(m))}</span><span>${openMarkets} mercados abiertos</span></div>
      <div class="admin-match-actions">
        <button class="btn btn-secondary admin-mini" data-admin-edit="${m.id}">Editar</button>
        <button class="btn btn-ghost admin-mini" data-admin-markets="${m.id}">Cuotas</button>
        <button class="btn btn-ghost admin-mini" data-admin-close="${m.id}">Cerrar mercados</button>
      </div>
    </article>`;
  }).join("");

  root.querySelectorAll("[data-admin-edit]").forEach(b => b.addEventListener("click", () => {
    const m = adminMatches.find(x => Number(x.id) === Number(b.dataset.adminEdit));
    if (!m) return;
    adminSelectedMatchId = Number(m.id);
    adminFillForm(m);
    renderAdminMatches();
    renderAdminMarkets(m);
    $("adminEditor").scrollIntoView({behavior:"smooth", block:"start"});
  }));
  root.querySelectorAll("[data-admin-markets]").forEach(b => b.addEventListener("click", () => {
    const m = adminMatches.find(x => Number(x.id) === Number(b.dataset.adminMarkets));
    if (!m) return;
    adminSelectedMatchId = Number(m.id);
    renderAdminMatches();
    renderAdminMarkets(m);
    $("adminMarkets").scrollIntoView({behavior:"smooth", block:"start"});
  }));
  root.querySelectorAll("[data-admin-close]").forEach(b => b.addEventListener("click", async () => {
    const id = Number(b.dataset.adminClose);
    if (!confirm("¿Cerrar todos los mercados de este partido? No se borrará el historial.")) return;
    await adminAction(async () => {
      const { error } = await sb.rpc("admin_close_match_markets", { p_match_id:id, p_status:"closed" });
      if (error) throw error;
      adminSelectedMatchId = id;
    }, "Mercados cerrados.");
  }));
}

function renderAdminMarkets(match) {
  const toolbar = $("adminMarketToolbar");
  const root = $("adminMarketsList");
  if (!toolbar || !root || !match) return;
  toolbar.classList.remove("hidden");
  $("adminSelectedMatchTitle").textContent = `${match.home} vs ${match.away}`;
  $("adminSelectedMatchMeta").textContent = `${match.sport || "Fútbol"} · ${getMatchDate(match)}`;
  const list = adminMarkets.filter(m => Number(m.match_id) === Number(match.id));
  if (!list.length) {
    root.innerHTML = `<div class="empty-state">No hay mercados. Pulsa «Añadir mercado».</div>`;
    return;
  }
  root.innerHTML = list.map(m => `<div class="admin-market-row" data-market-row="${m.id}">
    <label>Categoría<input data-field="category" value="${esc(m.category || "Resultado")}"></label>
    <label>Nombre / selección<input data-field="name" value="${esc(m.name || "")}"></label>
    <label>Cuota<input data-field="odd" type="number" step="0.01" min="1.01" value="${Number(m.odd).toFixed(2)}"></label>
    <label>Estado<select data-field="open"><option value="true" ${m.is_open ? "selected" : ""}>Abierto</option><option value="false" ${!m.is_open ? "selected" : ""}>Cerrado</option></select></label>
    <div class="market-actions">
      <button class="btn btn-secondary" data-save-market="${m.id}">Guardar</button>
      <button class="btn btn-ghost" data-resolve-market="${m.id}">Resolver</button>
    </div>
  </div>`).join("");

  root.querySelectorAll("[data-save-market]").forEach(b => b.addEventListener("click", async () => {
    const row = b.closest("[data-market-row]");
    const id = Number(b.dataset.saveMarket);
    await adminAction(async () => {
      const { error } = await sb.rpc("admin_update_market", {
        p_market_id:id,
        p_category:row.querySelector('[data-field="category"]').value.trim(),
        p_name:row.querySelector('[data-field="name"]').value.trim(),
        p_odd:Number(row.querySelector('[data-field="odd"]').value),
        p_is_open:row.querySelector('[data-field="open"]').value === "true",
        p_sort_order:0
      });
      if (error) throw error;
    }, "Mercado y cuota actualizados.");
  }));

  root.querySelectorAll("[data-resolve-market]").forEach(b => b.addEventListener("click", async () => {
    const id = Number(b.dataset.resolveMarket);
    const m = adminMarkets.find(x => Number(x.id) === id);
    if (!m) return;
    const winner = prompt(`Resultado exacto para «${m.name}».\n\nDebe coincidir con la selección apostada.`, m.name);
    if (winner === null || !winner.trim()) return;
    if (!confirm(`¿Resolver «${m.name}» como «${winner.trim()}»? Esto liquida simples y afecta a las combinadas.`)) return;
    await adminAction(async () => {
      const { error } = await sb.rpc("resolve_single_market", { p_market_id:id, p_winner:winner.trim() });
      if (error) throw error;
    }, "Mercado resuelto y apuestas liquidadas.");
  }));
}

async function adminAction(action, successText) {
  loading(true);
  try {
    await action();
    adminMsg(successText, "ok");
    await adminLoadData();
    await loadData();
  } catch (e) {
    console.error(e);
    adminMsg(e.message || "No se pudo completar la acción.", "error");
  } finally {
    loading(false);
  }
}

async function adminSaveMatch(e) {
  e.preventDefault();
  const id = Number($("adminMatchId").value || 0);
  const values = {
    p_home:$("adminHome").value.trim(), p_away:$("adminAway").value.trim(),
    p_match_date:new Date($("adminDate").value).toISOString(), p_status:$("adminStatus").value,
    p_odd_home:Number($("adminOddHome").value), p_odd_draw:Number($("adminOddDraw").value), p_odd_away:Number($("adminOddAway").value),
    p_result:$("adminResult").value || null, p_sport:$("adminSport").value.trim() || "Fútbol", p_competition:$("adminCompetition").value.trim() || null,
    p_home_logo_url:$("adminHomeLogo").value.trim() || null, p_away_logo_url:$("adminAwayLogo").value.trim() || null,
    p_home_shirt_url:$("adminHomeShirt").value.trim() || null, p_away_shirt_url:$("adminAwayShirt").value.trim() || null,
    p_match_image_url:$("adminMatchImage").value.trim() || null, p_banner_url:$("adminBanner").value.trim() || null,
    p_featured:$("adminFeatured").checked, p_sort_order:Number($("adminSortOrder").value || 0)
  };
  if (Object.values(values).some(v => v === undefined)) return;
  await adminAction(async () => {
    const rpc = id ? "admin_update_match" : "admin_create_match";
    const params = id ? { p_match_id:id, ...values } : values;
    const { error } = await sb.rpc(rpc, params);
    if (error) throw error;
  }, id ? "Partido actualizado." : "Partido creado.");
  adminResetForm();
}

async function adminAddMarket() {
  if (!adminSelectedMatchId) {
    adminMsg("Selecciona primero un partido.", "error");
    return;
  }
  const category = prompt("Categoría: Resultado, Goles, Córners, Remates, A puerta, Tarjetas o Jugadores", "Resultado");
  if (!category) return;
  const name = prompt("Nombre de la selección / mercado", "Gana local");
  if (!name) return;
  const odd = Number(prompt("Cuota", "2.00"));
  if (!Number.isFinite(odd) || odd <= 1) { adminMsg("La cuota debe ser mayor que 1.", "error"); return; }
  await adminAction(async () => {
    const { error } = await sb.rpc("admin_create_market", { p_match_id:Number(adminSelectedMatchId), p_category:category.trim(), p_name:name.trim(), p_odd:odd, p_is_open:true, p_sort_order:0 });
    if (error) throw error;
  }, "Mercado creado.");
}

function initAdminPanel() {
  const panel = $("adminPanel");
  if (!panel) return;
  const isAdmin = Boolean(profile?.is_admin);
  panel.classList.toggle("hidden", !isAdmin);
  if (!isAdmin) return;

  $("adminNewMatchBtn").onclick = () => { adminResetForm(); $("adminEditor").scrollIntoView({behavior:"smooth", block:"start"}); };
  $("adminCancelEditBtn").onclick = adminResetForm;
  $("adminRefreshBtn").onclick = () => adminAction(adminLoadData, "Panel actualizado.");
  $("adminMatchForm").onsubmit = adminSaveMatch;
  $("adminAddMarketBtn").onclick = adminAddMarket;
  adminResetForm();
  adminLoadData().catch(e => adminMsg(e.message || "No se pudo cargar el panel admin.", "error"));
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
    initAdminPanel();
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
