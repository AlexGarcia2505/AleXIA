/* alexia_logic.js
 Non-intrusive logic enhancer for AleXIA.
 Only enhances behavior; DOES NOT change layout or style.
 Place in repo root and include with <script src="alexia_logic.js" defer></script>
*/
(function(){
  if (window.__alexia_logic_loaded) return;
  window.__alexia_logic_loaded = true;
  console.log("AleXIA logic module loaded — no UI changes.");

  // ---------- Utilities ----------
  function normalize(s){ return String(s||'').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,'').replace(/[¿?¡!.,]/g,'').trim(); }
  function processSynonyms(text, slangMap){
    if(!text) return "";
    return String(text).split(/\s+/).map(w=>{
      const cw = normalize(w);
      return (slangMap && slangMap[cw]) ? slangMap[cw] : cw;
    }).join(" ");
  }
  function saveUserName(name){
    if(!name) return;
    try{ localStorage.setItem('alexia_user_name', name); }catch(e){}
  }
  function getUserName(){ try{ return localStorage.getItem('alexia_user_name'); }catch(e){return null;} }

  // ---------- Simple trigram similarity (for fuzzy match) ----------
  function trigrams(s){
    s = normalize(s).replace(/[^a-z0-9ñáéíóúü ]+/g,' ');
    s = '  ' + s + '  ';
    const out = new Set();
    for(let i=0;i<s.length-2;i++) out.add(s.slice(i,i+3));
    return out;
  }
  function trigramSimilarity(a,b){
    if(!a || !b) return 0;
    const A = trigrams(a), B = trigrams(b);
    let inter = 0;
    for(const x of A) if(B.has(x)) inter++;
    const union = new Set([...A,...B]).size;
    return union ? inter/union : 0;
  }

  // ---------- External helpers ----------
  async function fetchWikipedia(term){
    try{
      const enc = encodeURIComponent(term);
      const search = await fetch(`https://es.wikipedia.org/w/api.php?action=opensearch&search=${enc}&limit=1&format=json&origin=*`);
      if(!search.ok) return null;
      const sjson = await search.json();
      if(!sjson[1] || sjson[1].length===0) return null;
      const title = encodeURIComponent(sjson[1][0]);
      const contentResp = await fetch(`https://es.wikipedia.org/w/api.php?action=query&prop=extracts&titles=${title}&explaintext=1&exintro=1&format=json&origin=*`);
      if(!contentResp.ok) return null;
      const cjson = await contentResp.json();
      const pages = cjson.query && cjson.query.pages;
      const pid = pages && Object.keys(pages)[0];
      if(pid === "-1") return null;
      const text = pages[pid].extract || "";
      // format a bit
      const sentences = text.split('. ').slice(0,6).join('. ') + (text.split('. ').length>6? '...':'');
      return { def: `<p>${sentences}</p>`, src: 'Wikipedia', url: `https://es.wikipedia.org/?curid=${pid}` };
    }catch(e){ return null; }
  }

  async function fetchDictionaryEs(word){
    try{
      const w = encodeURIComponent(word);
      // dictionaryapi.dev Spanish endpoint
      const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/es/${w}`);
      if(!res.ok) return null;
      const j = await res.json();
      if(!Array.isArray(j) || j.length===0) return null;
      const entry = j[0];
      let defs = [];
      if(entry.meanings){
        entry.meanings.forEach(m => {
          (m.definitions||[]).slice(0,2).forEach(d => defs.push(d.definition));
        });
      }
      if(defs.length===0) return null;
      return { def: `<p><b>${word}</b>: ${defs.slice(0,3).join('; ')}</p>`, src: 'DictionaryAPI' };
    }catch(e){ return null; }
  }

  async function fetchBible(query){
    try{
      const q = encodeURIComponent(query);
      // bible-api.com supports passing reference (returns text)
      const res = await fetch(`https://bible-api.com/${q}?translation=rv1960`);
      if(!res.ok) return null;
      const j = await res.json();
      if(j.text) return { def: `<p><b>${j.reference}</b>: ${j.text.replace(/\n/g,'<br>')}</p>`, src:'bible-api.com' };
    }catch(e){}
    return null;
  }

  // ---------- Hook into existing functions non-intrusively ----------
  // We'll try to wrap window.sendMessage if it exists, otherwise listen to Enter on #chat-input
  function safeWrapSendMessage(){
    const original = window.sendMessage;
    if(typeof original !== 'function') return false;
    window.sendMessage = async function(){
      // before: detect if user told name like "me llamo X" and handle locally
      const inputEl = document.getElementById('chat-input');
      const text = inputEl ? inputEl.value.trim() : '';
      if(text){
        const m = text.match(/^(?:me llamo|mi nombre es|soy)\s+(.{2,50})/i);
        if(m && m[1]){
          const name = m[1].replace(/[.!?]/g,'').trim();
          saveUserName(name);
          // mimic a friendly reply without breaking original flow
          if(inputEl) inputEl.value = '';
          if(typeof window.appendMsg === 'function') window.appendMsg('user', text);
          const reply = `Mucho gusto, ${name}. Guardé tu nombre.`;
          if(typeof window.finishResponse === 'function') {
            await window.finishResponse(text, reply, false, false);
            return;
          } else {
            if(typeof original === 'function') return original.apply(this, arguments);
          }
        }
      }
      // fallback to original
      return original.apply(this, arguments);
    };
    return true;
  }

  // If sendMessage not loaded yet, try again later
  if(!safeWrapSendMessage()){
    const t = setInterval(()=>{
      if(safeWrapSendMessage()){ clearInterval(t); console.log("Wrapped sendMessage for name-detection."); }
    }, 500);
  } else console.log("Wrapped sendMessage for name-detection.");

  // Provide a public helper: alexiaLogic.findBestMemoryMatch(...)
  window.alexiaLogic = {
    getUserName, saveUserName, trigramSimilarity, fetchWikipedia, fetchDictionaryEs, fetchBible
  };

  // ---------- Extra intent detection (non-intrusive) ----------
  // If your code calls checkSpecificIntent/processSpecificIntent by name, we don't override.
  // But add a safe helper to detect Bible queries: use window.checkSpecificIntent if present, else allow callers to use alexiaLogic.detectIntent
  window.alexiaLogic.detectIntent = function(text){
    if(!text) return null;
    const low = normalize(text);
    // bible intent
    const bibleMatch = low.match(/(?:versiculo|versículo|biblia|leer|cita)\s+(.{1,50})/i);
    if(bibleMatch) return { action:'bible', query: bibleMatch[1].trim() };
    // clima
    const met = low.match(/(?:clima|tiempo)\s+(?:en|de)\s+(.+)/);
    if(met) return { action:'clima', query: met[1].trim() };
    // libro
    const book = low.match(/(?:libro|obra)\s+(?:de|titulado|sobre)?\s*(.+)/);
    if(book) return { action:'libro', query: book[1].trim() };
    return null;
  };

  // ---------- Non-destructive example usage functions ----------
  // You can call these from your existing code, e.g. inside processSpecificIntent:
  // const res = await window.alexiaLogic.fetchBible('Juan 3:16'); if(res) ... etc.

  // Provide a small test function (manual trigger)
  window.alexiaLogic.selfTest = async function(){
    console.log("AleXIA logic self-test: userName=", getUserName());
    const dict = await fetchDictionaryEs('amistad').catch(()=>null);
    console.log("dict(amistad):", dict ? dict.def : 'no data');
    const wiki = await fetchWikipedia('Inteligencia Artificial').catch(()=>null);
    console.log("wiki IA:", wiki ? wiki.def.slice(0,120) : 'no data');
    const bible = await fetchBible('Juan 3:16').catch(()=>null);
    console.log("bible Juan 3:16:", bible ? bible.def.slice(0,120) : 'no data');
    return { userName:getUserName(), dict:!!dict, wiki:!!wiki, bible:!!bible };
  };

  // done
})();
