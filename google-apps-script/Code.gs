/**
 * Baan Thai Kitchen & Cafe — reservation system backend
 * ------------------------------------------------------
 * This script turns your "Baan Thai Bookings" Google Sheet into the
 * database for the website. Every booking becomes a row in the
 * "Bookings" tab. Staff logins live in the "Staff" tab.
 *
 * How to install: follow the guide (Part 2). In short:
 *   1. Open the Google Sheet > Extensions > Apps Script
 *   2. Delete everything in Code.gs, paste this whole file, Save
 *   3. Run "setup" once and allow access
 *   4. Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone)
 *
 * You don't need to edit anything below this line.
 */

var TZ = "Asia/Kolkata";
var TAB_BOOKINGS = "Bookings", TAB_STAFF = "Staff", TAB_SETTINGS = "Settings";
var COLS = ["Date", "Time", "Name", "Phone", "Code", "Guests", "Adults", "Kids", "Status", "Table",
  "Email", "Preferences", "Guest note", "Staff note", "Source", "Booked at", "Arrived at", "Ticket key"];
var C = {}; COLS.forEach(function (c, i) { C[c] = i; });
var SETTINGS = [
  ["capacity", "Seats per 30-minute slot", 40, 1, 500],
  ["minGuests", "Smallest party", 1, 1, 20],
  ["maxGuests", "Largest online party", 12, 1, 60],
  ["daysAhead", "Days guests can book ahead (incl. today)", 7, 1, 60],
  ["leadMin", "Minimum notice before arrival (minutes)", 30, 0, 240],
  ["holdMin", "Table hold for late guests (minutes)", 15, 0, 120]
];
var STATUS_WORD = { confirmed: "Booked", checked_in: "Arrived", no_show: "No-show", cancelled: "Cancelled" };
var SOURCE_WORD = { online: "Online", phone: "Phone call", walkin: "Walk-in" };
var SESSION_SECONDS = 21600; // 6 hours, renewed on every use
var ALPH = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/* ================= Web entry points ================= */

function doGet() {
  return out({ ok: true, service: "Baan Thai reservations", now: nowIST() });
}

function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (x) { return out({ ok: false, error: "Bad request." }); }
  try {
    var fn = ACTIONS[req.action];
    if (!fn) throw userErr("Unknown request.");
    var res = fn(req) || {};
    res.ok = true;
    return out(res);
  } catch (x) {
    if (x && x.userMessage) return out({ ok: false, error: x.userMessage, code: x.code || "error" });
    console.error(x && x.stack || x);
    return out({ ok: false, error: "Something went wrong on our side. Please try again.", code: "server" });
  }
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function userErr(msg, code) { var e = new Error(msg); e.userMessage = msg; e.code = code || "invalid"; return e; }

var ACTIONS = {
  /* ---------- public (guests) ---------- */
  config: function () { return { settings: getSettings(), now: nowIST() }; },

  availability: function (r) {
    var s = getSettings(), now = nowIST();
    var date = cleanDate(r.date);
    return { settings: s, now: now, date: date, used: usedByTime(readAll(), date, null) };
  },

  book: function (r) {
    if (r.website) throw userErr("Booking blocked."); // spam trap: a hidden field only bots fill in
    var s = getSettings(), now = nowIST();
    var b = cleanGuestInput(r, s);
    if (b.date < now.date || b.date > addDays(now.date, s.daysAhead - 1)) throw userErr("Please pick a date within the next " + s.daysAhead + " days.");
    if (b.date === now.date && toMin(b.time) < now.min + s.leadMin) throw userErr(t12(b.time) + " is too soon to book. Please choose a later time.");
    if (b.guests < s.minGuests || b.guests > s.maxGuests) throw userErr("Online bookings are for " + s.minGuests + " to " + s.maxGuests + " guests. For bigger groups, please call the cafe.");
    var cache = CacheService.getScriptCache(), rk = "rate_" + b.phone, tries = Number(cache.get(rk) || 0);
    if (tries >= 6) throw userErr("Too many bookings from this phone number. Please call the cafe.", "rate");
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      var all = readAll();
      var used = usedByTime(all, b.date, null)[b.time] || 0;
      if (used + b.guests > s.capacity) {
        var left = Math.max(0, s.capacity - used);
        throw userErr(left ? "Only " + left + " seats are left at " + t12(b.time) + ". Please choose another time or fewer guests." : t12(b.time) + " is fully booked. Please choose another time.", "full");
      }
      b.code = newCode(all); b.key = randomStr(10);
      b.status = "confirmed"; b.source = "online"; b.staffNote = ""; b.table = "";
      b.bookedAt = stampIST(); b.arrivedAt = "";
      appendBooking(b);
    } finally { lock.releaseLock(); }
    cache.put(rk, String(tries + 1), 3600);
    return { booking: publicView(b) };
  },

  find: function (r) {
    var code = cleanCode(r.code), digits = String(r.phone || "").replace(/\D/g, "");
    if (!code || digits.length < 6) throw userErr("Enter your booking code and the phone number you booked with.");
    var b = getByCode(code);
    if (!b || b.phone.replace(/\D/g, "").slice(-6) !== digits.slice(-6)) throw userErr("We couldn't find a booking with that code and phone number. Please check both.", "notfound");
    return { booking: publicView(b) };
  },

  /* ---------- staff ---------- */
  login: function (r) {
    var user = String(r.username || "").trim().toLowerCase(), pw = String(r.password || "");
    if (!user || !pw) throw userErr("Enter your login ID and password.");
    var cache = CacheService.getScriptCache(), fk = "fail_" + user, fails = Number(cache.get(fk) || 0);
    if (fails >= 5) throw userErr("Too many wrong attempts. Wait 15 minutes, or ask the manager to reset your password.", "locked");
    var st = findStaff(user);
    if (!st || !st.active || hashPw(pw, st.salt) !== st.hash) {
      cache.put(fk, String(fails + 1), 900);
      throw userErr("Login ID or password is wrong.", "badlogin");
    }
    cache.remove(fk);
    var token = randomStr(32);
    cache.put("s_" + token, JSON.stringify({ u: st.username, n: st.name, ep: epoch() }), SESSION_SECONDS);
    return { token: token, name: st.name, username: st.username, sheetUrl: SpreadsheetApp.getActive().getUrl() };
  },

  logout: function (r) { CacheService.getScriptCache().remove("s_" + r.token); return {}; },

  me: function (r) { var s = auth(r); return { name: s.n, username: s.u, sheetUrl: SpreadsheetApp.getActive().getUrl(), settings: getSettings(), now: nowIST() }; },

  day: function (r) {
    auth(r);
    var date = cleanDate(r.date);
    var list = readAll().filter(function (b) { return b.date === date; }).map(staffView);
    return { date: date, bookings: list, settings: getSettings(), now: nowIST() };
  },

  get: function (r) {
    auth(r);
    var b = getByCode(cleanCode(r.code));
    return { booking: b ? staffView(b) : null, now: nowIST(), settings: getSettings() };
  },

  search: function (r) {
    auth(r);
    var q = String(r.q || "").trim();
    if (q.length < 3) throw userErr("Type at least 3 characters.");
    var code = cleanCode(q), dg = q.replace(/\D/g, ""), lq = q.toLowerCase();
    var list = readAll().filter(function (b) {
      if (code && b.code === code) return true;
      if (dg.length >= 6 && b.phone.replace(/\D/g, "").indexOf(dg.slice(-10)) >= 0) return true;
      return lq.length >= 3 && /[a-z]/.test(lq) && b.name.toLowerCase().indexOf(lq) >= 0;
    });
    list.sort(function (a, b) { return (b.date + b.time).localeCompare(a.date + a.time); });
    return { bookings: list.slice(0, 30).map(staffView) };
  },

  recent: function (r) {
    auth(r);
    var sh = sheet(TAB_BOOKINGS), last = sh.getLastRow(), after = Number(r.after || 0);
    var reset = !after || after > last; // first load, or rows were deleted from the sheet
    var from = Math.max(2, reset ? last - 29 : after + 1);
    var list = [];
    if (last >= from) {
      var vals = sh.getRange(from, 1, last - from + 1, COLS.length).getValues();
      list = vals.map(function (v, i) { return fromRow(v, from + i); }).filter(function (b) { return b.code; });
    }
    return { bookings: list.map(staffView), last: last, reset: reset, now: nowIST() };
  },

  update: function (r) {
    var who = auth(r);
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      var b = getByCode(cleanCode(r.code));
      if (!b) throw userErr("That booking no longer exists.", "notfound");
      var p = r.patch || {}, s = getSettings();
      var moved = false;
      if (p.status !== undefined) {
        if (!STATUS_WORD[p.status]) throw userErr("Unknown status.");
        b.status = p.status;
        if (p.status === "checked_in") b.arrivedAt = stampIST();
        if (p.status === "confirmed") b.arrivedAt = "";
      }
      if (p.table !== undefined) b.table = clip(p.table, 12);
      if (p.staffNote !== undefined) b.staffNote = clip(p.staffNote, 300);
      if (p.date !== undefined || p.time !== undefined || p.adults !== undefined || p.kids !== undefined) {
        var nd = p.date !== undefined ? cleanDate(p.date) : b.date, nt = p.time !== undefined ? cleanTime(p.time) : b.time;
        var na = p.adults !== undefined ? int(p.adults, 1, 60, "Adults") : b.adults, nk = p.kids !== undefined ? int(p.kids, 0, 60, "Kids") : b.kids;
        var used = usedByTime(readAll(), nd, b.code)[nt] || 0;
        if (used + na + nk > s.capacity && !r.force) throw userErr(t12(nt) + " has " + Math.max(0, s.capacity - used) + " seats left. Save again to overbook.", "full");
        b.date = nd; b.time = nt; b.adults = na; b.kids = nk; b.guests = na + nk; moved = true;
      }
      writeBooking(b);
      return { booking: staffView(b), moved: moved, by: who.n };
    } finally { lock.releaseLock(); }
  },

  add: function (r) {
    var who = auth(r), s = getSettings();
    var b = cleanGuestInput(r, s);
    b.source = r.source === "walkin" ? "walkin" : "phone";
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      var all = readAll();
      var used = usedByTime(all, b.date, null)[b.time] || 0;
      if (used + b.guests > s.capacity && !r.force) throw userErr(t12(b.time) + " has " + Math.max(0, s.capacity - used) + " seats left. Press Create booking again to overbook.", "full");
      b.code = newCode(all); b.key = randomStr(10);
      b.status = b.source === "walkin" ? "checked_in" : "confirmed";
      b.table = clip(r.table, 12); b.staffNote = clip(r.staffNote, 300);
      b.bookedAt = stampIST(); b.arrivedAt = b.source === "walkin" ? b.bookedAt : "";
      appendBooking(b);
    } finally { lock.releaseLock(); }
    return { booking: staffView(b), by: who.n };
  },

  saveSettings: function (r) {
    auth(r);
    var v = r.values || {}, cur = getSettings(), next = {};
    SETTINGS.forEach(function (d) {
      var x = v[d[0]] === undefined ? cur[d[0]] : Math.round(Number(v[d[0]]));
      if (!(x >= d[3] && x <= d[4])) throw userErr(d[1] + " must be between " + d[3] + " and " + d[4] + ".");
      next[d[0]] = x;
    });
    if (next.minGuests > next.maxGuests) throw userErr("Smallest party can't be bigger than the largest party.");
    if (next.maxGuests > next.capacity) throw userErr("Largest party can't be more than the seats per slot.");
    var sh = sheet(TAB_SETTINGS);
    SETTINGS.forEach(function (d, i) { sh.getRange(i + 2, 2).setValue(next[d[0]]); });
    return { settings: next };
  }
};

/* ================= Sessions & staff ================= */

function auth(r) {
  var cache = CacheService.getScriptCache(), key = "s_" + String(r.token || "");
  var raw = r.token ? cache.get(key) : null;
  if (!raw) throw userErr("Your login has expired. Please log in again.", "auth");
  var s = JSON.parse(raw);
  if (s.ep !== epoch()) { cache.remove(key); throw userErr("You were signed out by the manager. Please log in again.", "auth"); }
  cache.put(key, raw, SESSION_SECONDS);
  return s;
}
function epoch() { return PropertiesService.getScriptProperties().getProperty("SESSION_EPOCH") || "1"; }

function findStaff(user) {
  var sh = sheet(TAB_STAFF), n = sh.getLastRow();
  if (n < 2) return null;
  var rows = sh.getRange(2, 1, n - 1, 5).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim().toLowerCase() === user) {
      return { row: i + 2, username: String(rows[i][0]).trim().toLowerCase(), name: String(rows[i][1] || rows[i][0]),
        active: String(rows[i][2]).trim().toLowerCase() !== "no", hash: String(rows[i][3]), salt: String(rows[i][4]) };
    }
  }
  return null;
}

function hashPw(pw, salt) {
  var h = salt + "|" + pw;
  for (var i = 0; i < 400; i++) {
    h = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + "|" + salt, Utilities.Charset.UTF_8)
      .map(function (x) { return ("0" + (x & 255).toString(16)).slice(-2); }).join("");
  }
  return h;
}

/* ================= Sheet helpers ================= */

function sheet(name) {
  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw userErr("The '" + name + "' tab is missing. Open the sheet and run Baan Thai > Set up this sheet.", "setup");
  return sh;
}

function readAll() {
  var sh = sheet(TAB_BOOKINGS), n = sh.getLastRow();
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, COLS.length).getValues()
    .map(function (v, i) { return fromRow(v, i + 2); })
    .filter(function (b) { return b.code; });
}

function getByCode(code) {
  if (!code) return null;
  var sh = sheet(TAB_BOOKINGS), n = sh.getLastRow();
  if (n < 2) return null;
  var cell = sh.getRange(2, C.Code + 1, n - 1, 1).createTextFinder(code).matchEntireCell(true).findNext();
  if (!cell) return null;
  var row = cell.getRow();
  return fromRow(sh.getRange(row, 1, 1, COLS.length).getValues()[0], row);
}

function fromRow(v, row) {
  var phone = str(v[C.Phone]), sp = phone.indexOf(" ");
  var statusWord = str(v[C.Status]).toLowerCase(), status = "confirmed";
  Object.keys(STATUS_WORD).forEach(function (k) { if (STATUS_WORD[k].toLowerCase() === statusWord) status = k; });
  var srcWord = str(v[C.Source]).toLowerCase(), source = "online";
  Object.keys(SOURCE_WORD).forEach(function (k) { if (SOURCE_WORD[k].toLowerCase() === srcWord) source = k; });
  var adults = Number(v[C.Adults]) || 0, kids = Number(v[C.Kids]) || 0;
  return {
    row: row, date: dateStr(v[C.Date]), time: timeStr(v[C.Time]), name: str(v[C.Name]),
    cc: sp > 0 ? phone.slice(0, sp) : "", phone: sp > 0 ? phone.slice(sp + 1) : phone,
    code: str(v[C.Code]).toUpperCase(), guests: Number(v[C.Guests]) || adults + kids, adults: adults, kids: kids,
    status: status, table: str(v[C.Table]), email: str(v[C.Email]),
    prefs: str(v[C.Preferences]) ? str(v[C.Preferences]).split(/\s*;\s*/) : [],
    comments: str(v[C["Guest note"]]), staffNote: str(v[C["Staff note"]]), source: source,
    bookedAt: stampStr(v[C["Booked at"]]), arrivedAt: stampStr(v[C["Arrived at"]]), key: str(v[C["Ticket key"]])
  };
}

function toRow(b) {
  var r = [];
  r[C.Date] = txt(b.date); r[C.Time] = txt(b.time); r[C.Name] = txt(b.name); r[C.Phone] = txt((b.cc ? b.cc + " " : "") + b.phone);
  r[C.Code] = b.code; r[C.Guests] = b.guests; r[C.Adults] = b.adults; r[C.Kids] = b.kids;
  r[C.Status] = STATUS_WORD[b.status]; r[C.Table] = txt(b.table); r[C.Email] = txt(b.email);
  r[C.Preferences] = txt((b.prefs || []).join("; ")); r[C["Guest note"]] = txt(b.comments); r[C["Staff note"]] = txt(b.staffNote);
  r[C.Source] = SOURCE_WORD[b.source] || "Online"; r[C["Booked at"]] = txt(b.bookedAt); r[C["Arrived at"]] = txt(b.arrivedAt);
  r[C["Ticket key"]] = b.key;
  return r;
}
function appendBooking(b) { sheet(TAB_BOOKINGS).appendRow(toRow(b)); }
function writeBooking(b) { sheet(TAB_BOOKINGS).getRange(b.row, 1, 1, COLS.length).setValues([toRow(b)]); }

function usedByTime(all, date, excludeCode) {
  var used = {};
  all.forEach(function (b) {
    if (b.date === date && b.code !== excludeCode && b.status !== "cancelled" && b.status !== "no_show") used[b.time] = (used[b.time] || 0) + b.guests;
  });
  return used;
}

function publicView(b) {
  return { code: b.code, key: b.key, name: b.name, cc: b.cc, phone: b.phone, email: b.email, comments: b.comments,
    adults: b.adults, kids: b.kids, guests: b.guests, date: b.date, time: b.time, prefs: b.prefs, status: b.status, table: b.table };
}
function staffView(b) {
  var v = publicView(b);
  v.staffNote = b.staffNote; v.source = b.source; v.bookedAt = b.bookedAt; v.arrivedAt = b.arrivedAt; v.row = b.row;
  return v;
}

function getSettings() {
  var s = {};
  SETTINGS.forEach(function (d) { s[d[0]] = d[2]; });
  var sh = SpreadsheetApp.getActive().getSheetByName(TAB_SETTINGS);
  if (sh && sh.getLastRow() >= 2) {
    var vals = sh.getRange(2, 1, Math.min(sh.getLastRow() - 1, SETTINGS.length), 2).getValues();
    SETTINGS.forEach(function (d, i) { var x = vals[i] ? Number(vals[i][1]) : NaN; if (x >= d[3] && x <= d[4]) s[d[0]] = Math.round(x); });
  }
  return s;
}

/* ================= Validation ================= */

function cleanGuestInput(r, s) {
  var name = clip(r.name, 60);
  if (name.length < 2) throw userErr("Please enter the name for the booking.");
  var cc = String(r.cc || "+91").replace(/[^+\d]/g, "").slice(0, 5) || "+91";
  if (cc.charAt(0) !== "+") cc = "+" + cc;
  var phone = String(r.phone || "").replace(/\D/g, "");
  if (phone.length < 7 || phone.length > 13) throw userErr("Please enter a valid phone number.");
  var email = clip(r.email, 80);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw userErr("That email address doesn't look right.");
  var adults = int(r.adults, 1, 60, "Adults"), kids = int(r.kids || 0, 0, 60, "Kids");
  var prefs = (Array.isArray(r.prefs) ? r.prefs : []).slice(0, 8).map(function (p) { return clip(p, 40); }).filter(String);
  return { name: name, cc: cc, phone: phone, email: email, comments: clip(r.comments, 300), adults: adults, kids: kids,
    guests: adults + kids, date: cleanDate(r.date), time: cleanTime(r.time), prefs: prefs };
}
function cleanDate(d) { d = String(d || ""); if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw userErr("Please pick a valid date."); return d; }
function cleanTime(t) { t = String(t || ""); if (!/^([01]\d|2[0-3]):(00|30)$/.test(t)) throw userErr("Please pick a valid time."); return t; }
function cleanCode(c) { c = String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); if (c.length === 6 && c.indexOf("BT") !== 0) c = "BT" + c; return /^BT[A-Z0-9]{6}$/.test(c) ? c : ""; }
function int(v, lo, hi, label) { var n = Math.round(Number(v)); if (!(n >= lo && n <= hi)) throw userErr(label + " must be between " + lo + " and " + hi + "."); return n; }
function clip(v, n) { return String(v == null ? "" : v).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n); }
function txt(v) { v = v == null ? "" : String(v); return v === "" ? "" : "'" + v; }
function str(v) { return v == null ? "" : String(v).trim(); }
function dateStr(v) { return v instanceof Date ? Utilities.formatDate(v, TZ, "yyyy-MM-dd") : str(v); }
function timeStr(v) { return v instanceof Date ? Utilities.formatDate(v, TZ, "HH:mm") : str(v); }
function stampStr(v) { return v instanceof Date ? Utilities.formatDate(v, TZ, "yyyy-MM-dd HH:mm") : str(v); }

/* ================= Time & ids ================= */

function nowIST() {
  var d = new Date();
  return { date: Utilities.formatDate(d, TZ, "yyyy-MM-dd"), min: Number(Utilities.formatDate(d, TZ, "H")) * 60 + Number(Utilities.formatDate(d, TZ, "m")) };
}
function stampIST() { return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd HH:mm"); }
function addDays(d, n) { var p = d.split("-").map(Number); var t = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)); return t.toISOString().slice(0, 10); }
function toMin(t) { var p = t.split(":").map(Number); return p[0] * 60 + p[1]; }
function t12(t) { var p = t.split(":").map(Number), h = p[0] % 12 || 12; return h + ":" + ("0" + p[1]).slice(-2) + " " + (p[0] < 12 ? "AM" : "PM"); }
function randomStr(n) {
  var s = "";
  while (s.length < n) {
    var hex = Utilities.getUuid().replace(/-/g, "");
    for (var i = 0; i + 1 < hex.length && s.length < n; i += 2) s += ALPH.charAt(parseInt(hex.substr(i, 2), 16) % ALPH.length);
  }
  return s;
}
function newCode(all) {
  var taken = {};
  all.forEach(function (b) { taken[b.code] = 1; });
  for (var i = 0; i < 20; i++) { var c = "BT" + randomStr(6); if (!taken[c]) return c; }
  throw userErr("Couldn't create a booking code. Please try again.");
}

/* ================= Sheet menu (for the manager) ================= */

function onOpen() {
  SpreadsheetApp.getUi().createMenu("Baan Thai")
    .addItem("Set up this sheet", "setup")
    .addSeparator()
    .addItem("Add or change a staff login", "menuAddStaff")
    .addItem("Turn off a staff login", "menuDisableStaff")
    .addItem("Sign out all staff devices", "menuSignOutAll")
    .addToUi();
}

function setup() {
  var ss = SpreadsheetApp.getActive();
  var bk = ss.getSheetByName(TAB_BOOKINGS) || ss.insertSheet(TAB_BOOKINGS, 0);
  if (bk.getLastRow() === 0) bk.appendRow(COLS);
  bk.getRange(1, 1, 1, COLS.length).setValues([COLS]).setFontWeight("bold").setBackground("#2a1d2f").setFontColor("#f4e9c6");
  bk.setFrozenRows(1);
  [100, 70, 170, 140, 95, 60, 60, 50, 90, 55, 180, 180, 220, 180, 90, 130, 130, 90].forEach(function (w, i) { bk.setColumnWidth(i + 1, w); });
  bk.hideColumns(C["Ticket key"] + 1);
  var rules = [["Arrived", "#d9ead3"], ["Cancelled", "#eeeeee"], ["No-show", "#f4cccc"], ["Booked", "#fff2cc"]].map(function (x) {
    return SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(x[0]).setBackground(x[1]).setRanges([bk.getRange("I2:I")]).build();
  });
  bk.setConditionalFormatRules(rules);

  var st = ss.getSheetByName(TAB_STAFF) || ss.insertSheet(TAB_STAFF);
  st.getRange(1, 1, 1, 5).setValues([["Login ID", "Name", "Active (Yes/No)", "Password hash (do not edit)", "Salt (do not edit)"]]).setFontWeight("bold");
  st.setFrozenRows(1);
  st.setColumnWidths(1, 3, 150);

  var se = ss.getSheetByName(TAB_SETTINGS) || ss.insertSheet(TAB_SETTINGS);
  se.getRange(1, 1, 1, 2).setValues([["Setting", "Value"]]).setFontWeight("bold");
  var cur = getSettings();
  SETTINGS.forEach(function (d, i) { se.getRange(i + 2, 1, 1, 2).setValues([[d[1], cur[d[0]]]]); });
  se.setColumnWidth(1, 320);

  if (!PropertiesService.getScriptProperties().getProperty("SESSION_EPOCH")) PropertiesService.getScriptProperties().setProperty("SESSION_EPOCH", "1");
  try { SpreadsheetApp.getUi().alert("Baan Thai sheet is ready.\n\nNext: Baan Thai > Add or change a staff login."); } catch (e) { /* run from editor */ }
}

function menuAddStaff() {
  var ui = SpreadsheetApp.getUi();
  var a = ui.prompt("Add or change a staff login", "Login ID (one word, e.g. counter1 or rahul):", ui.ButtonSet.OK_CANCEL);
  if (a.getSelectedButton() !== ui.Button.OK) return;
  var user = a.getResponseText().trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(user)) { ui.alert("Login ID must be 3 to 30 letters or numbers, with no spaces."); return; }
  var b = ui.prompt("Staff member's name", "Shown on the staff screen, e.g. Rahul K:", ui.ButtonSet.OK_CANCEL);
  if (b.getSelectedButton() !== ui.Button.OK) return;
  var p = ui.prompt("Password for " + user, "At least 8 characters. Write it down and give it to the staff member privately:", ui.ButtonSet.OK_CANCEL);
  if (p.getSelectedButton() !== ui.Button.OK) return;
  var pw = p.getResponseText();
  if (pw.length < 8) { ui.alert("The password must be at least 8 characters. Nothing was saved."); return; }
  var salt = randomStr(16), hash = hashPw(pw, salt), sh = sheet(TAB_STAFF), ex = findStaff(user);
  var row = [user, b.getResponseText().trim() || user, "Yes", hash, salt];
  if (ex) sh.getRange(ex.row, 1, 1, 5).setValues([row]); else sh.appendRow(row);
  ui.alert((ex ? "Updated" : "Added") + " login '" + user + "'.\n\nThey can now log in on the staff page.");
}

function menuDisableStaff() {
  var ui = SpreadsheetApp.getUi();
  var a = ui.prompt("Turn off a staff login", "Login ID to turn off:", ui.ButtonSet.OK_CANCEL);
  if (a.getSelectedButton() !== ui.Button.OK) return;
  var ex = findStaff(a.getResponseText().trim().toLowerCase());
  if (!ex) { ui.alert("No staff login with that ID."); return; }
  sheet(TAB_STAFF).getRange(ex.row, 3).setValue("No");
  bumpEpoch();
  ui.alert("Login '" + ex.username + "' is turned off, and all staff devices have been signed out. Everyone else just logs in again.");
}

function menuSignOutAll() { bumpEpoch(); SpreadsheetApp.getUi().alert("All staff devices are signed out. Staff need to log in again."); }
function bumpEpoch() { var p = PropertiesService.getScriptProperties(); p.setProperty("SESSION_EPOCH", String(Number(p.getProperty("SESSION_EPOCH") || 1) + 1)); }
