/* ==============================================
   [JS-STAFF: 01-CONFIG-AUTH] - CHIAVI & CLIENT
   ============================================== */
const MASTER_KEY = "AURA2026MASTERMOHA";
const STAFF_KEY = "AURASTAFF2026";
const SUPABASE_URL = "https://pspbdtmwagsuxgrlobcd.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBzcGJkdG13YWdzdXhncmxvYmNkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTExMzk1OTcsImV4cCI6MjEwNjcxNTU5N30.6CpEusUnubJHdp0KTGWnretigjMECOBsVCd_FXmGack";

let sbClient = null;
if (window.supabase && typeof window.supabase.createClient === 'function') {
  sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

let currentAuthKey = localStorage.getItem("aura_staff_session_key") || null;
let sharedGeminiKey = "";
let pendingList = [];
let activeList = [];
let allMarketList = [];
let currentStats = null;
let aiResults = {};

// Controllo accesso
async function checkAuth() {
  if (currentAuthKey === MASTER_KEY || currentAuthKey === STAFF_KEY) {
    document.getElementById("loginScreen").style.display = "none";
    document.getElementById("dashboardScreen").style.display = "block";

    const isMaster = (currentAuthKey === MASTER_KEY);
    const badge = document.getElementById("roleBadge");
    badge.innerText = isMaster ? "MASTER ADMIN" : "STAFF COLLABORATORE";
    badge.className = `badge-role ${isMaster ? "badge-master" : "badge-staff"}`;

    // Segregazione: nascondi schede Master allo Staff
    document.getElementById("tabBtnStats").style.display = isMaster ? "flex" : "none";
    document.getElementById("tabBtnMarket").style.display = isMaster ? "flex" : "none";

    await fetchSharedGeminiKey();
    await loadPendingQueue();
    await loadActivePosts();
    if (isMaster) {
      await loadStats();
      await loadMarketAdmin();
    }
  } else {
    document.getElementById("loginScreen").style.display = "flex";
    document.getElementById("dashboardScreen").style.display = "none";
  }
}

document.getElementById("btnLogin").addEventListener("click", () => {
  const inputKey = document.getElementById("inputAuthKey").value.trim().toUpperCase();
  if (inputKey === MASTER_KEY || inputKey === STAFF_KEY) {
    currentAuthKey = inputKey;
    localStorage.setItem("aura_staff_session_key", currentAuthKey);
    checkAuth();
  } else {
    alert("Chiave non valida.");
  }
});

document.getElementById("btnLogout").addEventListener("click", () => {
  localStorage.removeItem("aura_staff_session_key");
  currentAuthKey = null;
  checkAuth();
});


/* ==============================================
   [JS-STAFF: 02-NAV-TABS] - GESTIONE SCHEDE
   ============================================== */
const tabBtnMod = document.getElementById("tabBtnMod");
const tabBtnActive = document.getElementById("tabBtnActive");
const tabBtnStats = document.getElementById("tabBtnStats");
const tabBtnMarket = document.getElementById("tabBtnMarket");
const paneMod = document.getElementById("paneMod");
const paneActive = document.getElementById("paneActive");
const paneStats = document.getElementById("paneStats");
const paneMarket = document.getElementById("paneMarket");

function activateTab(tab) {
  [tabBtnMod, tabBtnActive, tabBtnStats, tabBtnMarket].forEach(b => b.classList.remove("active"));
  [paneMod, paneActive, paneStats, paneMarket].forEach(p => p.style.display = "none");

  if (tab === 'mod') { tabBtnMod.classList.add("active"); paneMod.style.display = "block"; }
  if (tab === 'active') { tabBtnActive.classList.add("active"); paneActive.style.display = "block"; loadActivePosts(); }
  if (tab === 'stats') { tabBtnStats.classList.add("active"); paneStats.style.display = "block"; loadStats(); }
  if (tab === 'market') { tabBtnMarket.classList.add("active"); paneMarket.style.display = "block"; loadMarketAdmin(); }
}

tabBtnMod.addEventListener("click", () => activateTab('mod'));
tabBtnActive.addEventListener("click", () => activateTab('active'));
tabBtnStats.addEventListener("click", () => activateTab('stats'));
tabBtnMarket.addEventListener("click", () => activateTab('market'));


/* ==============================================
   [JS-STAFF: 03-GEMINI-CLOUD] - CONFIGURAZIONE CHIAVE
   ============================================== */
async function fetchSharedGeminiKey() {
  try {
    const { data, error } = await sbClient.rpc('get_app_config', {
      p_auth_key: currentAuthKey,
      p_key: 'gemini_api_key'
    });
    if (!error && data) {
      sharedGeminiKey = data;
      document.getElementById("inputSharedGeminiKey").value = data;
      document.getElementById("geminiStatusBadge").innerText = "● Connessa al Cloud";
      document.getElementById("geminiStatusBadge").style.color = "#10B981";
    } else {
      document.getElementById("geminiStatusBadge").innerText = "○ Non configurata";
      document.getElementById("geminiStatusBadge").style.color = "#EF4444";
    }
  } catch (e) {
    console.error(e);
  }
}

document.getElementById("btnSaveSharedGeminiKey").addEventListener("click", async () => {
  const val = document.getElementById("inputSharedGeminiKey").value.trim();
  if (!val) { alert("Inserisci una chiave valida."); return; }
  try {
    const { data, error } = await sbClient.rpc('set_app_config', {
      p_auth_key: currentAuthKey,
      p_key: 'gemini_api_key',
      p_val: val
    });
    if (!error && data.success) {
      sharedGeminiKey = val;
      alert("Chiave Google Gemini salvata nel cloud!");
      fetchSharedGeminiKey();
    } else {
      alert("Errore salvataggio: " + (error ? error.message : data.error));
    }
  } catch (e) {
    console.error(e);
  }
});


/* ==============================================
   [JS-STAFF: 04-MODERATION-QUEUE] - CODA PENDING
   ============================================== */
async function loadPendingQueue() {
  if (!sbClient || !currentAuthKey) return;
  try {
    const { data, error } = await sbClient.rpc('get_pending_posts', { p_auth_key: currentAuthKey });
    if (error) throw error;
    pendingList = data || [];
    document.getElementById("badgePendingCount").innerText = pendingList.length;
    document.getElementById("statusSummaryText").innerText = `${pendingList.length} post in attesa di moderazione`;
    renderQueue();
  } catch (err) {
    console.error(err);
  }
}

function renderQueue() {
  const container = document.getElementById("pendingContainer");
  if (pendingList.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:50px 20px; background:rgba(255,255,255,0.02); border-radius:16px;">
        <div style="font-size:36px; margin-bottom:10px;">☕</div>
        <h3 style="font-size:16px; color:var(--rose-gold-light);">Nessun post in attesa!</h3>
        <p style="font-size:12px; color:var(--text-muted); margin-top:6px;">Il feed studentesco è in pari.</p>
      </div>`;
    return;
  }

  container.innerHTML = pendingList.map(p => {
    const ai = aiResults[p.id];
    let cardClass = "";
    let aiBadge = "";
    let curText = p.testo;

    if (ai) {
      if (ai.safe) {
        cardClass = "ai-safe";
        aiBadge = `<div class="ai-badge safe">✅ GEMINI: SICURO (${ai.reason})</div>`;
        curText = ai.censored_text;
      } else {
        cardClass = "ai-danger";
        aiBadge = `<div class="ai-badge danger">⛔ GEMINI: RISCHIOSO (${ai.reason})</div>`;
      }
    }

    const isSpotted = (p.tipo === 'spotted');
    const extraInfo = isSpotted ? `
      <div style="font-size:11.5px; color:#C084FC; margin: 6px 0; background:rgba(192,132,252,0.06); padding:6px 10px; border-radius:6px;">
        <strong>Domanda Handshake:</strong> "${p.handshake_q || 'N/A'}"
      </div>` : '';

    return `
      <div class="item-card ${cardClass}" id="card-${p.id}">
        ${aiBadge}
        <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
          <span style="font-size:11px; font-weight:800; color:var(--rose-gold);">${p.tipo.toUpperCase()} • ${p.polo}</span>
          <span style="font-size:10.5px; color:var(--text-muted);">${p.luogo}</span>
        </div>
        <div style="font-weight:700; font-size:14px; color:#fff; margin-bottom:6px;">${p.titolo}</div>
        ${extraInfo}
        <label style="font-size:10.5px; color:var(--rose-gold); font-weight:600;">Testo (puoi modificarlo liberamente):</label>
        <textarea id="edit-testo-${p.id}" style="margin-top:4px; font-size:12.5px;">${curText}</textarea>
        <div class="card-actions">
          <button class="btn btn-act-now" onclick="window.approveItem('${p.id}', 0)">✅ Live Subito</button>
          <button class="btn btn-act-queue" onclick="window.approveItem('${p.id}', 60)">⏱️ In Coda (+1 min)</button>
          <button class="btn btn-act-story" onclick="window.generateStory('${p.id}', 'pending')">📸 Story IG</button>
          <button class="btn btn-act-del" onclick="window.rejectItem('${p.id}')">❌ Rifiuta</button>
        </div>
      </div>`;
  }).join('');
}

// Analisi Gemini
async function callGemini(apiKey, post) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  const prompt = `Sei il redattore e moderatore di AURA, community UdA Chieti-Pescara.
Analizza: "${post.tipo}" - "${post.polo} - ${post.luogo}"
TITOLO: "${post.titolo}"
TESTO: "${post.testo}"
1. safe=false solo per nomi e cognomi reali, numeri o diffamazione grave.
2. censura strategica: se safe=true, racchiudi 1-2 dettagli tra [parentesi quadre].
Rispondi SOLO JSON: {"safe": true, "reason": "...", "censored_text": "..."}`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json" }
    })
  });
  if (!res.ok) throw new Error("Errore Gemini");
  const jsonRes = await res.json();
  return JSON.parse(jsonRes.candidates[0].content.parts[0].text);
}

document.getElementById("btnRunAiBatch").addEventListener("click", async () => {
  if (!sharedGeminiKey || pendingList.length === 0) return;
  const btn = document.getElementById("btnRunAiBatch");
  btn.disabled = true;
  btn.innerText = "⏳ Analisi in corso...";
  for (const p of pendingList) {
    try { aiResults[p.id] = await callGemini(sharedGeminiKey, p); } catch (e) { console.error(e); }
  }
  btn.disabled = false;
  btn.innerText = "🪄 Analizza & Censura con Gemini";
  renderQueue();
});

document.getElementById("btnApproveAllSafe").addEventListener("click", async () => {
  const safeItems = pendingList.filter(p => aiResults[p.id] && aiResults[p.id].safe === true);
  if (safeItems.length === 0) { alert("Nessun post con esito 'Sicuro'."); return; }
  let delay = 60;
  for (const p of safeItems) {
    const txt = aiResults[p.id].censored_text || p.testo;
    await sbClient.rpc('approva_vault_post', { p_id: p.id, p_auth_key: currentAuthKey, p_testo: txt, p_delay_seconds: delay });
    delay += 60;
  }
  alert("Post approvati!");
  await loadPendingQueue();
  await loadActivePosts();
});

window.approveItem = async function(id, delaySeconds) {
  const textVal = document.getElementById(`edit-testo-${id}`).value.trim();
  try {
    const { data, error } = await sbClient.rpc('approva_vault_post', { p_id: id, p_auth_key: currentAuthKey, p_testo: textVal, p_delay_seconds: delaySeconds });
    if (!error && data.success) {
      alert(delaySeconds > 0 ? "Post programmato!" : "Post live subito!");
      await loadPendingQueue();
      await loadActivePosts();
    }
  } catch (e) { console.error(e); }
};

window.rejectItem = async function(id) {
  if (!confirm("Rifiutare ed eliminare questo post?")) return;
  await sbClient.rpc('rifiuta_vault_post', { p_id: id, p_auth_key: currentAuthKey });
  await loadPendingQueue();
};


/* ==============================================
   [JS-STAFF: 05-ACTIVE-POSTS] - POST LIVE & REAZIONI
   ============================================== */
async function loadActivePosts() {
  if (!sbClient) return;
  try {
    const { data, error } = await sbClient
      .from('vault_posts')
      .select('*')
      .eq('status', 'active')
      .order('created_at', { ascending: false });

    if (!error && data) {
      activeList = data;
      document.getElementById("badgeActiveCount").innerText = activeList.length;
      renderActivePosts();
    }
  } catch (e) { console.error(e); }
}

function renderActivePosts() {
  const container = document.getElementById("activePostsContainer");
  const query = (document.getElementById("inputSearchActive").value || "").toLowerCase();
  const campus = document.getElementById("filterCampusActive").value;
  const sort = document.getElementById("filterSortActive").value;

  let maxVotes = -1;
  let topPostId = null;
  activeList.forEach(p => {
    const tot = p.voti_totali || 0;
    if (tot > maxVotes && tot > 0) { maxVotes = tot; topPostId = p.id; }
  });

  let filtered = activeList.filter(p => {
    const campusMatch = (campus === 'ALL' || p.polo === campus || p.polo === 'Tutti');
    const searchMatch = !query || (p.titolo && p.titolo.toLowerCase().includes(query)) || (p.testo && p.testo.toLowerCase().includes(query));
    return campusMatch && searchMatch;
  });

  if (sort === 'votes') {
    filtered.sort((a, b) => (b.voti_totali || 0) - (a.voti_totali || 0));
  } else {
    filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  if (filtered.length === 0) {
    container.innerHTML = `<div style="text-align:center; padding:40px 20px; color:var(--text-muted);">Nessun post live corrispondente</div>`;
    return;
  }

  container.innerHTML = filtered.map(p => {
    const isTop = (p.id === topPostId);
    const topTag = isTop ? `<div class="badge-trending-tag">👑 #1 PIÙ GETTONATO (${p.voti_totali} VOTI)</div>` : '';
    const statusText = p.is_unlocked ? '🔓 Sbloccato' : `🔒 Censurato (${p.voti_totali || 0}/${p.soglia_sblocco || 25})`;

    return `
      <div class="item-card ${isTop ? 'top-trending' : ''}">
        ${topTag}
        <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
          <span style="font-size:11px; font-weight:800; color:var(--rose-gold);">${p.tipo.toUpperCase()} • ${p.polo}</span>
          <span style="font-size:10.5px; color:var(--text-muted);">${p.luogo}</span>
        </div>
        <div style="font-weight:700; font-size:14px; color:#fff; margin-bottom:6px;">${p.titolo}</div>
        <div style="font-size:12.5px; color:#DDD4E2; margin-bottom:8px; line-height:1.5;">${p.testo}</div>
        <div class="reactions-bar-staff">
          <span class="react-chip">🔥 ${p.voti_fire || 0}</span>
          <span class="react-chip">💀 ${p.voti_skull || 0}</span>
          <span class="react-chip">🚩 ${p.voti_redflag || 0}</span>
          <span style="color:var(--rose-gold); font-weight:700; margin-left:4px;">Totale: ${p.voti_totali || 0}</span>
          <span style="color:var(--text-muted); margin-left:auto;">${statusText}</span>
        </div>
        <div class="card-actions">
          <button class="btn btn-act-story" onclick="window.generateStory('${p.id}', 'active')">📸 Story IG</button>
          <button class="btn btn-act-del" onclick="window.deleteActivePost('${p.id}')">🗑️ Elimina dal Feed</button>
        </div>
      </div>`;
  }).join('');
}

document.getElementById("inputSearchActive").addEventListener("input", renderActivePosts);
document.getElementById("filterCampusActive").addEventListener("change", renderActivePosts);
document.getElementById("filterSortActive").addEventListener("change", renderActivePosts);

window.deleteActivePost = async function(id) {
  if (!confirm("Rimuovere definitivamente questo post dal feed pubblico?")) return;
  try {
    const { data, error } = await sbClient.rpc('rifiuta_vault_post', {
      p_id: id,
      p_auth_key: currentAuthKey
    });

    if (!error) {
      alert("Post rimosso dal feed!");
      await loadActivePosts();
      if (currentAuthKey === MASTER_KEY) loadStats();
    } else {
      alert("Errore eliminazione: " + (error ? error.message : "Permesso negato"));
    }
  } catch (e) {
    alert("Errore: " + e.message);
  }
};


/* ==============================================
   [JS-STAFF: 06-STATS-INTEL] - KPI & REPORT GEMINI
   ============================================== */
async function loadStats() {
  if (!sbClient || currentAuthKey !== MASTER_KEY) return;
  try {
    const { data, error } = await sbClient.rpc('get_staff_stats', { p_auth_key: currentAuthKey });
    if (!error && data.success) {
      currentStats = data;
      document.getElementById("statReactions").innerText = data.posts.reactions_total;
      document.getElementById("statUnlocked").innerText = data.posts.unlocked_gossip;
      document.getElementById("statUnlockedSub").innerText = `su ${data.posts.gossip} gossip`;
      document.getElementById("statSpottedRate").innerText = `${data.posts.spotted_match_rate}%`;
      document.getElementById("statSpottedMatchedCount").innerText = `${data.posts.spotted_matched} match`;
      document.getElementById("statCampusBattle").innerText = data.posts.chieti >= data.posts.pescara ? "🏛️ Chieti" : "🌊 Pescara";
      document.getElementById("statCampusDetail").innerText = `Chieti: ${data.posts.chieti} | Pescara: ${data.posts.pescara}`;
      document.getElementById("statMarketTotal").innerText = data.market.total;
      document.getElementById("statMarketCampus").innerText = `Chieti: ${data.market.chieti} | Pescara: ${data.market.pescara}`;
    }
  } catch (e) { console.error(e); }
}

document.getElementById("btnGenerateAiReport").addEventListener("click", async () => {
  if (!sharedGeminiKey) return;
  const box = document.getElementById("intelReportBox");
  box.innerText = "⏳ Gemini sta analizzando i post...";
  try {
    const { data: posts } = await sbClient.from('vault_posts').select('*').limit(30);
    const prompt = `Sei Social Strategist di AURA UdA. Analizza dati: ${JSON.stringify(currentStats)} e post: ${JSON.stringify(posts || [])}. Crea un report sintetico: 1. Trend caldi, 2. Campus battle, 3. Market, 4. Format Instagram @aura.uda.`;
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${sharedGeminiKey}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    const resData = await res.json();
    box.innerText = resData.candidates[0].content.parts[0].text;
  } catch (err) {
    box.innerText = "Errore: " + err.message;
  }
});


/* ==============================================
   [JS-STAFF: 07-MARKET-ADMIN] - GESTIONE MARKETPLACE
   ============================================== */
async function loadMarketAdmin() {
  if (!sbClient || currentAuthKey !== MASTER_KEY) return;
  try {
    const { data, error } = await sbClient.rpc('get_all_annunci_staff', { p_auth_key: currentAuthKey });
    if (!error && data) {
      allMarketList = data;
      renderMarketAdmin();
    }
  } catch (e) { console.error(e); }
}

function renderMarketAdmin() {
  const container = document.getElementById("marketAdminContainer");
  const query = (document.getElementById("inputSearchMarketAdmin").value || "").toLowerCase();
  const campusFilter = document.getElementById("filterCampusMarketAdmin").value;

  const filtered = allMarketList.filter(item => {
    const campusMatch = (campusFilter === "ALL" || item.polo === campusFilter);
    const searchMatch = !query || item.titolo.toLowerCase().includes(query) || item.contatto_ig.toLowerCase().includes(query);
    return campusMatch && searchMatch;
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div style="text-align:center; padding:30px; color:var(--text-muted);">Nessun annuncio trovato.</div>`;
    return;
  }

  container.innerHTML = filtered.map(item => `
    <div class="item-card market-admin-item" id="market-item-${item.id}">
      <img class="market-admin-img" src="${item.foto_url}" onerror="this.src='logo.png';">
      <div class="market-admin-info">
        <div style="font-size:10.5px; color:var(--rose-gold); font-weight:700;">${item.categoria} • ${item.polo}</div>
        <div style="font-weight:700; font-size:13.5px; color:#fff; margin:2px 0;">${item.titolo}</div>
        <div style="font-family:var(--font-serif); font-size:14px; color:var(--rose-gold-light); font-weight:800;">${item.prezzo}</div>
        <div style="font-size:11px; color:var(--text-muted);">Venditore: @${item.contatto_ig}</div>
      </div>
      <div>
        <button class="btn btn-act-del" onclick="window.deleteMarketItem('${item.id}')" style="padding:8px 12px;">Elimina</button>
      </div>
    </div>`).join('');
}

document.getElementById("inputSearchMarketAdmin").addEventListener("input", renderMarketAdmin);
document.getElementById("filterCampusMarketAdmin").addEventListener("change", renderMarketAdmin);

window.deleteMarketItem = async function(id) {
  if (!confirm("Rimuovere definitivamente questo annuncio?")) return;
  try {
    await sbClient.rpc('elimina_annuncio_staff', { p_id: id, p_auth_key: currentAuthKey });
    allMarketList = allMarketList.filter(x => x.id !== id);
    renderMarketAdmin();
    loadStats();
  } catch (e) { console.error(e); }
};


/* ==============================================
   [JS-STAFF: 08-STORY-ENGINE] - GRAFICA STORY IG
   ============================================== */
window.generateStory = function(id, source = 'pending') {
  const post = (source === 'pending') ? pendingList.find(p => p.id === id) : activeList.find(p => p.id === id);
  if (!post) return;

  let textVal = post.testo;
  const editEl = document.getElementById(`edit-testo-${id}`);
  if (editEl) textVal = editEl.value.trim();

  const canvas = document.getElementById("storyCanvas");
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#050407";
  ctx.fillRect(0, 0, 1080, 1920);

  const grad = ctx.createRadialGradient(540, 400, 50, 540, 400, 700);
  grad.addColorStop(0, "rgba(232, 121, 249, 0.25)");
  grad.addColorStop(1, "transparent");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1080, 1920);

  ctx.font = "bold 46px 'Cinzel', serif";
  ctx.fillStyle = "#FDE8E1";
  ctx.textAlign = "center";
  ctx.fillText(post.tipo === 'spotted' ? "AURA • 👀 SPOTTED UDA" : "AURA • 💣 GOSSIP UDA", 540, 260);

  ctx.font = "bold 28px 'Plus Jakarta Sans', sans-serif";
  ctx.fillStyle = "#E2B49A";
  ctx.fillText(`📍 ${post.polo.toUpperCase()} • ${post.luogo.toUpperCase()}`, 540, 330);

  ctx.fillStyle = "rgba(18, 14, 25, 0.95)";
  ctx.roundRect(100, 460, 880, 1050, 30);
  ctx.fill();
  ctx.strokeStyle = "rgba(226, 180, 154, 0.4)";
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.font = "bold 46px 'Plus Jakarta Sans', sans-serif";
  ctx.fillStyle = "#FFFFFF";
  ctx.textAlign = "left";
  wrapText(ctx, post.titolo, 160, 570, 760, 60);

  ctx.font = "400 36px 'Plus Jakarta Sans', sans-serif";
  ctx.fillStyle = "#E7DEEA";
  const cleanText = textVal.replace(/\[(.*?)\]/g, "████████");
  wrapText(ctx, `“${cleanText}”`, 160, 740, 760, 56);

  ctx.fillStyle = "#E879F9";
  ctx.font = "bold 34px 'Plus Jakarta Sans', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Vota per sbloccare i dettagli censurati", 540, 1640);

  ctx.fillStyle = "#FAF5F8";
  ctx.font = "500 28px 'Plus Jakarta Sans', sans-serif";
  ctx.fillText("Link in Bio • @aura.uda", 540, 1700);

  const link = document.createElement("a");
  link.download = `story_aura_${post.id.substring(0,6)}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
};

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(" ");
  let line = "";
  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + " ";
    if (ctx.measureText(testLine).width > maxWidth && n > 0) {
      ctx.fillText(line, x, y);
      line = words[n] + " ";
      y += lineHeight;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line, x, y);
}

// Inizializza
checkAuth();