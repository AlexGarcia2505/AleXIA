// alexia_logic.js (El Neuro-Router / Cerebro Híbrido)
// Contiene la inicialización de Firebase, la lógica de la IA Híbrida y todas las funciones UI/UX.

(function(){
    // =========================================================================
    // I. CONFIGURACIÓN E INICIALIZACIÓN GLOBAL (Desde window.modules en index.html)
    // =========================================================================
    const { initializeApp, getFirestore, doc, onSnapshot, setDoc, updateDoc, arrayUnion, arrayRemove, getDoc, writeBatch, getAuth, signInWithPopup, GoogleAuthProvider, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, sendEmailVerification } = window.modules;
    
    let app, db, auth, provider;
    try {
        app = initializeApp(window.FIREBASE_CONFIG);
        db = getFirestore(app);
        auth = getAuth(app);
        provider = new GoogleAuthProvider();
        document.getElementById('connection-dot').classList.add('online');
        document.getElementById('connection-dot').classList.remove('offline');
    } catch(e) { 
        console.error("Firebase Init Error:", e);
        alert("Error de conexión: " + e.message); 
        return; 
    }

    let currentUser = null;
    let brain = { memory: [], reviewQueue: [], missingLog: [] };
    let currentChatId = null;
    let chatState = { mode: 'normal', lastQuery: '' }; 
    let activeSuggestions = JSON.parse(sessionStorage.getItem('alexia_active_suggestions')) || []; 
    let isVoiceActive = false;
    let recognition;
    let synth = window.speechSynthesis;
    let wasVoiceInput = false;

    // Constantes para el Motor de Lógica
    const ADMIN_EMAIL = window.ADMIN_EMAIL;
    const randomTopics = ["Universo", "Inteligencia Artificial", "Historia de México", "Biología", "Arte Moderno", "Filosofía", "Tecnología", "Dinosaurios", "Psicología", "Música Clásica"];
    const bookSubjects = ["love", "science", "history", "fantasy", "mystery", "art", "psychology", "mexico"];
    const globalCities = ["Cancún", "Ciudad de México", "Madrid", "Tokio", "Nueva York", "Buenos Aires", "Londres", "París", "Monterrey", "Guadalajara", "Bogotá", "Lima", "Berlín", "Roma"];
    const slangMap = { "andas": "estas", "onda": "pasa", "hubo": "paso", "pex": "pasa", "pedo": "problema", "chido": "bueno", "padre": "bueno", "gwey": "amigo", "wey": "amigo", "camara": "adios", "simon": "si", "nelson": "no", "chale": "que mal", "neto": "verdad", "neta": "verdad", "jalo": "acepto", "sobres": "esta bien" };
    const stopWords = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'y', 'o', 'de', 'del', 'al', 'a', 'en', 'por', 'para', 'con', 'sin', 'que', 'como', 'cual', 'quien', 'es', 'son', 'fue', 'era', 'me', 'te', 'se', 'lo', 'mi', 'tu', 'su', 'nos', 'yo', 'tu', 'el', 'ella', 'dime', 'sobre', 'acerca', 'significa', 'busco', 'esta', 'está', 'cómo', 'hay', 'eres', 'soy', 'somos', 'todo', 'bien', 'tal', 'gracias']);
    
    // Inicialización de la voz
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        recognition = new SpeechRecognition();
        recognition.lang = 'es-MX'; recognition.continuous = false; recognition.interimResults = false;
        recognition.onstart = () => { isVoiceActive = true; document.getElementById('mic-btn').classList.add('listening'); document.getElementById('chat-input').placeholder = "Escuchando..."; };
        recognition.onend = () => { isVoiceActive = false; document.getElementById('mic-btn').classList.remove('listening'); document.getElementById('chat-input').placeholder = "Pregunta algo..."; };
        recognition.onresult = (event) => { document.getElementById('chat-input').value = event.results[0][0].transcript; wasVoiceInput = true; window.sendMessage(); };
    } else { document.getElementById('mic-btn').style.display = 'none'; }

    // Conexión a Firebase
    onAuthStateChanged(auth, async (user) => {
        // Lógica de autenticación y carga de historial
        if (user) { /* ... (user logic) ... */ } else { /* ... (guest logic) ... */ }
        const lastChatId = localStorage.getItem('alexia_last_chat_id');
        if (lastChatId) window.loadLocalChat(lastChatId); // Se llama a loadLocalChat desde el scope global
    });
    if(db) onSnapshot(doc(db, "alexia_db", "main_brain"), (snap) => { if(snap.exists()) brain = snap.data(); });

    // =========================================================================
    // II. UTILIDADES Y LÓGICA DE BAJO NIVEL (Capa de Interpretación)
    // =========================================================================
    window.normalize = (str) => String(str||'').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[¿?¡!.,]/g, "").trim();
    const processSynonyms = (text) => text.split(" ").map(w => { const cw = normalize(w); return slangMap[cw] || cw; }).join(" ");
    const removeDuplicates = (text) => [...new Set(text.split(/\s+/))].join(" ");
    const truncateLog = (text) => { if (!text) return ""; let limit = text.split('\n')[0]; if (limit.length > 100) limit = limit.substring(0, 100) + "..."; return limit; }
    
    // Utilidad de Similitud de Trigramas (para corrección ortográfica leve y fuzzy search)
    const trigrams = (s) => {
        s = window.normalize(s).replace(/[^a-z0-9ñáéíóúü ]+/g,' ');
        s = '  ' + s + '  ';
        const out = new Set();
        for(let i=0;i<s.length-2;i++) out.add(s.slice(i,i+3));
        return out;
    }
    window.trigramSimilarity = (a,b) => {
        if(!a || !b) return 0;
        const A = trigrams(a), B = trigrams(b);
        let inter = 0;
        for(const x of A) if(B.has(x)) inter++;
        const union = new Set([...A,...B]).size;
        return union ? inter/union : 0;
    }

    // =========================================================================
    // III. MOTOR DE INTENCIÓN (NEURO-ROUTER)
    // =========================================================================

    /** Clasifica la consulta en la intención más probable para elegir la API correcta. */
    const detectarIntencion = (texto) => {
        const t = window.normalize(texto);

        // Intenciones de conocimiento especializado (mayor prioridad)
        if (/(?:versiculo|versículo|biblia|cita)\s+(.{1,50})/i.test(t)) return { intent: "biblia", query: RegExp.$1.trim() };
        if (/(?:significado|define|que significa|que es|definicion|definir)\s+(.+)/i.test(t)) return { intent: "diccionario", query: RegExp.$1.trim() };
        if (/(?:clima|tiempo)\s+(?:en|de)\s+(.+)/i.test(t)) return { intent: "clima", query: RegExp.$1.trim() };
        if (/(?:libro|obra|autor|novela)\s+(?:de|sobre)?\s*(.+)/i.test(t)) return { intent: "libros", query: RegExp.$1.trim() };
        
        // Intenciones de conocimiento general (Wikipedia, DDG)
        if (/(?:quien es|que es|como funciona|cuando fue|donde esta|dime sobre|informacion de|biografia de)\s+(.+)/i.test(t)) return { intent: "wikipedia", query: RegExp.$1.trim() };
        if (/(?:capital de|poblacion de|idioma de|país|de dónde es)\s+(.+)/i.test(t)) return { intent: "pais", query: RegExp.$1.trim() };

        // Intención General / Fallback
        return { intent: "general", query: texto };
    }

    // =========================================================================
    // IV. MÓDULOS DE CONOCIMIENTO (7 APIs Gratuitas)
    // =========================================================================

    // MÓDULO 1: API de Biblia (bible-api.com)
    const fetchBible = async (query) => {
        try {
            const res = await fetch(`https://bible-api.com/${encodeURIComponent(query)}?translation=rv1960`);
            if (!res.ok) return null;
            const j = await res.json();
            if (j.text) return { def: j.text.replace(/\n/g, '<br>'), src: j.reference };
        } catch (e) { return null; }
        return null;
    }

    // MÓDULO 2: API de Diccionario Español (dictionaryapi.dev)
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

    // MÓDULO 3: API de Open-Meteo (Clima sin token)
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

    // MÓDULO 4: API de DuckDuckGo Instant Answer (Respuestas rápidas)
    const fetchDDG = async (query) => {
        try {
            const res = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&t=alexia_app&nohtml=1`);
            const j = await res.json();
            if (j.AbstractText) return { def: j.AbstractText, src: 'DuckDuckGo' };
        } catch (e) { return null; }
        return null;
    }

    // MÓDULO 5: API de Wikipedia (para artículos detallados)
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
    
    // MÓDULO 6: API de OpenLibrary (Libros)
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

    // MÓDULO 7: API REST Countries (Países)
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


    // =========================================================================
    // V. MOTOR DE SÍNTESIS Y FALLBACK (RunWordDecomposition Mejorado)
    // =========================================================================

    /** Busca definiciones de palabras clave en Firebase DB y Wikipedia para sintetizar una respuesta. */
    const sintesisPorPalabraClave = async (words) => {
        let synthesis = [];
        for (let word of words) {
            let definition = null; let source = "";
            
            // 1. Buscar en Diccionario Local (Firestore)
            try { 
                const dictSnap = await getDoc(doc(db, "dictionary", word)); 
                if (dictSnap.exists()) { definition = dictSnap.data().def; source = "Memoria/DB"; } 
            } catch(e) {}
            
            // 2. Fallback a Wikipedia (recurso gratuito)
            if (!definition) { 
                const wikiData = await fetchWikipedia(word); 
                if (wikiData) { definition = wikiData.def; source = "WEB/Wiki"; } 
            }
            
            if (definition) synthesis.push({ word: word, def: definition, src: source });
        }
        return synthesis;
    }
    
    // =========================================================================
    // VI. UI/UX Y FUNCIONES PÚBLICAS (Funciones que necesitan estar en window)
    // =========================================================================
    
    // Funciones que requiere el HTML (expuestas globalmente)
    window.toggleUserMenu = (e) => { e.stopPropagation(); document.getElementById('user-dropdown').classList.toggle('show'); }
    window.onclick = (e) => { /* ... (Logic) ... */ }; // Implementar lógica de cierre de dropdowns
    window.emergencyReset = (e) => { if(e) e.stopPropagation(); if(confirm("⚠️ ¿Restablecer aplicación?")) { localStorage.clear(); sessionStorage.clear(); window.location.reload(); } };
    window.toggleSuggestions = () => { const popup = document.getElementById('suggestions-popup'); popup.classList.toggle('show'); }
    window.useSuggestion = (query) => { document.getElementById('suggestions-popup').classList.remove('show'); document.getElementById('chat-input').value = query; window.sendMessage(); }
    window.toggleSidebar = () => { const sb = document.getElementById('sidebar'); const ov = document.getElementById('overlay'); sb.classList.toggle('open'); ov.classList.toggle('active'); }
    window.toggleVoice = () => { if(isVoiceActive) recognition.stop(); else recognition.start(); }
    
    // Funciones de control de la conversación (appendMsg, finishResponse, etc.)
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
        // Lógica de guardar chat, mostrar feedback, y TTS
        const msgId = 'ai-msg-' + Date.now();
        let feedbackHTML = "";
        const safeUserTxt = userTxt.replace(/'/g, "\\'").replace(/"/g, '"').replace(/\n/g, ' ');
        if (showFeedback) {
            feedbackHTML = `<div class="feedback-area"><button class="feedback-btn" onclick="window.rateAnswer('good', '${safeUserTxt}', this)"><i class="fas fa-thumbs-up"></i> Útil</button><button class="feedback-btn bad" onclick="window.rateAnswer('bad', '${safeUserTxt}', this)"><i class="fas fa-graduation-cap"></i> Enseñar</button></div>`;
        }
        window.appendMsg('ai', aiTxt + feedbackHTML, true, msgId); 
        // Lógica de guardar chat (loadLocalChat, saveLocalChat, etc. necesita ser implementada aquí)
        
        if (wasVoiceInput) { /* ... (TTS logic) ... */ }
        if (shouldSuggest) window.generateSuggestions();
    }
    
    window.generateSuggestions = () => {
        // Lógica para generar sugerencias (usando constantes globales como randomTopics, etc.)
        activeSuggestions = [];
        // ... (Tu lógica de fetch OpenLibrary, Wikipedia, etc. para sugerencias) ...
        sessionStorage.setItem('alexia_active_suggestions', JSON.stringify(activeSuggestions));
        const ideaBtn = document.getElementById('idea-btn');
        ideaBtn.classList.add('has-ideas');
    }
    
    // Funciones de autenticación, historial y UI de Admin
    window.loadLocalChat = (id) => { /* ... (Chat loading logic) ... */ };
    window.rateAnswer = (type, query, btnElement) => { /* ... (Feedback/Teaching mode logic) ... */ };
    // ... (Todas las demás funciones como showAuth, emailLogin, logout, renderAdminQueue, etc.) ...
    
    
    // =========================================================================
    // VII. FUNCIÓN PRINCIPAL DEL CEREBRO (window.sendMessage)
    // =========================================================================

    window.sendMessage = async function() {
        if(!db) return alert("Sin conexión a base de datos.");
        const input = document.getElementById('chat-input');
        const originalText = input.value.trim();
        if(!originalText) return;

        // Lógica de validación, enseñanza y comandos rápidos (quien te creó, etc.)

        const normInput = removeDuplicates(window.normalize(originalText));
        
        // Comandos fijos
        if (normInput.match(/quien (te )?(creo|hizo)|quien eres|que eres|como te llamas/i)) {
            input.value = ''; window.appendMsg('user', originalText);
            await window.finishResponse(originalText, "Soy <b>AleXIA</b>, creada por <b>Alexis García</b>.", false, false); return;
        }

        input.value = ''; window.appendMsg('user', originalText); 
        const loadingId = 'loading-' + Date.now(); window.appendMsg('ai', `<i class="fas fa-circle-notch fa-spin"></i> <span id="think-text">Ruteando consulta...</span>`, false, loadingId);
        
        // Simulación de latencia
        await new Promise(r => setTimeout(r, 500));
        const loadingMsg = document.getElementById(loadingId); if(loadingMsg) loadingMsg.remove();

        // 1. Motor de Intención (Neuro-Router)
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
        
        // 2. Motor de Memoria (Si la intención no dio resultado)
        if (!responseData) {
            // Lógica para buscar en brain.memory (similar a la lógica original)
        }

        // 3. Motor de Síntesis de Palabras Clave (Fallback Final)
        if (!responseData) {
            const interpretedWords = originalText.split(/\s+/).filter(w => !stopWords.has(window.normalize(w)) && w.length > 2);
            const synthesisResult = await sintesisPorPalabraClave(interpretedWords);
            
            if (synthesisResult.length > 0) {
                 // Plantilla de respuesta de Síntesis
                let aiResponse = synthesisResult.length === 1 ? `Encontré esto sobre <strong>${synthesisResult[0].word}</strong>:<br>${synthesisResult[0].def}` : `<strong>Analizando conceptos:</strong><br>` + synthesisResult.map(item => `- <b>${item.word}:</b> ${item.def}`).join('<br>');
                aiResponse += "<br><br>¿Te sirve esta información?";
                await window.finishResponse(originalText, aiResponse, true, true);
                return;
            }
        }

        // 4. Generador de Respuesta Final (Plantillas Dinámicas)
        let finalResponse = "Lo siento, AleXIA no tiene una respuesta programada para esa consulta. ¿Podrías intentar una pregunta más específica o enseñarme algo nuevo?";

        if (responseData) {
            // Ejemplo de Plantilla Dinámica
            const template = `¡Claro! Encontré información sobre tu consulta (${intention.intent.toUpperCase()}):<br><br><div class="rich-content">${responseData.def}</div>${responseData.url ? `<div class="rich-source"><a href="${responseData.url}" target="_blank"><i class="fas fa-external-link-alt"></i> Fuente: ${responseData.src}</a></div>` : ''}`;
            finalResponse = template;
        }

        // Registrar consulta no resuelta si no se encontró nada.

        await window.finishResponse(originalText, finalResponse, true, true);
        
        wasVoiceInput = false;
    }
    
    // Inicia el listener de Enter al final
    document.getElementById('chat-input').addEventListener('keypress', (e) => { if(e.key === 'Enter') window.sendMessage(); });
    
})(); // Fin del módulo de AleXIA
