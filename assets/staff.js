/* Baan Thai — staff area: login, counter, bookings, settings */
"use strict";
let settings={capacity:40,minGuests:1,maxGuests:12,daysAhead:7,leadMin:30,holdMin:15};
let session=lsGet("bt-staff",null)||(()=>{try{return JSON.parse(sessionStorage.getItem("bt-staff"))}catch(e){return null}})();
const ALLSLOTS=Array.from({length:48},(_,i)=>hhmm(i*30));

/* ---------- API with login ---------- */
async function sapi(action,data){
  try{return await api(action,Object.assign({token:session&&session.token},data||{}))}
  catch(e){if(e.code==="auth"){signOut(e.message)}throw e}
}
function saveSession(s,remember){session=s;lsDel("bt-staff");try{sessionStorage.removeItem("bt-staff")}catch(e){}
  if(remember)lsSet("bt-staff",s);else try{sessionStorage.setItem("bt-staff",JSON.stringify(s))}catch(e){}}
function signOut(msg){
  if(session&&session.token&&!msg)api("logout",{token:session.token}).catch(()=>{});
  session=null;lsDel("bt-staff");try{sessionStorage.removeItem("bt-staff")}catch(e){}
  stopTimers();hideDrawer();renderLogin(msg||"");
}

/* ---------- login ---------- */
function renderLogin(msg){
  $("#tabs").hidden=true;$("#who").hidden=true;
  $("#view").innerHTML=`<div class="login">
    <div><p class="eyebrow">Baan Thai team</p><h1>Staff login</h1><p class="lede">Log in to see today's bookings and check guests in.</p></div>
    ${apiReady()?"":`<div class="notice">The website isn't connected to the Google Sheet yet. Add the web app URL to config.js (see the setup guide, Part 3).</div>`}
    <form id="loginform" novalidate>
      <div class="field"><label for="l-user">Login ID</label><input class="input" id="l-user" autocomplete="username" autocapitalize="none" spellcheck="false"></div>
      <div class="field"><label for="l-pw">Password</label><div class="pw"><input class="input" id="l-pw" type="password" autocomplete="current-password"><button type="button" id="l-show">Show</button></div></div>
      <label class="check plain" for="l-keep"><input type="checkbox" id="l-keep" checked><span>Keep me logged in on this device</span></label>
      <p class="err" id="l-err" ${msg?"":"hidden"}>${esc(msg)}</p>
      <button class="btn" type="submit" id="l-go">Log in</button>
    </form>
    <p class="small">Forgot your password? Ask the manager to reset it from the Google Sheet (Baan Thai menu).</p></div>`;
  $("#l-show").onclick=()=>{const p=$("#l-pw");p.type=p.type==="password"?"text":"password";$("#l-show").textContent=p.type==="password"?"Show":"Hide"};
  $("#loginform").onsubmit=async e=>{e.preventDefault();const err=$("#l-err"),btn=$("#l-go");err.hidden=true;btn.disabled=true;btn.innerHTML=`<span class="spin"></span> Logging in…`;
    try{const r=await api("login",{username:$("#l-user").value,password:$("#l-pw").value});
      saveSession({token:r.token,name:r.name,username:r.username,sheetUrl:r.sheetUrl},$("#l-keep").checked);
      await enter();}
    catch(x){err.textContent=x.message;err.hidden=false;btn.disabled=false;btn.textContent="Log in"}};
  setTimeout(()=>{const u=$("#l-user");if(u)u.focus()},0);
}
async function enter(){
  $("#view").innerHTML=`<p class="small"><span class="spin"></span> Loading…</p>`;
  try{const r=await sapi("me");settings=r.settings;session.name=r.name;session.sheetUrl=r.sheetUrl}
  catch(e){if(e.code!=="auth")$("#view").innerHTML=`<div class="empty">${esc(e.message)} <button class="linkbtn" onclick="enter()">Try again</button></div>`;return}
  $("#who").innerHTML=`<span>Logged in as <b>${esc(session.name)}</b></span>${session.sheetUrl?`<a href="${esc(session.sheetUrl)}" target="_blank" rel="noopener">Open Google Sheet</a>`:""}<button id="logout">Log out</button>`;
  $("#who").hidden=false;$("#tabs").hidden=false;$("#logout").onclick=()=>signOut();
  startFeed();go();
}

/* ---------- routing ---------- */
function route(){const h=(location.hash||"").replace("#","");return ["counter","bookings","settings"].includes(h)?h:"counter"}
function go(){
  if(!session)return;
  const r=route();
  document.querySelectorAll("#tabs a").forEach(a=>a.setAttribute("aria-current",a.dataset.r===r?"page":"false"));
  hideDrawer();
  if(r==="counter")renderCounter();else if(r==="bookings")renderBookings();else renderSettings();
  scrollTo(0,0);
}
window.addEventListener("hashchange",go);
let timers=[];
function stopTimers(){timers.forEach(clearInterval);timers=[];feed.started=false}

/* ---------- shared booking helpers ---------- */
function lateBy(b){if(b.status!=="confirmed")return 0;const n=istNow();if(b.date<n.date)return 9999;if(b.date>n.date)return 0;const l=n.min-toMin(b.time);return l>settings.holdMin?l:0}
function lateText(m){return m>=9999?"Didn't arrive":m>=60?`Late ${Math.floor(m/60)}h ${m%60}m`:`Late ${m} min`}
function byTime(a,b){return a.time.localeCompare(b.time)||(a.row||0)-(b.row||0)}
function sumG(a){return a.reduce((s,b)=>s+(b.guests||0),0)}
function tables(n){return n+(n===1?" table":" tables")}
function timeOpts(sel){return ALLSLOTS.map(t=>`<option value="${t}" ${t===sel?"selected":""}>${t12(t)}</option>`).join("")}
function normCode(v){let c=String(v||"").toUpperCase().replace(/[^A-Z0-9]/g,"");if(c.length===6&&!c.startsWith("BT"))c="BT"+c;return c}
function waLink(b){const p=dParts(b.date);return `https://wa.me/${(b.cc+b.phone).replace(/\D/g,"")}?text=${encodeURIComponent(`Hi ${b.name.split(" ")[0]}, this is Baan Thai at Calicut Airport about your table ${b.code} on ${p.day} ${p.mon} at ${t12(b.time)}.`)}`}
const known={}; // latest copy of every booking we've seen, by code
function remember(b){if(b&&b.code){known[b.code]=b;const i=con.list.findIndex(x=>x.code===b.code);if(i>=0){if(b.date===con.date)con.list[i]=b;else con.list.splice(i,1)}else if(b.date===con.date)con.list.push(b)}return b}
async function updateBooking(code,patch,force){
  const r=await sapi("update",{code,patch,force:!!force});remember(r.booking);
  if(desk.cur&&desk.cur.code===code){desk.cur=r.booking;renderVerdict()}
  conRefresh();if(con.sel===code)renderDrawer();
  return r.booking;
}

/* =================== COUNTER =================== */
const desk={cur:null,verdict:null,confirm:null,last:"",sound:false,ac:null};
const feed={list:[],last:0,ready:false,started:false,fresh:new Set(),err:""};
function judge(b){
  const n=istNow(),late=n.min-toMin(b.time);
  if(b.status==="checked_in")return {kind:"warn",title:"Already checked in",text:`Arrived ${fmtStamp(b.arrivedAt)}${b.table?`, table ${esc(b.table)}`:""}.`};
  if(b.status==="cancelled")return {kind:"bad",title:"Booking cancelled",text:"This reservation was cancelled."};
  if(b.status==="no_show")return {kind:"warn",title:"Marked as no-show",text:"You can still check the guest in if a table is free."};
  if(b.date!==n.date){const p=dParts(b.date);return {kind:"warn",title:b.date<n.date?"Ticket is for a past date":"Ticket is for another day",text:`Booked for ${p.long} at ${t12(b.time)}.`}}
  if(late>settings.holdMin)return {kind:"warn",title:`${late} min late`,text:`Booked for ${t12(b.time)}. The ${settings.holdMin}-minute hold has passed, so seat them if a table is free.`};
  if(late<-60)return {kind:"good",title:"Valid, early arrival",text:`Booked for ${t12(b.time)} today, ${Math.round(-late/6)/10} h from now.`};
  return {kind:"good",title:"Valid ticket",text:`Booked for ${t12(b.time)} today.`};
}
function renderCounter(){
  $("#view").innerHTML=`<div class="stack">
  <div class="con-head"><div><p class="eyebrow">Front counter</p><h1>Counter</h1><p class="lede" style="margin-top:6px">Type the booking code from the guest's ticket to see their details and check them in.</p></div></div>
  <div class="desk">
    <div class="stack" style="gap:16px;min-width:0">
      <form class="codebox" id="k-form" novalidate>
        <label class="label" for="s-code" style="margin:0">Booking code</label>
        <div class="codein"><input class="input" id="s-code" placeholder="BT7K4Q2M" maxlength="12" autocomplete="off" autocapitalize="characters" spellcheck="false"><button class="btn" type="submit" style="width:auto">Find</button></div>
        <div class="codefoot"><span class="small">Codes start with BT and have 8 characters. The 6 after BT are enough.</span>
          <label class="btn ghost sm scanmini" for="s-file">Scan QR instead<input type="file" id="s-file" accept="image/*" capture="environment"></label></div>
      </form>
      <div id="s-out"></div>
    </div>
    <aside class="panel feedpanel"><div class="feedhead"><div><h3>Latest bookings</h3><span class="small" id="k-newcount"></span></div>
      <button class="btn ghost sm" id="k-sound" aria-pressed="${desk.sound}">${desk.sound?"Sound on":"Sound off"}</button></div>
      <div id="k-feed"></div></aside>
  </div></div>`;
  const inp=$("#s-code");
  $("#k-form").onsubmit=e=>{e.preventDefault();lookup(inp.value)};
  inp.oninput=()=>{const v=normCode(inp.value);if(v.length===8&&v!==desk.last){desk.last=v;lookup(v)}};
  $("#s-file").onchange=e=>{const f=e.target.files[0];if(f)decodeFile(f);e.target.value=""};
  $("#s-out").onclick=counterActions;
  $("#k-feed").onclick=e=>{const t=e.target.closest("[data-k]");if(t){inp.value=t.dataset.k;desk.last=t.dataset.k;lookup(t.dataset.k);if(innerWidth<900)$("#s-out").scrollIntoView({behavior:"smooth",block:"start"})}};
  $("#k-sound").onclick=e=>{desk.sound=!desk.sound;if(desk.sound&&!desk.ac){try{desk.ac=new (window.AudioContext||window.webkitAudioContext)()}catch(x){}}
    if(desk.ac&&desk.ac.state==="suspended")desk.ac.resume();e.currentTarget.setAttribute("aria-pressed",desk.sound);e.currentTarget.textContent=desk.sound?"Sound on":"Sound off";if(desk.sound)chime()};
  renderVerdict();renderFeed();
  if(innerWidth>=900)setTimeout(()=>inp.focus(),0);
}
async function lookup(code,key){
  code=normCode(code);if(!code)return;
  desk.confirm=null;desk.cur=null;desk.verdict={kind:"",title:"Looking up "+code+"…",text:""};renderVerdict();
  try{
    const r=await sapi("get",{code});if(r.settings)settings=r.settings;
    if(!r.booking){desk.verdict={kind:"bad",title:"Booking not found",text:`No booking has the code <b class="num">${esc(code)}</b>. Check the code on the guest's ticket and try again.`}}
    else if(key&&key!==r.booking.key){desk.verdict={kind:"bad",title:"QR doesn't match",text:"The QR on this ticket doesn't match our records. Check the guest's name and phone before seating."}}
    else{desk.cur=remember(r.booking);desk.verdict=null}
  }catch(e){if(e.code!=="auth")desk.verdict={kind:"bad",title:"Couldn't look that up",text:esc(e.message)}}
  renderVerdict();
}
function decodeFile(f){
  desk.cur=null;desk.verdict={kind:"",title:"Reading QR…",text:""};renderVerdict();
  const url=URL.createObjectURL(f),img=new Image();
  img.onload=()=>{URL.revokeObjectURL(url);let hit=null;
    for(const max of [1400,900,2200]){const k=Math.min(1,max/Math.max(img.width,img.height)),w=Math.round(img.width*k),h=Math.round(img.height*k);
      const c=$("#work");c.width=w;c.height=h;const x=c.getContext("2d",{willReadFrequently:true});x.drawImage(img,0,0,w,h);
      const r=jsQR(x.getImageData(0,0,w,h).data,w,h,{inversionAttempts:"attemptBoth"});if(r){hit=r.data;break}}
    if(!hit){desk.verdict={kind:"bad",title:"No QR code found",text:"Take the photo closer to the large QR on the ticket, with the whole code in view. Or type the code."};return renderVerdict()}
    const m=/^BAANTHAI\|([A-Z0-9]+)\|([A-Z0-9]+)$/.exec(hit.trim());
    if(!m){desk.verdict={kind:"bad",title:"Not a Baan Thai ticket",text:"This QR code isn't from a Baan Thai reservation."};return renderVerdict()}
    const inp=$("#s-code");if(inp){inp.value=m[1];desk.last=m[1]}
    lookup(m[1],m[2]);
  };
  img.onerror=()=>{desk.verdict={kind:"bad",title:"Couldn't open that image",text:"Try another photo or type the booking code."};renderVerdict()};
  img.src=url;
}
function renderVerdict(){
  const o=$("#s-out");if(!o)return;
  if(desk.verdict&&!desk.cur){const v=desk.verdict;o.innerHTML=`<div class="verdict ${v.kind}" role="status"><div class="head">${v.kind?`<span class="dot"></span>`:`<span class="spin"></span>`}<div><p class="vt">${esc(v.title)}</p>${v.text?`<div class="small">${v.text}</div>`:""}</div></div></div>`;return}
  if(!desk.cur){o.innerHTML=`<div class="empty">Guest details appear here after you enter a code.</div>`;return}
  const b=desk.cur,v=judge(b),p=dParts(b.date);
  o.innerHTML=`<div class="verdict ${v.kind}" role="status">
  <div class="head"><span class="dot"></span><div><p class="vt">${esc(v.title)}</p><div class="small">${v.text}</div></div></div>
  <div class="vguest"><h2>${esc(b.name)}</h2><span class="pill ${b.status}">${STATUS_LABEL[b.status]}</span></div>
  <div class="facts">
    <div class="fact"><span>Party</span><b>${b.guests}</b><small>${b.adults} adult${b.adults>1?"s":""}${b.kids?` · ${b.kids} kid${b.kids>1?"s":""}`:""}</small></div>
    <div class="fact"><span>Time</span><b class="num">${t12(b.time).replace(" ","&nbsp;")}</b><small>IST</small></div>
    <div class="fact"><span>Date</span><b>${p.day} ${p.mon}</b><small>${relDay(b.date)||p.wd}</small></div>
    <div class="fact"><span>Table</span><b>${b.table?esc(b.table):"—"}</b><small>${b.table?"Assigned":"Not assigned"}</small></div>
  </div>
  <dl class="kv"><dt>Code</dt><dd class="num">${b.code}</dd>
    <dt>Phone</dt><dd><span class="num">${esc(b.cc+" "+b.phone)}</span> <button class="linkbtn" data-act="copy" style="margin-left:8px">Copy</button></dd>
    ${b.email?`<dt>Email</dt><dd>${esc(b.email)}</dd>`:""}
    ${b.prefs&&b.prefs.length?`<dt>Prefs</dt><dd>${esc(b.prefs.join(", "))}</dd>`:""}
    ${b.comments?`<dt>Guest note</dt><dd>“${esc(b.comments)}”</dd>`:""}
    ${b.staffNote?`<dt>Staff note</dt><dd>${esc(b.staffNote)}</dd>`:""}
    <dt>Booked</dt><dd>${fmtStamp(b.bookedAt)} · ${SRC_LABEL[b.source]||b.source}</dd></dl>
  ${b.status==="checked_in"?`<div class="toolbar"><button class="btn ghost sm" data-act="undo">Undo check-in</button></div>`:
   b.status==="cancelled"?`<div class="toolbar"><button class="btn ghost sm" data-act="undo">Restore booking</button></div>`:
   `<div class="toolbar"><input class="input" id="s-table" placeholder="Table no." value="${esc(b.table)}" style="max-width:130px" aria-label="Table number"><button class="btn leaf sm" data-act="checkin">Check in ${b.guests} guest${b.guests>1?"s":""}</button>
   ${desk.confirm===b.code?`<span class="confirmrow">Cancel this booking? <button class="btn sm" data-act="cancel-yes">Yes, cancel</button><button class="btn ghost sm" data-act="cancel-no">Keep</button></span>`:`<button class="btn ghost sm" data-act="cancel">Cancel booking</button>`}</div>`}</div>`;
}
async function counterActions(e){
  const t=e.target.closest("button[data-act]");if(!t||!desk.cur)return;const a=t.dataset.act,b=desk.cur;
  if(a==="copy")return copyText(b.cc+" "+b.phone);
  if(a==="cancel"){desk.confirm=b.code;return renderVerdict()}
  if(a==="cancel-no"){desk.confirm=null;return renderVerdict()}
  const patch=a==="checkin"?{status:"checked_in",table:(($("#s-table")||{}).value||"").trim()}:a==="undo"?{status:"confirmed"}:a==="cancel-yes"?{status:"cancelled"}:null;
  if(!patch)return;t.disabled=true;desk.confirm=null;
  try{await updateBooking(b.code,patch);toast(a==="checkin"?"Checked in":a==="undo"?"Updated":"Booking cancelled")}catch(x){if(x.code!=="auth")toast(x.message);t.disabled=false}
}
/* latest-bookings feed: checks the Google Sheet every 20 seconds */
function startFeed(){if(feed.started)return;feed.started=true;pollFeed();timers.push(setInterval(pollFeed,20000));timers.push(setInterval(()=>{if(route()==="counter")renderFeed()},30000))}
async function pollFeed(){
  try{
    const r=await sapi("recent",{after:feed.ready?feed.last:0});
    const fresh=r.bookings||[];
    if(r.reset&&feed.ready){feed.list=[]}
    if(feed.ready&&!r.reset)fresh.filter(b=>b.source==="online").forEach(b=>{feed.fresh.add(b.code);alertNew(b)});
    fresh.forEach(b=>{remember(b);feed.list=feed.list.filter(x=>x.code!==b.code);feed.list.unshift(b)});
    feed.list.sort((a,b)=>(b.row||0)-(a.row||0));feed.list=feed.list.slice(0,40);
    feed.last=r.last;feed.ready=true;feed.err="";
    if(fresh.length&&route()==="bookings"){const d=fresh.some(b=>b.date===con.date);if(d)conRefresh()}
  }catch(e){feed.err=e.message}
  renderFeed();
}
function chime(){if(!desk.ac)return;try{const ac=desk.ac,t0=ac.currentTime;[[880,0],[1320,.18]].forEach(([f,dl])=>{const o=ac.createOscillator(),g=ac.createGain();o.frequency.value=f;o.type="sine";g.gain.setValueAtTime(0.0001,t0+dl);g.gain.exponentialRampToValueAtTime(0.25,t0+dl+.02);g.gain.exponentialRampToValueAtTime(0.0001,t0+dl+.35);o.connect(g).connect(ac.destination);o.start(t0+dl);o.stop(t0+dl+.4)})}catch(e){}}
function alertNew(b){const p=dParts(b.date);toast(`New booking: ${b.name}, ${b.guests} pax, ${relDay(b.date)||p.day+" "+p.mon} ${t12(b.time)}`);if(desk.sound)chime()}
function renderFeed(){
  const F=$("#k-feed");if(!F)return;
  const n=$("#k-newcount");if(n){const c=feed.fresh.size;n.textContent=feed.err?"Can't refresh: "+feed.err:c?`${c} new since you opened this screen`:"Checks for new bookings every 20 seconds"}
  if(!feed.ready){F.innerHTML=`<div class="empty"><span class="spin"></span> Loading…</div>`;return}
  const list=feed.list.filter(b=>b.status!=="cancelled"||feed.fresh.has(b.code)).slice(0,25);
  if(!list.length){F.innerHTML=`<div class="empty">No bookings yet. New ones appear here soon after a guest gets their ticket.</div>`;return}
  F.innerHTML=list.map(b=>{const p=dParts(b.date),isNew=feed.fresh.has(b.code);
    return `<button class="fi${isNew?" new":""}" data-k="${b.code}"><span class="fw"><span class="fn">${isNew?`<span class="newbadge">New</span>`:""}<b>${esc(b.name)}</b></span>
      <span class="small">${b.guests} pax · ${relDay(b.date)||p.wd+" "+p.day+" "+p.mon} · <span class="num">${t12(b.time)}</span></span></span>
      <span class="fr"><span class="num code">${b.code}</span><span class="small">${b.source==="online"?fmtStamp(b.bookedAt):SRC_LABEL[b.source]}</span></span></button>`}).join("");
}

/* =================== BOOKINGS =================== */
const con={date:null,status:"all",q:"",slot:null,list:[],loaded:false,err:"",sel:null,mode:null,confirm:null,over:null,dErr:"",tick:null,req:0};
function renderBookings(){
  const n=istNow();if(!con.date)con.date=n.date;
  $("#view").innerHTML=`<div class="stack console">
  <div class="con-head"><div><p class="eyebrow">Reservations</p><h1>Bookings</h1></div>
    <div class="con-tools">
      <div class="daynav"><button class="ib" data-c="prev" aria-label="Previous day">‹</button>
        <input class="input num" type="date" id="c-date" value="${con.date}" aria-label="Show bookings for date">
        <button class="ib" data-c="next" aria-label="Next day">›</button>
        <button class="btn ghost sm" data-c="today">Today</button></div>
      <button class="btn ghost sm" data-c="refresh">Refresh</button>
      <button class="btn sm" data-c="add">Add booking</button>
    </div></div>
  <div class="dayline" id="c-day"></div>
  <div class="stats six" id="c-stats"></div>
  <section class="load" aria-label="Seats booked per 30-minute slot">
    <div class="loadtop"><span class="label" style="margin:0">Seats booked per 30-minute slot</span><span class="small" id="c-slotinfo"></span></div>
    <div class="loadbars" id="c-load"></div>
    <div class="loadaxis" aria-hidden="true">${["12 AM","3 AM","6 AM","9 AM","12 PM","3 PM","6 PM","9 PM"].map(x=>`<span>${x}</span>`).join("")}</div>
  </section>
  <div class="con-body">
    <div class="stack" style="gap:12px;min-width:0">
      <div class="toolbar"><div class="chips" id="c-filters"></div><input class="input" id="c-q" placeholder="Filter by name, phone, code or table" value="${esc(con.q)}" autocomplete="off"></div>
      <div id="c-list"></div>
    </div>
    <aside class="con-side">
      <div class="panel" id="c-next"></div>
      <form class="panel" id="c-findform" novalidate><h3>Find any booking</h3>
        <div style="display:flex;gap:8px"><input class="input" id="c-find" placeholder="Code, phone or name" autocomplete="off"><button class="btn sm" type="submit">Find</button></div>
        <div id="c-found" class="small">Searches every date.</div></form>
    </aside>
  </div></div>`;
  const v=$("#view");v.onclick=conClick;
  v.onkeydown=e=>{if((e.key==="Enter"||e.key===" ")&&e.target.matches(".r[data-open]")){e.preventDefault();openBooking(e.target.dataset.open)}};
  $("#c-date").onchange=e=>{if(e.target.value)setConDate(e.target.value)};
  $("#c-q").oninput=e=>{con.q=e.target.value;conRefresh()};
  $("#c-findform").onsubmit=e=>{e.preventDefault();findAny()};
  loadDay();conRefresh();
  clearInterval(con.tick);con.tick=setInterval(()=>{if(route()==="bookings"&&!document.hidden&&$("#dwrap").hidden)loadDay(true)},45000);timers.push(con.tick);
}
function setConDate(d){con.date=d;con.slot=null;con.list=[];con.loaded=false;const i=$("#c-date");if(i)i.value=d;loadDay();conRefresh()}
async function loadDay(quiet){
  const d=con.date,id=++con.req;if(!quiet){con.err=""}
  try{const r=await sapi("day",{date:d});if(id!==con.req||d!==con.date)return;settings=r.settings;con.list=r.bookings;con.list.forEach(b=>known[b.code]=b);con.loaded=true;con.err=""}
  catch(e){if(id===con.req&&e.code!=="auth"){con.err=e.message;con.loaded=true}}
  conRefresh();
}
function conRefresh(){
  if(!$("#c-list"))return;
  const n=istNow(),L=con.list,isToday=con.date===n.date,p=dParts(con.date),rd=relDay(con.date);
  $("#c-day").innerHTML=`<span>${p.long}</span>${rd?`<span>${rd}</span>`:""}${isToday?`<span class="live">${t12(hhmm(n.min))} IST · refreshes every minute</span>`:""}`;
  const act=L.filter(b=>b.status!=="cancelled"),arrived=L.filter(b=>b.status==="checked_in"),up=L.filter(b=>b.status==="confirmed"),
        ns=L.filter(b=>b.status==="no_show"),cx=L.filter(b=>b.status==="cancelled"),late=up.filter(b=>lateBy(b));
  $("#c-stats").innerHTML=[["Bookings",act.length,`${sumG(act)} guests`,""],["Arrived",sumG(arrived),`guests · ${tables(arrived.length)}`,""],
    ["To arrive",sumG(up),`guests · ${tables(up.length)}`,""],["Running late",late.length,late.length?`past ${settings.holdMin}-min hold`:"none right now",late.length?"alert":""],
    ["No-shows",ns.length,`${sumG(ns)} guests`,""],["Cancelled",cx.length,`${sumG(cx)} guests`,""]]
    .map(x=>`<div class="stat ${x[3]}"><span>${x[0]}</span><b>${x[1]}</b><small>${x[2]}</small></div>`).join("");
  const used={};act.filter(b=>b.status!=="no_show").forEach(b=>used[b.time]=(used[b.time]||0)+b.guests);
  const cap=settings.capacity;
  $("#c-load").innerHTML=ALLSLOTS.map(t=>{const u=used[t]||0,pc=Math.min(100,u/cap*100);
    return `<button type="button" data-slot="${t}" aria-pressed="${con.slot===t}" title="${t12(t)} · ${u}/${cap} seats" aria-label="${t12(t)}, ${u} of ${cap} seats booked"><i class="${u?(pc>=100?"full":pc>=75?"warn":""):"zero"}" style="height:${u?Math.max(8,pc):3}%"></i></button>`}).join("")
    +(isToday?`<span class="now" style="left:${(n.min/1440*100).toFixed(2)}%" title="Now"></span>`:"");
  const busy=Object.keys(used).sort((a,b)=>used[b]-used[a]||a.localeCompare(b))[0];
  $("#c-slotinfo").innerHTML=con.slot?`Showing ${t12(con.slot)} only · ${used[con.slot]||0}/${cap} seats · <button class="linkbtn" data-c="clearslot">Show all</button>`
    :busy?`Busiest: ${t12(busy)} · ${used[busy]}/${cap} seats. Tap a bar to filter.`:"No seats booked yet";
  const F=[["all","All",L.length],["upcoming","To arrive",up.length],["arrived","Arrived",arrived.length],["no_show","No-show",ns.length],["cancelled","Cancelled",cx.length]];
  $("#c-filters").innerHTML=F.map(f=>`<button class="chip pref" data-f="${f[0]}" aria-pressed="${con.status===f[0]}">${f[1]} <span class="num" style="opacity:.7">${f[2]}</span></button>`).join("");
  const map={upcoming:"confirmed",arrived:"checked_in",no_show:"no_show",cancelled:"cancelled"},q=con.q.trim().toLowerCase();
  const rows=L.filter(b=>(con.status==="all"||b.status===map[con.status])&&(!con.slot||b.time===con.slot)&&(!q||[b.name,b.phone,b.cc+b.phone,b.code,b.table,b.email].join(" ").toLowerCase().includes(q))).sort(byTime);
  const C=$("#c-list");
  if(con.err&&!L.length)C.innerHTML=`<div class="empty">Couldn't load bookings: ${esc(con.err)} <button class="linkbtn" data-c="refresh">Try again</button></div>`;
  else if(!con.loaded)C.innerHTML=`<div class="empty"><span class="spin"></span> Loading bookings…</div>`;
  else if(!rows.length)C.innerHTML=`<div class="empty">${L.length?"No bookings match these filters.":`No bookings for ${rd?rd.toLowerCase():p.day+" "+p.mon} yet.<br>Online bookings appear here soon after a guest confirms. Use <b>Add booking</b> for phone calls and walk-ins.`}</div>`;
  else C.innerHTML=`<div class="rows" role="list"><div class="rh" aria-hidden="true"><span>Time</span><span>Guest</span><span>Party</span><span>Phone</span><span>Table</span><span>Notes</span><span>Status</span><span></span></div>${rows.map(rowHTML).join("")}</div>`;
  const N=$("#c-next");
  if(isToday){
    const nx=up.filter(b=>toMin(b.time)<=n.min+120).sort(byTime).slice(0,8);
    N.innerHTML=`<h3>Arriving next 2 hours</h3>`+(nx.length?nx.map(b=>{const lt=lateBy(b),d=toMin(b.time)-n.min;
      return `<button class="nx" data-open="${b.code}"><span class="t num">${t12(b.time)}</span><span class="who"><b>${esc(b.name)}</b><span class="small">${b.guests} pax${b.table?` · Table ${esc(b.table)}`:""}</span></span>${lt?`<span class="flag">${lateText(lt)}</span>`:`<span class="small num">${d>0?`in ${d} min`:"Due now"}</span>`}</button>`}).join(""):`<p class="small" style="margin:0">No one due in the next 2 hours.</p>`);
  }else{
    const s=act.filter(b=>b.status!=="no_show").sort(byTime),big=[...s].sort((a,b)=>b.guests-a.guests)[0];
    N.innerHTML=`<h3>${con.date>n.date?"Day ahead":"Day summary"}</h3>`+(s.length?`<dl class="kv"><dt>First table</dt><dd class="num">${t12(s[0].time)}</dd><dt>Last table</dt><dd class="num">${t12(s[s.length-1].time)}</dd><dt>Busiest</dt><dd class="num">${t12(busy)} · ${used[busy]} seats</dd><dt>Largest party</dt><dd>${big.guests} · ${esc(big.name)}</dd></dl>`:`<p class="small" style="margin:0">No bookings on this day.</p>`);
  }
}
function rowHTML(b){
  const lt=lateBy(b),today=b.date===istNow().date;
  const notes=[...(b.prefs||[]),b.comments&&`“${b.comments}”`,b.staffNote&&`Staff: ${b.staffNote}`].filter(Boolean).join(" · ");
  const st=`<span class="pill ${b.status}">${STATUS_LABEL[b.status]}</span>${lt?`<span class="flag">${lateText(lt)}</span>`:""}`;
  return `<div class="r ${b.status}${lt?" late":""}" role="listitem button" tabindex="0" data-open="${b.code}" aria-label="${esc(b.name)}, ${t12(b.time)}, ${b.guests} guests, ${STATUS_LABEL[b.status]}">
    <span class="t num">${t12(b.time)}</span>
    <span class="nm"><b>${esc(b.name)}</b><span class="code">${b.code}${b.source!=="online"?` · ${SRC_LABEL[b.source]||b.source}`:""}</span>
      <span class="meta-sm">${b.guests} pax${b.table?` · Table ${esc(b.table)}`:""} · ${st}</span></span>
    <span class="c-party num"><b>${b.guests}</b><small>${b.adults}A${b.kids?` ${b.kids}K`:""}</small></span>
    <span class="c-phone num">${esc(b.cc+" "+b.phone)}</span>
    <span class="c-table num">${b.table?esc(b.table):'<span class="dim">—</span>'}</span>
    <span class="c-notes">${notes?esc(notes):'<span class="dim">—</span>'}</span>
    <span class="c-st">${st}</span>
    <span class="c-act">${(b.status==="confirmed"||b.status==="no_show")&&today?`<button class="btn leaf sm" data-q="checkin" data-code="${b.code}">Check in</button>`:`<span class="chev" aria-hidden="true">›</span>`}</span></div>`;
}
async function conClick(e){
  const q=e.target.closest("[data-q]");
  if(q){e.stopPropagation();q.disabled=true;try{await updateBooking(q.dataset.code,{status:"checked_in"});toast("Checked in")}catch(x){if(x.code!=="auth")toast(x.message);q.disabled=false}return}
  const o=e.target.closest("[data-open]");if(o){openBooking(o.dataset.open);return}
  const s=e.target.closest("[data-slot]");if(s){con.slot=con.slot===s.dataset.slot?null:s.dataset.slot;conRefresh();return}
  const f=e.target.closest("[data-f]");if(f){con.status=f.dataset.f;conRefresh();return}
  const c=e.target.closest("[data-c]");if(!c)return;const a=c.dataset.c;
  if(a==="prev")setConDate(addDays(con.date,-1));else if(a==="next")setConDate(addDays(con.date,1));else if(a==="today")setConDate(istNow().date);
  else if(a==="clearslot"){con.slot=null;conRefresh()}else if(a==="add")openAdd();else if(a==="refresh"){con.loaded=!!con.list.length;loadDay();toast("Refreshing…")}
}
async function findAny(){
  const raw=$("#c-find").value.trim(),out=$("#c-found");if(!raw)return;
  out.innerHTML=`<span class="spin"></span> Searching…`;
  try{const r=await sapi("search",{q:raw});const res=r.bookings.map(remember);
    out.innerHTML=res.length?res.map(b=>{const p=dParts(b.date);return `<button type="button" class="nx" data-open="${b.code}"><span class="t num">${p.day} ${p.mon}</span><span class="who"><b>${esc(b.name)}</b><span class="small">${t12(b.time)} · ${b.guests} pax · ${b.code}</span></span><span class="pill ${b.status}">${STATUS_LABEL[b.status]}</span></button>`}).join(""):`No booking found for “${esc(raw)}”.`;
  }catch(e){if(e.code!=="auth")out.textContent=e.message}
}

/* ---------- booking drawer ---------- */
function openBooking(code){con.sel=code;con.mode="view";con.confirm=null;con.dErr="";con.over=null;renderDrawer();showDrawer()}
function showDrawer(){$("#dwrap").hidden=false;document.documentElement.style.overflow="hidden";setTimeout(()=>{const x=$("#d-close");if(x)x.focus()},0)}
function hideDrawer(){const w=$("#dwrap");if(!w||w.hidden)return;w.hidden=true;document.documentElement.style.overflow="";con.sel=null;con.mode=null}
function closeBtn(){return `<button class="x" id="d-close" data-d="close" aria-label="Close">×</button>`}
function renderDrawer(){
  const D=$("#drawer");if(!D)return;
  if(con.mode==="add"){D.innerHTML=addFormHTML();$("#addform").onsubmit=e=>{e.preventDefault();saveAdd()};return}
  const b=known[con.sel];
  if(!b){D.innerHTML=`<div class="dhead"><h2 id="d-title">Booking not found</h2>${closeBtn()}</div>`;return}
  const p=dParts(b.date),lt=lateBy(b);
  let acts="";
  if(con.confirm===b.code)acts=`<span class="confirmrow" style="font-size:14px">Cancel this booking? The guest's QR will stop working. <button class="btn sm" data-d="cancelyes">Yes, cancel</button><button class="btn ghost sm" data-d="keep">Keep</button></span>`;
  else if(b.status==="confirmed")acts=`<button class="btn leaf sm" data-d="checkin">Check in</button><button class="btn ghost sm" data-d="noshow">No-show</button><button class="btn ghost sm" data-d="cancel">Cancel booking</button>`;
  else if(b.status==="checked_in")acts=`<button class="btn ghost sm" data-d="undo">Undo check-in</button>`;
  else if(b.status==="no_show")acts=`<button class="btn leaf sm" data-d="checkin">Check in</button><button class="btn ghost sm" data-d="undo">Undo no-show</button>`;
  else acts=`<button class="btn ghost sm" data-d="restore">Restore booking</button>`;
  D.innerHTML=`
  <div class="dhead"><div style="min-width:0"><p class="eyebrow">${b.code} · ${SRC_LABEL[b.source]||b.source}</p><h2 id="d-title">${esc(b.name)}</h2>
    <div class="tags"><span class="pill ${b.status}">${STATUS_LABEL[b.status]}</span>${lt?`<span class="flag">${lateText(lt)}</span>`:""}</div></div>${closeBtn()}</div>
  <div class="toolbar">${acts}</div>
  <dl class="kv">
    <dt>When</dt><dd>${p.long}<br><b class="num">${t12(b.time)}</b>${relDay(b.date)?` · ${relDay(b.date)}`:""}</dd>
    <dt>Party</dt><dd>${guestsText(b)} · ${b.guests} total</dd>
    <dt>Phone</dt><dd><span class="num">${esc(b.cc+" "+b.phone)}</span><br><button class="linkbtn" data-d="copy">Copy</button> <a class="linkbtn" href="${waLink(b)}" target="_blank" rel="noopener">WhatsApp</a> <a class="linkbtn" href="tel:${esc((b.cc+b.phone).replace(/\s/g,""))}">Call</a></dd>
    ${b.email?`<dt>Email</dt><dd>${esc(b.email)}</dd>`:""}
    <dt>Table</dt><dd>${b.table?esc(b.table):"Not assigned"}</dd>
    ${b.prefs&&b.prefs.length?`<dt>Prefs</dt><dd>${esc(b.prefs.join(", "))}</dd>`:""}
    ${b.comments?`<dt>Guest note</dt><dd>“${esc(b.comments)}”</dd>`:""}
    ${b.staffNote?`<dt>Staff note</dt><dd>${esc(b.staffNote)}</dd>`:""}
    <dt>Booked</dt><dd>${fmtStamp(b.bookedAt)}</dd>
    ${b.arrivedAt?`<dt>Arrived</dt><dd>${fmtStamp(b.arrivedAt)}</dd>`:""}
  </dl>
  <section class="sec"><span class="label" style="margin:0">Table and staff note</span>
    <div class="grid2 tn"><div class="field"><label for="e-table">Table</label><input class="input" id="e-table" value="${esc(b.table)}" placeholder="e.g. 7"></div>
    <div class="field"><label for="e-note">Staff note</label><input class="input" id="e-note" value="${esc(b.staffNote)}" placeholder="Only the team sees this"></div></div>
    <div><button class="btn ghost sm" data-d="savenote">Save table and note</button></div></section>
  ${b.status==="cancelled"?"":`<section class="sec"><span class="label" style="margin:0">Change date, time or party</span>
    <div class="grid2"><div class="field"><label for="e-date">Date</label><input class="input num" type="date" id="e-date" value="${b.date}"></div>
    <div class="field"><label for="e-time">Time</label><select class="input num" id="e-time">${timeOpts(b.time)}</select></div>
    <div class="field"><label for="e-adults">Adults</label><input class="input num" type="number" min="1" max="60" id="e-adults" value="${b.adults}"></div>
    <div class="field"><label for="e-kids">Kids</label><input class="input num" type="number" min="0" max="60" id="e-kids" value="${b.kids}"></div></div>
    <p class="err" id="e-err" ${con.dErr?"":"hidden"}>${esc(con.dErr)}</p>
    <div><button class="btn ghost sm" data-d="resched">Save changes</button></div></section>`}
  <section class="sec"><span class="label" style="margin:0">Guest ticket</span><div class="ticketbox"><canvas id="d-ticket" width="1728" height="864" aria-label="Ticket for ${b.code}"></canvas></div>
    <div class="toolbar"><button class="btn ghost sm" data-d="pdf">Download ticket PDF</button><button class="btn ghost sm" data-d="img">Save as image</button></div></section>`;
  paintTicket(b,$("#d-ticket"));
}
async function drawerClick(e){
  if(e.target.classList.contains("scrim")){hideDrawer();return}
  const t=e.target.closest("[data-d]");if(!t)return;const a=t.dataset.d;
  if(a==="close"){hideDrawer();return}
  if(con.mode!=="view")return;
  const b=known[con.sel];if(!b)return;let patch=null,msg="",force=false;
  if(a==="checkin"){patch={status:"checked_in",table:(($("#e-table")||{}).value||"").trim()};msg="Checked in"}
  else if(a==="undo"){patch={status:"confirmed"};msg="Back to booked"}
  else if(a==="noshow"){patch={status:"no_show"};msg="Marked as no-show"}
  else if(a==="restore"){patch={status:"confirmed"};msg="Booking restored"}
  else if(a==="cancel"){con.confirm=b.code;renderDrawer();return}
  else if(a==="keep"){con.confirm=null;renderDrawer();return}
  else if(a==="cancelyes"){con.confirm=null;patch={status:"cancelled"};msg="Booking cancelled"}
  else if(a==="savenote"){patch={table:$("#e-table").value.trim(),staffNote:$("#e-note").value.trim()};msg="Table and note saved"}
  else if(a==="copy"){copyText(b.cc+" "+b.phone);return}
  else if(a==="pdf"){downloadPdf(b);return}
  else if(a==="img"){downloadImage(b);return}
  else if(a==="resched"){
    const d=$("#e-date").value,tm=$("#e-time").value,ad=Math.round(+$("#e-adults").value),kd=Math.round(+$("#e-kids").value||0);
    const key=[b.code,d,tm,ad+kd].join("|");force=con.over===key;
    patch={date:d,time:tm,adults:ad,kids:kd};msg="Booking updated";
    t.disabled=true;
    try{await updateBooking(b.code,patch,force);con.over=null;con.dErr="";toast(msg);renderDrawer()}
    catch(x){t.disabled=false;if(x.code==="auth")return;con.dErr=x.message;if(x.code==="full")con.over=key;const er=$("#e-err");if(er){er.textContent=x.message;er.hidden=false}}
    return;
  }
  if(patch){t.disabled=true;try{await updateBooking(b.code,patch);toast(msg)}catch(x){if(x.code!=="auth")toast(x.message);t.disabled=false}}
}
function openAdd(){con.mode="add";con.sel=null;con.over=null;renderDrawer();showDrawer()}
function addFormHTML(){
  const n=istNow(),d=con.date>=n.date?con.date:n.date,dt=d===n.date?hhmm((Math.ceil(n.min/30)*30)%1440):"19:00";
  return `<div class="dhead"><div><p class="eyebrow">Phone call or walk-in</p><h2 id="d-title">Add booking</h2></div>${closeBtn()}</div>
  <form id="addform" class="stack" style="gap:14px" novalidate>
    <div class="field"><label for="a-src">Booking type</label><select class="input" id="a-src"><option value="phone">Phone call (guest arrives later)</option><option value="walkin">Walk-in (seat now, checked in)</option></select></div>
    <div class="field"><label for="a-name">Guest name *</label><input class="input" id="a-name" autocomplete="off"></div>
    <div class="field"><label for="a-phone">Phone *</label><div class="phone"><select class="input" id="a-cc" aria-label="Country code" style="width:auto">${CODES.map(c=>`<option>${c}</option>`).join("")}</select><input class="input" id="a-phone" inputmode="tel" autocomplete="off"></div></div>
    <div class="grid2">
      <div class="field"><label for="a-date">Date</label><input class="input num" type="date" id="a-date" value="${d}"></div>
      <div class="field"><label for="a-time">Time</label><select class="input num" id="a-time">${timeOpts(dt)}</select></div>
      <div class="field"><label for="a-adults">Adults</label><input class="input num" type="number" min="1" max="60" id="a-adults" value="2"></div>
      <div class="field"><label for="a-kids">Kids</label><input class="input num" type="number" min="0" max="60" id="a-kids" value="0"></div></div>
    <div class="grid2 tn"><div class="field"><label for="a-table">Table</label><input class="input" id="a-table" placeholder="Optional"></div>
      <div class="field"><label for="a-note">Staff note</label><input class="input" id="a-note" placeholder="Only the team sees this"></div></div>
    <div class="field"><label for="a-comments">Guest request</label><input class="input" id="a-comments" placeholder="Allergies, flight time, occasion"></div>
    <p class="err" id="a-err" hidden></p>
    <button class="btn" type="submit" id="a-save">Create booking</button>
  </form>`;
}
async function saveAdd(){
  const v=id=>$("#"+id).value.trim(),er=$("#a-err"),btn=$("#a-save");const fail=m=>{er.textContent=m;er.hidden=false;btn.disabled=false;btn.textContent="Create booking"};
  const data={source:v("a-src"),name:v("a-name"),cc:v("a-cc"),phone:v("a-phone"),date:v("a-date"),time:v("a-time"),adults:v("a-adults"),kids:v("a-kids")||0,table:v("a-table"),staffNote:v("a-note"),comments:v("a-comments")};
  const key=["add",data.date,data.time,(+data.adults)+(+data.kids)].join("|");
  btn.disabled=true;btn.innerHTML=`<span class="spin"></span> Saving…`;er.hidden=true;
  try{const r=await sapi("add",Object.assign(data,{force:con.over===key}));remember(r.booking);con.over=null;
    toast(data.source==="walkin"?"Walk-in checked in":"Booking added");con.mode="view";con.sel=r.booking.code;
    if(r.booking.date!==con.date&&route()==="bookings")setConDate(r.booking.date);else conRefresh();renderDrawer();}
  catch(x){if(x.code==="auth")return;if(x.code==="full")con.over=key;fail(x.message)}
}

/* =================== SETTINGS =================== */
function renderSettings(){
  const F=[["capacity","Seats per 30-minute slot","Total guests who can book the same arrival time.",1,500],
    ["minGuests","Smallest party","Fewest guests allowed on one online booking.",1,20],["maxGuests","Largest online party","Bigger groups are asked to call the cafe.",1,60],
    ["daysAhead","Days bookable ahead","Including today.",1,60],["leadMin","Minimum notice (minutes)","How soon before arrival online booking closes.",0,240],
    ["holdMin","Table hold (minutes)","Shown to guests and used to flag late arrivals.",0,120]];
  $("#view").innerHTML=`<div class="stack"><div><p class="eyebrow">Settings</p><h1>Capacity and rules</h1><p class="lede">Bookings run 24 hours in 30-minute slots, India time. Changes apply to the booking website straight away.</p></div>
  <form id="capform" class="stack" novalidate><div class="settings">${F.map(f=>`<div class="field"><label for="c-${f[0]}">${f[1]}</label><input class="input num" type="number" id="c-${f[0]}" min="${f[3]}" max="${f[4]}" value="${settings[f[0]]}"><span class="small">${f[2]}</span></div>`).join("")}</div>
  <p class="err" id="c-err" hidden></p><div><button class="btn sm" type="submit" id="c-save">Save settings</button></div></form>
  <section class="notice">Staff logins are managed in the Google Sheet: open it, then use the <b>Baan Thai</b> menu to add a login, reset a password or turn a login off.${session.sheetUrl?` <a href="${esc(session.sheetUrl)}" target="_blank" rel="noopener">Open the Google Sheet</a>`:""}</section></div>`;
  $("#capform").onsubmit=async e=>{e.preventDefault();const values={};F.forEach(f=>values[f[0]]=$("#c-"+f[0]).value);const er=$("#c-err"),b=$("#c-save");er.hidden=true;b.disabled=true;
    try{const r=await sapi("saveSettings",{values});settings=r.settings;toast("Settings saved")}catch(x){if(x.code!=="auth"){er.textContent=x.message;er.hidden=false}}b.disabled=false};
}

/* ---------- start ---------- */
$("#dwrap").onclick=drawerClick;
document.addEventListener("keydown",e=>{if(e.key==="Escape")hideDrawer()});
if(session&&session.token)enter();else renderLogin("");
