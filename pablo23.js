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
    ? [match.home_logo_url, match.home_logo, match.home_team_logo, match.home_crest, match.home_badge, match.home_image]
    : [match.away_logo_url, match.away_logo, match.away_team_logo, match.away_crest, match.away_badge, match.away_image];
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
  // Cargamos el perfil y comprobamos el admin también mediante la función
  // segura de Supabase. Así el panel no depende de cómo llegue el objeto
  // devuelto por el SELECT y no falla aunque haya caché o cambios de sesión.
  const { data, error } = await sb.from("profiles")
    .select("id,username,balance,is_admin")
    .eq("id", currentUser.id)
    .maybeSingle();

  if (error) throw error;

  profile = data || null;

  let adminFlag = Boolean(profile?.is_admin);
  try {
    const { data: secureAdmin, error: adminError } = await sb.rpc("is_admin");
    if (!adminError) adminFlag = Boolean(secureAdmin);
  } catch (_) {
    // Si la RPC no estuviera disponible, usamos is_admin del perfil.
  }

  if (profile) profile.is_admin = adminFlag;

  $("userName").textContent = profile?.username || currentUser.email;
  $("balance").textContent = adminFlag ? "ADMIN" : `${money(profile?.balance)} créditos`;

  // Mostrar/ocultar inmediatamente el panel según el permiso real.
  const panel = $("adminPanel");
  const adminTopBtn = $("adminTopBtn");
  if (panel) panel.classList.toggle("hidden", !adminFlag);
  if (adminTopBtn) adminTopBtn.classList.toggle("hidden", !adminFlag);
  if (adminTopBtn) adminTopBtn.onclick = () => panel?.scrollIntoView({behavior:"smooth", block:"start"});
}

async function loadData() {
  loading(true);
  try {
    try { await sb.rpc("expire_supercuotas"); } catch (_) {}
    const [matchesRes, marketsRes, superRes] = await Promise.all([
      sb.from("matches").select("*").order("id", { ascending: true }),
      sb.from("markets").select("*").eq("is_open", true).order("match_id").order("sort_order").order("id"),
      sb.from("supercuotas").select("*").eq("active", true).order("sort_order").order("id")
    ]);

    if (matchesRes.error) throw matchesRes.error;
    if (marketsRes.error) throw marketsRes.error;
    if (superRes.error && !String(superRes.error.message || "").includes("supercuotas")) throw superRes.error;

    matches = matchesRes.data || [];
    markets = marketsRes.data || [];
    adminSupercuotas = superRes.data || [];
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
                  <span class="market-name">${esc(m.name)}${(() => {
                    const s = adminSupercuotas.find(x => Number(x.market_id) === Number(m.id));
                    return s ? `<span class="super-badge">⚡ ${esc(s.label || "SUPERCUOTA")}</span>` : "";
                  })()}</span>
                  <span class="odd-wrap">${(() => {
                    const s = adminSupercuotas.find(x => Number(x.market_id) === Number(m.id));
                    return s ? `<del class="old-odd">${Number(s.original_odd).toFixed(2)}</del><span class="odd super-odd">${Number(m.odd).toFixed(2)}</span>` : `<span class="odd">${Number(m.odd).toFixed(2)}</span>`;
                  })()}</span>
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
            ${match.is_live ? `<span class="live-pill">● DIRECTO${match.live_minute != null ? ` ${esc(match.live_minute)}'` : ""}</span>` : ""}
            ${(match.score_home != null && match.score_away != null && (Number(match.score_home) !== 0 || Number(match.score_away) !== 0 || match.is_live || match.status === "finished"))
              ? `<span class="live-score">${Number(match.score_home)} - ${Number(match.score_away)}</span>` : ""}
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
let adminSupercuotas = [];
let adminDraftMarkets = [];
const ADMIN_DRAFT_KEY = "pablo23_admin_match_draft_v1";

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

function readAdminDraft() {
  try { return JSON.parse(localStorage.getItem(ADMIN_DRAFT_KEY) || "null"); } catch { return null; }
}

function draftFormValues() {
  return {
    home:$('adminHome')?.value || "", away:$('adminAway')?.value || "",
    date:$('adminDate')?.value || "", sport:$('adminSport')?.value || "Fútbol",
    competition:$('adminCompetition')?.value || "", oddHome:$('adminOddHome')?.value || "2.00",
    oddDraw:$('adminOddDraw')?.value || "3.00", oddAway:$('adminOddAway')?.value || "2.00",
    status:$('adminStatus')?.value || "open", result:$('adminResult')?.value || "",
    scoreHome:$('adminScoreHome')?.value || "", scoreAway:$('adminScoreAway')?.value || "",
    homeLogo:$('adminHomeLogo')?.value || "", awayLogo:$('adminAwayLogo')?.value || "",
    homeShirt:$('adminHomeShirt')?.value || "", awayShirt:$('adminAwayShirt')?.value || "",
    matchImage:$('adminMatchImage')?.value || "", banner:$('adminBanner')?.value || "",
    featured:Boolean($('adminFeatured')?.checked), sortOrder:$('adminSortOrder')?.value || "0"
  };
}

function saveAdminDraft() {
  if (!$('adminMatchId') || $('adminMatchId').value) return;
  try {
    localStorage.setItem(ADMIN_DRAFT_KEY, JSON.stringify({form:draftFormValues(), markets:adminDraftMarkets}));
  } catch (e) { console.warn('No se pudo guardar el borrador', e); }
}

function clearAdminDraft() {
  localStorage.removeItem(ADMIN_DRAFT_KEY);
  adminDraftMarkets = [];
}

function restoreAdminDraft() {
  const draft = readAdminDraft();
  if (!draft?.form) return false;
  const f = draft.form;
  $('adminMatchId').value = "";
  $('adminEditorTitle').textContent = "Nuevo partido · Borrador recuperado";
  $('adminHome').value = f.home || "";
  $('adminAway').value = f.away || "";
  $('adminDate').value = f.date || localDateTimeValue(new Date(Date.now() + 3600000));
  $('adminSport').value = f.sport || "Fútbol";
  $('adminCompetition').value = f.competition || "";
  $('adminOddHome').value = f.oddHome || "2.00";
  $('adminOddDraw').value = f.oddDraw || "3.00";
  $('adminOddAway').value = f.oddAway || "2.00";
  $('adminStatus').value = f.status || "open";
  $('adminResult').value = f.result || "";
  $('adminScoreHome').value = f.scoreHome || "";
  $('adminScoreAway').value = f.scoreAway || "";
  $('adminHomeLogo').value = f.homeLogo || "";
  $('adminAwayLogo').value = f.awayLogo || "";
  $('adminHomeShirt').value = f.homeShirt || "";
  $('adminAwayShirt').value = f.awayShirt || "";
  $('adminMatchImage').value = f.matchImage || "";
  $('adminBanner').value = f.banner || "";
  $('adminFeatured').checked = Boolean(f.featured);
  $('adminSortOrder').value = f.sortOrder ?? 0;
  adminDraftMarkets = Array.isArray(draft.markets) ? draft.markets : [];
  renderDraftMarkets();
  return true;
}

function adminResetForm({keepDraft=false} = {}) {
  if (!keepDraft) clearAdminDraft();
  $('adminMatchId').value = "";
  $('adminEditorTitle').textContent = "Nuevo partido";
  $('adminHome').value = "";
  $('adminAway').value = "";
  $('adminDate').value = localDateTimeValue(new Date(Date.now() + 3600000));
  $('adminSport').value = "Fútbol";
  $('adminCompetition').value = "";
  $('adminOddHome').value = "2.00";
  $('adminOddDraw').value = "3.00";
  $('adminOddAway').value = "2.00";
  $('adminStatus').value = "open";
  $('adminResult').value = "";
  $('adminScoreHome').value = "";
  $('adminScoreAway').value = "";
  $('adminHomeLogo').value = "";
  $('adminAwayLogo').value = "";
  $('adminHomeShirt').value = "";
  $('adminAwayShirt').value = "";
  $('adminMatchImage').value = "";
  $('adminBanner').value = "";
  $('adminFeatured').checked = false;
  $('adminSortOrder').value = "0";
  if (!keepDraft) renderDraftMarkets();
}

function adminFillForm(match) {
  clearAdminDraft();
  $('adminMatchId').value = match.id;
  $('adminEditorTitle').textContent = `Editar #${match.id}`;
  $('adminHome').value = match.home || "";
  $('adminAway').value = match.away || "";
  $('adminDate').value = localDateTimeValue(match.match_date);
  $('adminSport').value = match.sport || "Fútbol";
  $('adminCompetition').value = match.competition || "";
  $('adminOddHome').value = match.odd_home ?? "2.00";
  $('adminOddDraw').value = match.odd_draw ?? "3.00";
  $('adminOddAway').value = match.odd_away ?? "2.00";
  $('adminStatus').value = match.status || "open";
  $('adminResult').value = match.result || "";
  $('adminScoreHome').value = match.score_home ?? "";
  $('adminScoreAway').value = match.score_away ?? "";
  $('adminHomeLogo').value = match.home_logo_url || "";
  $('adminAwayLogo').value = match.away_logo_url || "";
  $('adminHomeShirt').value = match.home_shirt_url || "";
  $('adminAwayShirt').value = match.away_shirt_url || "";
  $('adminMatchImage').value = match.match_image_url || "";
  $('adminBanner').value = match.banner_url || "";
  $('adminFeatured').checked = Boolean(match.featured);
  $('adminSortOrder').value = match.sort_order ?? 0;
  renderAdminMarkets(match);
}

async function adminLoadData() {
  if (!profile?.is_admin) return;
  const [mr, kr, sr] = await Promise.all([
    sb.from("matches").select("*").order("featured", { ascending: false }).order("sort_order", { ascending: true }).order("match_date", { ascending: true }),
    sb.from("markets").select("*").order("match_id").order("sort_order").order("id"),
    sb.from("supercuotas").select("*").order("sort_order").order("id")
  ]);
  if (mr.error) throw mr.error;
  if (kr.error) throw kr.error;
  if (sr.error) throw sr.error;
  adminMatches = mr.data || [];
  adminMarkets = kr.data || [];
  adminSupercuotas = sr.data || [];
  renderAdminMatches();
  if (adminSelectedMatchId != null) {
    const selected = adminMatches.find(m => Number(m.id) === Number(adminSelectedMatchId));
    if (selected) renderAdminMarkets(selected);
    else adminSelectedMatchId = null;
  }
}

function adminMatchMenu(m) {
  return `<div class="admin-match-menu-wrap">
    <button class="admin-kebab" type="button" aria-label="Opciones de ${esc(m.home)} vs ${esc(m.away)}" data-admin-menu="${m.id}">⋮</button>
    <div class="admin-match-menu hidden" data-admin-menu-panel="${m.id}">
      <button type="button" data-admin-edit="${m.id}">✏️ Editar partido</button>
      <button type="button" data-admin-markets="${m.id}">🎯 Gestionar selecciones</button>
      <button type="button" data-admin-close="${m.id}">🔒 Cerrar apuestas</button>
      <button type="button" data-admin-result="${m.id}">🏁 Resultado final</button>
      <button type="button" data-admin-live="${m.id}">⚽ Gestionar directo</button>
      <div class="admin-menu-divider"></div>
      <button type="button" class="danger-item" data-admin-delete-match="${m.id}">🗑️ Eliminar partido</button>
    </div>
  </div>`;
}

function renderAdminMatches() {
  const root = $('adminMatchesList');
  if (!root) return;
  $('adminMatchCount').textContent = String(adminMatches.length);
  if (!adminMatches.length) {
    root.innerHTML = `<div class="empty-state">Todavía no hay partidos. Pulsa «Añadir partido».</div>`;
    return;
  }
  root.innerHTML = adminMatches.map(m => {
    const active = Number(adminSelectedMatchId) === Number(m.id);
    const openMarkets = adminMarkets.filter(x => Number(x.match_id) === Number(m.id) && x.is_open).length;
    const homeLogo = getTeamLogo(m, 'home', m.home);
    const awayLogo = getTeamLogo(m, 'away', m.away);
    return `<article class="admin-match-item ${active ? 'active' : ''}">
      <div class="admin-match-top">
        <div class="admin-match-teams-row">
          ${teamBadge(m.home, homeLogo, 'home')}
          <div class="admin-match-teams">${esc(m.home)} <span class="muted">vs</span> ${esc(m.away)}</div>
          ${teamBadge(m.away, awayLogo, 'away')}
        </div>
        <div class="admin-match-menu-slot">${adminMatchMenu(m)}</div>
      </div>
      <div class="admin-match-meta">
        <span>${esc(m.sport || 'Fútbol')}</span><span>${esc(m.competition || 'Sin competición')}</span>
        <span>${esc(getMatchDate(m))}</span><span>${openMarkets} mercados abiertos</span>
        <span class="admin-live-score">Marcador: <strong>${Number(m.score_home ?? 0)} - ${Number(m.score_away ?? 0)}</strong>${m.is_live ? ` · ${m.live_minute ?? '?' }' DIRECTO` : ''}</span>
      </div>
      <div class="admin-live-controls hidden" data-live-match="${m.id}">
        <input type="number" min="0" step="1" data-live-home value="${Number(m.score_home ?? 0)}" aria-label="Goles local">
        <span>-</span>
        <input type="number" min="0" step="1" data-live-away value="${Number(m.score_away ?? 0)}" aria-label="Goles visitante">
        <input type="number" min="0" step="1" data-live-minute value="${m.live_minute ?? ''}" placeholder="Min" aria-label="Minuto">
        <button class="btn btn-secondary admin-mini" data-live-update="${m.id}">⚽ Actualizar</button>
        <button class="btn btn-ghost admin-mini" data-live-toggle="${m.id}">${m.is_live ? '⏹ Parar directo' : '🔴 Poner directo'}</button>
        <button class="btn btn-ghost admin-mini" data-live-finish="${m.id}">🏁 Finalizar</button>
      </div>
    </article>`;
  }).join('');

  root.querySelectorAll('[data-admin-menu]').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    const id = btn.dataset.adminMenu;
    root.querySelectorAll('.admin-match-menu').forEach(menu => {
      if (menu.dataset.adminMenuPanel === id) menu.classList.toggle('hidden');
      else menu.classList.add('hidden');
    });
  }));
  root.querySelectorAll('[data-admin-live]').forEach(b => b.addEventListener('click', () => {
    const box = root.querySelector(`[data-live-match="${b.dataset.adminLive}"]`);
    if (box) box.classList.toggle('hidden');
    b.closest('.admin-match-menu')?.classList.add('hidden');
  }));

  root.querySelectorAll('[data-live-update]').forEach(b => b.addEventListener('click', async () => {
    const id = Number(b.dataset.liveUpdate), box = root.querySelector(`[data-live-match="${id}"]`);
    const home = Number(box.querySelector('[data-live-home]').value), away = Number(box.querySelector('[data-live-away]').value);
    const minuteRaw = box.querySelector('[data-live-minute]').value.trim();
    const minute = minuteRaw === '' ? null : Number(minuteRaw);
    if (!Number.isInteger(home) || home < 0 || !Number.isInteger(away) || away < 0 || (minute !== null && (!Number.isInteger(minute) || minute < 0))) { adminMsg('Marcador/minuto no válidos.', 'error'); return; }
    await adminAction(async () => { const {error}=await sb.rpc('admin_update_live_result',{p_match_id:id,p_score_home:home,p_score_away:away,p_live_minute:minute,p_is_live:true,p_status:null}); if(error) throw error; }, 'Marcador actualizado en directo.');
  }));
  root.querySelectorAll('[data-live-toggle]').forEach(b => b.addEventListener('click', async () => {
    const id=Number(b.dataset.liveToggle), m=adminMatches.find(x=>Number(x.id)===id), next=!Boolean(m?.is_live);
    await adminAction(async()=>{const {error}=await sb.rpc('admin_set_match_live',{p_match_id:id,p_is_live:next});if(error)throw error;},next?'Partido puesto en DIRECTO.':'Partido sacado de DIRECTO.');
  }));
  root.querySelectorAll('[data-live-finish]').forEach(b => b.addEventListener('click', async () => {
    const id=Number(b.dataset.liveFinish), box=root.querySelector(`[data-live-match="${id}"]`), home=Number(box.querySelector('[data-live-home]').value), away=Number(box.querySelector('[data-live-away]').value);
    if(!Number.isInteger(home)||home<0||!Number.isInteger(away)||away<0){adminMsg('Marcador no válido.','error');return;}
    if(!confirm(`¿Finalizar el partido con ${home}-${away}?`))return;
    await adminAction(async()=>{const {error}=await sb.rpc('admin_finish_match',{p_match_id:id,p_score_home:home,p_score_away:away});if(error)throw error;},'Partido finalizado y resultado guardado.');
  }));
  root.querySelectorAll('[data-admin-edit]').forEach(b => b.addEventListener('click', () => {
    const m=adminMatches.find(x=>Number(x.id)===Number(b.dataset.adminEdit)); if(!m)return;
    adminSelectedMatchId=Number(m.id); adminFillForm(m); renderAdminMatches(); $('adminEditor').scrollIntoView({behavior:'smooth',block:'start'}); closeAdminMenus();
  }));
  root.querySelectorAll('[data-admin-markets]').forEach(b => b.addEventListener('click', () => {
    const m=adminMatches.find(x=>Number(x.id)===Number(b.dataset.adminMarkets)); if(!m)return;
    adminSelectedMatchId=Number(m.id); renderAdminMatches(); renderAdminMarkets(m); $('adminMarkets').scrollIntoView({behavior:'smooth',block:'start'}); closeAdminMenus();
  }));
  root.querySelectorAll('[data-admin-close]').forEach(b => b.addEventListener('click', async () => {
    const id=Number(b.dataset.adminClose); if(!confirm('¿Cerrar todos los mercados de este partido? No se borrará el historial.'))return;
    await adminAction(async()=>{const {error}=await sb.rpc('admin_close_match_markets',{p_match_id:id,p_status:'closed'});if(error)throw error;adminSelectedMatchId=id;},'Mercados cerrados.');
  }));
  root.querySelectorAll('[data-admin-result]').forEach(b => b.addEventListener('click', async () => {
    const id=Number(b.dataset.adminResult),m=adminMatches.find(x=>Number(x.id)===id);if(!m)return;
    const scoreHome=prompt(`Goles de ${m.home}`,m.score_home??'0');if(scoreHome===null)return;
    const scoreAway=prompt(`Goles de ${m.away}`,m.score_away??'0');if(scoreAway===null)return;
    await adminAction(async()=>{const {error}=await sb.rpc('admin_finish_match',{p_match_id:id,p_score_home:Number(scoreHome),p_score_away:Number(scoreAway)});if(error)throw error;},'Resultado final actualizado.');
  }));
  root.querySelectorAll('[data-admin-delete-match]').forEach(b => b.addEventListener('click', async () => {
    const id=Number(b.dataset.adminDeleteMatch);
    if(!confirm('¿Eliminar este partido definitivamente? Si ya tiene apuestas o combinadas, se conservará el historial y Supabase impedirá el borrado.'))return;
    await adminAction(async()=>{const {error}=await sb.rpc('admin_delete_match',{p_match_id:id});if(error)throw error;if(Number(adminSelectedMatchId)===id)adminSelectedMatchId=null;},'Partido eliminado.');
  }));
}

function closeAdminMenus(){ document.querySelectorAll('.admin-match-menu').forEach(x=>x.classList.add('hidden')); }
document.addEventListener('click', e => { if(!e.target.closest('.admin-match-menu-wrap')) closeAdminMenus(); });

function renderDraftMarkets() {
  const root = $('adminMarketsList');
  const toolbar = $('adminMarketToolbar');
  if (!root || $('adminMatchId').value) return;
  toolbar?.classList.remove('hidden');
  $('adminSelectedMatchTitle').textContent = $('adminHome').value && $('adminAway').value ? `${$('adminHome').value} vs ${$('adminAway').value}` : 'Borrador de partido';
  $('adminSelectedMatchMeta').textContent = 'Las selecciones se guardan en este borrador hasta crear el partido.';
  if (!adminDraftMarkets.length) { root.innerHTML = `<div class="empty-state">No hay selecciones en el borrador. Pulsa «＋ Añadir mercado».</div>`; return; }
  root.innerHTML = adminDraftMarkets.map((m,i)=>`<div class="admin-market-row draft-market-row" data-draft-market="${i}">
    <label>Categoría<input data-field="category" value="${esc(m.category||'Resultado')}"></label>
    <label>Nombre / selección<input data-field="name" value="${esc(m.name||'')}"></label>
    <label>Cuota<input data-field="odd" type="number" step="0.01" min="1.01" value="${Number(m.odd||2).toFixed(2)}"></label>
    <label>Estado<select data-field="open"><option value="true" ${m.is_open!==false?'selected':''}>Abierto</option><option value="false" ${m.is_open===false?'selected':''}>Cerrado</option></select></label>
    <div class="market-actions"><button class="btn btn-secondary" data-save-draft-market="${i}">Guardar</button><button class="btn btn-danger" data-delete-draft-market="${i}">Borrar</button></div>
  </div>`).join('');
  root.querySelectorAll('[data-save-draft-market]').forEach(b=>b.addEventListener('click',()=>{const row=b.closest('[data-draft-market]'),i=Number(b.dataset.saveDraftMarket);adminDraftMarkets[i]={...adminDraftMarkets[i],category:row.querySelector('[data-field="category"]').value.trim(),name:row.querySelector('[data-field="name"]').value.trim(),odd:Number(row.querySelector('[data-field="odd"]').value),is_open:row.querySelector('[data-field="open"]').value==='true'};saveAdminDraft();adminMsg('Selección guardada en el borrador.','ok');renderDraftMarkets();}));
  root.querySelectorAll('[data-delete-draft-market]').forEach(b=>b.addEventListener('click',()=>{adminDraftMarkets.splice(Number(b.dataset.deleteDraftMarket),1);saveAdminDraft();renderDraftMarkets();}));
}

function renderAdminMarkets(match) {
  const toolbar = $("adminMarketToolbar");
  const root = $("adminMarketsList");
  const superRoot = $("adminSuperList");
  if (!toolbar || !root || !match) return;

  toolbar.classList.remove("hidden");
  $("adminSelectedMatchTitle").textContent = `${match.home} vs ${match.away}`;
  $("adminSelectedMatchMeta").textContent = `${match.sport || "Fútbol"} · ${getMatchDate(match)}`;

  const list = adminMarkets.filter(m => Number(m.match_id) === Number(match.id));

  if (!list.length) {
    root.innerHTML = `<div class="empty-state">No hay mercados. Pulsa «Añadir mercado».</div>`;
    if (superRoot) superRoot.innerHTML = `<div class="empty-state">Crea un mercado primero.</div>`;
    return;
  }

  root.innerHTML = list.map(m => {
    const s = adminSupercuotas.find(x => Number(x.market_id) === Number(m.id));
    return `<div class="admin-market-row" data-market-row="${m.id}">
      <label>Categoría<input data-field="category" value="${esc(m.category || "Resultado")}"></label>
      <label>Nombre / selección<input data-field="name" value="${esc(m.name || "")}"></label>
      <label>Cuota<input data-field="odd" type="number" step="0.01" min="1.01" value="${Number(m.odd).toFixed(2)}"></label>
      <label>Estado<select data-field="open"><option value="true" ${m.is_open ? "selected" : ""}>Abierto</option><option value="false" ${!m.is_open ? "selected" : ""}>Cerrado</option></select></label>
      <div class="market-actions">
        <button class="btn btn-secondary" data-save-market="${m.id}">Guardar</button>
        <button class="btn btn-ghost" data-pass-market="${m.id}">🟢 Ha pasado</button>
        <button class="btn btn-ghost" data-fail-market="${m.id}">🔴 No ha pasado</button>
        <button class="btn btn-ghost" data-super-market="${m.id}">⚡ ${s?.active ? "Editar supercuota" : "Supercuota"}</button>
        <button class="btn btn-danger" data-delete-market="${m.id}">Borrar</button>
      </div>
    </div>`;
  }).join("");

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

  root.querySelectorAll("[data-pass-market]").forEach(b => b.addEventListener("click", async () => {
    const id = Number(b.dataset.passMarket);
    const m = adminMarkets.find(x => Number(x.id) === id);
    if (!m) return;
    if (!confirm(`¿Marcar «${m.name}» como 🟢 HA PASADO?\n\nLas apuestas a esta selección ganarán y las otras selecciones del mismo mercado quedarán perdedoras.`)) return;
    await adminAction(async () => {
      const { error } = await sb.rpc("resolve_single_market", { p_market_id:id, p_winner:m.name });
      if (error) throw error;
    }, "Selección marcada como válida y apuestas liquidadas.");
  }));

  root.querySelectorAll("[data-fail-market]").forEach(b => b.addEventListener("click", async () => {
    const id = Number(b.dataset.failMarket);
    const m = adminMarkets.find(x => Number(x.id) === id);
    if (!m) return;
    if (!confirm(`¿Marcar «${m.name}» como 🔴 NO HA PASADO?\n\nLas apuestas a esta selección perderán. Las demás selecciones del mercado permanecen pendientes.`)) return;
    await adminAction(async () => {
      const { error } = await sb.rpc("admin_mark_selection_lost", { p_market_id:id, p_selection:m.name });
      if (error) throw error;
    }, "Selección marcada como no válida.");
  }));

  root.querySelectorAll("[data-delete-market]").forEach(b => b.addEventListener("click", async () => {
    const id = Number(b.dataset.deleteMarket);
    if (!confirm("¿Borrar esta cuota? Si ya tiene apuestas o está en combinadas, Supabase bloqueará el borrado para proteger el historial.")) return;
    await adminAction(async () => {
      const { error } = await sb.rpc("admin_delete_market", { p_market_id:id });
      if (error) throw error;
    }, "Cuota borrada.");
  }));

  root.querySelectorAll("[data-super-market]").forEach(b => b.addEventListener("click", async () => {
    const id = Number(b.dataset.superMarket);
    const m = adminMarkets.find(x => Number(x.id) === id);
    if (!m) return;
    const existing = adminSupercuotas.find(x => Number(x.market_id) === id);
    const odd = Number(prompt("Nueva SUPERCUOTA", existing?.super_odd ?? Math.max(1.01, Number(m.odd) - 0.50).toFixed(2)));
    if (!Number.isFinite(odd) || odd <= 1) { adminMsg("La supercuota debe ser mayor que 1.", "error"); return; }
    const label = prompt("Etiqueta", existing?.label || "SUPERCUOTA");
    if (label === null) return;
    const image = prompt("URL imagen (opcional)", existing?.image_url || "");
    if (image === null) return;
    const banner = prompt("URL banner (opcional)", existing?.banner_url || "");
    if (banner === null) return;
    const expires = prompt("Expira en ISO (opcional), ejemplo 2026-08-12T23:59:00+02:00", existing?.expires_at || "");
    if (expires === null) return;
    await adminAction(async () => {
      const { error } = await sb.rpc("admin_set_supercuota", {
        p_market_id:id, p_super_odd:odd, p_label:label.trim() || "SUPERCUOTA",
        p_image_url:image.trim() || null, p_banner_url:banner.trim() || null,
        p_expires_at:expires.trim() || null, p_sort_order:0
      });
      if (error) throw error;
    }, "Supercuota activada.");
  }));

  if (superRoot) {
    const active = adminSupercuotas.filter(s => list.some(m => Number(m.id) === Number(s.market_id)));
    superRoot.innerHTML = active.length ? active.map(s => {
      const m = list.find(x => Number(x.id) === Number(s.market_id));
      return `<div class="admin-super-item">
        <div><span class="super-badge">⚡ ${esc(s.label || "SUPERCUOTA")}</span><strong>${esc(m?.name || "Mercado")}</strong><div class="muted">Normal ${Number(s.original_odd).toFixed(2)} → Super ${Number(s.super_odd).toFixed(2)}</div></div>
        <button class="btn btn-ghost admin-mini" data-toggle-super="${s.market_id}">Desactivar</button>
      </div>`;
    }).join("") : `<div class="empty-state">No hay supercuotas activas en este partido.</div>`;

    superRoot.querySelectorAll("[data-toggle-super]").forEach(b => b.addEventListener("click", async () => {
      const id = Number(b.dataset.toggleSuper);
      if (!confirm("¿Desactivar esta supercuota y restaurar la cuota original?")) return;
      await adminAction(async () => {
        const { error } = await sb.rpc("admin_toggle_supercuota", { p_market_id:id, p_active:false });
        if (error) throw error;
      }, "Supercuota desactivada.");
    }));
  }
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
    const { data: createdId, error } = await sb.rpc(rpc, params);
    if (error) throw error;
    const matchId = id || Number(createdId);
    if (!id && matchId && adminDraftMarkets.length) {
      for (const market of adminDraftMarkets) {
        const { error: marketError } = await sb.rpc("admin_create_market", {
          p_match_id:matchId, p_category:market.category, p_name:market.name, p_odd:Number(market.odd),
          p_is_open:Boolean(market.is_open), p_sort_order:Number(market.sort_order || 0)
        });
        if (marketError) throw marketError;
      }
    }
    if (matchId && ($("adminScoreHome").value !== "" || $("adminScoreAway").value !== "" || $("adminResult").value)) {
      const { error: scoreError } = await sb.rpc("admin_update_match_result", {
        p_match_id:matchId,
        p_score_home:$("adminScoreHome").value === "" ? null : Number($("adminScoreHome").value),
        p_score_away:$("adminScoreAway").value === "" ? null : Number($("adminScoreAway").value),
        p_result:$("adminResult").value || null,
        p_status:$("adminStatus").value
      });
      if (scoreError) throw scoreError;
    }
  }, id ? "Partido actualizado." : "Partido creado.");
  clearAdminDraft();
  adminResetForm({keepDraft:true});
}

async function adminAddMarket() {
  const category = prompt('Categoría: Resultado, Goles, Córners, Remates, A puerta, Tarjetas o Jugadores', 'Resultado');
  if (!category) return;
  const name = prompt('Nombre de la selección / mercado', 'Gana local');
  if (!name) return;
  const odd = Number(prompt('Cuota', '2.00'));
  if (!Number.isFinite(odd) || odd <= 1) { adminMsg('La cuota debe ser mayor que 1.', 'error'); return; }
  if (!adminSelectedMatchId && !$('adminMatchId').value) {
    adminDraftMarkets.push({category:category.trim(),name:name.trim(),odd,is_open:true,sort_order:adminDraftMarkets.length});
    saveAdminDraft(); renderDraftMarkets(); adminMsg('Selección añadida al borrador. No se perderá al salir.', 'ok'); return;
  }
  if (!adminSelectedMatchId) { adminMsg('Selecciona primero un partido.', 'error'); return; }
  await adminAction(async()=>{const {error}=await sb.rpc('admin_create_market',{p_match_id:Number(adminSelectedMatchId),p_category:category.trim(),p_name:name.trim(),p_odd:odd,p_is_open:true,p_sort_order:0});if(error)throw error;},'Mercado creado.');
}


function initAdminPanel() {
  const panel = $('adminPanel'); if (!panel) return;
  const isAdmin = Boolean(profile?.is_admin);
  panel.classList.toggle('hidden', !isAdmin);
  const adminTopBtn = $('adminTopBtn');
  if (adminTopBtn) { adminTopBtn.classList.toggle('hidden', !isAdmin); adminTopBtn.onclick=()=>panel.scrollIntoView({behavior:'smooth',block:'start'}); }
  if (!isAdmin) return;
  $('adminNewMatchBtn').onclick=()=>{adminSelectedMatchId=null;adminResetForm({keepDraft:true});restoreAdminDraft();$('adminEditor').scrollIntoView({behavior:'smooth',block:'start'});};
  $('adminCancelEditBtn').onclick=()=>{
    if (!$('adminMatchId').value && (draftFormValues().home || draftFormValues().away || adminDraftMarkets.length || draftFormValues().homeLogo || draftFormValues().matchImage || draftFormValues().banner)) {
      saveAdminDraft(); adminMsg('Borrador guardado. Puedes salir y volver sin perder selecciones ni imágenes.','ok'); return;
    }
    adminResetForm(); adminSelectedMatchId=null;
  };
  $('adminRefreshBtn').onclick=()=>adminAction(adminLoadData,'Panel actualizado.');
  $('adminMatchForm').onsubmit=adminSaveMatch;
  $('adminAddMarketBtn').onclick=adminAddMarket;
  const draftInputs=['adminHome','adminAway','adminDate','adminSport','adminCompetition','adminOddHome','adminOddDraw','adminOddAway','adminStatus','adminResult','adminScoreHome','adminScoreAway','adminHomeLogo','adminAwayLogo','adminHomeShirt','adminAwayShirt','adminMatchImage','adminBanner','adminSortOrder'];
  draftInputs.forEach(id=>$(id)?.addEventListener('input',saveAdminDraft));
  $('adminFeatured')?.addEventListener('change',saveAdminDraft);
  adminResetForm({keepDraft:true});
  const restored=restoreAdminDraft();
  if (!restored) renderDraftMarkets();
  adminLoadData().catch(e=>adminMsg(e.message||'No se pudo cargar el panel admin.','error'));
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
