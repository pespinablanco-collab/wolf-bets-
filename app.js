const SUPABASE_URL="https://acfctgzevmstoqqhtwfs.supabase.co";
const SUPABASE_KEY="sb_publishable_7b9I48CTSngMxXthiYMvqQ_UeIwiFMs";
const db=supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
const $=id=>document.getElementById(id);
let user=null,profile=null,view="home",catByMatch={};

function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function toast(t){const e=document.createElement("div");e.className="toast";e.textContent=t;document.body.append(e);setTimeout(()=>e.remove(),3000)}
function euro(n){return `${Number(n||0).toFixed(2)} 🪙`}
function dateText(d){return new Date(d).toLocaleString("es-ES",{dateStyle:"short",timeStyle:"short"})}

async function getProfile(){
  if(!user)return;
  let r=await db.from("profiles").select("*").eq("id",user.id).maybeSingle();
  if(r.error){toast("Error leyendo tu perfil: "+r.error.message);return}
  if(!r.data){
    const username=(user.user_metadata?.username||user.email.split("@")[0]).slice(0,30);
    const ins=await db.from("profiles").insert({id:user.id,username,balance:1000,is_admin:false}).select().single();
    if(ins.error){toast("Tu usuario existe pero falta su perfil. Ejecuta el SQL V5 y vuelve a entrar.");return}
    profile=ins.data;
  }else profile=r.data;
}

function header(){
 return `<header class="appbar"><nav class="nav">
  <div class="brand"><div class="wolfmark">🐺</div>WOLF <span>BETS</span></div>
  <div class="navlinks">
   <button onclick="go('home')">Partidos</button><button onclick="go('bets')">Mis apuestas</button><button onclick="go('ranking')">🏆 Ranking</button>
   ${profile.is_admin?`<button onclick="go('admin')">👑 Admin</button>`:""}
  </div>
  <div class="wallet">${profile.is_admin?"♾️ Saldo ilimitado":euro(profile.balance)}</div>
  <button class="ghost" onclick="logout()">Salir</button>
 </nav></header>`
}
function authScreen(mode="login"){
 $("app").innerHTML=`<div class="container"><div class="auth card">
  <div class="brand authlogo"><div class="wolfmark">🐺</div>WOLF <span>BETS</span></div>
  <p class="muted" style="text-align:center">Tu liga privada de apuestas con créditos ficticios.</p>
  <div class="switch"><button class="ghost" onclick="authScreen('login')">Iniciar sesión</button><button class="ghost" onclick="authScreen('signup')">Crear cuenta</button></div>
  <div id="authForm"></div></div></div>`;
 if(mode==="login") $("authForm").innerHTML=`<form class="form" onsubmit="login(event)">
   <input id="email" type="email" placeholder="Correo electrónico" autocomplete="email" required>
   <input id="password" type="password" placeholder="Contraseña" autocomplete="current-password" required>
   <button class="primary">Entrar en Wolf Bets</button></form>`;
 else $("authForm").innerHTML=`<form class="form" onsubmit="signup(event)">
   <input id="username" placeholder="Nombre de jugador" maxlength="30" required>
   <input id="email" type="email" placeholder="Correo electrónico" required>
   <input id="password" type="password" minlength="6" placeholder="Contraseña (mínimo 6)" required>
   <button class="primary">Crear mi cuenta</button></form>`;
}
async function login(e){
 e.preventDefault();const b=e.submitter;b.disabled=true;
 const {data,error}=await db.auth.signInWithPassword({email:$("email").value.trim(),password:$("password").value});
 b.disabled=false;if(error)return toast("No se pudo iniciar sesión: "+error.message);
 user=data.user;await getProfile();if(profile)go("home");
}
async function signup(e){
 e.preventDefault();const b=e.submitter;b.disabled=true;
 const username=$("username").value.trim(),email=$("email").value.trim(),password=$("password").value;
 const {data,error}=await db.auth.signUp({email,password,options:{data:{username}}});b.disabled=false;
 if(error)return toast("No se pudo crear la cuenta: "+error.message);
 if(data.session){user=data.user;await getProfile();return go("home")}
 toast("Cuenta creada. Si Supabase pide confirmar el correo, confírmalo y después inicia sesión.");
}
async function logout(){await db.auth.signOut();user=null;profile=null;authScreen("login")}
async function go(v){view=v;await render()}
async function render(){
 if(!profile)return authScreen();
 if(view==="home")return home();if(view==="bets")return myBets();if(view==="ranking")return ranking();if(view==="admin")return admin();
}
async function home(){
 const r=await db.from("matches").select("*").eq("status","open").order("match_date",{ascending:true});
 if(r.error)return toast(r.error.message);
 $("app").innerHTML=header()+`<main class="container"><section class="hero"><h1>Hola, ${esc(profile.username)} 🐺</h1><div class="muted">${profile.is_admin?"Tienes control total y saldo ilimitado.":"Saldo disponible: "+euro(profile.balance)}</div></section><div class="grid">${r.data?.length?r.data.map(matchCard).join(""):`<div class="card empty">Todavía no hay partidos abiertos.</div>`}</div></main>`;
}
function matchCard(m){
 const cats=["Resultado","Goles","Córners","Remates","A puerta","Tarjetas","Jugadores"];
 return `<article class="card"><div class="match-head"><span class="pill">⚽ ABIERTO</span><span class="date">${dateText(m.match_date)}</span></div>
 <div class="teams">${esc(m.home)} <span class="muted">vs</span> ${esc(m.away)}</div>
 <div class="market-tabs">${cats.map(c=>`<button id="tab-${m.id}-${c}" onclick="markets(${m.id},'${c}')">${c}</button>`).join("")}</div>
 <div id="mk-${m.id}" class="empty">Selecciona un mercado.</div></article>`;
}
async function markets(matchId,cat){
 document.querySelectorAll(`[id^="tab-${matchId}-"]`).forEach(x=>x.classList.remove("active"));
 const tab=$(`tab-${matchId}-${cat}`);if(tab)tab.classList.add("active");
 const r=await db.from("markets").select("*").eq("match_id",matchId).eq("category",cat).eq("is_open",true).order("sort_order");
 const box=$(`mk-${matchId}`);if(r.error)return box.textContent=r.error.message;
 box.className="";box.innerHTML=r.data?.length?`<div class="odds">${r.data.map(x=>`<button class="odd" onclick="betModal(${x.id})"><span>${esc(x.name)}</span><b>${Number(x.odd).toFixed(2)}</b></button>`).join("")}</div>`:`<div class="empty">El administrador aún no ha añadido mercados de ${cat}.</div>`;
}
async function betModal(marketId){
 const r=await db.from("markets").select("*,matches(home,away)").eq("id",marketId).single();if(r.error)return toast(r.error.message);const m=r.data;
 $("app").insertAdjacentHTML("beforeend",`<div id="modal" style="position:fixed;inset:0;background:#000b;z-index:50;display:grid;place-items:center;padding:18px"><div class="card" style="max-width:430px;width:100%"><h2>${esc(m.name)}</h2><p class="muted">${esc(m.matches.home)} vs ${esc(m.matches.away)} · cuota ${m.odd}</p><form class="form" onsubmit="placeBet(event,${m.id},${m.odd})"><input id="stake" type="number" min="1" step="1" max="${profile.is_admin?100000000:Math.floor(profile.balance)}" placeholder="Cantidad de créditos" required><div class="row"><span>Retorno potencial</span><b id="ret" class="green">0.00 🪙</b></div><button class="primary">Confirmar apuesta</button><button type="button" class="ghost" onclick="modal.remove()">Cancelar</button></form></div></div>`);
 $("stake").oninput=()=>{$("ret").textContent=euro(Number($("stake").value||0)*Number(m.odd))}
}
async function placeBet(e,marketId,odd){e.preventDefault();const r=await db.rpc("place_market_bet",{p_market_id:marketId,p_stake:Number($("stake").value)});if(r.error)return toast(r.error.message);modal.remove();toast("✅ Apuesta registrada");await getProfile();go("bets")}
async function myBets(){
 const r=await db.from("bets").select("id,stake,odd,potential_win,status,selection,created_at,markets(name),matches(home,away)").eq("user_id",user.id).order("created_at",{ascending:false});
 if(r.error)return toast(r.error.message);
 $("app").innerHTML=header()+`<main class="container"><section class="hero"><h1>Mis apuestas</h1><div class="muted">Aquí tienes todo tu historial.</div></section><div class="card">${r.data?.length?r.data.map(b=>`<div class="slip"><div class="row"><b>${esc(b.matches.home)} vs ${esc(b.matches.away)}</b><span class="${b.status==="won"?"green":b.status==="lost"?"red":""}">${b.status==="pending"?"PENDIENTE":b.status==="won"?"GANADA":"PERDIDA"}</span></div><div class="muted">${esc(b.selection)} · cuota ${b.odd} · apostado ${euro(b.stake)} · potencial ${euro(b.potential_win)}</div></div>`).join(""):`<div class="empty">No tienes apuestas todavía.</div>`}</div></main>`;
}
async function ranking(){
 const r=await db.from("profiles").select("username,balance").eq("is_admin",false).order("balance",{ascending:false});if(r.error)return toast(r.error.message);
 $("app").innerHTML=header()+`<main class="container"><section class="hero"><h1>🏆 Ranking</h1><div class="muted">Clasificación por saldo.</div></section><div class="card"><table class="table"><tr><th>#</th><th>Jugador</th><th>Saldo</th></tr>${r.data.map((x,i)=>`<tr><td>${i+1}</td><td>${esc(x.username)}</td><td>${euro(x.balance)}</td></tr>`).join("")}</table></div></main>`;
}
async function admin(){
 if(!profile.is_admin)return go("home");
 const [u,m]=await Promise.all([db.from("profiles").select("id,username,balance,is_admin").order("username"),db.from("matches").select("*").order("match_date",{ascending:false})]);
 if(u.error||m.error)return toast((u.error||m.error).message);
 $("app").innerHTML=header()+`<main class="container"><section class="hero"><h1>👑 Panel Wolf Bets</h1><div class="muted">Gestiona jugadores, saldo, partidos y todos los mercados.</div></section>
 <div class="grid"><div class="card"><h2>Usuarios</h2>${u.data.filter(x=>!x.is_admin).map(x=>`<div class="user-line"><div class="row"><div><b>${esc(x.username)}</b><div class="muted">${euro(x.balance)}</div></div><div class="actions"><button class="danger" onclick="adjust('${x.id}',-100)">−100</button><button class="success" onclick="adjust('${x.id}',100)">+100</button><button class="success" onclick="adjust('${x.id}',500)">+500</button><button class="success" onclick="adjust('${x.id}',1000)">+1000</button></div></div></div>`).join("")||`<div class="empty">Aún no hay jugadores.</div>`}</div>
 <div class="card"><h2>Crear partido</h2><form class="form" onsubmit="createMatch(event)"><input id="mhome" placeholder="Equipo local" required><input id="maway" placeholder="Equipo visitante" required><input id="mdate" type="datetime-local" required><button class="primary">⚽ Crear partido</button></form></div></div>
 <div class="card" style="margin-top:15px"><h2>Partidos y mercados</h2>${m.data.length?m.data.map(adminMatch).join(""):`<div class="empty">Crea tu primer partido arriba.</div>`}</div></main>`;
}
function adminMatch(m){
 return `<div class="admin-market"><div class="row"><div><b>${esc(m.home)} vs ${esc(m.away)}</b><div class="muted">${dateText(m.match_date)}</div></div><span class="pill">${m.status}</span></div>
 <div class="title">Añadir mercado</div><form class="market-line" onsubmit="addMarket(event,${m.id})"><select id="cat-${m.id}"><option>Resultado</option><option>Goles</option><option>Córners</option><option>Remates</option><option>A puerta</option><option>Tarjetas</option><option>Jugadores</option></select><input id="name-${m.id}" placeholder="Ej. Chelsea gana / Más de 2.5 / Juan marca" required><input id="odd-${m.id}" type="number" min="1.01" step=".01" placeholder="Cuota" required><button class="primary">Añadir</button></form>
 <div id="list-${m.id}" class="title">Mercados actuales</div><div id="markets-admin-${m.id}">Cargando...</div></div>`;
}
async function refreshAdminMarkets(){
 const r=await db.from("markets").select("*").order("match_id").order("category").order("sort_order");if(r.error)return;
 const grouped={};for(const x of r.data){(grouped[x.match_id]??=[]).push(x)}
 for(const id in grouped){const el=$(`markets-admin-${id}`);if(el)el.innerHTML=grouped[id].map(x=>`<div class="row slip"><span>${esc(x.category)} · ${esc(x.name)}</span><b>${Number(x.odd).toFixed(2)}</b><button class="danger" onclick="resolveMarket(${x.id})">Resolver</button></div>`).join("")}
}
async function createMatch(e){
 e.preventDefault();const btn=e.submitter;btn.disabled=true;
 const r=await db.from("matches").insert({home:$("mhome").value.trim(),away:$("maway").value.trim(),match_date:new Date($("mdate").value).toISOString(),status:"open"}).select().single();
 btn.disabled=false;if(r.error)return toast("No se pudo crear: "+r.error.message);
 toast("✅ Partido creado");await admin();refreshAdminMarkets();
}
async function addMarket(e,matchId){
 e.preventDefault();const r=await db.from("markets").insert({match_id:matchId,category:$(`cat-${matchId}`).value,name:$(`name-${matchId}`).value.trim(),odd:Number($(`odd-${matchId}`).value),is_open:true,sort_order:0});
 if(r.error)return toast("No se pudo añadir: "+r.error.message);toast("Mercado añadido");await admin();refreshAdminMarkets();
}
async function resolveMarket(marketId){
 const r=await db.from("markets").select("id,name,match_id").eq("id",marketId).single();if(r.error)return toast(r.error.message);
 const winner=prompt(`Escribe EXACTAMENTE la selección ganadora para:\n${r.data.name}\n\nEjemplo: Chelsea gana`);
 if(!winner)return;
 const x=await db.rpc("resolve_single_market",{p_market_id:marketId,p_winner:winner.trim()});if(x.error)return toast("No se pudo resolver: "+x.error.message);
 toast("✅ Mercado resuelto");await admin();refreshAdminMarkets();
}
async function adjust(id,delta){const r=await db.rpc("admin_adjust_balance",{p_user_id:id,p_delta:delta});if(r.error)return toast(r.error.message);toast("Saldo actualizado");await admin();refreshAdminMarkets()}
db.auth.onAuthStateChange(async(event,session)=>{if(session&&!profile){user=session.user;await getProfile();if(profile)render()}});
async function boot(){const r=await db.auth.getSession();if(r.data.session){user=r.data.session.user;await getProfile();if(profile)render();else authScreen()}else authScreen("login")}
boot();
