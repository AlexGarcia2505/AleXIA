// alexia_logic.js - CEREBRO MAESTRO (MODULAR)
// Este archivo es autosuficiente y contiene la configuración de Firebase integrada.

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import { getFirestore, doc, onSnapshot, setDoc, updateDoc, arrayUnion, arrayRemove, getDoc, writeBatch } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, sendEmailVerification } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

// =========================================================================
// I. CONFIGURACIÓN E INICIALIZACIÓN GLOBAL (AUTÓNOMA)
// =========================================================================

// TU CONFIGURACIÓN DE FIREBASE
const firebaseConfig = {
    apiKey: "AIzaSyAeNVoB1ZasZSauIf6G7GbIa4bbJJ3_5cw",
    authDomain: "alexia-1c4f2.firebaseapp.com",
    projectId: "alexia-1c4f2",
    storageBucket: "alexia-1c4f2.firebasestorage.app",
    messagingSenderId: "483778313354",
    appId: "1:483778313354:web:c28c9da35d5674b174c173"
};

let app, db, auth, provider;
try {
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);
    provider = new GoogleAuthProvider();
    const dot = document.getElementById('connection-dot');
    if(dot) { dot.classList.add('online'); dot.classList.remove('offline'); }
} catch(e) { 
    console.error("Firebase Init Error:", e);
    // No alert aquí para no bloquear el acceso
}

// Variables de Estado
let currentUser = null;
let brain = { memory: [], reviewQueue: [], missingLog: [] };
let currentChatId = null;
let chatState = { mode: 'normal', lastQuery: '' }; 
let activeSuggestions = JSON.parse(sessionStorage.getItem('alexia_active_suggestions')) || []; 
let isVoiceActive = false;
let recognition;
let synth = window.speechSynthesis;
let wasVoiceInput = false;

// Constantes
const ADMIN_EMAIL = "eljacksonyt@gmail.com";
const slangMap = { "andas": "estas", "onda": "pasa", "hubo": "paso", "pex": "pasa", "pedo": "problema", "chido": "bueno", "padre": "bueno", "gwey": "amigo", "wey": "amigo", "camara": "adios", "simon": "si", "nelson": "no", "chale": "que mal", "neto": "verdad", "neta": "verdad", "jalo": "acepto", "sobres": "esta bien" };
const stopWords = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'y', 'o', 'de', 'del', 'al', 'a', 'en', 'por', 'para', 'con', 'sin', 'que', 'como', 'cual', 'quien', 'es', 'son', 'fue', 'era', 'me', 'te', 'se', 'lo', 'mi', 'tu', 'su', 'nos', 'yo', 'tu', 'el', 'ella', 'dime', 'sobre', 'acerca', 'significa', 'busco', 'esta', 'está', 'cómo', 'hay', 'eres', 'soy', 'somos', 'todo', 'bien', 'tal', 'gracias']);

// Inicialización de Voz
if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.lang = 'es-MX'; recognition.continuous = false; recognition.interimResults = false;
    recognition.onstart = () => { isVoiceActive = true; document.getElementById('mic-btn').classList.add('listening'); document.getElementById('chat-input').placeholder = "Escuchando..."; };
    recognition.onend = () => { isVoiceActive = false; document.getElementById('mic-btn').classList.remove('listening'); document.getElementById('chat-input').placeholder = "Pregunta algo..."; };
    recognition.onresult = (event) => { document.getElementById('chat-input').value = event.results[0][0].transcript; wasVoiceInput = true; window.sendMessage(); };
}

// Conexión a Base de Datos en Tiempo Real
if(db) onSnapshot(doc(db, "alexia_db", "main_brain"), (snap) => { if(snap.exists()) brain = snap.data(); });

// Autenticación (Se mantiene al final del archivo por la lógica asíncrona)
onAuthStateChanged(auth, async (user) => {
    if (user) {
        if (!user.emailVerified) return;
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);
        let role = "user";
        if(user.email === ADMIN_EMAIL) role = "admin";
        else if (userSnap.exists()) role = userSnap.data().role || "user";
        if (!userSnap.exists()) await setDoc(userRef, { email: user.email, role: role, createdAt: new Date().toISOString() });
        currentUser = { uid: user.uid, name: user.displayName || user.email.split('@')[0], role: role, email: user.email };
        window.updateUserUI(currentUser);
        window.renderLocalHistory();
        window.closeModal(); 
    } else { 
        currentUser = null; 
        window.updateUserUI(null); 
        currentChatId = null; 
        window.renderLocalHistory(); 
    }
    const lastChatId = localStorage.getItem('alexia_last_chat_id');
    if (lastChatId) window.loadLocalChat(lastChatId);
});

// =========================================================================
// II. UTILIDADES Y LÓGICA DE BAJO NIVEL
// =========================================================================
window.normalize = (str) => String(str||'').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[¿?¡!.,]/g, "").trim();
const processSynonyms = (text) => text.split(" ").map(w => { const cw = window.normalize(w); return slangMap[cw] || cw; }).join(" ");
const removeDuplicates = (text) => [...new Set(text.split(/\s+/))].join(" ");
const truncateLog = (text) => { if (!text) return ""; let limit = text.split('\n')[0]; if (limit.length > 100) limit = limit.substring(0, 100) + "..."; return limit; }

// =========================================================================
// III. MOTOR DE INTENCIÓN (NEURO-ROUTER)
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

// ... (Resto de funciones fetch, síntesis y UI/UX) ...

// =========================================================================
// IV. MÓDULOS DE CONOCIMIENTO (7 APIs Gratuitas)
// =========================================================================

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


// =========================================================================
// V. FUNCIONES PÚBLICAS (Expuestas a window para que el HTML funcione)
// =========================================================================
window.toggleUserMenu = (e) => { e.stopPropagation(); document.getElementById('user-dropdown').classList.toggle('show'); }
window.toggleSuggestions = () => { document.getElementById('suggestions-popup').classList.toggle('show'); }
window.toggleSidebar = () => { document.getElementById('sidebar').classList.toggle('open'); document.getElementById('overlay').classList.toggle('active'); }
window.toggleVoice = () => { if(isVoiceActive) recognition.stop(); else recognition.start(); }
window.emergencyReset = (e) => { if(e) e.stopPropagation(); if(confirm("⚠️ ¿Restablecer aplicación?")) { localStorage.clear(); sessionStorage.clear(); window.location.reload(); } };
window.useSuggestion = (query) => { document.getElementById('suggestions-popup').classList.remove('show'); document.getElementById('chat-input').value = query; window.sendMessage(); }
window.openDash = () => { document.getElementById('admin-dash').style.display = 'flex'; /* renderAdminQueue debe ser implementada */ }
window.closeDash = () => document.getElementById('admin-dash').style.display = 'none';
window.openLogin = () => { if(!currentUser) document.getElementById('auth-modal').style.display = 'flex'; }
window.closeModal = () => document.getElementById('auth-modal').style.display = 'none';
window.closeVerify = () => document.getElementById('verify-modal').style.display = 'none';

window.emailLogin = (e) => { /* ... lógica de login ... */ };
window.startNewChat = () => { /* ... lógica de chat nuevo ... */ };
window.renderLocalHistory = () => { /* ... lógica de renderizado ... */ };
window.updateUserUI = (u) => { /* ... lógica de UI de usuario ... */ };
window.loadLocalChat = (id) => { /* ... lógica de carga ... */ };
window.rateAnswer = (type, query, btnElement) => { /* ... lógica de enseñanza ... */ };
window.saveLocalChat = (uMsg, aiMsg) => { /* ... lógica de guardado ... */ };
window.generateSuggestions = () => { /* ... lógica de sugerencias ... */ };

// Funciones de Login y Auth (Placeholder para evitar errores de ReferenceError)
window.showAuth = (type) => { /* ... */ };
window.emailLogin = () => { /* ... */ };
window.emailRegister = () => { /* ... */ };
window.googleLogin = () => { /* ... */ };
window.logout = () => { /* ... */ };
window.uploadDictionary = () => { /* ... */ };


// ... (El resto de la lógica de sendMessage) ...

window.sendMessage = async function() {
    if(!db) return alert("Cargando cerebro... espera unos segundos.");
    const input = document.getElementById('chat-input');
    const originalText = input.value.trim();
    if(!originalText) return;

    // Modo Enseñanza
    if (chatState.mode === 'waiting_correction') { /* ... lógica de enseñanza ... */ }

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
        // Plantilla Dinámica
        const url = responseData.url || (intention.intent === 'wikipedia' ? responseData.url : null);
        const template = `¡Claro! Encontré información sobre tu consulta (${intention.intent.toUpperCase()}):<br><br><div class="rich-content">${responseData.def}</div>${url ? `<div class="rich-source"><a href="${url}" target="_blank"><i class="fas fa-external-link-alt"></i> Fuente: ${responseData.src}</a></div>` : ''}`;
        finalResponse = template;
    } else {
        // Registrar error
        if(db) setDoc(doc(db, "alexia_db", "main_brain"), { missingLog: arrayUnion({ q: truncateLog(originalText), a: "Sin respuesta", date: new Date().toISOString() }) }, { merge: true }).catch(e=>{});
    }

    await window.finishResponse(originalText, finalResponse, true, true);
    wasVoiceInput = false;
}

// Iniciar Enter listener
const inputField = document.getElementById('chat-input');
if(inputField) inputField.addEventListener('keypress', (e) => { if(e.key === 'Enter') window.sendMessage(); });
