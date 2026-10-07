/* ==============================================
   [JS: 01-CONFIG & STATE]
   ============================================== */
(function() {
  const SUPABASE_URL = "https://pspbdtmwagsuxgrlobcd.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBzcGJkdG13YWdzdXhncmxvYmNkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTExMzk1OTcsImV4cCI6MjEwNjcxNTU5N30.6CpEusUnubJHdp0KTGWnretigjMECOBsVCd_FXmGack";

  let sbClient = null;
  if (window.supabase && typeof window.supabase.createClient === 'function') {
    sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }

  let listings = [];
  let vaultPosts = [];
  let activeCampus = localStorage.getItem("aura_campus_choice") || "ALL";
  let activeFeedType = "ALL";
  let activeSpottedStatus = "ALL";
  let activeMarketCat = "ALL";
  
  let activePostForHandshake = null;
  let activePostForAuthorUnlock = null;
  let activeMarketIdToDelete = null;

  /* ==============================================
     [JS: 02-HELPERS & UTILS]
     ============================================== */
  function triggerHaptic(pattern = [30]) {
    if (navigator.vibrate) {
      try { navigator.vibrate(pattern); } catch (e) {}
    }
  }

  function escapeHTML(str) {
    if (!str) return "";
    return String(str).replace(/[&<>'"]/g, tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag));
  }

  async function sha256(str) {
    const buffer = new TextEncoder().encode(str.trim().toLowerCase());
    const hash = await crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  let toastTimer = null;
  function showToast(text) {
    const toast = document.getElementById("toastMsg");
    toast.innerText = text;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
  }

  function timeAgo(dateString) {
    if (!dateString) return "Poco fa";
    const d = new Date(dateString);
    const diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
    if (diffSec < 60) return "Pochi istanti fa";
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin} min fa`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours} ore fa`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return "Ieri";
    if (diffDays < 7) return `${diffDays} giorni fa`;
    return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
  }

  function debounce(func, wait = 150) {
    let timeout;
    return function(...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }

  function getCategoryIcon(cat) {
    switch(cat) {
      case 'Libri': return '📚';
      case 'Affitti': return '🏠';
      case 'Abbigliamento': return '👗';
      case 'Biglietti': return '🎟️';
      case 'Tech': return '💻';
      default: return '🛍️';
    }
  }

  /* ==============================================
     [JS: 03-NAV-SWITCH-CAMPUS]
     ============================================== */
  const campusSelMarket = document.getElementById("campusFilterMarket");
  const campusSelFeed = document.getElementById("campusFilterFeed");
  campusSelMarket.value = activeCampus;
  campusSelFeed.value = activeCampus;

  function updateCampusSelection(val) {
    activeCampus = val;
    localStorage.setItem("aura_campus_choice", val);
    campusSelMarket.value = val;
    campusSelFeed.value = val;
    renderMarketCards();
    renderVault();
  }

  campusSelMarket.addEventListener("change", (e) => updateCampusSelection(e.target.value));
  campusSelFeed.addEventListener("change", (e) => updateCampusSelection(e.target.value));

  const tabMarket = document.getElementById("tabBtnMarket");
  const tabVault = document.getElementById("tabBtnVault");
  const secMarket = document.getElementById("sectionMarket");
  const secVault = document.getElementById("sectionVault");

  tabMarket.addEventListener("click", () => {
    tabMarket.classList.add("active");
    tabVault.classList.remove("active");
    secMarket.style.display = "block";
    secVault.style.display = "none";
  });
  tabVault.addEventListener("click", () => {
    tabVault.classList.add("active");
    tabMarket.classList.remove("active");
    secVault.style.display = "block";
    secMarket.style.display = "none";
    renderVault();
  });

  /* ==============================================
     [JS: 04-VAULT-FEED-ENGINE]
     ============================================== */
  function parseCensorship(text, isUnlocked) {
    if (!text) return "";
    const clean = escapeHTML(text);
    return clean.replace(/\[(.*?)\]/g, (match, p1) => {
      if (isUnlocked) {
        return `<span class="unlocked-text">${p1}</span>`;
      } else {
        return `<span class="redacted-bar" onclick="window.onRedactedTap(event)">████████</span>`;
      }
    });
  }

  window.onRedactedTap = function(e) {
    triggerHaptic([40, 30, 40]);
    const bar = e.currentTarget;
    bar.classList.add("shake");
    setTimeout(() => bar.classList.remove("shake"), 400);
    showToast("🔒 Dettagli censurati! Vota 🔥 sotto per sbloccarli!");
  };

  function updateDripCountdown(now) {
    const banner = document.getElementById("dripCountdown");
    const upcoming = vaultPosts
      .filter(p => p.status === 'active' && p.published_at && new Date(p.published_at) > now)
      .sort((a,b) => new Date(a.published_at) - new Date(b.published_at));

    if (upcoming.length > 0) {
      const nextTime = new Date(upcoming[0].published_at);
      const diffMs = nextTime - now;
      if (diffMs > 0 && diffMs <= 1800000) {
        const mins = Math.floor(diffMs / 60000);
        const secs = Math.floor((diffMs % 60000) / 1000);
        banner.style.display = "block";
        banner.innerText = `🔥 1 nuovo post in arrivo tra ${mins.toString().padStart(2,'0')}:${secs.toString().padStart(2,'0')}...`;
        return;
      }
    }
    banner.style.display = "none";
  }

  let hasScrolledToDeepLink = false;
  function checkDeepLinkScroll() {
    if (hasScrolledToDeepLink) return;
    const hash = window.location.hash;
    if (hash && hash.startsWith("#post-")) {
      const el = document.querySelector(hash);
      if (el) {
        hasScrolledToDeepLink = true;
        tabVault.click();
        setTimeout(() => {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.add("highlight-pulse");
        }, 300);
      }
    }
  }

  function renderVault() {
    const feed = document.getElementById("vaultFeed");
    const searchQuery = (document.getElementById("searchInputFeed").value || "").trim().toLowerCase();
    const now = new Date();

    updateDripCountdown(now);

    let maxVotes = -1;
    let trendingId = null;
    vaultPosts.forEach(p => {
      if (p.tipo === 'gossip' && p.status === 'active' && p.voti_totali > maxVotes && p.voti_totali > 0) {
        maxVotes = p.voti_totali;
        trendingId = p.id;
      }
    });

    const filtered = vaultPosts.filter(p => {
      const isLive = (p.status === 'active') && (!p.published_at || new Date(p.published_at) <= now);
      if (!isLive) return false;
      
      const campusMatch = (activeCampus === "ALL" || p.polo === activeCampus || p.polo === "Tutti");
      const typeMatch = (activeFeedType === "ALL" || p.tipo === activeFeedType);
      
      let spottedStatusMatch = true;
      if (p.tipo === 'spotted' && activeSpottedStatus !== "ALL") {
        if (activeSpottedStatus === "waiting") spottedStatusMatch = !p.has_match;
        if (activeSpottedStatus === "matched") spottedStatusMatch = p.has_match;
      }

      const searchMatch = !searchQuery || 
        (p.titolo && p.titolo.toLowerCase().includes(searchQuery)) || 
        (p.testo && p.testo.toLowerCase().includes(searchQuery)) || 
        (p.luogo && p.luogo.toLowerCase().includes(searchQuery));

      return campusMatch && typeMatch && spottedStatusMatch && searchMatch;
    });

    if (filtered.length === 0) {
      feed.innerHTML = `
        <div style="text-align:center; padding: 40px 20px; background: rgba(255,255,255,0.02); border-radius:16px;">
          <div style="font-size:32px; margin-bottom:8px;">⚡</div>
          <div style="font-size:16px; font-weight:700; color:var(--rose-gold-light);">Nessun post attivo al momento</div>
          <p style="font-size:12px; color:var(--text-muted); margin: 8px auto 16px; max-width:320px;">
            I post vengono verificati e approvati a intervalli regolari. Invia tu il prossimo!
          </p>
          <button class="btn-create" onclick="document.getElementById('btnOpenVaultModal').click()" style="margin: 0 auto;">
            Invia in Anonimo
          </button>
        </div>
      `;
      return;
    }

    let html = "";
    let count = 0;

    filtered.forEach((p) => {
      count++;
      const isSpotted = (p.tipo === 'spotted');
      const isTrending = (!isSpotted && p.id === trendingId);
      const badgeClass = isSpotted ? 'spotted' : 'gossip';
      const badgeIcon = isSpotted ? '👀 SPOTTED' : '💣 GOSSIP';
      const textParsed = parseCensorship(p.testo, p.is_unlocked);
      const timeLabel = timeAgo(p.published_at || p.created_at);

      const trendingHtml = isTrending ? `<div class="badge-trending">👑 #1 TRENDING UDA</div>` : '';

      const pct = Math.min(100, Math.round((p.voti_totali / p.soglia_sblocco) * 100));
      const unlockBar = (!p.is_unlocked && !isSpotted) ? `
        <div class="unlock-progress-wrap">
          <div class="unlock-progress-text">
            <span>🔒 Dettagli censurati (${p.voti_totali}/${p.soglia_sblocco} reazioni)</span>
            <span>${pct}%</span>
          </div>
          <div class="unlock-progress-track">
            <div class="unlock-progress-fill" style="width: ${pct}%;"></div>
          </div>
        </div>
      ` : '';

      let spottedBox = "";
      if (isSpotted) {
        if (p.has_match) {
          spottedBox = `
            <div class="spotted-matched-box">
              <span style="font-size: 11.5px; color: #6EE7B7; font-weight: 600;">
                🎯 Qualcuno si è riconosciuto per questo spotted!
              </span>
              <button class="btn-unlock-author" onclick="window.openAuthorUnlockModal('${p.id}')">
                🔑 Sei l'autore? Sblocca con PIN
              </button>
            </div>
          `;
        } else if (p.handshake_q) {
          spottedBox = `
            <div style="margin-bottom: 12px;">
              <button class="btn-spotted-handshake" onclick="window.openHandshakeModal('${p.id}')">
                Penso di essere io 👀
              </button>
            </div>
          `;
        }
      }

      const hasVoted = !!localStorage.getItem(`aura_voted_${p.id}`);
      const deepLink = `${window.location.origin}${window.location.pathname}#post-${p.id}`;
      const waText = encodeURIComponent(`Regà leggete questo drama su AURA, mancano poche reazioni per sbloccare la parte censurata! 👀👇\n${deepLink}`);
      
      const shareGroup = (!isSpotted) ? `
        <div class="share-actions-group">
          <a href="https://api.whatsapp.com/send?text=${waText}" target="_blank" class="btn-share-wa">
            📲 WhatsApp
          </a>
          <button class="btn-share-general" onclick="window.shareOrCopyPost('${p.id}', '${escapeHTML(p.titolo)}')">
            🔗 Condividi
          </button>
        </div>
      ` : `
        <div class="share-actions-group">
          <button class="btn-share-general" onclick="window.shareOrCopyPost('${p.id}', '${escapeHTML(p.titolo)}')">
            🔗 Condividi
          </button>
        </div>
      `;

      html += `
        <article class="vault-card ${isTrending ? 'trending' : ''}" id="post-${p.id}">
          ${trendingHtml}
          <div class="vault-header">
            <span class="vault-badge ${badgeClass}">${badgeIcon}</span>
            <div class="vault-meta">
              <span class="loc">📍 ${escapeHTML(p.polo)} • ${escapeHTML(p.luogo)}</span>
              <span>• ${timeLabel}</span>
            </div>
          </div>
          <h3 class="vault-title">${escapeHTML(p.titolo)}</h3>
          <div class="vault-body">${textParsed}</div>
          ${unlockBar}
          ${spottedBox}
          <div class="vault-actions-bar">
            <div class="reaction-btns-group">
              <button class="btn-react ${hasVoted ? 'voted' : ''}" onclick="window.reactVault('${p.id}', 'fire')">🔥 <span id="cnt-fire-${p.id}">${p.voti_fire || 0}</span></button>
              <button class="btn-react ${hasVoted ? 'voted' : ''}" onclick="window.reactVault('${p.id}', 'skull')">💀 <span id="cnt-skull-${p.id}">${p.voti_skull || 0}</span></button>
              <button class="btn-react ${hasVoted ? 'voted' : ''}" onclick="window.reactVault('${p.id}', 'redflag')">🚩 <span id="cnt-redflag-${p.id}">${p.voti_redflag || 0}</span></button>
            </div>
            ${shareGroup}
            <button style="background:none; border:none; color:var(--text-muted); font-size:11px; cursor:pointer;" onclick="window.flagVault('${p.id}')">Segnala</button>
          </div>
        </article>
      `;

      if (count % 3 === 0 && listings.length > 0) {
        const randomListing = listings[Math.floor(Math.random() * listings.length)];
        html += `
          <div class="interleaved-market-card" onclick="document.getElementById('tabBtnMarket').click();">
            <img class="interleaved-market-img" src="${escapeHTML(randomListing.foto_url)}" onerror="this.src='logo.png';">
            <div class="interleaved-market-info">
              <div class="interleaved-market-tag">Dall'AURA Market • ${escapeHTML(randomListing.polo)}</div>
              <div class="interleaved-market-title">${escapeHTML(randomListing.titolo)}</div>
              <div class="interleaved-market-price">${escapeHTML(randomListing.prezzo)}</div>
            </div>
            <div style="font-size: 18px; color: var(--rose-gold);">➔</div>
          </div>
        `;
      }
    });

    feed.innerHTML = html;
    checkDeepLinkScroll();
  }

  window.shareOrCopyPost = async function(id, title) {
    const link = `${window.location.origin}${window.location.pathname}#post-${id}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: `AURA UdA • ${title}`,
          text: `Guarda questo post su AURA UdA:`,
          url: link
        });
        return;
      } catch (e) {}
    }

    navigator.clipboard.writeText(link).then(() => {
      triggerHaptic([30]);
      showToast("Link copiato negli appunti! 📋");
    }).catch(() => {
      showToast("Impossibile copiare il link.");
    });
  };

  /* ==============================================
     [JS: 05-SPOTTED-HANDSHAKE-AND-AUTH]
     ============================================== */
  const modalHandshake = document.getElementById("modalHandshake");
  window.openHandshakeModal = function(id) {
    const post = vaultPosts.find(p => p.id === id);
    if (!post) return;
    if (post.has_match) {
      alert("Qualcuno si è già fatto avanti per questo spotted!");
      return;
    }

    const bfKey = `aura_bf_${id}`;
    const bfData = JSON.parse(localStorage.getItem(bfKey) || '{"attempts":0, "lockedUntil":0}');
    if (bfData.lockedUntil > Date.now()) {
      const remainMins = Math.ceil((bfData.lockedUntil - Date.now()) / 60000);
      alert(`Hai effettuato troppi tentativi errati. Riprova tra ${remainMins} minuti 🔒`);
      return;
    }

    activePostForHandshake = post;
    document.getElementById("handshakePromptText").innerText = `Domanda dell'autore:\n"${post.handshake_q}"`;
    document.getElementById("inputHandshakeAnswer").value = "";
    document.getElementById("inputMyIg").value = "";
    document.getElementById("attemptsRemainingText").innerText = `Tentativi rimasti: ${3 - bfData.attempts}`;
    modalHandshake.classList.add("open");
  };
  document.getElementById("btnCloseHandshakeModal").addEventListener("click", () => modalHandshake.classList.remove("open"));

  document.getElementById("btnVerifyAndSubmitHandshake").addEventListener("click", async () => {
    const ans = document.getElementById("inputHandshakeAnswer").value.trim();
    const rawIg = document.getElementById("inputMyIg").value.trim().replace(/^@+/, '');
    
    if (!ans) {
      alert("Inserisci la risposta alla domanda segreta.");
      return;
    }
    if (!rawIg) {
      alert("Inserisci il tuo username Instagram.");
      return;
    }

    const bfKey = `aura_bf_${activePostForHandshake.id}`;
    let bfData = JSON.parse(localStorage.getItem(bfKey) || '{"attempts":0, "lockedUntil":0}');

    const btn = document.getElementById("btnVerifyAndSubmitHandshake");
    btn.disabled = true;
    btn.innerText = "Verifica in corso...";

    try {
      const { data, error } = await sbClient.rpc('verifica_e_invia_spotted', {
        p_id: activePostForHandshake.id,
        p_risposta: ans,
        p_target_ig: rawIg
      });

      if (!error && data && data.success) {
        triggerHaptic([30, 40, 60]);
        localStorage.removeItem(bfKey);
        alert("Risposta esatta! Il tuo profilo Instagram è stato recapitato all'autore!");
        modalHandshake.classList.remove("open");
        loadVaultData();
      } else {
        triggerHaptic([60, 50, 60]);
        bfData.attempts += 1;
        if (bfData.attempts >= 3) {
          bfData.lockedUntil = Date.now() + 30 * 60 * 1000;
          localStorage.setItem(bfKey, JSON.stringify(bfData));
          alert("Risposta non corretta. Hai esaurito i 3 tentativi! Bloccato per 30 minuti.");
          modalHandshake.classList.remove("open");
        } else {
          localStorage.setItem(bfKey, JSON.stringify(bfData));
          document.getElementById("attemptsRemainingText").innerText = `Tentativi rimasti: ${3 - bfData.attempts}`;
          alert(`Risposta non corretta! Ti rimangono ${3 - bfData.attempts} tentativi.`);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      btn.disabled = false;
      btn.innerText = "Conferma & Invia Profilo 🚀";
    }
  });

  const modalAuthorUnlock = document.getElementById("modalAuthorUnlock");
  window.openAuthorUnlockModal = function(id) {
    activePostForAuthorUnlock = id;
    document.getElementById("inputAuthorPinUnlock").value = "";
    document.getElementById("authorResultBox").style.display = "none";
    modalAuthorUnlock.classList.add("open");
  };
  document.getElementById("btnCloseAuthorUnlock").addEventListener("click", () => modalAuthorUnlock.classList.remove("open"));

  document.getElementById("btnConfirmAuthorUnlock").addEventListener("click", async () => {
    const pin = document.getElementById("inputAuthorPinUnlock").value.trim();
    if (!pin || pin.length !== 4) {
      alert("Inserisci il tuo PIN a 4 cifre.");
      return;
    }

    const resBox = document.getElementById("authorResultBox");
    try {
      const { data, error } = await sbClient.rpc('sblocca_contatto_autore', {
        p_id: activePostForAuthorUnlock,
        p_pin: pin
      });

      resBox.style.display = "block";
      if (!error && data && data.success) {
        triggerHaptic([50, 50]);
        const ig = data.matched_ig.replace('@','');
        resBox.style.background = "rgba(16, 185, 129, 0.15)";
        resBox.style.border = "1px solid #10B981";
        resBox.style.color = "#6EE7B7";
        resBox.innerHTML = `
          🎉 <strong>La persona che cercavi è:</strong><br>
          <a href="https://ig.me/m/${ig}" target="_blank" style="font-size:16px; color:#fff; font-weight:800; text-decoration:underline;">@${ig}</a>
          <div style="font-size:11px; margin-top:6px; color:#E7DEEA;">Tocca per aprire direttamente la chat Instagram!</div>
        `;
      } else {
        triggerHaptic([60]);
        resBox.style.background = "rgba(239, 68, 68, 0.15)";
        resBox.style.border = "1px solid #EF4444";
        resBox.style.color = "#FCA5A5";
        resBox.innerHTML = `❌ PIN non valido o nessun contatto ancora registrato.`;
      }
    } catch (e) {
      console.error(e);
    }
  });

  /* ==============================================
     [JS: 06-CREATE-POST-COOLDOWN]
     ============================================== */
  const modalVault = document.getElementById("modalVaultCreate");
  document.getElementById("btnOpenVaultModal").addEventListener("click", () => modalVault.classList.add("open"));
  document.getElementById("btnCloseVaultModal").addEventListener("click", () => modalVault.classList.remove("open"));

  document.getElementById("vTipo").addEventListener("change", (e) => {
    document.getElementById("spottedFields").style.display = (e.target.value === 'spotted') ? 'block' : 'none';
  });

  document.getElementById("vaultCreateForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    const lastPostTs = parseInt(localStorage.getItem("aura_last_post_ts") || "0", 10);
    const cooldownMs = 10 * 60 * 1000;
    if (Date.now() - lastPostTs < cooldownMs) {
      const remainMins = Math.ceil((cooldownMs - (Date.now() - lastPostTs)) / 60000);
      alert(`Hai inviato un post di recente! Attendi ${remainMins} minuti prima di condividerne un altro ✨`);
      return;
    }

    const submitBtn = document.getElementById("btnSubmitVault");
    submitBtn.disabled = true;

    const tipo = document.getElementById("vTipo").value;
    const polo = document.getElementById("vPolo").value;
    const luogo = document.getElementById("vLuogo").value.trim();
    const titolo = document.getElementById("vTitolo").value.trim();
    const testo = document.getElementById("vTesto").value.trim();

    let handshake_q = null;
    let handshake_hash = null;
    let author_pin = null;

    if (tipo === 'spotted') {
      handshake_q = document.getElementById("vHandshakeQ").value.trim() || null;
      const rawA = document.getElementById("vHandshakeA").value.trim();
      if (rawA) handshake_hash = await sha256(rawA);
      author_pin = document.getElementById("vAuthorPin").value.trim() || null;
    }

    const payload = {
      tipo,
      polo,
      luogo,
      titolo,
      testo,
      soglia_sblocco: (tipo === 'gossip') ? 25 : 1,
      status: 'pending',
      handshake_q,
      handshake_hash,
      author_pin
    };

    try {
      const { error } = await sbClient.from('vault_posts').insert([payload]);
      if (error) throw error;
      localStorage.setItem("aura_last_post_ts", Date.now().toString());
      document.getElementById("vaultCreateForm").reset();
      modalVault.classList.remove("open");
      triggerHaptic([30, 40]);
      alert("Post inviato alla moderazione! Verrà revisionato e rilasciato a breve ✨");
      await loadVaultData();
    } catch (err) {
      alert("Errore invio: " + err.message);
    } finally {
      submitBtn.disabled = false;
    }
  });

  /* ==============================================
     [JS: 07-REACT-FLAG-ACTIONS]
     ============================================== */
  window.reactVault = async function(id, type) {
    const key = `aura_voted_${id}`;
    if (localStorage.getItem(key)) {
      showToast("Hai già votato questo post!");
      return;
    }
    
    localStorage.setItem(key, "1");
    triggerHaptic([35]);
    const countSpan = document.getElementById(`cnt-${type}-${id}`);
    if (countSpan) {
      countSpan.innerText = parseInt(countSpan.innerText || "0", 10) + 1;
    }
    
    const postObj = vaultPosts.find(p => p.id === id);
    if (postObj) {
      postObj.voti_totali = (postObj.voti_totali || 0) + 1;
      if (type === 'fire') postObj.voti_fire = (postObj.voti_fire || 0) + 1;
      if (type === 'skull') postObj.voti_skull = (postObj.voti_skull || 0) + 1;
      if (type === 'redflag') postObj.voti_redflag = (postObj.voti_redflag || 0) + 1;
      if (postObj.voti_totali >= postObj.soglia_sblocco) {
        postObj.is_unlocked = true;
      }
    }
    renderVault();

    try {
      const { data } = await sbClient.rpc('vota_vault_post', { p_id: id, p_vote_type: type });
      if (data && data.success) {
        showToast(data.is_unlocked ? "🎉 Dettagli censurati sbloccati!" : "Voto registrato! 🔥");
        loadVaultData();
      }
    } catch (e) {}
  };

  window.flagVault = async function(id) {
    if (!confirm("Segnalare questo post per contenuto non appropriato?")) return;
    try {
      const { data } = await sbClient.rpc('segnala_vault_post', { p_id: id });
      if (data && data.success) {
        showToast("Segnalazione inviata. Grazie per il contributo!");
        if (data.quarantined) loadVaultData();
      }
    } catch (e) {}
  };

  /* ==============================================
     [JS: 08-MARKET-ENGINE]
     ============================================== */
  function renderMarketCards() {
    const grid = document.getElementById("listingsGrid");
    const query = (document.getElementById("searchInputMarket").value || "").trim().toLowerCase();

    const filtered = listings.filter(item => {
      const campusMatch = (activeCampus === "ALL" || item.polo === activeCampus || item.polo === "Tutti");
      const catMatch = (activeMarketCat === "ALL" || item.categoria === activeMarketCat);
      const queryMatch = !query || (item.titolo && item.titolo.toLowerCase().includes(query));
      return campusMatch && catMatch && queryMatch;
    });

    if (filtered.length === 0) {
      grid.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding: 40px; color:var(--text-muted);">Nessun annuncio per questa ricerca.</div>`;
      return;
    }

    grid.innerHTML = filtered.map(item => `
      <article class="card">
        <div class="card-cover-wrap">
          <span class="tag-campus">${escapeHTML(item.polo)}</span>
          <img class="card-cover" src="${escapeHTML(item.foto_url)}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
          <div class="card-placeholder-fallback" style="display:none;">
            <div class="card-placeholder-icon">${getCategoryIcon(item.categoria)}</div>
            <div class="card-placeholder-text">${escapeHTML(item.categoria.toUpperCase())}</div>
          </div>
        </div>
        <div class="card-content">
          <div class="card-price">${escapeHTML(item.prezzo)}</div>
          <div class="card-title">${escapeHTML(item.titolo)}</div>
          <div class="card-footer-actions">
            <a href="https://ig.me/m/${escapeHTML(item.contatto_ig)}" target="_blank" class="btn-contact">Contatta @${escapeHTML(item.contatto_ig)}</a>
            <button class="btn-card-del" onclick="window.openDeleteMarketModal('${item.id}')" title="Hai venduto? Rimuovi annuncio">🗑️</button>
          </div>
        </div>
      </article>
    `).join('');
  }

  const modalMarketDelete = document.getElementById("modalMarketDelete");
  window.openDeleteMarketModal = function(id) {
    activeMarketIdToDelete = id;
    document.getElementById("inputDeleteMarketPin").value = "";
    modalMarketDelete.classList.add("open");
  };
  document.getElementById("btnCloseMarketDeleteModal").addEventListener("click", () => modalMarketDelete.classList.remove("open"));

  document.getElementById("btnConfirmMarketDelete").addEventListener("click", async () => {
    const pin = document.getElementById("inputDeleteMarketPin").value.trim();
    if (!pin || pin.length !== 4) {
      alert("Inserisci il PIN a 4 cifre associato all'annuncio.");
      return;
    }

    try {
      const { data, error } = await sbClient.rpc('elimina_annuncio_utente', {
        p_id: activeMarketIdToDelete,
        p_pin: pin
      });

      if (!error && data && data.success) {
        triggerHaptic([30, 40]);
        modalMarketDelete.classList.remove("open");
        showToast("Annuncio rimosso con successo! 🛍️");
        loadMarketData();
      } else {
        triggerHaptic([60]);
        alert("PIN non valido. Impossibile cancellare l'annuncio.");
      }
    } catch (err) {
      alert("Errore durante l'eliminazione: " + err.message);
    }
  });

  const modalMarket = document.getElementById("modalMarketCreate");
  document.getElementById("btnOpenMarketModal").addEventListener("click", () => modalMarket.classList.add("open"));
  document.getElementById("btnCloseMarketModal").addEventListener("click", () => modalMarket.classList.remove("open"));

  document.getElementById("createListingForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      titolo: document.getElementById("fTitolo").value.trim(),
      prezzo: document.getElementById("fPrezzo").value.trim(),
      categoria: document.getElementById("fCategoria").value,
      polo: document.getElementById("fPolo").value,
      contatto_ig: document.getElementById("fIg").value.trim().replace(/^@+/, ''),
      foto_url: document.getElementById("fFoto").value.trim(),
      pin: document.getElementById("fPin").value.trim()
    };

    try {
      const { error } = await sbClient.from('annunci').insert([payload]);
      if (error) throw error;
      document.getElementById("createListingForm").reset();
      modalMarket.classList.remove("open");
      triggerHaptic([30, 40]);
      showToast("Annuncio pubblicato sul Market! 🛍️");
      loadMarketData();
    } catch (err) {
      alert("Errore: " + err.message);
    }
  });

  /* ==============================================
     [JS: 09-PILLS-FILTERS-LISTENERS]
     ============================================== */
  document.querySelectorAll('#sectionMarket .pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('#sectionMarket .pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      activeMarketCat = pill.dataset.cat;
      renderMarketCards();
    });
  });

  document.querySelectorAll('#sectionVault .pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('#sectionVault .pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      activeFeedType = pill.dataset.feedType;
      
      const statusRow = document.getElementById("spottedStatusFilterRow");
      if (activeFeedType === 'spotted') {
        statusRow.style.display = 'flex';
      } else {
        statusRow.style.display = 'none';
        activeSpottedStatus = 'ALL';
        document.querySelectorAll('.sub-pill').forEach(sp => sp.classList.remove('active'));
        document.querySelector('.sub-pill[data-spotted-status="ALL"]').classList.add('active');
      }
      renderVault();
    });
  });

  document.querySelectorAll('.sub-pill').forEach(subPill => {
    subPill.addEventListener('click', () => {
      document.querySelectorAll('.sub-pill').forEach(sp => sp.classList.remove('active'));
      subPill.classList.add('active');
      activeSpottedStatus = subPill.dataset.spottedStatus;
      renderVault();
    });
  });

  document.getElementById("searchInputMarket").addEventListener("input", debounce(renderMarketCards));
  document.getElementById("searchInputFeed").addEventListener("input", debounce(renderVault));

  /* ==============================================
     [JS: 10-LOAD-DATA-REALTIME]
     ============================================== */
  async function loadMarketData() {
    if (!sbClient) return;
    try {
      const { data } = await sbClient.from('annunci').select('*').order('created_at', { ascending: false });
      if (data) listings = data;
    } catch (e) {}
    renderMarketCards();
  }

  async function loadVaultData() {
    if (!sbClient) return;
    try {
      const { data } = await sbClient.from('vault_posts_public').select('*').order('created_at', { ascending: false });
      if (data) vaultPosts = data;
    } catch (e) {}
    renderVault();
  }

  loadMarketData();
  loadVaultData();
  setInterval(renderVault, 10000);

  if (sbClient) {
    sbClient.channel('realtime_public_aura_student_v7')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'annunci' }, loadMarketData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vault_posts' }, loadVaultData)
      .subscribe();
  }
})();
