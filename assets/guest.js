/* Baan Thai — guest reservation page */
"use strict";
const DEFAULTS={capacity:40,minGuests:1,maxGuests:12,daysAhead:7,leadMin:30,holdMin:15};
const PERIODS=[
  {id:"night",name:"Late night",sub:"12–6 AM",from:0,to:360},
  {id:"morning",name:"Morning",sub:"6 AM–12",from:360,to:720},
  {id:"afternoon",name:"Afternoon",sub:"12–6 PM",from:720,to:1080},
  {id:"evening",name:"Evening",sub:"6 PM–12",from:1080,to:1440}];
const PREFS=["Catching a flight soon","Window seat","Birthday / celebration","Kids chair","Quiet corner","Vegetarian group"];
const PHONE=(window.BAAN_THAI_PHONE||"").trim();
let settings={...DEFAULTS};
const S={step:1,agreed:false,adults:2,kids:0,date:null,period:null,time:null,prefs:new Set(),name:"",cc:"+91",phone:"",email:"",comments:"",booking:null,saving:false,error:""};
const avail={date:null,used:{},loading:false,error:""};

function callLine(){return PHONE?` Call <a href="tel:${esc(PHONE.replace(/\s/g,""))}">${esc(PHONE)}</a>.`:""}
function myTickets(){const n=istNow().date;return lsGet("bt-tickets",[]).filter(b=>b&&b.date>=n&&b.status!=="cancelled").sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time))}
function saveTicket(b){const l=lsGet("bt-tickets",[]).filter(x=>x&&x.code!==b.code);l.push(b);lsSet("bt-tickets",l.slice(-12))}

async function loadAvail(date,force){
  if(avail.date===date&&!force&&!avail.error)return;
  avail.date=date;avail.loading=true;avail.error="";avail.used={};render();
  try{const r=await api("availability",{date});if(avail.date!==date)return;avail.used=r.used||{};settings={...DEFAULTS,...r.settings}}
  catch(e){if(avail.date===date)avail.error=e.message}
  if(avail.date===date){avail.loading=false;render()}
}
function seatsLeft(t){return Math.max(0,settings.capacity-(avail.used[t]||0))}
function slotOpen(date,m){const n=istNow();if(date<n.date)return false;if(date===n.date&&m<n.min+settings.leadMin)return false;return true}

function stepsBar(){return `<div class="steps" aria-hidden="true">${[1,2,3,4].map(i=>`<span class="${i<=S.step?"on":""}"></span>`).join("")}</div>`}
function render(){
  const v=$("#view");
  v.innerHTML=S.step===1?stepPolicy():S.step===2?stepTable():S.step===3?stepDetails():stepDone();
  bind();
  if(S.step===4)paintTicket(S.booking,$("#tcanvas"));
}
function stepPolicy(){
  const mine=myTickets();
  return `${stepsBar()}<div class="stack">
  <div><p class="eyebrow">Reserve a table</p><h1>Sit down for real Thai before you fly</h1>
  <p class="lede">Baan Thai serves authentic Thai food at Calicut International Airport, around the clock. Book in three short steps and get a boarding-pass ticket with a QR code to show at the counter.</p></div>
  ${apiReady()?"":`<div class="notice">Online booking isn't switched on yet.${callLine()}</div>`}
  ${mine.length?`<div class="mine"><p class="label" style="margin:0 0 4px">Your upcoming tables</p>${mine.map(b=>{const p=dParts(b.date);return `<button data-mine="${b.code}"><span><b>${dayLabel(b.date)}, ${p.day} ${p.mon} · ${t12(b.time)}</b><br><span class="small">${guestsText(b)} · ${b.code}</span></span><span>Show ticket</span></button>`}).join("")}</div>`:""}
  <section><p class="label">Before you book</p>
  <ul class="policy">
    <li><span>Please arrive <b>on time</b>. Your table is held for <b>${settings.holdMin} minutes</b>, after which seating depends on availability.</span></li>
    <li><span>Show your <b>QR ticket</b> at the counter when you arrive. The PDF, the image or a screenshot all work.</span></li>
    <li><span>Flying out? Leave enough time for security and boarding, and tell us your departure time so we can serve you quickly.</span></li>
    <li><span>Let us know about any change to your booking in advance.</span></li>
    <li><span>Seating preferences depend on availability and can't be guaranteed.</span></li>
    <li><span>Reservations are free. There is no cover charge.</span></li>
  </ul></section>
  <label class="check" for="agree"><input type="checkbox" id="agree" ${S.agreed?"checked":""}><span>I accept the reservation policy</span></label>
  <details class="find"><summary>Already booked? Find your ticket</summary>
    <form class="stack" style="gap:12px" id="findform" novalidate><div class="row2">
      <div class="field"><label for="f-code">Booking code</label><input class="input num" id="f-code" placeholder="BT7K4Q2M" autocomplete="off" autocapitalize="characters"></div>
      <div class="field"><label for="f-phone">Phone number</label><input class="input" id="f-phone" inputmode="tel" placeholder="Number used to book"></div>
    </div><button class="btn ghost sm" type="submit" id="f-go" style="justify-self:start">Find ticket</button><p class="err" id="f-err" hidden></p></form>
  </details>
  </div>
  <div class="cta"><button class="btn" id="go2" ${S.agreed&&apiReady()?"":"disabled"}>Reserve a table</button></div>`;
}
function counter(key,label,sub,val,min){
  return `<div class="counter"><span class="label" style="margin:0">${label}</span><div class="row">
  <button type="button" data-dec="${key}" aria-label="Fewer ${label.toLowerCase()}" ${val<=min?"disabled":""}>−</button>
  <b aria-live="polite">${val}</b>
  <button type="button" data-inc="${key}" aria-label="More ${label.toLowerCase()}" ${S.adults+S.kids>=settings.maxGuests?"disabled":""}>+</button></div><small>${sub}</small></div>`;
}
function stepTable(){
  const n=istNow();if(!S.date)S.date=n.date;
  if(avail.date!==S.date&&!avail.loading)setTimeout(()=>loadAvail(S.date),0);
  const g=S.adults+S.kids,dates=[];for(let i=0;i<settings.daysAhead;i++)dates.push(addDays(n.date,i));
  const pm=PERIODS.map(p=>{const ms=[];for(let m=p.from;m<p.to;m+=30)if(slotOpen(S.date,m))ms.push(m);return {...p,ms}});
  if(!S.period||!pm.find(p=>p.id===S.period&&p.ms.length)){const f=pm.find(p=>p.ms.length);S.period=f?f.id:null}
  const cur=pm.find(p=>p.id===S.period);
  const gErr=(g<settings.minGuests||g>settings.maxGuests)?`Online bookings are for ${settings.minGuests} to ${settings.maxGuests} guests. For bigger groups, please call the cafe.${callLine()}`:"";
  let tErr="";if(S.time&&!avail.loading&&seatsLeft(S.time)<g)tErr=seatsLeft(S.time)?`Only ${seatsLeft(S.time)} seats left at ${t12(S.time)}. Pick another time or fewer guests.`:`${t12(S.time)} is full. Pick another time.`;
  const slots=avail.loading?`<div class="empty"><span class="spin"></span> Checking free tables…</div>`:avail.error?`<div class="empty">${esc(avail.error)} <button class="linkbtn" id="retry">Try again</button></div>`:
    cur?`<div class="slotgrid">${cur.ms.map(m=>{const t=hhmm(m),l=seatsLeft(t),full=l<Math.max(1,g);return `<button class="chip slot" data-time="${t}" aria-pressed="${t===S.time}" ${full?"disabled":""}>${t12(t)}${full?`<span class="left">Full</span>`:l<=10?`<span class="left">${l} seats left</span>`:""}</button>`}).join("")}</div>`:`<div class="empty">No more tables today. Pick another date.</div>`;
  const ready=!gErr&&!tErr&&S.time&&!avail.loading&&!avail.error;
  return `${stepsBar()}<div class="stack">
  <div><p class="eyebrow">Step 1 of 3</p><h2>Your table</h2></div>
  <section><p class="label">Guests</p><div class="counters">${counter("adults","Adults","Age 12+",S.adults,1)}${counter("kids","Kids","Under 12",S.kids,0)}</div>${gErr?`<p class="err" style="margin-top:10px">${gErr}</p>`:""}</section>
  <section><p class="label">Date</p><div class="chips scroll">${dates.map(d=>{const p=dParts(d);return `<button class="chip date" data-date="${d}" aria-pressed="${d===S.date}">${p.day} ${p.mon}<small>${dayLabel(d)}</small></button>`}).join("")}</div></section>
  <section><p class="label">Time of day</p><div class="chips">${pm.map(p=>`<button class="chip" data-period="${p.id}" aria-pressed="${p.id===S.period}" ${p.ms.length?"":"disabled"}>${p.name}<small>${p.sub}</small></button>`).join("")}</div></section>
  <section><p class="label">Arrival time <span style="text-transform:none;letter-spacing:0;color:var(--dim)">· India time (IST)</span></p>${slots}${tErr?`<p class="err" style="margin-top:10px">${tErr}</p>`:""}</section>
  <section><p class="label">Preferences (optional)</p><div class="chips">${PREFS.map(p=>`<button class="chip pref" data-pref="${esc(p)}" aria-pressed="${S.prefs.has(p)}">${esc(p)}</button>`).join("")}</div></section>
  </div>
  <div class="cta"><button class="btn" id="go3" ${ready?"":"disabled"}>Continue</button><button class="btn ghost sm" id="back1" style="align-self:center">Back</button></div>`;
}
function stepDetails(){
  const p=dParts(S.date);
  return `${stepsBar()}<div class="stack">
  <div><p class="eyebrow">Step 2 of 3</p><h2>Your details</h2></div>
  <div class="summary"><dl>
    <dt>When</dt><dd>${dayLabel(S.date)}, ${p.day} ${p.mon} ${p.yr} at <span class="num">${t12(S.time)}</span></dd>
    <dt>Guests</dt><dd>${guestsText(S)}</dd><dt>Where</dt><dd>Baan Thai, Calicut International Airport</dd>
    ${S.prefs.size?`<dt>Notes</dt><dd>${esc([...S.prefs].join(", "))}</dd>`:""}
  </dl><button class="linkbtn" id="edit">Edit</button></div>
  <form id="dform" class="stack" style="gap:16px" novalidate>
    <div class="field"><label for="d-name">Full name *</label><input class="input" id="d-name" autocomplete="name" value="${esc(S.name)}" required></div>
    <div class="field"><label for="d-phone">Phone number *</label><div class="phone">
      <select class="input" id="d-cc" aria-label="Country code" style="width:auto">${CODES.map(c=>`<option ${c===S.cc?"selected":""}>${c}</option>`).join("")}</select>
      <input class="input" id="d-phone" inputmode="tel" autocomplete="tel-national" value="${esc(S.phone)}" placeholder="98765 43210" required></div></div>
    <div class="field"><label for="d-email">Email</label><input class="input" id="d-email" type="email" autocomplete="email" value="${esc(S.email)}" placeholder="Optional"></div>
    <div class="field"><label for="d-comments">Comments</label><textarea class="input" id="d-comments" placeholder="Allergies, departure time, anything we should know">${esc(S.comments)}</textarea></div>
    <div class="hp" aria-hidden="true"><label for="d-website">Website</label><input id="d-website" tabindex="-1" autocomplete="off"></div>
    <p class="err" id="d-err" ${S.error?"":"hidden"}>${esc(S.error)}</p>
  </form></div>
  <div class="cta"><button class="btn" id="confirm" form="dform" type="submit" ${S.saving?"disabled":""}>${S.saving?`<span class="spin"></span> Confirming…`:"Confirm reservation"}</button></div>`;
}
function stepDone(){
  const b=S.booking,p=dParts(b.date);
  return `${stepsBar()}<div class="stack">
  <div><p class="eyebrow">${b.status==="cancelled"?"Cancelled":"Confirmed"}</p><h2>${b.status==="cancelled"?"This reservation was cancelled":`See you ${relDay(b.date)==="Today"?"today":"on "+p.wd+" "+p.day+" "+p.mon}, ${esc(b.name.split(" ")[0])}`}</h2>
  <p class="lede">Show this QR ticket at the Baan Thai counter. Your table is held until ${t12(hhmm((toMin(b.time)+settings.holdMin)%1440))}.</p></div>
  <div class="ticketbox"><canvas id="tcanvas" width="1728" height="864" role="img" aria-label="Boarding-pass ticket for booking ${b.code}"></canvas></div>
  <div class="summary"><div><span class="label" style="margin-bottom:4px">Booking code</span><div class="codebig">${b.code}</div></div>
  <dl style="grid-column:1/-1"><dt>When</dt><dd>${p.long}, <span class="num">${t12(b.time)}</span></dd><dt>Guests</dt><dd>${guestsText(b)}</dd><dt>Name</dt><dd>${esc(b.name)}</dd><dt>Phone</dt><dd class="num">${esc(b.cc+" "+b.phone)}</dd></dl></div>
  <p class="small">Save the ticket now. You can also find it again from this page with your booking code and phone number.</p>
  </div>
  <div class="cta"><button class="btn" id="dl">Download PDF ticket</button>
  <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap"><button class="btn ghost sm" id="dlimg">Save as image</button><button class="btn ghost sm" id="again">Book another table</button></div></div>`;
}
function bind(){
  const v=$("#view");
  v.onclick=async e=>{
    const t=e.target.closest("button");if(!t||t.form)return;
    if(t.id==="go2"){S.step=2;render();scrollTo(0,0)}
    else if(t.id==="back1"){S.step=1;render()}
    else if(t.id==="retry"){loadAvail(S.date,true)}
    else if(t.dataset.inc){S[t.dataset.inc]++;render()}
    else if(t.dataset.dec){S[t.dataset.dec]--;render()}
    else if(t.dataset.date){S.date=t.dataset.date;S.time=null;S.period=null;render()}
    else if(t.dataset.period){S.period=t.dataset.period;render()}
    else if(t.dataset.time){S.time=t.dataset.time;render()}
    else if(t.dataset.pref){const p=t.dataset.pref;S.prefs.has(p)?S.prefs.delete(p):S.prefs.add(p);render()}
    else if(t.id==="go3"){S.step=3;S.error="";render();scrollTo(0,0)}
    else if(t.id==="edit"){S.step=2;render()}
    else if(t.id==="dl"){t.disabled=true;try{await downloadPdf(S.booking)}catch(x){toast("Couldn't make the PDF. Use Save as image or take a screenshot.")}t.disabled=false}
    else if(t.id==="dlimg"){downloadImage(S.booking)}
    else if(t.id==="again"){Object.assign(S,{step:2,time:null,booking:null,error:""});S.prefs=new Set();avail.date=null;render();scrollTo(0,0)}
    else if(t.dataset.mine){const b=lsGet("bt-tickets",[]).find(x=>x.code===t.dataset.mine);if(b){S.booking=b;S.step=4;render();scrollTo(0,0)}}
  };
  const ag=$("#agree");if(ag)ag.onchange=()=>{S.agreed=ag.checked;$("#go2").disabled=!(S.agreed&&apiReady())};
  const ff=$("#findform");if(ff)ff.onsubmit=e=>{e.preventDefault();findTicket()};
  const f=$("#dform");
  if(f){const sync=()=>{S.name=$("#d-name").value;S.cc=$("#d-cc").value;S.phone=$("#d-phone").value;S.email=$("#d-email").value;S.comments=$("#d-comments").value};
    f.oninput=sync;f.onchange=sync;f.onsubmit=e=>{e.preventDefault();sync();submitBooking()}}
}
async function findTicket(){
  const code=$("#f-code").value,ph=$("#f-phone").value,err=$("#f-err"),btn=$("#f-go");
  err.hidden=true;btn.disabled=true;
  try{const r=await api("find",{code,phone:ph});S.booking=r.booking;saveTicket(r.booking);S.step=4;render();scrollTo(0,0)}
  catch(e){err.textContent=e.message;err.hidden=false;btn.disabled=false}
}
async function submitBooking(){
  S.error="";const digits=S.phone.replace(/\D/g,"");
  if(S.name.trim().length<2){S.error="Enter the name the booking is under.";return render()}
  if(digits.length<7||digits.length>13){S.error="Enter a valid phone number so we can reach you about your table.";return render()}
  if(S.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(S.email)){S.error="That email address doesn't look right. Fix it or leave it empty.";return render()}
  S.saving=true;render();
  try{
    const r=await api("book",{name:S.name.trim(),cc:S.cc,phone:digits,email:S.email.trim(),comments:S.comments.trim(),adults:S.adults,kids:S.kids,date:S.date,time:S.time,prefs:[...S.prefs],website:($("#d-website")||{}).value||""});
    S.booking=r.booking;saveTicket(r.booking);S.step=4;S.saving=false;avail.date=null;render();scrollTo(0,0);
  }catch(e){S.saving=false;S.error=e.message+(e.code==="full"?" Tap Edit above to change the time.":"");render()}
}

(async function start(){
  if(PHONE)$("#foot-phone").innerHTML=`Phone: <a href="tel:${esc(PHONE.replace(/\s/g,""))}">${esc(PHONE)}</a>`;
  render();
  if(apiReady()){try{const r=await api("config");settings={...DEFAULTS,...r.settings};if(S.step===1)render()}catch(e){}}
})();
