// alexia_logic.js - CEREBRO MAESTRO (VERSION 4.3 - FINAL FIX)

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import { getFirestore, doc, onSnapshot, setDoc, updateDoc, arrayUnion, arrayRemove, getDoc, writeBatch } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, sendEmailVerification } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

// =========================================================================
// I. INICIALIZACIÓN DE FIREBASE (Usa la configuración del HTML)
// =========================================================================
let app, db, auth, provider;
try {
    // Verificar que la configuración exista
    if (typeof window.FIREBASE_CONFIG === 'undefined') throw new Error("Firebase config not exposed globally.");
    
    app = initializeApp(window.FIREBASE_CONFIG); 
    db = getFirestore(app);
    auth = getAuth(app);
    provider = new GoogleAuthProvider();
    const dot = document.getElementById('connection-dot');
    if(dot) { dot.classList.add('online'); dot.classList.remove('offline'); }
} catch(e) { 
    console.error("Firebase Init Error:", e);
    // Si falla, el sitio carga, pero la funcionalidad de login y DB estará muerta.
}

// Variables de Estado
let currentUser = null;
let brain = { memory: [], reviewQueue: [], missingLog: [] };
let currentChatId = null;
let chatState = { mode: 'normal', lastQuery: '' }; 
let isVoiceActive = false;
let recognition;
let synth = window.speechSynthesis;
let wasVoiceInput = false;

// Constantes
const ADMIN_EMAIL = window.ADMIN_EMAIL || "eljacksonyt@gmail.com";
const slangMap = { "andas": "estas", "onda": "pasa", "hubo": "paso", "pex": "pasa", "pedo": "problema", "chido": "bueno", "padre": "bueno", "gwey": "amigo", "wey": "amigo", "camara": "adios", "simon": "si", "nelson": "no", "chale": "que mal", "neto": "verdad", "neta": "verdad", "jalo": "acepto", "sobres": "esta bien" };
const stopWords = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'y', 'o', 'de', 'del', 'al', 'a', 'en', 'por', 'para', 'con', 'sin', 'que', 'como', 'cual', 'quien', 'es', 'son', 'fue', 'era', 'me', 'te', 'se', 'lo', 'mi', 'tu', 'su', 'nos', 'yo', 'tu', 'el', 'ella', 'dime', 'sobre', 'acerca', 'significa', 'busco', 'esta', 'está', 'cómo', 'hay', 'eres', 'soy', 'somos', 'todo', 'bien', 'tal', 'gracias']);
const randomTopics = ["Universo", "Inteligencia Artificial", "Historia de México", "Biología", "Arte Moderno", "Filosofía", "Tecnología", "Dinosaurios", "Psicología", "Música Clásica"];


// =========================================================================
// II. FUNCIONES PÚBLICAS (EXPUESTAS AL INICIO PARA EVITAR CONFLICTOS)
// =========================================================================
window.normalize = (str) => String(str||'').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[¿?¡!.,]/g, "").trim();
window.toggleSidebar = () => { document.getElementById('sidebar').classList.toggle('open'); document.getElementById('overlay').classList.toggle('active'); }
window.toggleUserMenu = (e) => { e.stopPropagation(); document.getElementById('user-dropdown').classList.toggle('show'); }
window.toggleSuggestions = () => { document.getElementById('suggestions-popup').classList.toggle('show'); }
window.toggleVoice = () => { if(isVoiceActive) recognition.stop(); else recognition.start(); }
window.emergencyReset = (e) => { if(e) e.stopPropagation(); if(confirm("⚠️ ¿Restablecer aplicación?")) { localStorage.clear(); sessionStorage.clear(); window.location.reload(); } };
window.openLogin = () => { if(!currentUser) document.getElementById('auth-modal').style.display = 'flex'; }
window.closeModal = () => document.getElementById('auth-modal').style.display = 'none';
window.closeVerify = () => document.getElementById('verify-modal').style.display = 'none';
window.startNewChat = () => {
    currentChatId = null; 
    localStorage.removeItem('alexia_last_chat_id'); 
    chatState = { mode: 'normal' }; 
    document.getElementById('chat-box').innerHTML = `<div style="text-align:center; margin-top:80px; opacity:0.7; animation:fadeIn 1s;"><div style="width:80px; height:80px; background:linear-gradient(135deg, var(--accent), #ec4899); border-radius:50%; margin:0 auto 25px auto; display:flex; align-items:center; justify-content:center; box-shadow:0 0 40px var(--accent-glow);"><i class="fas fa-robot" style="font-size:40px; color:white;"></i></div><h2 style="font-weight:500;">¿Qué tienes en mente?</h2></div>`; 
    window.renderLocalHistory(); 
    if(window.innerWidth < 800) { document.getElementById('sidebar').classList.remove('open'); document.getElementById('overlay').classList.remove('active'); }
}
window.showAuth = (type) => { 
    if(type === 'login') { document.getElementById('section-login').style.display = 'block'; document.getElementById('section-register').style.display = 'none'; document.getElementById('tab-login').classList.add('active'); document.getElementById('tab-register').classList.remove('active'); } 
    else { document.getElementById('section-login').style.display = 'none'; document.getElementById('section-register').style.display = 'block'; document.getElementById('tab-login').classList.remove('active'); document.getElementById('tab-register').classList.add('active'); } 
}
window.emailLogin = () => { const e=document.getElementById('l-email').value, p=document.getElementById('l-pass').value; signInWithEmailAndPassword(auth, e, p).then((c)=>{if(!c.user.emailVerified){document.getElementById('verify-modal').style.display='flex';signOut(auth);}else window.closeModal();}).catch(e=>alert(e.message)); };
window.logout = (e) => { if(e) e.stopPropagation(); const key = `alexia_chats_${currentUser ? currentUser.uid : 'guest'}`; localStorage.removeItem(key); localStorage.removeItem('alexia_last_chat_id'); signOut(auth).then(() => { window.location.reload(); }); }
window.uploadDictionary = async () => { alert("Lógica de carga no implementada."); };
window.openDash = () => { document.getElementById('admin-dash').style.display = 'flex'; /* renderAdminQueue debe ser implementada */ }
window.closeDash = () => document.getElementById('admin-dash').style.display = 'none';
window.emailRegister = () => { const e=document.getElementById('r-email').value, p=document.getElementById('r-pass').value; createUserWithEmailAndPassword(auth, e, p).then(async(c)=>{await sendEmailVerification(c.user);document.getElementById('auth-modal').style.display='none';document.getElementById('verify-modal').style.display='flex';}).catch(e=>alert(e.message)); };
window.googleLogin = () => signInWithPopup(auth, provider).then(()=>window.closeModal()).catch(e=>alert(e.message));


// =========================================================================
// III. FUNCIONES SECUNDARIAS
// =========================================================================
const processSynonyms = (text) => text.split(" ").map(w => { const cw = window.normalize(w); return slangMap[cw] || cw; }).join(" ");
const removeDuplicates = (text) => [...new Set(text.split(/\s+/))].join(" ");
const truncateLog = (text) => { if (!text) return ""; let limit = text.split('\n')[0]; if (limit.length > 100) limit = limit.substring(0, 100) + "..."; return limit; }

// UTILS DE CHAT
window.appendMsg = (role, text, hasControls = false, customId = null) => {
    const box = document.getElementById('chat-box');
    const row = document.createElement('div'); row.className = `msg-row ${role}-row`; if (customId) row.id = customId;
    let controlsHTML = '';
    if (role === 'ai' && hasControls) {
        const safeText = text.replace(/'/g, "").replace(/"/g, "").replace(/\n/g, " ");
        const btnId = `btn-${customId}`;
        controlsHTML = `<button id="${btnId}" class="tts-btn" onclick="window.speakText('${safeText}', '${btnId}')"><i class="fas fa-volume-up"></i></button>`;
    }
    const icon = role === 'ai' ? `<div class="msg-icon"><i class="fas fa-robot"></i></div>` : '';
    row.innerHTML = `${icon}<div class="msg-bubble">${controlsHTML}${text}</div>`;
    if(box.querySelector('h2')) box.innerHTML = '';
    box.appendChild(row);
    setTimeout(() => { row.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 100);
}
window.finishResponse = async (userTxt, aiTxt, shouldSuggest, showFeedback = false) => {
    const msgId = 'ai-msg-' + Date.now();
    let feedbackHTML = "";
    const safeUserTxt = userTxt.replace(/'/g, "\\'").replace(/"/g, '"').replace(/\n/g, ' ');
    if (showFeedback) {
        feedbackHTML = `<div class="feedback-area"><button class="feedback-btn" onclick="window.rateAnswer('good', '${safeUserTxt}', this)"><i class="fas fa-thumbs-up"></i> Útil</button><button class="feedback-btn bad" onclick="window.rateAnswer('bad', '${safeUserTxt}', this)"><i class="fas fa-graduation-cap"></i> Enseñar</button></div>`;
    }
    window.appendMsg('ai', aiTxt + feedbackHTML, true, msgId); 
    window.saveLocalChat(userTxt, aiTxt + feedbackHTML);
    if (shouldSuggest) window.generateSuggestions();
}
window.rateAnswer = (type, query, btnElement) => {
    if (type === 'good') { alert("¡Me alegra haber ayudado! 😊"); } else {
        if (chatState.mode === 'waiting_correction') {
            chatState = { mode: 'normal', lastQuery: '' };
            btnElement.classList.remove('active-teach'); btnElement.innerHTML = `<i class="fas fa-graduation-cap"></i> Enseñar`;
            window.appendMsg('ai', "Modo enseñanza cancelado.");
        } else {
            chatState = { mode: 'waiting_correction', lastQuery: query };
            document.querySelectorAll('.feedback-btn.active-teach').forEach(b => b.classList.remove('active-teach'));
            btnElement.classList.add('active-teach'); btnElement.innerHTML = `<i class="fas fa-times"></i> Cancelar`;
            window.appendMsg('ai', "Entendido. 😔 ¿Qué respuesta debería haberte dado?");
        }
    }
}
window.generateSuggestions = () => {
    const randomTopics = ["Universo", "Inteligencia Artificial", "Historia de México", "Biología", "Arte Moderno", "Filosofía", "Tecnología", "Dinosaurios", "Psicología", "Música Clásica"];
    activeSuggestions = [];
    const randomTopic = randomTopics[Math.floor(Math.random() * randomTopics.length)];
    activeSuggestions.push({ label: `Wiki: **${randomTopic}**`, query: `informacion de ${randomTopic}` });
    sessionStorage.setItem('alexia_active_suggestions', JSON.stringify(activeSuggestions));
    const ideaBtn = document.getElementById('idea-btn');
    if(ideaBtn) ideaBtn.classList.add('has-ideas');
    const content = document.getElementById('suggestions-content');
    if(content) {
        content.innerHTML = "";
        activeSuggestions.forEach(s => { content.innerHTML += `<div class="sug-item" onclick="window.useSuggestion('${s.query}')">${s.label}</div>`; });
    }
}


// Módulos de Conocimiento (APIs gratuitas)
const fetchBible = async (query) => { 
    try {
        const res = await fetch(`https://bible-api.com/${encodeURIComponent(query)}?translation=rv1960`);
        if (!res.ok) return null;
        const j = await res.json();
        if (j.text) return { def: j.text.replace(/\n/g, '<br>'), src: j.reference };
    } catch (e) { return null; }
    return null;
}
const fetchDictionaryEs = async (word) => { 
    try {
        const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/es/${window.normalize(word)}`);
        if (!res.ok) return null;
        const j = await res.json();
        if (!Array.isArray(j) || j.length === 0) return null;
        let defs = j[0].meanings.flatMap(m => (m.definitions || []).slice(0, 2).map(d => d.definition));
        if (defs.length === 0) return null;
        return { def: defs.slice(0, 3).join('; '), src: 'DictionaryAPI' };
    } catch (e) { return null; }
}
const fetchMeteo = async (city) => { 
    try {
        const geoResp = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=es&format=json`);
        const geoData = await geoResp.json();
        if (geoData.results && geoData.results.length > 0) {
            const place = geoData.results[0];
            const weatherResp = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current_weather=true`);
            const weatherData = await weatherResp.json();
            if (weatherData.current_weather) return { def: `En <b>${place.name}</b>: <b>${weatherData.current_weather.temperature}°C</b>. Viento: ${weatherData.current_weather.windspeed} km/h.`, src: "Open-Meteo" };
        }
    } catch (e) { } return null;
}
const fetchWikipedia = async (term) => { 
    try {
        const enc = encodeURIComponent(term);
        const search = await fetch(`https://es.wikipedia.org/w/api.php?action=opensearch&search=${enc}&limit=1&format=json&origin=*`);
        if (!search.ok) return null;
        const sjson = await search.json();
        if (!sjson[1] || sjson[1].length === 0) return null;
        const title = encodeURIComponent(sjson[1][0]);
        const contentResp = await fetch(`https://es.wikipedia.org/w/api.php?action=query&prop=extracts&titles=${title}&explaintext=1&exintro=1&format=json&origin=*`);
        if (!contentResp.ok) return null;
        const cjson = await contentResp.json();
        const pages = cjson.query && cjson.query.pages;
        const pid = pages && Object.keys(pages)[0];
        if (pid === "-1") return null;
        const text = pages[pid].extract || "";
        return { def: text.split('. ').slice(0, 4).join('. ') + '...', src: 'Wikipedia', url: `https://es.wikipedia.org/?curid=${pid}` };
    } catch (e) { return null; }
}
const fetchOpenLibrary = async (query) => { 
    try {
        const searchResp = await fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=1`);
        const searchData = await searchResp.json();
        if (searchData.docs && searchData.docs.length > 0) {
            const book = searchData.docs[0];
            return { def: `<b>Título:</b> ${book.title}. <b>Autor:</b> ${book.author_name?book.author_name[0]:'?'}.`, src: "OpenLibrary", url: `https://openlibrary.org${book.key}` };
        }
    } catch(e) {} return null;
}
const fetchRestCountries = async (country) => { 
    try {
        const res = await fetch(`https://restcountries.com/v3.1/name/${encodeURIComponent(country)}?fields=capital,languages,population,flags`);
        const j = await res.json();
        if (j && j.length > 0) {
            const c = j[0];
            const lang = Object.values(c.languages).join(', ');
            return { def: `<b>Capital:</b> ${c.capital[0]}. <b>Población:</b> ${c.population.toLocaleString()}. <b>Idiomas:</b> ${lang}.`, src: 'REST Countries' };
        }
    } catch (e) { return null; }
    return null;
}
const sintesisPorPalabraClave = async (words) => { 
    let synthesis = [];
    for (let word of words) {
        let definition = null; let source = "";
        try { 
            const dictSnap = await getDoc(doc(db, "dictionary", word)); 
            if (dictSnap.exists()) { definition = dictSnap.data().def; source = "Memoria/DB"; } 
        } catch(e) {}
        
        if (!definition) { 
            const wikiData = await fetchWikipedia(word); 
            if (wikiData) { definition = wikiData.def; source = "WEB/Wiki"; } 
        }
        if (definition) synthesis.push({ word: word, def: definition, src: source });
    }
    return synthesis;
}


// Lógica de Historial (necesita ser definida)
window.saveLocalChat = (uMsg, aiMsg) => {
    const key = `alexia_chats_${currentUser ? currentUser.uid : 'guest'}`;
    let chats = JSON.parse(localStorage.getItem(key) || '[]') || []; 
    if (!currentChatId) { 
        currentChatId = Date.now().toString(); 
        chats.unshift({ id: currentChatId, title: uMsg.substring(0, 25) + "...", timestamp: Date.now(), isPinned: false, messages: [{r:'user', t:uMsg}, {r:'ai', t:aiMsg}] }); 
    } else { 
        const idx = chats.findIndex(c => c.id === currentChatId); 
        if (idx > -1) { chats[idx].messages.push({r:'user', t:uMsg}, {r:'ai', t:aiMsg}); chats[idx].timestamp = Date.now(); } 
    } 
    localStorage.setItem(key, JSON.stringify(chats)); 
    localStorage.setItem('alexia_last_chat_id', currentChatId); 
    window.renderLocalHistory(); 
}

window.renderLocalHistory = () => {
    const key = `alexia_chats_${currentUser ? currentUser.uid : 'guest'}`;
    let chats = []; try { chats = JSON.parse(localStorage.getItem(key) || '[]') || []; } catch(e) { chats = []; }
    const pc = document.getElementById('pinned-container'); const hc = document.getElementById('history-container'); 
    if(!pc || !hc) return;
    pc.innerHTML = ""; hc.innerHTML = ""; let hasPinned = false;
    if(chats.length === 0) { hc.innerHTML = `<div style="text-align:center; padding:20px; color:#555; font-size:0.85rem;">Historial vacío</div>`; } else { 
        chats.forEach(chat => { 
            const active = (chat.id === currentChatId) ? 'active' : ''; 
            const html = `<div class="chat-item ${active}" onclick="window.loadLocalChat('${chat.id}')"><div class="chat-title"><i class="far fa-comment-alt" style="opacity:0.7; margin-right:8px;"></i>${chat.title}</div></div>`; 
            if (chat.isPinned) { pc.innerHTML += html; hasPinned = true; } else hc.innerHTML += html; 
        }); 
    } 
    const ps = document.getElementById('pinned-section');
    if(ps) ps.style.display = hasPinned ? 'block' : 'none';
}


window.loadLocalChat = (id) => {
    const key = `alexia_chats_${currentUser ? currentUser.uid : 'guest'}`;
    const chats = JSON.parse(localStorage.getItem(key) || '[]') || []; 
    const chat = chats.find(c => c.id === id); 
    if (chat) { 
        currentChatId = id; 
        localStorage.setItem('alexia_last_chat_id', currentChatId); 
        const box = document.getElementById('chat-box'); 
        box.innerHTML = ""; 
        chat.messages.forEach(m => window.appendMsg(m.r, m.t, m.r === 'ai')); 
        window.renderLocalHistory(); 
        if(window.innerWidth < 800) { document.getElementById('sidebar').classList.remove('open'); document.getElementById('overlay').classList.remove('active'); }
    }
}
window.speakText = (text, btnId) => {
    if (synth.speaking) { synth.cancel(); if (window.activeSpeakingBtnId === btnId) { document.querySelectorAll('.tts-btn').forEach(b => { b.classList.remove('speaking'); b.innerHTML = '<i class="fas fa-volume-up"></i>'; }); window.activeSpeakingBtnId = null; return; } }
    const cleanText = text.replace(/<[^>]*>/g, '').replace(/http\S+/g, 'enlace');
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = 'es-MX'; utterance.rate = 1.0;
    utterance.onstart = () => { const btn = document.getElementById(btnId); if(btn) { btn.classList.add('speaking'); btn.innerHTML = '<i class="fas fa-stop"></i>'; window.activeSpeakingBtnId = btnId; } };
    utterance.onend = () => { document.querySelectorAll('.tts-btn').forEach(b => { b.classList.remove('speaking'); b.innerHTML = '<i class="fas fa-volume-up"></i>'; }); window.activeSpeakingBtnId = null; };
    synth.speak(utterance);
};


window.updateUserUI = (u) => {
    const btnLogin = document.getElementById('top-login-btn');
    const headerProfile = document.getElementById('header-user-profile');
    const headerAvatar = document.getElementById('header-avatar');
    const ddName = document.getElementById('dd-name');
    const ddEmail = document.getElementById('dd-email');
    const adminLink = document.getElementById('admin-link-container');
    
    if(u) {
        if(btnLogin) btnLogin.style.display = 'none';
        if(headerProfile) headerProfile.style.display = 'block';
        if(headerAvatar) headerAvatar.innerHTML = u.name[0].toUpperCase();
        if(ddName) ddName.innerText = u.name;
        if(ddEmail) ddEmail.innerText = u.email;
        if(adminLink) adminLink.style.display = (u.role === 'admin') ? 'block' : 'none';
    } else {
        if(btnLogin) btnLogin.style.display = 'block';
        if(headerProfile) headerProfile.style.display = 'none';
    }
}


// =========================================================================
// IV. MOTOR DE INTENCIÓN (NEURO-ROUTER)
// =========================================================================
const detectarIntencion = (texto) => {
    const t = window.normalize(texto);

    // Biblia (Patrón flexible corregido para mateo 1:3)
    if (/(?:biblia|versiculo|cita)\s*.*?(\w+\s\d{1,3}:\d{1,3}(?:\-\d{1,3})?)/i.test(t)) {
        return { intent: "biblia", query: RegExp.$1.trim() }; 
    }
    
    if (/(?:significado|define|que significa|que es|definicion|definir)\s+(.+)/i.test(t)) return { intent: "diccionario", query: RegExp.$1.trim() };
    if (/(?:clima|tiempo)\s+(?:en|de)\s+(.+)/i.test(t)) return { intent: "clima", query: RegExp.$1.trim() };
    if (/(?:libro|obra|autor|novela)\s+(?:de|sobre)?\s*(.+)/i.test(t)) return { intent: "libros", query: RegExp.$1.trim() };
    if (/(?:quien es|que es|como funciona|cuando fue|donde esta|dime sobre|informacion de|biografia de)\s+(.+)/i.test(t)) return { intent: "wikipedia", query: RegExp.$1.trim() };
    if (/(?:capital de|poblacion de|idioma de|país|de dónde es)\s+(.+)/i.test(t)) return { intent: "pais", query: RegExp.$1.trim() };

    return { intent: "general", query: texto };
}


// =========================================================================
// V. FUNCIÓN PRINCIPAL DE ENVÍO
// =========================================================================

window.sendMessage = async function() {
    if(!db) return alert("Cargando cerebro... espera unos segundos.");
    const input = document.getElementById('chat-input');
    const originalText = input.value.trim();
    if(!originalText) return;

    // Modo Enseñanza
    if (chatState.mode === 'waiting_correction') {
        const correction = originalText;
        input.value = '';
        window.appendMsg('user', originalText);
        const sendingMsgId = 'sending-' + Date.now();
        window.appendMsg('ai', `<i class="fas fa-circle-notch fa-spin"></i> Guardando enseñanza...`, false, sendingMsgId);
        try {
            const qData = String(chatState.lastQuery || "Pregunta no detectada");
            await setDoc(doc(db, "alexia_db", "main_brain"), { reviewQueue: arrayUnion({ q: qData, a: correction, user: currentUser ? currentUser.email : "Anónimo", date: new Date().toISOString() }) }, { merge: true });
            const sendingEl = document.getElementById(sendingMsgId);
            if(sendingEl) sendingEl.querySelector('.msg-bubble').innerHTML = `¡Gracias! Respuesta guardada para revisión.`;
            document.querySelectorAll('.feedback-btn.active-teach').forEach(b => { b.classList.remove('active-teach'); b.innerHTML = '<i class="fas fa-graduation-cap"></i> Enseñar'; });
        } catch (e) {
            console.error(e);
        }
        chatState = { mode: 'normal' }; return;
    }

    // Comandos fijos
    const normInput = removeDuplicates(window.normalize(originalText));
    if (normInput.match(/quien (te )?(creo|hizo)|quien eres|que eres|como te llamas/i)) {
        input.value = ''; window.appendMsg('user', originalText);
        await window.finishResponse(originalText, "Soy <b>AleXIA</b>, creada por <b>Alexis García</b>.", false, false); return;
    }

    input.value = ''; window.appendMsg('user', originalText); 
    const loadingId = 'loading-' + Date.now(); window.appendMsg('ai', `<i class="fas fa-circle-notch fa-spin"></i> <span id="think-text">Ruteando consulta...</span>`, false, loadingId);
    
    await new Promise(r => setTimeout(r, 600));
    const loadingMsg = document.getElementById(loadingId); if(loadingMsg) loadingMsg.remove();

    // 1. NEURO-ROUTER
    const intention = detectarIntencion(originalText);
    let responseData = null;

    if (intention.intent !== 'general') {
        const query = intention.query || originalText;
        switch (intention.intent) {
            case 'biblia': responseData = await fetchBible(query); break;
            case 'diccionario': responseData = await fetchDictionaryEs(query); break;
            case 'clima': responseData = await fetchMeteo(query); break;
            case 'libros': responseData = await fetchOpenLibrary(query); break;
            case 'pais': responseData = await fetchRestCountries(query); break;
            case 'wikipedia': responseData = await fetchWikipedia(query); break;
        }
    }
    
    // 2. MEMORIA DE FIREBASE (Si no hubo API)
    if (!responseData) {
        let bestMatch = null, maxScore = 0;
        const interpretedText = processSynonyms(normInput);
        if(brain.memory) {
            brain.memory.forEach(mem => {
                mem.inputs.forEach(key => {
                    const memKey = processSynonyms(key); 
                    if (memKey === interpretedText) { maxScore = 1.0; bestMatch = mem; } 
                    else if (memKey.includes(interpretedText) && interpretedText.length > 3) { if (0.8 > maxScore) { maxScore = 0.8; bestMatch = mem; } }
                });
            });
        }
        if (maxScore >= 0.8) {
            responseData = { def: bestMatch.output, src: "Memoria" };
        }
    }

    // 3. FALLBACK: SÍNTESIS DE PALABRAS
    if (!responseData) {
        const interpretedWords = originalText.split(/\s+/).filter(w => !stopWords.has(window.normalize(w)) && w.length > 2);
        const synthesisResult = await sintesisPorPalabraClave(interpretedWords);
        
        if (synthesisResult.length > 0) {
            let aiResponse = synthesisResult.length === 1 ? `Encontré esto sobre <strong>${synthesisResult[0].word}</strong>:<br>${synthesisResult[0].def}` : `<strong>Analizando conceptos:</strong><br>` + synthesisResult.map(item => `- <b>${item.word}:</b> ${item.def}`).join('<br>');
            aiResponse += "<br><br>¿Te sirve esta información?";
            await window.finishResponse(originalText, aiResponse, true, true);
            return;
        }
    }

    // 4. RESPUESTA FINAL
    let finalResponse = "Lo siento, AleXIA no tiene información sobre eso. ¿Podrías intentar una pregunta más específica o enseñarme usando el botón de birrete?";
    if (responseData) {
        const url = responseData.url || (intention.intent === 'wikipedia' ? responseData.url : null);
        const template = `¡Claro! Encontré información sobre tu consulta (${intention.intent.toUpperCase()}):<br><br><div class="rich-content">${responseData.def}</div>${url ? `<div class="rich-source"><a href="${url}" target="_blank"><i class="fas fa-external-link-alt"></i> Fuente: ${responseData.src}</a></div>` : ''}`;
        finalResponse = template;
    } else {
        if(db) setDoc(doc(db, "alexia_db", "main_brain"), { missingLog: arrayUnion({ q: truncateLog(originalText), a: "Sin respuesta", date: new Date().toISOString() }) }, { merge: true }).catch(e=>{});
    }

    await window.finishResponse(originalText, finalResponse, true, true);
    wasVoiceInput = false;
}

// Inicialización de Voz (continuación)
if (document.getElementById('mic-btn')) {
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
        document.getElementById('mic-btn').style.display = 'none';
    }
}


// Iniciar Enter listener
const inputField = document.getElementById('chat-input');
if(inputField) inputField.addEventListener('keypress', (e) => { if(e.key === 'Enter') window.sendMessage(); });
