/* ==============================================
   [JS: 01-CONFIG] - CLIENT SUPABASE & STATO GLOBALE
   ============================================== */
const SUPABASE_URL = "https://pspbdtmwagsuxgrlobcd.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBzcGJkdG13YWdzdXhncmxvYmNkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTExMzk1OTcsImV4cCI6MjEwNjcxNTU5N30.6CpEusUnubJHdp0KTGWnretigjMECOBsVCd_FXmGack";

let sbClient = null;
if (window.supabase && typeof window.supabase.createClient === 'function') {
  sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

// Stato dell'applicazione
const state = {
  campus: 'Tutti',
  vaultFilter: 'ALL',
  vaultPosts: [],
  marketItems: [],
  activeHandshakePost: null,
  pendingDeleteMarketId: null
};

// Funzione crittografica per Handshake e PIN
async function hashSHA256(text) {
  const msgBuffer = new TextEncoder().encode(text.trim().toLowerCase());
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}


/* ==============================================
   [JS: 02-NAV] - SELETTORE CAMPUS & TAB PRINCIPALI
   ============================================== */
document.addEventListener("DOMContentLoaded", () => {
  // Cambio Campus
  document.querySelectorAll(".campus-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".campus-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.campus = btn.getAttribute("data-campus");
      renderVaultFeed();
      renderMarketFeed();
    });
  });

  // Switch Schede (Market vs Vault)
  const tabBtnMarket = document.getElementById("tabBtnMarket");
  const tabBtnVault = document.getElementById("tabBtnVault");
  const paneMarket = document.getElementById("paneMarket");
  const paneVault = document.getElementById("paneVault");

  tabBtnMarket.addEventListener("click", () => {
    tabBtnMarket.classList.add("active");
    tabBtnVault.classList.remove("active");
    paneMarket.style.display = "block";
    paneVault.style.display = "none";
  });

  tabBtnVault.addEventListener("click", () => {
    tabBtnVault.classList.add("active");
    tabBtnMarket.classList.remove("active");
    paneVault.style.display = "block";
    paneMarket.style.display = "none";
  });

  // Filtri feed Vault (Tutti, Gossip, Spotted)
  document.querySelectorAll(".filter-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".filter-chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      state.vaultFilter = chip.getAttribute("data-filter");
      renderVaultFeed();
    });
  });

  // Ricerca live Market
  document.getElementById("marketSearchInput").addEventListener("input", renderMarketFeed);

  // Inizializzazione caricamento dati
  loadVaultPosts();
  loadMarketItems();
  initModals();
});


/* ==============================================
   [JS: 03-VAULT-FEED] - CARICAMENTO, RENDERING & VOTI
   ============================================== */
async function loadVaultPosts() {
  if (!sbClient) return;
  try {
    const { data, error } = await sbClient
      .from('vault_posts')
      .select('*')
      .eq('status', 'active')
      .order('created_at', { ascending: false });

    if (!error && data) {
      state.vaultPosts = data;
      renderVaultFeed();
    }
  } catch (err) {
    console.error("Errore recupero Vault:", err);
  }
}

function renderVaultFeed() {
  const container = document.getElementById("vaultListContainer");
  if (!container) return;

  const filtered = state.vaultPosts.filter(p => {
    const matchCampus = (state.campus === 'Tutti' || p.polo === state.campus || p.polo === 'Tutti');
    const matchType = (state.vaultFilter === 'ALL' || p.tipo === state.vaultFilter);
    return matchCampus && matchType;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px 16px; color: var(--text-muted); font-size: 13px;">
        Nessun post presente per questa selezione.
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(p => {
    const isSpotted = (p.tipo === 'spotted');
    const badgeClass = isSpotted ? 'badge-spotted' : 'badge-gossip';
    const badgeLabel = isSpotted ? '👀 SPOTTED' : '💣 GOSSIP';

    // Gestione testo con censura parziale o sbloccato
    let bodyHtml = '';
    if (p.is_unlocked) {
      bodyHtml = `<div class="vault-body-text">${p.testo.replace(/\[(.*?)\]/g, '<strong>$1</strong>')}</div>`;
    } else {
      const masked = p.testo.replace(/\[(.*?)\]/g, '████████');
      bodyHtml = `
        <div class="vault-body-text">${masked}</div>
        <div class="censored-block">
          🔒 Dettaglio censurato • Sblocco a ${p.soglia_sblocco || 25} reazioni (Attuali: ${p.voti_totali || 0})
        </div>
      `;
    }

    // Se è Spotted con handshake
    let handshakeBtn = '';
    if (isSpotted && p.handshake_hash) {
      handshakeBtn = `
        <button class="btn btn-accent" style="padding: 5px 10px; font-size: 11px; margin-left: auto;" onclick="openHandshakeModal('${p.id}')">
          ${p.has_match ? '🎯 Risolto' : '👀 Sono io!'}
        </button>
      `;
    }

    return `
      <article class="vault-card" id="vault-card-${p.id}">
        <div class="vault-header">
          <span class="vault-badge ${badgeClass}">${badgeLabel} • ${p.polo}</span>
          <span class="vault-place">📍 ${p.luogo}</span>
        </div>
        <h4 class="vault-title">${p.titolo}</h4>
        ${bodyHtml}
        <div class="reactions-bar">
          <button class="react-btn" onclick="voteVault('${p.id}', 'fire')">🔥 ${p.voti_fire || 0}</button>
          <button class="react-btn" onclick="voteVault('${p.id}', 'skull')">💀 ${p.voti_skull || 0}</button>
          <button class="react-btn" onclick="voteVault('${p.id}', 'redflag')">🚩 ${p.voti_redflag || 0}</button>
          ${handshakeBtn}
        </div>
      </article>
    `;
  }).join('');
}

async function voteVault(id, reactionType) {
  const storageKey = `aura_voted_${id}`;
  if (localStorage.getItem(storageKey)) {
    alert("Hai già votato questo post!");
    return;
  }

  try {
    const { data, error } = await sbClient.rpc('vota_vault_post', {
      p_id: id,
      p_reaction: reactionType
    });

    if (!error) {
      localStorage.setItem(storageKey, reactionType);
      await loadVaultPosts();
    }
  } catch (err) {
    console.error("Errore voto:", err);
  }
}

// Invia Post anonimo alla moderazione
// Invia Post anonimo alla moderazione (con Cooldown Anti-Spam di 5 min)
document.getElementById("btnSubmitVault").addEventListener("click", async () => {
  // --- CONTROLLO COOLDOWN ANTI-SPAM ---
  const lastPostTime = localStorage.getItem("aura_last_post_ts");
  if (lastPostTime && (Date.now() - parseInt(lastPostTime)) < 5 * 60 * 1000) {
    const minRestanti = Math.ceil((5 * 60 * 1000 - (Date.now() - parseInt(lastPostTime))) / 60000);
    alert(`Frena! Devi attendere ancora ${minRestanti} minuti prima di pubblicare un altro post.`);
    return;
  }

  const tipo = document.querySelector('input[name="vaultType"]:checked').value;
  const polo = document.getElementById("vaultPoloInput").value;
  const luogo = document.getElementById("vaultLuogoInput").value.trim();
  const titolo = document.getElementById("vaultTitoloInput").value.trim();
  const testo = document.getElementById("vaultTestoInput").value.trim();

  if (!luogo || !titolo || !testo) {
    alert("Compila tutti i campi obbligatori!");
    return;
  }

  let handshakeData = { handshake_q: null, handshake_hash: null, contact_ig: null };
  if (tipo === 'spotted') {
    const q = document.getElementById("vaultHandshakeQ").value.trim();
    const a = document.getElementById("vaultHandshakeA").value.trim();
    const ig = document.getElementById("vaultContactIG").value.trim().replace('@', '');
    if (q && a && ig) {
      handshakeData.handshake_q = q;
      handshakeData.handshake_hash = await hashSHA256(a);
      handshakeData.contact_ig = ig;
    }
  }

  try {
    const { error } = await sbClient.from('vault_posts').insert([{
      tipo,
      polo,
      luogo,
      titolo,
      testo,
      status: 'pending',
      handshake_q: handshakeData.handshake_q,
      handshake_hash: handshakeData.handshake_hash,
      contact_ig: handshakeData.contact_ig,
      soglia_sblocco: 25
    }]);

    if (!error) {
      // Salva il timestamp per bloccare lo spam
      localStorage.setItem("aura_last_post_ts", Date.now().toString());

      alert("Post inviato! Verrà pubblicato appena revisionato dallo staff.");
      closeModal('modalVaultCreate');
      document.getElementById("vaultLuogoInput").value = '';
      document.getElementById("vaultTitoloInput").value = '';
      document.getElementById("vaultTestoInput").value = '';
    } else {
      alert("Errore invio: " + error.message);
    }
  } catch (err) {
    console.error(err);
  }
});

/* ==============================================
   [JS: 04-HANDSHAKE] - SPOTTED VERIFICA & SBLOCCO
   ============================================== */
window.openHandshakeModal = function(id) {
  const post = state.vaultPosts.find(p => p.id === id);
  if (!post || !post.handshake_q) return;

  state.activeHandshakePost = post;
  document.getElementById("handshakeQuestionText").innerText = `Domanda di verifica: "${post.handshake_q}"`;
  document.getElementById("handshakeAnswerInput").value = '';
  document.getElementById("handshakeResultBox").innerHTML = '';
  openModal('modalHandshake');
};

document.getElementById("btnSubmitHandshake").addEventListener("click", async () => {
  if (!state.activeHandshakePost) return;

  const answer = document.getElementById("handshakeAnswerInput").value.trim();
  if (!answer) return;

  const computedHash = await hashSHA256(answer);
  const resultBox = document.getElementById("handshakeResultBox");

  if (computedHash === state.activeHandshakePost.handshake_hash) {
    const ig = state.activeHandshakePost.contact_ig;
    resultBox.innerHTML = `
      <div style="background: rgba(16, 185, 129, 0.15); border: 1px solid var(--aura-green); padding: 12px; border-radius: 8px; margin-top: 12px; text-align: center;">
        <div style="color: #6EE7B7; font-weight: 800; font-size: 13px;">Risposta corretta! È un match! 🎉</div>
        <div style="font-size: 12px; margin-top: 6px;">Contatta la persona su Instagram:</div>
        <a href="https://instagram.com/${ig}" target="_blank" style="color: var(--rose-gold-light); font-weight: 800; font-size: 14px; text-decoration: underline;">@${ig}</a>
      </div>
    `;
    // Aggiorna stato match nel database
    await sbClient.from('vault_posts').update({ has_match: true }).eq('id', state.activeHandshakePost.id);
  } else {
    resultBox.innerHTML = `
      <div style="background: rgba(239, 68, 68, 0.15); border: 1px solid var(--aura-red); color: #FCA5A5; padding: 10px; border-radius: 8px; margin-top: 12px; font-size: 12px; text-align: center;">
        Risposta errata. Riprova con un'altra risposta.
      </div>
    `;
  }
});


/* ==============================================
   [JS: 05-MARKET-FEED] - CARICAMENTO & RICERCA MARKET
   ============================================== */
async function loadMarketItems() {
  if (!sbClient) return;
  try {
    const { data, error } = await sbClient
      .from('annunci_market')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data) {
      state.marketItems = data;
      renderMarketFeed();
    }
  } catch (err) {
    console.error("Errore caricamento Market:", err);
  }
}

function renderMarketFeed() {
  const container = document.getElementById("marketListContainer");
  if (!container) return;

  const query = (document.getElementById("marketSearchInput").value || "").toLowerCase().trim();

  const filtered = state.marketItems.filter(item => {
    const matchCampus = (state.campus === 'Tutti' || item.polo === state.campus || item.polo === 'Tutti');
    const matchQuery = !query || item.titolo.toLowerCase().includes(query) || item.categoria.toLowerCase().includes(query);
    return matchCampus && matchQuery;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 40px 16px; color: var(--text-muted); font-size: 13px;">
        Nessun annuncio trovato nel Marketplace.
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(item => `
    <div class="market-card" id="market-card-${item.id}">
      <img class="market-img" src="${item.foto_url}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22><rect width=%22100%22 height=%22100%22 fill=%22%23110D18%22/><text x=%2250%%22 y=%2250%%22 fill=%22%23E2B49A%22 text-anchor=%22middle%22 dy=%22.3em%22 font-family=%22sans-serif%22 font-size=%2212%22>AURA</text></svg>';">
      <div class="market-content">
        <div style="font-size: 10.5px; color: var(--rose-gold); font-weight: 700; margin-bottom: 2px;">
          ${item.categoria} • ${item.polo}
        </div>
        <div class="market-price">${item.prezzo}</div>
        <div class="market-title">${item.titolo}</div>
        <div class="market-footer">
          <a href="https://ig.me/m/${item.contatto_ig}" target="_blank" class="btn btn-primary" style="padding: 6px 12px; font-size: 11px;">
            Contatta @${item.contatto_ig}
          </a>
          <button class="btn btn-danger" style="padding: 6px 10px; font-size: 10.5px;" onclick="promptDeleteMarket('${item.id}')">
            Venduto? ✕
          </button>
        </div>
      </div>
    </div>
  `).join('');
}


/* ==============================================
   [JS: 06-MARKET-ACTIONS] - CREAZIONE & RIMOZIONE PIN
   ============================================== */
document.getElementById("btnSubmitMarket").addEventListener("click", async () => {
  // Cooldown Anti-Spam (3 minuti)
  const lastMarketTime = localStorage.getItem("aura_last_market_ts");
  if (lastMarketTime && (Date.now() - parseInt(lastMarketTime)) < 3 * 60 * 1000) {
    const minRestanti = Math.ceil((3 * 60 * 1000 - (Date.now() - parseInt(lastMarketTime))) / 60000);
    alert(`Attendi ancora ${minRestanti} minuti prima di pubblicare un altro annuncio.`);
    return;
  }

  const titolo = document.getElementById("marketTitoloInput").value.trim();
  const categoria = document.getElementById("marketCatInput").value;
  const polo = document.getElementById("marketPoloInput").value;
  const prezzo = document.getElementById("marketPrezzoInput").value.trim();
  const contatto_ig = document.getElementById("marketIgInput").value.trim().replace('@', '');
  const foto_url = document.getElementById("marketFotoInput").value.trim();
  const pin = document.getElementById("marketPinInput").value.trim();

  if (!titolo || !prezzo || !contatto_ig || pin.length !== 4) {
    alert("Compila tutti i campi richiesti e inserisci un PIN di 4 cifre!");
    return;
  }

  const pinHash = await hashSHA256(pin);

  try {
    const { error } = await sbClient.from('annunci_market').insert([{
      titolo,
      categoria,
      polo,
      prezzo,
      contatto_ig,
      foto_url: foto_url || 'logo.png',
      pin_hash: pinHash
    }]);

    if (!error) {
      localStorage.setItem("aura_last_market_ts", Date.now().toString());
      alert("Annuncio pubblicato!");
      closeModal('modalMarketCreate');
      document.getElementById("marketTitoloInput").value = '';
      document.getElementById("marketPrezzoInput").value = '';
      document.getElementById("marketIgInput").value = '';
      document.getElementById("marketFotoInput").value = '';
      document.getElementById("marketPinInput").value = '';
      loadMarketItems();
    } else {
      alert("Errore salvataggio: " + error.message);
    }
  } catch (err) {
    console.error(err);
  }
});

// Apertura modale eliminazione annuncio con PIN
window.promptDeleteMarket = function(id) {
  state.pendingDeleteMarketId = id;
  document.getElementById("deletePinInput").value = '';
  openModal('modalMarketDelete');
};

document.getElementById("btnConfirmDeleteMarket").addEventListener("click", async () => {
  if (!state.pendingDeleteMarketId) return;

  const pin = document.getElementById("deletePinInput").value.trim();
  if (pin.length !== 4) {
    alert("Inserisci il PIN di 4 cifre.");
    return;
  }

  const enteredHash = await hashSHA256(pin);

  try {
    const { data: item, error: fetchErr } = await sbClient
      .from('annunci_market')
      .select('pin_hash')
      .eq('id', state.pendingDeleteMarketId)
      .single();

    if (fetchErr || !item) {
      alert("Annuncio non trovato.");
      return;
    }

    if (item.pin_hash === enteredHash) {
      await sbClient.from('annunci_market').delete().eq('id', state.pendingDeleteMarketId);
      alert("Annuncio rimosso con successo!");
      closeModal('modalMarketDelete');
      state.pendingDeleteMarketId = null;
      loadMarketItems();
    } else {
      alert("PIN errato! Impossibile rimuovere l'annuncio.");
    }
  } catch (err) {
    console.error(err);
  }
});


/* ==============================================
   [JS: 07-MODALS-UTILS] - APERTURA, CHIUSURA MODALI
   ============================================== */
function initModals() {
  // Toggle campi extra handshake su Spotted
  document.querySelectorAll('input[name="vaultType"]').forEach(r => {
    r.addEventListener("change", (e) => {
      const extraFields = document.getElementById("spottedExtraFields");
      if (extraFields) {
        extraFields.style.display = (e.target.value === 'spotted') ? 'block' : 'none';
      }
    });
  });

  // Tasti apertura modali
  document.getElementById("btnOpenCreateMarket").addEventListener("click", () => openModal('modalMarketCreate'));
  document.getElementById("btnOpenCreateVault").addEventListener("click", () => openModal('modalVaultCreate'));

  // Tasti chiusura modali (X)
  document.querySelectorAll(".modal-close").forEach(btn => {
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-close");
      closeModal(targetId);
    });
  });

  // Chiusura al click fuori dal popup
  document.querySelectorAll(".modal-backdrop").forEach(backdrop => {
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) backdrop.classList.remove("open");
    });
  });
}

function openModal(modalId) {
  const el = document.getElementById(modalId);
  if (el) el.classList.add("open");
}

function closeModal(modalId) {
  const el = document.getElementById(modalId);
  if (el) el.classList.remove("open");
}