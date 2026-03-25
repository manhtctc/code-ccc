/* =============================================
   SAFEWEATHER – MAIN.JS v4.0
   Dual API + Firebase + GPS + Map + Chat + AI
   ============================================= */

// ============================================================
// FIREBASE
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  collection,
  query,
  where,
  onSnapshot,
  serverTimestamp,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getStorage,
  ref as storageRef,
  uploadBytesResumable,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDJWA-JSgO9k5C_FH6PnGjSiKZiFIleCPM",
  authDomain: "weather-app-62b59.firebaseapp.com",
  databaseURL:
    "https://weather-app-62b59-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "weather-app-62b59",
  storageBucket: "weather-app-62b59.firebasestorage.app",
  messagingSenderId: "414119007011",
  appId: "1:414119007011:web:36de87aa4b42d73570b296",
};

const _fbApp = initializeApp(FIREBASE_CONFIG);
const _fbAuth = getAuth(_fbApp);
const _db = getFirestore(_fbApp);
const _storage = getStorage(_fbApp);

const FB = {
  uid: null,
  friendId: null,
  profile: null,
  pendingIn: [],
  pendingOut: [],
  friends: [],
  locations: {},
  shareTimer: null,
  _watched: new Set(),
};
window.FB = FB;

function _genId() {
  const c = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return (
    "SW-" +
    Array.from({ length: 6 }, () => c[(Math.random() * c.length) | 0]).join("")
  );
}
function _timeAgo(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const s = Math.floor((Date.now() - d) / 1000);
  if (s < 60) return `${s}s trước`;
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
  return `${Math.floor(s / 86400)} ngày trước`;
}
function _setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// ── Bước 1: Hiện ID ngay (0ms) ───────────────────────────────
function _initLocalProfile() {
  let id = localStorage.getItem("sw_friend_id");
  if (!id) {
    id = _genId();
    localStorage.setItem("sw_friend_id", id);
  }
  FB.friendId = id;
  _setText("my-friend-id-box", id);
  _setText(
    "fb-my-name",
    localStorage.getItem("sw_name") || "Người dùng SafeWeather",
  );
  const emojiEl = document.getElementById("my-emoji");
  if (emojiEl) emojiEl.textContent = localStorage.getItem("sw_emoji") || "😊";
  const st = document.getElementById("fb-status");
  if (st)
    st.innerHTML = '<span class="fb-dot connecting"></span> Đang kết nối...';
}

// ── Bước 2: Firebase Auth (hoàn toàn ngầm) ───────────────────
function _connectFirebase() {
  const timeout = setTimeout(() => {
    const st = document.getElementById("fb-status");
    if (st)
      st.innerHTML =
        '<span class="fb-dot" style="background:#3d5a7a"></span> Offline';
  }, 12000);

  signInAnonymously(_fbAuth).catch((e) =>
    console.warn("Firebase auth:", e.message),
  );

  onAuthStateChanged(_fbAuth, async (user) => {
    if (!user) return;
    clearTimeout(timeout);
    FB.uid = user.uid;
    try {
      const ref = doc(_db, "users", user.uid);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        const dup = await getDocs(
          query(collection(_db, "users"), where("friendId", "==", FB.friendId)),
        );
        if (!dup.empty) {
          const newId = _genId();
          localStorage.setItem("sw_friend_id", newId);
          FB.friendId = newId;
          _setText("my-friend-id-box", newId);
        }
        const emoji = ["😊", "🌟", "🛡", "🌍", "⚡", "🌸", "🔥", "💙"][
          Math.floor(Math.random() * 8)
        ];
        FB.profile = {
          friendId: FB.friendId,
          displayName:
            localStorage.getItem("sw_name") || "Người dùng SafeWeather",
          emoji,
          createdAt: serverTimestamp(),
          sharing: false,
        };
        await setDoc(ref, FB.profile);
        localStorage.setItem("sw_emoji", emoji);
        const emojiEl = document.getElementById("my-emoji");
        if (emojiEl) emojiEl.textContent = emoji;
      } else {
        FB.profile = snap.data();
        FB.friendId = snap.data().friendId;
        localStorage.setItem("sw_friend_id", FB.friendId);
        localStorage.setItem("sw_name", snap.data().displayName || "");
        localStorage.setItem("sw_emoji", snap.data().emoji || "😊");
        _setText("my-friend-id-box", FB.friendId);
        _setText("fb-my-name", FB.profile.displayName);
        const emojiEl = document.getElementById("my-emoji");
        if (emojiEl) emojiEl.textContent = FB.profile.emoji || "😊";
      }
      const st = document.getElementById("fb-status");
      if (st) st.innerHTML = '<span class="fb-dot online"></span> Đã kết nối';
      _listenRequests();
      _listenLocations();
      _listenGroups();
      console.log("%c🔥 Firebase OK", "color:#ff9800;font-weight:bold");
    } catch (e) {
      console.warn("Firebase lỗi:", e.message);
      const st = document.getElementById("fb-status");
      if (st)
        st.innerHTML = `<span class="fb-dot" style="background:#ff3d3d"></span> Lỗi: ${e.code || e.message}`;
    }
  });
}

// ── Friend Requests ───────────────────────────────────────────
async function _sendRequest(rawId) {
  const tid = (rawId || "").trim().toUpperCase();
  if (!FB.uid) return { ok: false, msg: "⏳ Chờ Firebase kết nối..." };
  if (!tid) return { ok: false, msg: "❌ Nhập Friend ID trước!" };
  if (tid === FB.friendId)
    return { ok: false, msg: "❌ Không thể kết bạn với chính mình!" };
  if (!/^SW-[A-Z2-9]{6}$/.test(tid))
    return { ok: false, msg: "❌ ID không hợp lệ (VD: SW-X4K9M2)" };
  try {
    const [mySent, theirSent] = await Promise.all([
      getDocs(
        query(
          collection(_db, "friendRequests"),
          where("fromId", "==", FB.friendId),
        ),
      ),
      getDocs(
        query(collection(_db, "friendRequests"), where("fromId", "==", tid)),
      ),
    ]);
    const alreadySent = mySent.docs.find((d) => d.data().toId === tid);
    const theysent = theirSent.docs.find((d) => d.data().toId === FB.friendId);
    if (alreadySent)
      return alreadySent.data().status === "accepted"
        ? { ok: false, msg: "⚠ Đã là bạn bè rồi!" }
        : { ok: false, msg: "⚠ Đã gửi lời mời rồi, chờ họ xác nhận!" };
    if (theysent && theysent.data().status === "pending") {
      await updateDoc(doc(_db, "friendRequests", theysent.id), {
        status: "accepted",
        toUid: FB.uid,
        toName: FB.profile.displayName,
        toEmoji: FB.profile.emoji || "😊",
        acceptedAt: serverTimestamp(),
      });
      return {
        ok: true,
        msg: `🎉 Kết bạn thành công với ${theysent.data().fromName}!`,
      };
    }
    if (theysent && theysent.data().status === "accepted")
      return { ok: false, msg: "⚠ Đã là bạn bè rồi!" };
    await addDoc(collection(_db, "friendRequests"), {
      fromUid: FB.uid,
      toUid: "",
      fromId: FB.friendId,
      toId: tid,
      fromName: FB.profile.displayName,
      fromEmoji: FB.profile.emoji || "😊",
      toName: "",
      toEmoji: "😊",
      status: "pending",
      createdAt: serverTimestamp(),
    });
    return { ok: true, msg: `✅ Đã gửi lời mời tới ${tid}!` };
  } catch (e) {
    console.error("sendRequest:", e);
    return { ok: false, msg: `❌ Lỗi: ${e.message}` };
  }
}

async function _acceptRequest(reqId) {
  await updateDoc(doc(_db, "friendRequests", reqId), {
    status: "accepted",
    toUid: FB.uid,
    toName: FB.profile.displayName,
    toEmoji: FB.profile.emoji || "😊",
    acceptedAt: serverTimestamp(),
  });
}
async function _rejectRequest(reqId) {
  await deleteDoc(doc(_db, "friendRequests", reqId));
}
async function _cancelRequest(reqId) {
  if (!confirm("Hủy lời mời kết bạn này?")) return;
  await deleteDoc(doc(_db, "friendRequests", reqId));
  showToast("✅ Đã hủy lời mời");
}
async function _removeFriend(reqId, name) {
  if (!confirm(`Hủy kết bạn với ${name}?`)) return;
  await deleteDoc(doc(_db, "friendRequests", reqId));
}

// ── Realtime Listeners ────────────────────────────────────────
function _listenRequests() {
  onSnapshot(
    query(collection(_db, "friendRequests"), where("toId", "==", FB.friendId)),
    (snap) => {
      FB.pendingIn = [];
      const acc = [];
      snap.forEach((d) => {
        const r = { id: d.id, _dir: "in", ...d.data() };
        if (!r.toUid && FB.uid)
          updateDoc(doc(_db, "friendRequests", d.id), { toUid: FB.uid }).catch(
            () => {},
          );
        if (r.status === "pending") FB.pendingIn.push(r);
        if (r.status === "accepted") acc.push(r);
      });
      FB.friends = [...acc, ...FB.friends.filter((f) => f._dir !== "in")];
      _renderPending();
      _renderFriends();
      _listenAllChats();
      const b = document.getElementById("pending-badge");
      if (b) {
        b.textContent = FB.pendingIn.length || "";
        b.style.display = FB.pendingIn.length ? "" : "none";
      }
    },
  );
  onSnapshot(
    query(collection(_db, "friendRequests"), where("fromUid", "==", FB.uid)),
    (snap) => {
      FB.pendingOut = [];
      const acc = [];
      snap.forEach((d) => {
        const r = { id: d.id, _dir: "out", ...d.data() };
        if (r.status === "pending") FB.pendingOut.push(r);
        if (r.status === "accepted") acc.push(r);
      });
      FB.friends = [...acc, ...FB.friends.filter((f) => f._dir !== "out")];
      _renderPending();
      _renderFriends();
      _listenAllChats();
    },
  );
}

function _listenLocations() {
  setInterval(() => {
    FB.friends.forEach((f) => {
      const uid = f._dir === "in" ? f.fromUid : f.toUid;
      if (!uid || FB._watched.has(uid)) return;
      FB._watched.add(uid);
      onSnapshot(doc(_db, "locations", uid), (snap) => {
        if (snap.exists()) {
          FB.locations[uid] = snap.data();
          _renderFriends();
          _updateMapMarkers();
        }
      });
    });
  }, 2000);
}

function _startSharing() {
  if (!FB.uid) return;
  const push = () => {
    if (!STATE?.lat) return;
    setDoc(doc(_db, "locations", FB.uid), {
      lat: STATE.lat,
      lon: STATE.lon,
      city: STATE.cityName || "",
      road: STATE.addressDetail?.road || "",
      sharing: true,
      updatedAt: serverTimestamp(),
    }).catch(() => {});
  };
  push();
  FB.shareTimer = setInterval(push, 10000);
  updateDoc(doc(_db, "users", FB.uid), { sharing: true }).catch(() => {});
}
function _stopSharing() {
  clearInterval(FB.shareTimer);
  if (!FB.uid) return;
  setDoc(
    doc(_db, "locations", FB.uid),
    { sharing: false, updatedAt: serverTimestamp() },
    { merge: true },
  ).catch(() => {});
  updateDoc(doc(_db, "users", FB.uid), { sharing: false }).catch(() => {});
}

// ── Render ────────────────────────────────────────────────────
function _renderPending() {
  const inEl = document.getElementById("friend-requests-pending");
  const outEl = document.getElementById("friend-requests-sent");
  const cardIn = document.getElementById("card-pending");
  const cardOut = document.getElementById("card-sent");
  const badge = document.getElementById("pending-badge");
  if (inEl) {
    inEl.innerHTML = FB.pendingIn.length
      ? FB.pendingIn
          .map(
            (r) => `
        <div class="fr-item fr-incoming">
          <div class="fr-avatar">${r.fromEmoji || "😊"}</div>
          <div class="fr-info"><div class="fr-name">${r.fromName || "Ẩn danh"}</div><div class="fr-id">${r.fromId}</div></div>
          <div class="fr-actions">
            <button class="fr-btn accept" onclick="_acceptRequest('${r.id}')">✓ Chấp nhận</button>
            <button class="fr-btn reject" onclick="_rejectRequest('${r.id}')">✕</button>
          </div>
        </div>`,
          )
          .join("")
      : "";
  }
  if (cardIn) cardIn.style.display = FB.pendingIn.length ? "" : "none";
  if (badge) {
    badge.textContent = FB.pendingIn.length || "";
    badge.style.display = FB.pendingIn.length ? "" : "none";
  }
  if (outEl) {
    outEl.innerHTML = FB.pendingOut.length
      ? FB.pendingOut
          .map(
            (r) => `
        <div class="fr-item fr-sent">
          <div class="fr-avatar">${r.toEmoji || "😊"}</div>
          <div class="fr-info"><div class="fr-name">${r.toName || r.toId}</div><div class="fr-id">${r.toId}</div></div>
          <button class="fr-btn reject" onclick="_cancelRequest('${r.id}')" title="Hủy lời mời" style="margin-left:auto">✕ Hủy</button>
        </div>`,
          )
          .join("")
      : "";
  }
  if (cardOut) cardOut.style.display = FB.pendingOut.length ? "" : "none";
}

function _renderFriends() {
  const el = document.getElementById("friends-accepted");
  if (!el) return;
  const countEl = document.getElementById("friends-count");
  if (countEl) countEl.textContent = FB.friends.length;
  if (!FB.friends.length) {
    el.innerHTML = `<div class="fr-empty-friends"><div style="font-size:2.5rem;margin-bottom:10px">👥</div><div style="font-weight:600;color:var(--text-secondary)">Chưa có bạn bè</div><div style="font-size:.78rem;color:var(--text-muted);margin-top:6px">Nhập Friend ID để kết nối</div></div>`;
    return;
  }
  el.innerHTML = FB.friends
    .map((f) => {
      const uid = f._dir === "in" ? f.fromUid : f.toUid;
      const name = f._dir === "in" ? f.fromName : f.toName;
      const emoji = f._dir === "in" ? f.fromEmoji : f.toEmoji;
      const fid = f._dir === "in" ? f.fromId : f.toId;
      const loc = FB.locations[uid];
      const on = loc?.sharing;
      const unread = CHAT.unread[uid] || 0;
      return `
      <div class="family-card fb-friend-card">
        <button class="btn-delete-member" onclick="_removeFriend('${f.id}','${name || ""}')" title="Hủy kết bạn">✕</button>
        <div class="fb-friend-avatar">${emoji || "😊"}</div>
        <div class="family-name">${name || "Ẩn danh"}</div>
        <div class="family-friend-id" onclick="navigator.clipboard.writeText('${fid}').then(()=>showToast('✅ Đã copy!'))" title="Copy ID">${fid} <span style="opacity:.4;font-size:.6rem">📋</span></div>
        ${
          on
            ? `<div class="fr-loc-badge online">🟢 Đang chia sẻ vị trí</div>
             <div class="family-loc" style="font-size:.78rem">📍 ${[loc.road, loc.city].filter(Boolean).join(", ") || "--"}</div>
             <div class="family-last-seen">🕐 ${_timeAgo(loc.updatedAt)}</div>
             <div class="fr-card-btns">
               <button class="btn-view-map" onclick="_viewOnMap('${uid}')">🗺 Bản đồ</button>
               <button class="btn-chat" onclick="openChat('${uid}','${name}','${emoji}')">💬 Chat${unread ? ` <span style="background:var(--accent-red);color:#fff;border-radius:8px;padding:0 5px;font-size:.65rem">${unread}</span>` : ""}</button>
             </div>`
            : `<div class="fr-loc-badge offline">⚫ Chưa chia sẻ vị trí</div>
             <button class="btn-chat" style="margin-top:8px;width:100%" onclick="openChat('${uid}','${name}','${emoji}')">💬 Nhắn tin${unread ? ` (${unread})` : ""}</button>`
        }
      </div>`;
    })
    .join("");
}

const _fbMarkers = {};
function _updateMapMarkers() {
  if (!STATE?.map || typeof L === "undefined") return;
  FB.friends.forEach((f) => {
    const uid = f._dir === "in" ? f.fromUid : f.toUid;
    const name = f._dir === "in" ? f.fromName : f.toName;
    const emoji = f._dir === "in" ? f.fromEmoji : f.toEmoji;
    const loc = FB.locations[uid];
    if (!loc?.sharing || !loc?.lat) return;
    if (_fbMarkers[uid]) {
      _fbMarkers[uid].setLatLng([loc.lat, loc.lon]);
    } else {
      _fbMarkers[uid] = L.marker([loc.lat, loc.lon], {
        icon: L.divIcon({
          html: `<div style="font-size:24px;filter:drop-shadow(0 2px 6px rgba(0,0,0,.5))">${emoji || "😊"}</div>`,
          className: "",
          iconSize: [30, 30],
          iconAnchor: [15, 15],
        }),
      }).addTo(STATE.map).bindPopup(`
        <div style="font-family:'Exo 2',sans-serif;background:#0b1628;color:#e8f4ff;padding:10px 14px;border-radius:8px;min-width:170px">
          <div style="font-weight:700;color:#00e676;margin-bottom:6px">${emoji} ${name}</div>
          ${loc.road ? `<div style="font-size:.8rem">🛣 ${loc.road}</div>` : ""}
          <div style="font-size:.78rem;color:#7a9cc0">${loc.city || ""}</div>
          <div style="font-size:.65rem;color:#3d5a7a;margin-top:5px;font-family:monospace">${loc.lat?.toFixed(5)}, ${loc.lon?.toFixed(5)}</div>
        </div>`);
    }
  });
}

function _viewOnMap(uid) {
  const loc = FB.locations[uid];
  if (!loc?.lat) return;
  switchTab("map", document.querySelector('[data-tab="map"]'));
  setTimeout(() => {
    if (STATE?.map) STATE.map.setView([loc.lat, loc.lon], 16);
  }, 300);
}

async function _updateName(name) {
  if (!name?.trim()) return;
  localStorage.setItem("sw_name", name);
  _setText("fb-my-name", name);
  FB.profile && (FB.profile.displayName = name);

  if (!FB.uid) return;

  // Cập nhật profile
  await updateDoc(doc(_db, "users", FB.uid), { displayName: name }).catch(
    () => {},
  );

  // Cập nhật tên trong tất cả friendRequests (cả 2 chiều)
  // để bạn bè thấy tên mới ngay lập tức
  try {
    const [sent, received] = await Promise.all([
      getDocs(
        query(
          collection(_db, "friendRequests"),
          where("fromUid", "==", FB.uid),
        ),
      ),
      getDocs(
        query(
          collection(_db, "friendRequests"),
          where("toId", "==", FB.friendId),
        ),
      ),
    ]);
    const updates = [];
    sent.docs.forEach((d) =>
      updates.push(
        updateDoc(doc(_db, "friendRequests", d.id), { fromName: name }),
      ),
    );
    received.docs.forEach((d) =>
      updates.push(
        updateDoc(doc(_db, "friendRequests", d.id), { toName: name }),
      ),
    );
    await Promise.all(updates);
    showToast(`✅ Đã đổi tên thành "${name}"`);
  } catch (e) {
    console.warn("Update name in requests:", e.message);
  }
}

// ============================================================
// CHAT SYSTEM
// ============================================================
const CHAT = {
  currentUid: null,
  currentName: null,
  currentEmoji: null,
  unsubMsg: null,
  unread: {},
  convMeta: {},
  windowOpen: false,
};

function _chatId(a, b) {
  return [a, b].sort().join("_");
}
function _esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}

function toggleChatWindow() {
  const win = document.getElementById("chat-window");
  if (!win) return;
  CHAT.windowOpen = !CHAT.windowOpen;
  win.classList.toggle("hidden", !CHAT.windowOpen);
  if (CHAT.windowOpen) {
    _renderConvList();
    _renderGroupList();
  }
}

// ── Tab DM / Group ────────────────────────────────────────────
function switchChatTab(tab) {
  CHAT.activeTab = tab;
  document.getElementById("tab-dm")?.classList.toggle("active", tab === "dm");
  document
    .getElementById("tab-grp")
    ?.classList.toggle("active", tab === "group");
  document
    .getElementById("chat-conv-list")
    ?.classList.toggle("hidden", tab !== "dm");
  document
    .getElementById("chat-group-list")
    ?.classList.toggle("hidden", tab !== "group");
  if (tab === "group") _renderGroupList();
}

// ── DM ────────────────────────────────────────────────────────
function openChat(friendUid, friendName, friendEmoji) {
  CHAT.currentUid = friendUid;
  CHAT.currentName = friendName;
  CHAT.currentEmoji = friendEmoji;
  CHAT.currentGroup = null;
  _switchView("chat-view-convo");
  document.getElementById("chat-h-avatar").textContent = friendEmoji || "😊";
  document.getElementById("chat-h-name").textContent = friendName || "Bạn bè";
  const loc = FB.locations[friendUid];
  const sb = document.getElementById("chat-h-sub");
  if (sb) {
    sb.textContent = loc?.sharing ? "🟢 Đang chia sẻ vị trí" : "⚫ Offline";
    sb.className = "chat-header-sub" + (loc?.sharing ? " online" : "");
  }
  document.getElementById("chat-btn-map").style.display = "";
  document.getElementById("chat-btn-members").style.display = "none";
  CHAT.unread[friendUid] = 0;
  CHAT.unread[friendUid + "_readAt"] = Date.now();
  _updateChatBadge();
  _renderFriends();
  if (!CHAT.windowOpen) {
    CHAT.windowOpen = true;
    document.getElementById("chat-window")?.classList.remove("hidden");
  }
  _listenMessages(friendUid);
  setTimeout(() => document.getElementById("chat-input")?.focus(), 100);
}

function showChatList() {
  if (CHAT.unsubMsg) {
    CHAT.unsubMsg();
    CHAT.unsubMsg = null;
  }
  CHAT.currentUid = null;
  CHAT.currentGroup = null;
  _switchView("chat-view-list");
  _renderConvList();
  _renderGroupList();
}

function chatGoMap() {
  if (CHAT.currentUid) _viewOnMap(CHAT.currentUid);
}

function _switchView(id) {
  [
    "chat-view-list",
    "chat-view-convo",
    "chat-view-create-group",
    "chat-view-group-invites",
    "chat-view-members",
  ].forEach((v) => {
    document.getElementById(v)?.classList.toggle("hidden", v !== id);
  });
}

function _renderConvList() {
  const el = document.getElementById("chat-conv-list");
  if (!el) return;
  if (!FB.friends.length) {
    el.innerHTML = `<div class="chat-conv-empty"><div style="font-size:2rem;margin-bottom:8px">💬</div><div>Kết bạn để nhắn tin</div></div>`;
    return;
  }
  el.innerHTML = FB.friends
    .map((f) => {
      const uid = f._dir === "in" ? f.fromUid : f.toUid;
      const name = f._dir === "in" ? f.fromName : f.toName;
      const emoji = f._dir === "in" ? f.fromEmoji : f.toEmoji;
      const meta = CHAT.convMeta[uid] || {};
      const unread = CHAT.unread[uid] || 0;
      const isOnline = FB.locations[uid]?.sharing;
      const lastMsg = meta.lastMsg
        ? _esc(meta.lastMsg.substring(0, 35)) + "..."
        : "Bấm để nhắn tin";
      const lastTime = meta.lastTime ? _fmtChatTime(meta.lastTime) : "";
      return `<div class="chat-conv-item ${unread ? "has-unread" : ""}" onclick="openChat('${uid}','${_esc(name)}','${emoji}')">
      <div class="chat-conv-avatar">${emoji || "😊"}${isOnline ? '<div class="chat-conv-online-dot"></div>' : ""}</div>
      <div class="chat-conv-body"><div class="chat-conv-name">${_esc(name || "Ẩn danh")}</div><div class="chat-conv-last ${unread ? "unread" : ""}">${lastMsg}</div></div>
      <div class="chat-conv-meta">${lastTime ? `<div class="chat-conv-time">${lastTime}</div>` : ""} ${unread ? `<div class="chat-unread-badge">${unread}</div>` : ""}</div>
    </div>`;
    })
    .join("");
}

function _fmtChatTime(ts) {
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });
}

function _listenMessages(friendUid) {
  if (!FB.uid) return;
  if (CHAT.unsubMsg) {
    CHAT.unsubMsg();
    CHAT.unsubMsg = null;
  }
  const chatId = _chatId(FB.uid, friendUid);
  const el = document.getElementById("chat-messages");
  if (el) el.innerHTML = '<div class="chat-loading">💬 Đang tải...</div>';
  CHAT.unsubMsg = onSnapshot(
    collection(_db, "chats", chatId, "messages"),
    (snap) => {
      const msgs = [];
      snap.forEach((d) => msgs.push({ id: d.id, ...d.data() }));
      msgs.sort(
        (a, b) =>
          (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0),
      );
      _renderMessages(msgs, false, chatId);
      CHAT.unread[friendUid] = 0;
      CHAT.unread[friendUid + "_readAt"] = Date.now();
      _updateChatBadge();
      msgs
        .filter((m) => m.senderUid !== FB.uid && !m.readBy?.[FB.uid])
        .forEach((m) => {
          updateDoc(doc(_db, "chats", chatId, "messages", m.id), {
            [`readBy.${FB.uid}`]: true,
          }).catch(() => {});
        });
    },
  );
}

// ============================================================
// GROUP CHAT SYSTEM
// ============================================================
const GROUP = {
  selected: new Set(),
  currentId: null,
  currentData: null,
  emoji: "🌟",
  unsub: null,
};

function _renderGroupList() {
  const el = document.getElementById("chat-group-list");
  if (!el) return;
  if (!CHAT.groups || !Object.keys(CHAT.groups).length) {
    el.innerHTML = `<div class="chat-conv-empty"><div style="font-size:2rem;margin-bottom:8px">👥</div><div>Chưa có nhóm nào<br><span style="font-size:.78rem;color:var(--text-muted)">Bấm "Nhóm mới" để tạo</span></div></div>`;
    return;
  }
  el.innerHTML = Object.entries(CHAT.groups)
    .map(([gid, g]) => {
      const unread = CHAT.unread["g_" + gid] || 0;
      const lastMsg = g.lastMsg
        ? _esc(g.lastMsg.substring(0, 35)) + "..."
        : "Bấm để vào nhóm";
      const lastTime = g.lastMsgTime ? _fmtChatTime(g.lastMsgTime) : "";
      const memberCount = g.members?.length || 0;
      return `<div class="chat-conv-item ${unread ? "has-unread" : ""}" onclick="openGroupChat('${gid}')">
      <div class="chat-conv-avatar grp">${g.emoji || "👥"}</div>
      <div class="chat-conv-body">
        <div class="chat-conv-name">${_esc(g.name || "Nhóm")}</div>
        <div class="chat-conv-last ${unread ? "unread" : ""}">${lastMsg}</div>
      </div>
      <div class="chat-conv-meta">
        <div class="chat-conv-time" style="color:var(--text-muted)">${memberCount} thành viên</div>
        ${lastTime ? `<div class="chat-conv-time">${lastTime}</div>` : ""}
        ${unread ? `<div class="chat-unread-badge">${unread}</div>` : ""}
      </div>
    </div>`;
    })
    .join("");
}

// ── Tạo nhóm ─────────────────────────────────────────────────
function showCreateGroup() {
  GROUP.selected = new Set();
  GROUP.emoji = "🌟";
  _switchView("chat-view-create-group");
  document.getElementById("grp-name-input").value = "";
  document.getElementById("grp-emoji-btn").textContent = "🌟";
  const g = document.getElementById("grp-emoji-grid");
  if (g) g.style.display = "none";
  _renderFriendSelect();
}

function toggleGrpEmoji() {
  const g = document.getElementById("grp-emoji-grid");
  if (g) g.style.display = g.style.display === "flex" ? "none" : "flex";
}
function setGrpEmoji(e) {
  GROUP.emoji = e;
  document.getElementById("grp-emoji-btn").textContent = e;
  const g = document.getElementById("grp-emoji-grid");
  if (g) g.style.display = "none";
}

function _renderFriendSelect() {
  const el = document.getElementById("grp-friend-select");
  if (!el) return;
  if (!FB.friends.length) {
    el.innerHTML = `<div style="color:var(--text-muted);font-size:.82rem;text-align:center;padding:12px">Cần có bạn bè để thêm vào nhóm</div>`;
    return;
  }
  el.innerHTML = FB.friends
    .map((f) => {
      const uid = f._dir === "in" ? f.fromUid : f.toUid;
      const name = f._dir === "in" ? f.fromName : f.toName;
      const emoji = f._dir === "in" ? f.fromEmoji : f.toEmoji;
      const checked = GROUP.selected.has(uid);
      return `<div class="grp-friend-row ${checked ? "selected" : ""}" onclick="toggleFriendSelect('${uid}',this)">
      <div class="grp-check">${checked ? "✓" : ""}</div>
      <div class="grp-f-avatar">${emoji || "😊"}</div>
      <div class="grp-f-name">${_esc(name || "Ẩn danh")}</div>
    </div>`;
    })
    .join("");
}

function toggleFriendSelect(uid, el) {
  if (GROUP.selected.has(uid)) {
    GROUP.selected.delete(uid);
    el.classList.remove("selected");
    el.querySelector(".grp-check").textContent = "";
  } else {
    GROUP.selected.add(uid);
    el.classList.add("selected");
    el.querySelector(".grp-check").textContent = "✓";
  }
}

async function createGroup() {
  const name = document.getElementById("grp-name-input")?.value?.trim();
  if (!name) {
    showToast("⚠ Nhập tên nhóm trước!");
    return;
  }
  if (!FB.uid) {
    showToast("⏳ Chờ Firebase kết nối...");
    return;
  }
  const members = [FB.uid, ...Array.from(GROUP.selected)];
  if (members.length < 2) {
    showToast("⚠ Thêm ít nhất 1 thành viên!");
    return;
  }
  try {
    const gRef = await addDoc(collection(_db, "groups"), {
      name,
      emoji: GROUP.emoji,
      members,
      createdBy: FB.uid,
      createdByName: FB.profile?.displayName || "",
      createdAt: serverTimestamp(),
      lastMsg: "Nhóm vừa được tạo",
      lastMsgTime: serverTimestamp(),
    });
    // Gửi lời mời cho các thành viên
    const invites = Array.from(GROUP.selected).map((uid) =>
      addDoc(collection(_db, "groupInvites"), {
        groupId: gRef.id,
        groupName: name,
        groupEmoji: GROUP.emoji,
        fromUid: FB.uid,
        fromName: FB.profile?.displayName || "",
        toUid: uid,
        status: "accepted", // auto-accepted khi tạo nhóm
        createdAt: serverTimestamp(),
      }),
    );
    await Promise.all(invites);
    // Gửi tin nhắn hệ thống
    await addDoc(collection(_db, "groups", gRef.id, "messages"), {
      text: `${GROUP.emoji} Nhóm "${name}" được tạo bởi ${FB.profile?.displayName || "Admin"}`,
      senderUid: "system",
      senderName: "Hệ thống",
      senderEmoji: "🛡",
      system: true,
      createdAt: serverTimestamp(),
    });
    showToast(`✅ Đã tạo nhóm "${name}"!`);
    openGroupChat(gRef.id);
  } catch (e) {
    showToast("❌ Lỗi tạo nhóm: " + e.message);
  }
}

// ── Mở nhóm chat ─────────────────────────────────────────────
function openGroupChat(groupId) {
  const g = CHAT.groups?.[groupId];
  if (!g) return;
  GROUP.currentId = groupId;
  GROUP.currentData = g;
  CHAT.currentUid = null;
  CHAT.currentGroup = groupId;
  _switchView("chat-view-convo");
  document.getElementById("chat-h-avatar").textContent = g.emoji || "👥";
  document.getElementById("chat-h-name").textContent = g.name || "Nhóm";
  const sb = document.getElementById("chat-h-sub");
  if (sb) {
    sb.textContent = `👥 ${g.members?.length || 0} thành viên`;
    sb.className = "chat-header-sub";
  }
  document.getElementById("chat-btn-map").style.display = "none";
  document.getElementById("chat-btn-members").style.display = "";
  CHAT.unread["g_" + groupId] = 0;
  CHAT.unread["g_" + groupId + "_readAt"] = Date.now();
  _updateChatBadge();
  if (!CHAT.windowOpen) {
    CHAT.windowOpen = true;
    document.getElementById("chat-window")?.classList.remove("hidden");
  }
  _listenGroupMessages(groupId);
  setTimeout(() => document.getElementById("chat-input")?.focus(), 100);
}

function showGroupChat() {
  if (GROUP.currentId) openGroupChat(GROUP.currentId);
}

function _listenGroupMessages(groupId) {
  if (CHAT.unsubMsg) {
    CHAT.unsubMsg();
    CHAT.unsubMsg = null;
  }
  const el = document.getElementById("chat-messages");
  if (el) el.innerHTML = '<div class="chat-loading">💬 Đang tải...</div>';
  CHAT.unsubMsg = onSnapshot(
    collection(_db, "groups", groupId, "messages"),
    (snap) => {
      const msgs = [];
      snap.forEach((d) => msgs.push({ id: d.id, ...d.data() }));
      msgs.sort(
        (a, b) =>
          (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0),
      );
      _renderMessages(msgs, true, groupId);
      CHAT.unread["g_" + groupId] = 0;
      CHAT.unread["g_" + groupId + "_readAt"] = Date.now();
      _updateChatBadge();
    },
  );
}

// ── Thành viên nhóm ───────────────────────────────────────────
// ── Thành viên nhóm ───────────────────────────────────────────
async function showGroupMembers() {
  _switchView("chat-view-members");
  const g = GROUP.currentData;
  if (!g) return;
  const isAdmin = g.createdBy === FB.uid;

  // Header
  const title = document.getElementById("grp-members-title");
  const sub = document.getElementById("grp-members-sub");
  const av = document.getElementById("grp-info-avatar");
  const nm = document.getElementById("grp-info-name");
  const role = document.getElementById("grp-info-role");
  if (title) title.textContent = `👥 ${g.name || "Nhóm"}`;
  if (sub) sub.textContent = `${g.members?.length || 0} thành viên`;
  if (av) av.textContent = g.emoji || "👥";
  if (nm) nm.textContent = g.name || "Nhóm";
  if (role)
    role.innerHTML = isAdmin
      ? '<span style="color:#ffb300">👑 Bạn là trưởng nhóm</span>'
      : '<span style="color:var(--text-muted)">Thành viên</span>';

  document.getElementById("grp-rename-form")?.classList.add("hidden");

  // Map uid → info từ bạn bè
  const allUsers = {
    [FB.uid]: {
      name: FB.profile?.displayName || "Tôi",
      emoji: FB.profile?.emoji || "😊",
    },
  };
  FB.friends.forEach((f) => {
    const uid = f._dir === "in" ? f.fromUid : f.toUid;
    allUsers[uid] = {
      name: f._dir === "in" ? f.fromName : f.toName,
      emoji: f._dir === "in" ? f.fromEmoji : f.toEmoji,
    };
  });

  // Với những UID chưa có — lấy từ Firestore
  const unknownUids = (g.members || []).filter((uid) => !allUsers[uid]);
  if (unknownUids.length) {
    await Promise.all(
      unknownUids.map(async (uid) => {
        try {
          const snap = await getDoc(doc(_db, "users", uid));
          if (snap.exists()) {
            const d = snap.data();
            allUsers[uid] = {
              name: d.displayName || "Người dùng",
              emoji: d.emoji || "😊",
            };
          } else {
            allUsers[uid] = { name: "Người dùng", emoji: "😊" };
          }
        } catch {
          allUsers[uid] = { name: "Người dùng", emoji: "😊" };
        }
      }),
    );
  }

  const el = document.getElementById("group-members-list");
  if (!el) return;
  el.innerHTML = (g.members || [])
    .map((uid) => {
      const u = allUsers[uid] || { name: "Người dùng", emoji: "😊" };
      const isMe = uid === FB.uid;
      const isOwner = uid === g.createdBy;
      return `
      <div class="grp-member-row">
        <div class="grp-member-avatar">
          ${u.emoji}
          ${isOwner ? '<div class="grp-crown">👑</div>' : ""}
        </div>
        <div class="grp-member-info">
          <div class="grp-member-name">${_esc(u.name)}${isMe ? ` <span style="color:var(--accent-cyan);font-size:.7rem">(Tôi)</span>` : ""}</div>
          <div class="grp-member-role">${isOwner ? "Trưởng nhóm" : "Thành viên"}</div>
        </div>
        ${
          isAdmin && !isMe && !isOwner
            ? `
          <button class="grp-kick-btn" onclick="kickMember('${GROUP.currentId}','${uid}','${_esc(u.name)}')" title="Xóa khỏi nhóm">
            <span>✕</span> Xóa
          </button>`
            : ""
        }
      </div>`;
    })
    .join("");

  // Mời thêm
  const moreEl = document.getElementById("grp-invite-more-list");
  if (!moreEl) return;
  const notIn = FB.friends.filter((f) => {
    const uid = f._dir === "in" ? f.fromUid : f.toUid;
    return !(g.members || []).includes(uid);
  });
  const invSec = document.getElementById("grp-invite-section");
  if (invSec) invSec.style.display = notIn.length ? "" : "none";
  moreEl.innerHTML = notIn
    .map((f) => {
      const uid = f._dir === "in" ? f.fromUid : f.toUid;
      const name = f._dir === "in" ? f.fromName : f.toName;
      const emoji = f._dir === "in" ? f.fromEmoji : f.toEmoji;
      return `
      <div class="grp-member-row">
        <div class="grp-member-avatar">${emoji || "😊"}</div>
        <div class="grp-member-info">
          <div class="grp-member-name">${_esc(name || "Ẩn danh")}</div>
        </div>
        <button class="grp-invite-btn" onclick="inviteToGroup('${GROUP.currentId}','${uid}','${_esc(name)}','${emoji}')">
          + Mời
        </button>
      </div>`;
    })
    .join("");
}

// ── Đổi tên nhóm ─────────────────────────────────────────────
let _renameEmoji = "";
function showRenameGroup() {
  const form = document.getElementById("grp-rename-form");
  if (!form) return;
  const g = GROUP.currentData;
  _renameEmoji = g?.emoji || "👥";
  const input = document.getElementById("grp-rename-input");
  const btn = document.getElementById("grp-rename-emoji-btn");
  if (input) input.value = g?.name || "";
  if (btn) btn.textContent = _renameEmoji;
  const grid = document.getElementById("grp-rename-emoji-grid");
  if (grid) grid.style.display = "none";
  form.classList.remove("hidden");
  setTimeout(() => input?.focus(), 100);
}
function cancelRenameGroup() {
  document.getElementById("grp-rename-form")?.classList.add("hidden");
}
function toggleRenameEmoji() {
  const g = document.getElementById("grp-rename-emoji-grid");
  if (g) g.style.display = g.style.display === "flex" ? "none" : "flex";
}
function setRenameEmoji(e) {
  _renameEmoji = e;
  document.getElementById("grp-rename-emoji-btn").textContent = e;
  document.getElementById("grp-rename-emoji-grid").style.display = "none";
}
async function submitRenameGroup() {
  const name = document.getElementById("grp-rename-input")?.value?.trim();
  if (!name) {
    showToast("⚠ Nhập tên nhóm trước!");
    return;
  }
  const gid = GROUP.currentId;
  const old = GROUP.currentData?.name;
  try {
    await updateDoc(doc(_db, "groups", gid), { name, emoji: _renameEmoji });
    await addDoc(collection(_db, "groups", gid, "messages"), {
      text: `✏ Nhóm đổi tên thành "${name}" bởi ${FB.profile?.displayName || "Admin"}`,
      senderUid: "system",
      senderName: "Hệ thống",
      senderEmoji: "🛡",
      system: true,
      createdAt: serverTimestamp(),
    });
    GROUP.currentData = { ...GROUP.currentData, name, emoji: _renameEmoji };
    showToast(`✅ Đã đổi tên thành "${name}"`);
    cancelRenameGroup();
    showGroupMembers();
  } catch (e) {
    showToast("❌ Lỗi: " + e.message);
  }
}

// ── Xóa thành viên (chỉ admin) ───────────────────────────────
async function kickMember(groupId, uid, name) {
  if (!confirm(`Xóa "${name}" khỏi nhóm?`)) return;
  try {
    const newMembers = (GROUP.currentData.members || []).filter(
      (m) => m !== uid,
    );
    await updateDoc(doc(_db, "groups", groupId), { members: newMembers });
    await addDoc(collection(_db, "groups", groupId, "messages"), {
      text: `🚫 ${name} đã bị xóa khỏi nhóm`,
      senderUid: "system",
      senderName: "Hệ thống",
      senderEmoji: "🛡",
      system: true,
      createdAt: serverTimestamp(),
    });
    GROUP.currentData = { ...GROUP.currentData, members: newMembers };
    showToast(`✅ Đã xóa "${name}" khỏi nhóm`);
    showGroupMembers();
  } catch (e) {
    showToast("❌ Lỗi: " + e.message);
  }
}

// ── Rời nhóm ─────────────────────────────────────────────────
async function leaveGroup() {
  const g = GROUP.currentData;
  const isAdmin = g?.createdBy === FB.uid;
  const msg = isAdmin
    ? "Bạn là trưởng nhóm! Rời nhóm sẽ giải tán nhóm. Tiếp tục?"
    : `Rời khỏi nhóm "${g?.name}"?`;
  if (!confirm(msg)) return;
  const gid = GROUP.currentId;
  try {
    if (isAdmin) {
      // Admin rời → xóa nhóm
      await updateDoc(doc(_db, "groups", gid), {
        members: [],
        disbanded: true,
      });
    } else {
      const newMembers = (g.members || []).filter((m) => m !== FB.uid);
      await updateDoc(doc(_db, "groups", gid), { members: newMembers });
      await addDoc(collection(_db, "groups", gid, "messages"), {
        text: `🚪 ${FB.profile?.displayName || "Ai đó"} đã rời nhóm`,
        senderUid: "system",
        senderName: "Hệ thống",
        senderEmoji: "🛡",
        system: true,
        createdAt: serverTimestamp(),
      });
    }
    GROUP.currentId = null;
    GROUP.currentData = null;
    CHAT.currentGroup = null;
    showChatList();
    switchChatTab("group");
    showToast(isAdmin ? "Đã giải tán nhóm" : "Đã rời khỏi nhóm");
  } catch (e) {
    showToast("❌ Lỗi: " + e.message);
  }
}

async function inviteToGroup(groupId, uid, name, emoji) {
  try {
    await updateDoc(doc(_db, "groups", groupId), {
      members: [...GROUP.currentData.members, uid],
    });
    await addDoc(collection(_db, "groups", groupId, "messages"), {
      text: `${emoji} ${name} đã được thêm vào nhóm`,
      senderUid: "system",
      senderName: "Hệ thống",
      senderEmoji: "🛡",
      system: true,
      createdAt: serverTimestamp(),
    });
    GROUP.currentData = {
      ...GROUP.currentData,
      members: [...GROUP.currentData.members, uid],
    };
    showToast(`✅ Đã mời ${name} vào nhóm!`);
    showGroupMembers();
  } catch (e) {
    showToast("❌ Lỗi: " + e.message);
  }
}

// ── Listen groups realtime ────────────────────────────────────
function _listenGroups() {
  if (!FB.uid || CHAT._unsubGroups) return;
  CHAT.groups = {};
  CHAT._unsubGroups = onSnapshot(
    query(
      collection(_db, "groups"),
      where("members", "array-contains", FB.uid),
    ),
    (snap) => {
      snap.forEach((d) => {
        CHAT.groups[d.id] = { id: d.id, ...d.data() };
      });
      // Xóa nhóm bị xóa
      const ids = snap.docs.map((d) => d.id);
      Object.keys(CHAT.groups).forEach((id) => {
        if (!ids.includes(id)) delete CHAT.groups[id];
      });
      _renderGroupList();
      _updateChatBadge();
      // Theo dõi tin nhắn mới
      snap.docs.forEach((d) => {
        const gid = d.id;
        const g = d.data();
        if (CHAT.unread["g_" + gid + "_watched"]) return;
        CHAT.unread["g_" + gid + "_watched"] = true;
        onSnapshot(doc(_db, "groups", gid), (gs) => {
          if (!gs.exists()) return;
          const gdata = gs.data();
          CHAT.groups[gid] = { id: gid, ...gdata };
          _renderGroupList();
          if (CHAT.currentGroup !== gid || !CHAT.windowOpen) {
            const lastTime = gdata.lastMsgTime?.toMillis?.() || 0;
            const readAt = CHAT.unread["g_" + gid + "_readAt"] || 0;
            if (lastTime > readAt && lastTime > 0) {
              CHAT.unread["g_" + gid] = (CHAT.unread["g_" + gid] || 0) + 1;
              _updateChatBadge();
              _renderGroupList();
              if (Notification.permission === "granted") {
                new Notification(`${gdata.emoji || "👥"} ${gdata.name}`, {
                  body: gdata.lastMsg?.substring(0, 60) || "Tin nhắn mới",
                  tag: "grp-" + gid,
                });
              } else {
                showToast(
                  `💬 ${gdata.emoji || "👥"} ${gdata.name}: ${gdata.lastMsg?.substring(0, 30) || "..."}`,
                );
              }
            }
          }
        });
      });
    },
  );
}

function _renderMessages(msgs, isGroup, chatId) {
  const el = document.getElementById("chat-messages");
  if (!el) return;
  if (!msgs.length) {
    el.innerHTML = `<div class="chat-empty"><div style="font-size:2rem;margin-bottom:8px">👋</div><div>Xin chào! Hãy bắt đầu cuộc trò chuyện</div></div>`;
    return;
  }
  let html = "",
    lastDate = "";
  msgs.forEach((m, i) => {
    const isMe = m.senderUid === FB.uid;
    const isSystem = m.system === true;
    const d = m.createdAt?.toDate?.() || new Date();
    const dateStr = d.toLocaleDateString("vi-VN");
    const timeStr = d.toLocaleTimeString("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
    });
    const today = new Date().toLocaleDateString("vi-VN");
    if (dateStr !== lastDate) {
      lastDate = dateStr;
      html += `<div class="chat-date-sep"><span>${dateStr === today ? "Hôm nay" : dateStr}</span></div>`;
    }
    // Tin nhắn hệ thống
    if (isSystem) {
      html += `<div class="chat-sys-msg">${m.text}</div>`;
      return;
    }
    const deleted = m.deleted === true || m.deletedFor?.[FB.uid] === true;
    const prevMsg = msgs[i - 1];
    const showAvatar =
      !isMe &&
      (i === 0 || prevMsg?.senderUid !== m.senderUid || prevMsg?.system);
    const showName = isGroup && !isMe && showAvatar;
    const nextMsg = msgs[i + 1];
    const isLastInGroup =
      isMe && (!nextMsg || nextMsg.senderUid !== m.senderUid || nextMsg.system);
    html += `
      <div class="chat-msg ${isMe ? "me" : "them"}" data-id="${m.id}">
        ${!isMe && showAvatar ? `<div class="chat-msg-avatar">${m.senderEmoji || "😊"}</div>` : !isMe ? '<div style="width:26px;flex-shrink:0"></div>' : ""}
        <div class="chat-bubble-wrap ${isMe ? "me" : "them"}">
          <button class="chat-menu-dots ${deleted ? "hidden" : ""}" onclick="showMsgMenu(event,'${m.id}','${isMe ? "me" : "them"}','${chatId || ""}','${isGroup ? "group" : "dm"}')" title="Tùy chọn">•••</button>
          <div class="chat-bubble ${isMe ? "me" : "them"} ${deleted ? "deleted" : ""}">
            ${showName ? `<div class="chat-bubble-sender">${_esc(m.senderName || "")}</div>` : ""}
            ${
              deleted
                ? `<div class="chat-bubble-text deleted-text">🚫 Tin nhắn đã bị xóa</div>`
                : m.type === "image" && m.imageUrl
                  ? `<div class="chat-bubble-img-wrap">
                     <img src="${m.imageUrl}" class="chat-bubble-img"
                       onclick="openChatImageViewer('${m.imageUrl}')"
                       loading="lazy" alt="Ảnh"/>
                   </div>`
                  : `<div class="chat-bubble-text">${_esc(m.text)}</div>`
            }
            <div class="chat-bubble-footer">
              <span class="chat-bubble-time">${timeStr}</span>
              ${isMe && isLastInGroup && !isGroup ? `<span class="chat-read-tick">${m.readBy && Object.keys(m.readBy).length ? "✓✓" : "✓"}</span>` : ""}
            </div>
          </div>
        </div>
      </div>`;
  });
  el.innerHTML = html;
  el.scrollTop = el.scrollHeight;
}

// ── Context Menu ──────────────────────────────────────────────
function showMsgMenu(event, msgId, dir, chatId, chatType) {
  event.stopPropagation();
  document.querySelector(".chat-ctx-menu")?.remove();

  const msgEl = event.target.closest(".chat-msg");
  const bubble = msgEl?.querySelector(".chat-bubble");
  const text =
    msgEl?.querySelector(".chat-bubble-text")?.textContent?.trim() || "";
  const isMe = dir === "me";

  const menu = document.createElement("div");
  menu.className = "chat-ctx-menu";
  menu._msgText = text;
  menu.innerHTML = `
    <button class="ctx-item" onclick="ctxCopy('${msgId}')">
      <span class="ctx-icon">📋</span><span>Sao chép</span>
    </button>
    <button class="ctx-item" onclick="ctxForward('${msgId}')">
      <span class="ctx-icon">↗</span><span>Chuyển tiếp</span>
    </button>
    <div class="ctx-divider"></div>
    <button class="ctx-item danger" onclick="ctxDelete('${msgId}','${chatId}','${chatType}')">
      <span class="ctx-icon">🗑</span>
      <span>${isMe ? "Xóa với mọi người" : "Xóa với tôi"}</span>
    </button>`;

  // Gắn vào chat-window để không bị tràn ra ngoài
  const chatWin = document.getElementById("chat-window") || document.body;
  chatWin.appendChild(menu);

  // Căn theo bubble
  const ref = bubble || event.target;
  const refRect = ref.getBoundingClientRect();
  const winRect = chatWin.getBoundingClientRect();
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;

  // Tính vị trí relative với chatWin
  let top = refRect.bottom - winRect.top + 4;
  let left = isMe
    ? refRect.right - winRect.left - mw // căn phải với bubble
    : refRect.left - winRect.left; // căn trái với bubble

  // Không tràn ra ngoài cửa sổ chat
  const maxLeft = chatWin.offsetWidth - mw - 6;
  const maxTop = chatWin.offsetHeight - mh - 6;
  if (left < 6) left = 6;
  if (left > maxLeft) left = maxLeft;
  if (top > maxTop) top = refRect.top - winRect.top - mh - 4;
  if (top < 6) top = 6;

  Object.assign(menu.style, {
    position: "absolute",
    zIndex: "3000",
    top: top + "px",
    left: left + "px",
    animation: "ctxFadeIn .15s ease",
  });

  setTimeout(
    () => document.addEventListener("click", _closeCtxMenu, { once: true }),
    10,
  );
}

function _closeCtxMenu() {
  document.querySelector(".chat-ctx-menu")?.remove();
}

function ctxCopy(msgId) {
  const menu = document.querySelector(".chat-ctx-menu");
  const text =
    menu?._msgText ||
    document.querySelector(`[data-id="${msgId}"] .chat-bubble-text`)
      ?.textContent ||
    "";
  navigator.clipboard.writeText(text).then(() => showToast("✅ Đã sao chép!"));
  _closeCtxMenu();
}

function ctxForward(msgId) {
  const menu = document.querySelector(".chat-ctx-menu");
  const text =
    menu?._msgText ||
    document.querySelector(`[data-id="${msgId}"] .chat-bubble-text`)
      ?.textContent ||
    "";
  _closeCtxMenu();
  // Điền vào ô nhập và focus
  const input = document.getElementById("chat-input");
  if (input) {
    input.value = "↗ " + text;
    input.focus();
    chatInputChange();
  }
  showToast("↗ Đã chuyển tiếp vào ô nhập");
}

async function ctxDelete(msgId, chatId, chatType) {
  _closeCtxMenu();
  if (!confirm("Xóa tin nhắn này?")) return;
  try {
    // Dùng đường dẫn đầy đủ thay vì doc(collection, id)
    const msgRef =
      chatType === "group"
        ? doc(_db, "groups", chatId, "messages", msgId)
        : doc(_db, "chats", chatId, "messages", msgId);

    const msgSnap = await getDoc(msgRef);
    if (!msgSnap.exists()) {
      showToast("❌ Không tìm thấy tin nhắn");
      return;
    }

    const isOwner = msgSnap.data().senderUid === FB.uid;
    if (isOwner) {
      await updateDoc(msgRef, {
        deleted: true,
        text: "",
        deletedAt: serverTimestamp(),
      });
      showToast("🗑 Đã xóa với mọi người");
    } else {
      await updateDoc(msgRef, { [`deletedFor.${FB.uid}`]: true });
      showToast("🗑 Đã xóa với bạn");
    }
  } catch (e) {
    showToast("❌ Lỗi xóa: " + e.message);
  }
}

async function chatSend() {
  const input = document.getElementById("chat-input");
  const text = input?.value?.trim();
  if (!text || !FB.uid) return;
  if (!CHAT.currentUid && !CHAT.currentGroup) return;
  input.value = "";
  chatInputChange();
  try {
    if (CHAT.currentGroup) {
      // Gửi vào nhóm
      const gid = CHAT.currentGroup;
      await addDoc(collection(_db, "groups", gid, "messages"), {
        text,
        senderUid: FB.uid,
        senderName: FB.profile?.displayName || "",
        senderEmoji: FB.profile?.emoji || "😊",
        createdAt: serverTimestamp(),
      });
      await updateDoc(doc(_db, "groups", gid), {
        lastMsg: text,
        lastMsgTime: serverTimestamp(),
      });
    } else {
      // Gửi DM
      const chatId = _chatId(FB.uid, CHAT.currentUid);
      await addDoc(collection(_db, "chats", chatId, "messages"), {
        text,
        senderUid: FB.uid,
        senderName: FB.profile?.displayName || "",
        senderEmoji: FB.profile?.emoji || "😊",
        readBy: {},
        createdAt: serverTimestamp(),
      });
      await setDoc(
        doc(_db, "chats", chatId),
        {
          lastMsg: text,
          lastMsgTime: serverTimestamp(),
          members: [FB.uid, CHAT.currentUid],
        },
        { merge: true },
      );
    }
  } catch (e) {
    showToast("❌ Lỗi gửi tin nhắn");
  }
}

// ============================================================
// IMAGE UPLOAD
// ============================================================
async function chatSendImage(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = ""; // reset để chọn lại cùng file

  // Kiểm tra kích thước < 5MB
  if (file.size > 5 * 1024 * 1024) {
    showToast("❌ Ảnh quá lớn! Tối đa 5MB");
    return;
  }
  if (!FB.uid || (!CHAT.currentUid && !CHAT.currentGroup)) {
    showToast("❌ Chưa chọn cuộc trò chuyện");
    return;
  }

  // Hiện progress bar
  const prog = document.getElementById("chat-upload-progress");
  const bar = document.getElementById("chat-upload-bar");
  const label = document.getElementById("chat-upload-label");
  if (prog) prog.classList.remove("hidden");

  try {
    // Upload lên Firebase Storage
    const path = `chat-images/${FB.uid}/${Date.now()}_${file.name}`;
    const imgRef = storageRef(_storage, path);
    const task = uploadBytesResumable(imgRef, file);

    await new Promise((resolve, reject) => {
      task.on(
        "state_changed",
        (snap) => {
          const pct = Math.round(
            (snap.bytesTransferred / snap.totalBytes) * 100,
          );
          if (bar) bar.style.width = pct + "%";
          if (label) label.textContent = `Đang tải... ${pct}%`;
        },
        reject,
        resolve,
      );
    });

    const url = await getDownloadURL(task.snapshot.ref);

    // Gửi tin nhắn loại ảnh
    const msgData = {
      type: "image",
      imageUrl: url,
      text: "📷 Đã gửi một ảnh",
      senderUid: FB.uid,
      senderName: FB.profile?.displayName || "",
      senderEmoji: FB.profile?.emoji || "😊",
      readBy: {},
      createdAt: serverTimestamp(),
    };

    if (CHAT.currentGroup) {
      const gid = CHAT.currentGroup;
      await addDoc(collection(_db, "groups", gid, "messages"), msgData);
      await updateDoc(doc(_db, "groups", gid), {
        lastMsg: "📷 Ảnh",
        lastMsgTime: serverTimestamp(),
      });
    } else {
      const chatId = _chatId(FB.uid, CHAT.currentUid);
      await addDoc(collection(_db, "chats", chatId, "messages"), msgData);
      await setDoc(
        doc(_db, "chats", chatId),
        {
          lastMsg: "📷 Ảnh",
          lastMsgTime: serverTimestamp(),
          members: [FB.uid, CHAT.currentUid],
        },
        { merge: true },
      );
    }

    if (prog) prog.classList.add("hidden");
    if (bar) bar.style.width = "0%";
  } catch (e) {
    if (prog) prog.classList.add("hidden");
    showToast("❌ Lỗi upload: " + e.message);
    console.error("uploadImage:", e);
  }
}

function chatInputChange() {
  const input = document.getElementById("chat-input");
  const btn = document.getElementById("chat-send-btn");
  if (btn)
    btn.classList.toggle("active", (input?.value?.trim().length || 0) > 0);
}

function toggleChatEmoji() {
  const g = document.getElementById("chat-emoji-grid");
  if (g) g.style.display = g.style.display === "flex" ? "none" : "flex";
}

// ── Image Viewer ──────────────────────────────────────────────
function openChatImageViewer(url) {
  document.querySelector(".chat-img-viewer")?.remove();
  const viewer = document.createElement("div");
  viewer.className = "chat-img-viewer";
  viewer.innerHTML = `
    <div class="chat-img-viewer-bg" onclick="this.parentElement.remove()"></div>
    <div class="chat-img-viewer-box">
      <button class="chat-img-viewer-close" onclick="this.closest('.chat-img-viewer').remove()">✕</button>
      <img src="${url}" class="chat-img-viewer-img" alt="Ảnh"/>
      <a href="${url}" download target="_blank" class="chat-img-viewer-dl">⬇ Tải xuống</a>
    </div>`;
  document.body.appendChild(viewer);
}

function chatEmoji(e) {
  const input = document.getElementById("chat-input");
  if (input) {
    input.value += e;
    input.focus();
    chatInputChange();
  }
  const g = document.getElementById("chat-emoji-grid");
  if (g) g.style.display = "none";
}

function _updateChatBadge() {
  const total = Object.entries(CHAT.unread)
    .filter(([k]) => !k.includes("_"))
    .reduce((s, [, v]) => s + (v || 0), 0);
  const fab = document.getElementById("chat-fab");
  const badge = document.getElementById("chat-total-badge");
  if (badge) {
    badge.textContent = total;
    badge.classList.toggle("hidden", total === 0);
  }
  if (fab) fab.classList.toggle("hidden", !FB.friends.length);
}

function _listenAllChats() {
  if (!FB.uid) return;
  FB.friends.forEach((f) => {
    const uid = f._dir === "in" ? f.fromUid : f.toUid;
    if (!uid || CHAT.unread[uid + "_watched"]) return;
    CHAT.unread[uid + "_watched"] = true;
    const chatId = _chatId(FB.uid, uid);
    onSnapshot(doc(_db, "chats", chatId), (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      CHAT.convMeta[uid] = {
        lastMsg: data.lastMsg,
        lastTime: data.lastMsgTime,
      };
      if (CHAT.currentUid !== uid || !CHAT.windowOpen) {
        const lastTime = data.lastMsgTime?.toMillis?.() || 0;
        const readAt = CHAT.unread[uid + "_readAt"] || 0;
        if (lastTime > readAt && lastTime > 0) {
          const name = f._dir === "in" ? f.fromName : f.toName;
          const emoji = f._dir === "in" ? f.fromEmoji : f.toEmoji;
          CHAT.unread[uid] = (CHAT.unread[uid] || 0) + 1;
          _updateChatBadge();
          _renderConvList();
          _renderFriends();
          if (Notification.permission === "granted") {
            new Notification(`${emoji} ${name}`, {
              body: data.lastMsg?.substring(0, 60) || "Tin nhắn mới",
              tag: `chat-${uid}`,
            });
          } else {
            showToast(
              `💬 ${emoji} ${name}: ${data.lastMsg?.substring(0, 30) || "..."}`,
            );
          }
        }
      }
      if (CHAT.windowOpen && !CHAT.currentUid) _renderConvList();
    });
  });
  _updateChatBadge();
}

// ============================================================
// PUBLIC FIREBASE UI FUNCTIONS
// ============================================================
function fbSendRequest() {
  const input = document.getElementById("add-friend-input");
  const msgEl = document.getElementById("add-friend-msg");
  const val = input?.value?.trim();
  if (!val) {
    if (msgEl) {
      msgEl.textContent = "⚠ Nhập Friend ID trước!";
      msgEl.className = "fb-msg warn";
    }
    return;
  }
  if (!FB.uid) {
    if (msgEl) {
      msgEl.textContent = "⏳ Firebase chưa kết nối...";
      msgEl.className = "fb-msg warn";
    }
    return;
  }
  if (msgEl) {
    msgEl.textContent = "⏳ Đang gửi...";
    msgEl.className = "fb-msg";
  }
  _sendRequest(val).then((r) => {
    if (msgEl) {
      msgEl.textContent = r.msg;
      msgEl.className = `fb-msg ${r.ok ? "ok" : "err"}`;
    }
    if (r.ok) {
      if (input) input.value = "";
      setTimeout(() => {
        if (msgEl) msgEl.textContent = "";
      }, 4000);
    }
  });
}
function fbEditName() {
  const cur = document.getElementById("fb-my-name")?.textContent || "";
  const name = prompt("Nhập tên hiển thị:", cur);
  if (name?.trim()) _updateName(name.trim());
}
function copyMyId() {
  const id =
    document.getElementById("my-friend-id-box")?.textContent?.trim() || "";
  if (!id || id.includes("...")) return;
  navigator.clipboard.writeText(id).then(() => showToast(`✅ Đã copy: ${id}`));
}
function startSharing() {
  document.getElementById("btn-share-start")?.classList.add("hidden");
  document.getElementById("btn-share-stop")?.classList.remove("hidden");
  _startSharing();
  addAlertLog("📡", "Đang chia sẻ vị trí realtime.", "safe");
}
function stopSharing() {
  document.getElementById("btn-share-start")?.classList.remove("hidden");
  document.getElementById("btn-share-stop")?.classList.add("hidden");
  _stopSharing();
  addAlertLog("🔕", "Đã dừng chia sẻ.", "safe");
}
function initFirebaseSystem() {
  _initLocalProfile();
  _connectFirebase();
}

const CONFIG = {
  OWM_KEY: "6770fd12ffcb99fa9f49528d53191343",
  OWM_BASE: "https://api.openweathermap.org/data/2.5",
  GEO_BASE: "https://api.openweathermap.org/geo/1.0",
  METEO_BASE: "https://api.open-meteo.com/v1",
  UPDATE_INT: 300_000,
  CACHE_TTL: 300_000,
};

const CACHE_KEY = "sw_weather_v3";

// ============================================================
// WMO CODES
// ============================================================
const WMO = {
  0: { desc: "Trời quang đãng", icon: "☀️" },
  1: { desc: "Chủ yếu quang đãng", icon: "🌤" },
  2: { desc: "Có mây một phần", icon: "⛅" },
  3: { desc: "Nhiều mây", icon: "☁️" },
  45: { desc: "Sương mù", icon: "🌫" },
  48: { desc: "Sương mù đóng băng", icon: "🌫" },
  51: { desc: "Mưa phùn nhẹ", icon: "🌦" },
  53: { desc: "Mưa phùn vừa", icon: "🌦" },
  55: { desc: "Mưa phùn dày", icon: "🌧" },
  61: { desc: "Mưa nhẹ", icon: "🌧" },
  63: { desc: "Mưa vừa", icon: "🌧" },
  65: { desc: "Mưa to", icon: "🌧" },
  71: { desc: "Tuyết nhẹ", icon: "❄️" },
  73: { desc: "Tuyết vừa", icon: "❄️" },
  75: { desc: "Tuyết dày", icon: "❄️" },
  80: { desc: "Mưa rào nhẹ", icon: "🌦" },
  81: { desc: "Mưa rào vừa", icon: "🌧" },
  82: { desc: "Mưa rào mạnh", icon: "🌧" },
  95: { desc: "Dông bão", icon: "⛈" },
  96: { desc: "Dông mưa đá nhỏ", icon: "⛈" },
  99: { desc: "Dông mưa đá lớn", icon: "⛈" },
};
function wmo(code) {
  return WMO[code] || { desc: "Không xác định", icon: "🌤" };
}

const OWM_ICONS = {
  "01d": "☀️",
  "01n": "🌙",
  "02d": "⛅",
  "02n": "⛅",
  "03d": "☁️",
  "03n": "☁️",
  "04d": "☁️",
  "04n": "☁️",
  "09d": "🌧",
  "09n": "🌧",
  "10d": "🌦",
  "10n": "🌧",
  "11d": "⛈",
  "11n": "⛈",
  "13d": "❄️",
  "13n": "❄️",
  "50d": "🌫",
  "50n": "🌫",
};
function owmIcon(c) {
  return OWM_ICONS[c] || "🌤";
}

// ============================================================
// STATE
// ============================================================
const STATE = {
  lat: null,
  lon: null,
  cityName: "",
  owmData: null,
  owmForecast: null,
  meteoData: null,
  meteoDailyData: null,
  merged: {
    temp: null,
    feelsLike: null,
    humidity: null,
    windSpeed: null,
    windDeg: null,
    pressure: null,
    visibility: null,
    weatherCode: null,
    weatherDesc: null,
    weatherIcon: null,
    sunrise: null,
    sunset: null,
    todayMax: null,
    todayMin: null,
    todayRain: null,
    todayWind: null,
    source: "none",
  },
  alertLevel: "safe",
  myStatus: null,
  sharing: false,
  shareInterval: null,
  map: null,
  myMarker: null,
  weatherLayer: false,
  hourlyChart: null,
  alertLog: [],
  _lastAccuracy: 9999,
  familyMembers: [],
};

// ============================================================
// UTILS
// ============================================================
function avg(...vals) {
  const v = vals.filter((x) => x !== null && x !== undefined && !isNaN(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}
function round(v, d = 1) {
  return v !== null ? +v.toFixed(d) : null;
}
function setText(id, val) {
  const el = document.getElementById(id);
  if (el && val !== null) el.textContent = val;
}
function windDir(deg) {
  const d = [
    "Bắc",
    "Đông Bắc",
    "Đông",
    "Đông Nam",
    "Nam",
    "Tây Nam",
    "Tây",
    "Tây Bắc",
  ];
  return d[Math.round((deg || 0) / 45) % 8];
}
function fmtTime(unix) {
  return new Date(unix * 1000).toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
function fmtHour(unix) {
  return new Date(unix * 1000).toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
function fmtDay(unix) {
  return new Date(unix * 1000).toLocaleDateString("vi-VN", {
    weekday: "long",
    day: "numeric",
    month: "numeric",
  });
}
function fmtDayS(str) {
  return new Date(str).toLocaleDateString("vi-VN", {
    weekday: "short",
    day: "numeric",
    month: "numeric",
  });
}
function sourceBadge(s) {
  if (s === "both")
    return `<span style="background:rgba(0,230,118,.15);color:#00e676;border:1px solid rgba(0,230,118,.3);border-radius:4px;padding:2px 8px;font-size:.7rem;margin-left:8px">✅ 2 nguồn</span>`;
  if (s === "owm")
    return `<span style="background:rgba(255,179,0,.15);color:#ffb300;border:1px solid rgba(255,179,0,.3);border-radius:4px;padding:2px 8px;font-size:.7rem;margin-left:8px">OWM</span>`;
  if (s === "meteo")
    return `<span style="background:rgba(0,212,255,.15);color:#00d4ff;border:1px solid rgba(0,212,255,.3);border-radius:4px;padding:2px 8px;font-size:.7rem;margin-left:8px">Open-Meteo</span>`;
  return "";
}

// ============================================================
// CLOCK
// ============================================================
function startClock() {
  function tick() {
    const n = new Date(),
      h = String(n.getHours()).padStart(2, "0"),
      m = String(n.getMinutes()).padStart(2, "0"),
      s = String(n.getSeconds()).padStart(2, "0");
    const el = document.getElementById("live-clock");
    if (el) el.textContent = `${h}:${m}:${s}`;
  }
  tick();
  setInterval(tick, 1000);
}

// ============================================================
// GPS — cache-first, nhanh, cải thiện ngầm
// ============================================================
function getLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({ lat: 21.0285, lon: 105.8542, accuracy: null });
      return;
    }
    let resolved = false;
    // Thử GPS cache 30s trước — cực nhanh
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (resolved) return;
        resolved = true;
        resolve({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
      },
      () => {
        if (!resolved) {
          resolved = true;
          resolve({ lat: 21.0285, lon: 105.8542, accuracy: null });
        }
      },
      { enableHighAccuracy: false, timeout: 2000, maximumAge: 30000 },
    );
    // Đồng thời watch GPS chính xác ngầm
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude: lat, longitude: lon, accuracy } = pos.coords;
        if (!resolved) {
          resolved = true;
          navigator.geolocation.clearWatch(watchId);
          resolve({ lat, lon, accuracy });
          return;
        }
        if (accuracy <= 50 && accuracy < STATE._lastAccuracy) {
          STATE._lastAccuracy = accuracy;
          STATE.lat = lat;
          STATE.lon = lon;
          navigator.geolocation.clearWatch(watchId);
          if (STATE.map && STATE.myMarker) STATE.myMarker.setLatLng([lat, lon]);
          reverseGeocode(lat, lon).then((city) => {
            STATE.cityName = city;
            setText("city-name", city);
            updateMapPanel();
          });
        }
      },
      (err) => console.warn("GPS watch:", err.message),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
    );
    setTimeout(() => navigator.geolocation.clearWatch(watchId), 15000);
  });
}

// ============================================================
// REVERSE GEOCODING
// ============================================================
async function reverseGeocode(lat, lon) {
  try {
    // Nominatim (OpenStreetMap) — trả về tên đường + phường + quận chi tiết
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=vi&addressdetails=1`,
      { headers: { "User-Agent": "SafeWeather/3.0" } },
    );
    if (!res.ok) throw new Error("Nominatim error");
    const data = await res.json();
    const a = data.address || {};
    const road = a.road || a.pedestrian || a.footway || a.path || "";
    const houseNumber = a.house_number ? `${a.house_number} ` : "";
    const ward = a.suburb || a.quarter || a.neighbourhood || a.village || "";
    const district = a.city_district || a.district || a.county || "";
    const city = a.city || a.town || a.state || "";
    STATE.addressDetail = {
      road: road ? `${houseNumber}${road}` : "",
      ward,
      district,
      city,
      full: [road ? `${houseNumber}${road}` : "", ward, district, city]
        .filter(Boolean)
        .join(", "),
    };
    updateLocationDisplay();
    return [district, city].filter(Boolean).join(", ") || "Vị trí của bạn";
  } catch (e) {
    console.warn("Nominatim lỗi, fallback OWM:", e.message);
    try {
      const res = await fetch(
        `${CONFIG.GEO_BASE}/reverse?lat=${lat}&lon=${lon}&limit=1&appid=${CONFIG.OWM_KEY}`,
      );
      if (!res.ok) return "Vị trí của bạn";
      const data = await res.json();
      if (data.length > 0) {
        const d = data[0];
        return [d.local_names?.vi || d.name, d.state, "Việt Nam"]
          .filter(Boolean)
          .join(", ");
      }
    } catch {}
    return "Vị trí của bạn";
  }
}

function updateLocationDisplay() {
  const a = STATE.addressDetail;
  if (!a) return;
  const cityName = [a.district, a.city].filter(Boolean).join(", ");
  if (cityName) {
    setText("city-name", cityName);
    STATE.cityName = cityName;
  }

  // Tách số nhà và tên đường để hiển thị riêng
  const roadEl = document.getElementById("map-loc-road");
  if (roadEl) {
    if (a.road) {
      // Highlight số nhà nếu có
      const parts = a.road.match(/^(\d+[\w\/]*)\s+(.+)$/);
      if (parts) {
        roadEl.innerHTML = `<span style="background:rgba(0,212,255,.15);color:#00d4ff;border:1px solid rgba(0,212,255,.3);border-radius:4px;padding:1px 7px;font-family:'Orbitron',monospace;font-size:.75rem;font-weight:700;margin-right:6px">Số ${parts[1]}</span><span>${parts[2]}</span>`;
      } else {
        roadEl.textContent = a.road;
      }
    } else {
      roadEl.textContent = "—";
    }
  }

  setText(
    "map-loc-district",
    [a.ward, a.district, a.city].filter(Boolean).join(", ") || "—",
  );
  if (STATE.lat)
    setText(
      "map-loc-coords",
      `${STATE.lat.toFixed(5)}, ${STATE.lon.toFixed(5)}`,
    );

  // Cập nhật popup bản đồ
  if (STATE.myMarker) {
    const roadParts = a.road?.match(/^(\d+[\w\/]*)\s+(.+)$/);
    const roadHtml = a.road
      ? roadParts
        ? `<div style="display:flex;align-items:center;gap:5px;margin-bottom:3px">
            <span style="background:#00d4ff;color:#000;border-radius:3px;padding:1px 5px;font-size:.68rem;font-weight:800;white-space:nowrap">Số ${roadParts[1]}</span>
            <span style="color:#e8f4ff;font-size:.8rem;font-weight:600">${roadParts[2]}</span>
           </div>`
        : `<div style="color:#e8f4ff;font-size:.8rem;font-weight:600;margin-bottom:3px">${a.road}</div>`
      : "";
    STATE.myMarker.setPopupContent(`
      <div style="font-family:'Exo 2',sans-serif;background:#0b1628;color:#e8f4ff;padding:10px 12px;border-radius:8px;min-width:180px;max-width:240px">
        <div style="color:#00d4ff;font-weight:700;font-size:.8rem;letter-spacing:.5px;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid #1a2f50">📍 Vị trí của bạn</div>
        ${roadHtml}
        <div style="font-size:.75rem;color:#7a9cc0;margin-top:2px">${[a.ward, a.district].filter(Boolean).join(" · ")}</div>
        ${a.city ? `<div style="font-size:.72rem;color:#3d5a7a">${a.city}</div>` : ""}
        <div style="font-size:.65rem;color:#3d5a7a;margin-top:6px;font-family:monospace;border-top:1px solid #1a2f50;padding-top:5px">${STATE.lat?.toFixed(6)}, ${STATE.lon?.toFixed(6)}</div>
      </div>`);
  }
}

// ============================================================

function saveCache(data) {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        ts: Date.now(),
        owmData: data.owmData,
        owmForecast: data.owmForecast,
        meteoData: data.meteoData,
        meteoDailyData: data.meteoDailyData,
        cityName: data.cityName,
      }),
    );
  } catch (e) {}
}
function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cache = JSON.parse(raw);
    const age = Date.now() - cache.ts;
    if (age < CONFIG.CACHE_TTL) {
      console.log(`⚡ Cache hit ${Math.round(age / 1000)}s`);
      return cache;
    }
    return { ...cache, stale: true };
  } catch {
    return null;
  }
}
function applyCache(cache) {
  STATE.owmData = cache.owmData;
  STATE.owmForecast = cache.owmForecast;
  STATE.meteoData = cache.meteoData;
  STATE.meteoDailyData = cache.meteoDailyData;
  STATE.cityName = cache.cityName || "";
  mergeWeatherData();
  renderAll();
  setText("last-update", `⚡ Cache ${cache.stale ? "(đang cập nhật...)" : ""}`);
}

// ============================================================
// FETCH APIs
// ============================================================
async function fetchOWM(lat, lon) {
  try {
    const [cR, fR] = await Promise.all([
      fetch(
        `${CONFIG.OWM_BASE}/weather?lat=${lat}&lon=${lon}&appid=${CONFIG.OWM_KEY}&units=metric&lang=vi`,
      ),
      fetch(
        `${CONFIG.OWM_BASE}/forecast?lat=${lat}&lon=${lon}&appid=${CONFIG.OWM_KEY}&units=metric&lang=vi`,
      ),
    ]);
    if (!cR.ok) throw new Error(`OWM ${cR.status}`);
    STATE.owmData = await cR.json();
    STATE.owmForecast = await fR.json();
    return true;
  } catch (e) {
    console.warn("❌ OWM:", e.message);
    return false;
  }
}

async function fetchOpenMeteo(lat, lon) {
  try {
    const url = `${CONFIG.METEO_BASE}/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,relativehumidity_2m,apparent_temperature,precipitation_probability,weathercode,windspeed_10m,winddirection_10m,surface_pressure,visibility&daily=weathercode,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max,windspeed_10m_max&current_weather=true&timezone=Asia%2FHo_Chi_Minh&forecast_days=8&windspeed_unit=kmh`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Meteo ${res.status}`);
    const data = await res.json();
    STATE.meteoData = data;
    STATE.meteoDailyData = data.daily;
    return true;
  } catch (e) {
    console.warn("❌ Open-Meteo:", e.message);
    return false;
  }
}

// ============================================================
// MERGE DATA
// ============================================================
function mergeWeatherData() {
  const owm = STATE.owmData,
    meteo = STATE.meteoData,
    m = STATE.merged;
  const owmTemp = owm ? owm.main.temp : null,
    meteoTemp = meteo ? meteo.current_weather.temperature : null;
  m.temp = round(avg(owmTemp, meteoTemp));
  m.feelsLike = round(
    avg(
      owm ? owm.main.feels_like : null,
      getMeteoHourly("apparent_temperature"),
    ),
  );
  m.humidity = round(
    avg(owm ? owm.main.humidity : null, getMeteoHourly("relativehumidity_2m")),
    0,
  );
  m.windSpeed = round(
    avg(
      owm ? owm.wind.speed * 3.6 : null,
      meteo ? meteo.current_weather.windspeed : null,
    ),
    0,
  );
  m.windDeg = owm
    ? owm.wind.deg
    : meteo
      ? meteo.current_weather.winddirection
      : 0;
  m.pressure = round(
    avg(owm ? owm.main.pressure : null, getMeteoHourly("surface_pressure")),
    0,
  );
  const rawVis = getMeteoHourly("visibility");
  m.visibility = round(
    avg(owm ? owm.visibility / 1000 : null, rawVis ? rawVis / 1000 : null),
    1,
  );
  if (meteo) {
    const info = wmo(meteo.current_weather.weathercode);
    m.weatherIcon = info.icon;
    m.weatherDesc = info.desc;
    m.weatherCode = meteo.current_weather.weathercode;
  } else if (owm) {
    m.weatherIcon = owmIcon(owm.weather[0].icon);
    m.weatherDesc = owm.weather[0].description;
    m.weatherCode = owm.weather[0].id;
  }
  if (owm) {
    m.sunrise = owm.sys.sunrise;
    m.sunset = owm.sys.sunset;
  } else if (STATE.meteoDailyData) {
    m.sunrise = new Date(STATE.meteoDailyData.sunrise[0]).getTime() / 1000;
    m.sunset = new Date(STATE.meteoDailyData.sunset[0]).getTime() / 1000;
  }
  m.source = owm && meteo ? "both" : owm ? "owm" : meteo ? "meteo" : "none";
  // Today stats
  if (STATE.meteoDailyData) {
    const d = STATE.meteoDailyData;
    m.todayMax = Math.round(d.temperature_2m_max[0]);
    m.todayMin = Math.round(d.temperature_2m_min[0]);
    m.todayRain = d.precipitation_probability_max[0] || 0;
    m.todayWind = Math.round(d.windspeed_10m_max[0] || 0);
  }
}

function getMeteoHourly(field) {
  const data = STATE.meteoData;
  if (!data?.hourly?.[field]) return null;
  const nowStr = new Date().toISOString().slice(0, 13);
  const idx = data.hourly.time.findIndex((t) => t.startsWith(nowStr));
  return data.hourly[field][idx !== -1 ? idx : 0];
}

// ============================================================
// MAIN FETCH — GPS first, cache for weather only
// ============================================================
async function fetchWeather() {
  showLoadingState(true);
  const { lat, lon, accuracy } = await getLocation();
  STATE.lat = lat;
  STATE.lon = lon;
  const cache = loadCache();
  if (cache) {
    applyCache(cache);
    if (!cache.stale) {
      reverseGeocode(lat, lon).then((city) => {
        STATE.cityName = city;
        setText("city-name", city);
        setText("map-loc-city", city);
        updateMapPanel();
      });
      showLoadingState(false);
      updateLastUpdate();
      return;
    }
  }
  try {
    const [cityName, owmOk, meteoOk] = await Promise.all([
      reverseGeocode(lat, lon),
      fetchOWM(lat, lon),
      fetchOpenMeteo(lat, lon),
    ]);
    STATE.cityName = cityName;
    setText("city-name", cityName);
    if (!owmOk && !meteoOk) throw new Error("Cả 2 API thất bại");
    mergeWeatherData();
    renderAll();
    runGroqAnalysis(); // Chạy AI phân tích sau khi có data
    saveCache({
      owmData: STATE.owmData,
      owmForecast: STATE.owmForecast,
      meteoData: STATE.meteoData,
      meteoDailyData: STATE.meteoDailyData,
      cityName: STATE.cityName,
    });
    const accStr = accuracy ? `±${Math.round(accuracy)}m` : "?";
    addAlertLog(
      "✅",
      `Dữ liệu từ ${owmOk && meteoOk ? "2 nguồn" : "1 nguồn"}. GPS ${accStr}`,
      "safe",
    );
  } catch (err) {
    console.error(err);
    if (!cache) {
      addAlertLog(
        "❌",
        "Không thể tải dữ liệu. Kiểm tra kết nối mạng.",
        "danger",
      );
      showToast("❌ Lỗi tải dữ liệu", 4000);
    }
  } finally {
    showLoadingState(false);
    updateLastUpdate();
  }
}

function showLoadingState(loading) {
  const btn = document.querySelector(".btn-refresh");
  if (btn) btn.textContent = loading ? "⏳ Đang tải..." : "↻ Làm mới";
}
function updateLastUpdate() {
  const el = document.getElementById("last-update");
  if (el)
    el.textContent = `Cập nhật ${new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}`;
}

// ============================================================
// RENDER ALL
// ============================================================
function renderAll() {
  renderCurrentWeather();
  renderForecast();
  renderAlerts();
  updateMapPanel();
  if (STATE.lat) updateMap();
}

function renderCurrentWeather() {
  const m = STATE.merged;
  if (m.source === "none") return;
  setText("temp-main", m.temp !== null ? Math.round(m.temp) : "--");
  setText("weather-desc", m.weatherDesc || "--");
  setText("feels-like", m.feelsLike !== null ? Math.round(m.feelsLike) : "--");
  setText(
    "humidity",
    m.humidity !== null ? `${Math.round(m.humidity)}%` : "--%",
  );
  setText(
    "wind-speed",
    m.windSpeed !== null ? `${Math.round(m.windSpeed)} km/h` : "-- km/h",
  );
  setText("wind-dir", `Hướng: ${windDir(m.windDeg)}`);
  setText("visibility", m.visibility !== null ? `${m.visibility} km` : "-- km");
  setText(
    "pressure",
    m.pressure !== null ? `${Math.round(m.pressure)} hPa` : "-- hPa",
  );
  setText("sunrise", m.sunrise ? fmtTime(m.sunrise) : "--:--");
  setText("sunset", m.sunset ? fmtTime(m.sunset) : "--:--");
  setText("city-name", STATE.cityName);
  const iconEl = document.getElementById("weather-icon-big");
  if (iconEl) iconEl.textContent = m.weatherIcon || "🌤";
  const humBar = document.getElementById("humidity-bar");
  if (humBar && m.humidity !== null) humBar.style.width = `${m.humidity}%`;
  const header = document.querySelector(".weather-main-card .card-header");
  if (header) header.innerHTML = `Thời tiết hiện tại ${sourceBadge(m.source)}`;
  renderSourceComparison();
  evaluateDanger();
}

function renderSourceComparison() {
  const owm = STATE.owmData,
    meteo = STATE.meteoData;
  if (!owm || !meteo) return;
  const owmT = owm.main.temp,
    meteoT = meteo.current_weather.temperature,
    diff = Math.abs(owmT - meteoT).toFixed(1);
  let cmp = document.getElementById("source-cmp");
  if (!cmp) {
    const card = document.querySelector(".weather-main-card");
    if (!card) return;
    cmp = document.createElement("div");
    cmp.id = "source-cmp";
    cmp.style.cssText =
      "margin-top:12px;padding:10px 14px;background:rgba(0,212,255,.06);border:1px solid rgba(0,212,255,.15);border-radius:8px;font-size:.78rem;color:#7a9cc0;line-height:1.8";
    card.appendChild(cmp);
  }
  const status =
    diff <= 1 ? "✅ Rất khớp" : diff <= 2 ? "⚠ Lệch nhỏ" : "🔴 Lệch lớn";
  const color = diff <= 1 ? "#00e676" : diff <= 2 ? "#ffb300" : "#ff3d3d";
  cmp.innerHTML = `<div style="color:#00d4ff;font-weight:600;margin-bottom:4px;letter-spacing:1px;font-size:.7rem">SO SÁNH 2 NGUỒN</div><div>🌐 OpenWeatherMap: <strong style="color:#e8f4ff">${owmT.toFixed(1)}°C</strong></div><div>📡 Open-Meteo: <strong style="color:#e8f4ff">${meteoT.toFixed(1)}°C</strong></div><div>📊 Trung bình: <strong style="color:#00e676">${STATE.merged.temp}°C</strong><span style="color:${color};margin-left:6px">${status} (±${diff}°)</span></div>`;
}

function evaluateDanger() {
  const m = STATE.merged,
    alerts = [],
    temp = m.temp || 0,
    wind = m.windSpeed || 0,
    hum = m.humidity || 0,
    wCode = m.weatherCode;
  let level = "safe";
  const isStorm =
    wCode >= 95 ||
    (STATE.owmData?.weather[0].id >= 200 && STATE.owmData?.weather[0].id < 300);
  if (isStorm) {
    alerts.push({
      icon: "⛈",
      title: "Dông bão nguy hiểm",
      desc: "Có dông và sét mạnh. Tránh ra ngoài trời.",
      type: "danger",
    });
    level = "danger";
  }
  const isHeavyRain =
    (wCode >= 63 && wCode <= 82) ||
    (STATE.owmData?.weather[0].id >= 501 && STATE.owmData?.weather[0].id < 600);
  if (isHeavyRain && !isStorm) {
    alerts.push({
      icon: "🌧",
      title: "Mưa lớn",
      desc: "Chú ý nguy cơ ngập úng và sạt lở.",
      type: "warning",
    });
    if (level !== "danger") level = "warning";
  }
  if (temp >= 38) {
    alerts.push({
      icon: "🔥",
      title: "Nắng nóng cực đoan",
      desc: `${temp}°C — Nguy cơ say nắng cao!`,
      type: "danger",
    });
    level = "danger";
  } else if (temp >= 35) {
    alerts.push({
      icon: "☀️",
      title: "Nắng nóng",
      desc: `${temp}°C — Hạn chế ra ngoài.`,
      type: "warning",
    });
    if (level !== "danger") level = "warning";
  }
  const threshold = parseInt(
    document.getElementById("wind-threshold")?.value || 50,
  );
  if (wind >= threshold) {
    alerts.push({
      icon: "🌬",
      title: "Gió mạnh nguy hiểm",
      desc: `${Math.round(wind)} km/h — Nguy cơ cây đổ.`,
      type: "danger",
    });
    level = "danger";
  } else if (wind >= 40) {
    alerts.push({
      icon: "💨",
      title: "Gió mạnh",
      desc: `${Math.round(wind)} km/h`,
      type: "warning",
    });
    if (level === "safe") level = "caution";
  }
  if (hum >= 90 && temp >= 30) {
    alerts.push({
      icon: "💧",
      title: "Độ ẩm cao + Nóng",
      desc: "Nguy cơ mất nước.",
      type: "warning",
    });
    if (level === "safe") level = "caution";
  }
  STATE.alertLevel = level;
  renderAlertItems(alerts);
  updateAlertLevel(level);
  if (level === "danger" && alerts[0])
    showEmergency(alerts[0].title, alerts[0].desc);
  if (!alerts.length)
    addAlertLog("✅", "Thời tiết ổn định, không có cảnh báo.", "safe");
  else
    alerts.forEach((a) => addAlertLog(a.icon, `${a.title}: ${a.desc}`, a.type));
}

// ============================================================
// GROQ AI — Phân tích rủi ro thời tiết
// ============================================================
const GROQ_KEY = "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";
window.GROQ_KEY = GROQ_KEY; // ← THÊM DÒNG NÀY
const WEATHER_API_KEY = "04910e6226234339944112242260303";

async function fetchWeatherAPI(lat, lon) {
  try {
    const res = await fetch(
      `https://api.weatherapi.com/v1/forecast.json?key=${WEATHER_API_KEY}&q=${lat},${lon}&days=2&alerts=yes&lang=vi`,
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function runGroqAnalysis() {
  const box = document.getElementById("ai-analysis-box");
  if (!box) return;
  if (!STATE.lat) {
    box.innerHTML = '<div class="ai-waiting">⏳ Chờ lấy vị trí GPS...</div>';
    return;
  }

  box.innerHTML =
    '<div class="ai-loading"><div class="ai-spinner"></div> 🧠 AI đang phân tích thời tiết...</div>';

  const m = STATE.merged;
  // Lấy thêm dữ liệu WeatherAPI song song
  const wData = await fetchWeatherAPI(STATE.lat, STATE.lon);

  const rain =
    wData?.forecast?.forecastday[0]?.day?.totalprecip_mm ?? m.todayRain ?? 0;
  const windMax =
    wData?.forecast?.forecastday[0]?.day?.maxwind_kph ?? m.todayWind ?? 0;
  const temp = m.temp ?? wData?.current?.temp_c ?? "N/A";
  const humidity = m.humidity ?? wData?.current?.humidity ?? "N/A";
  const wind = m.windSpeed ?? wData?.current?.wind_kph ?? "N/A";
  const desc = m.weatherDesc ?? wData?.current?.condition?.text ?? "N/A";
  const alerts = wData?.alerts?.alert || [];

  const prompt = `Bạn là chuyên gia khí tượng Việt Nam. Phân tích chi tiết rủi ro thời tiết tại ${STATE.cityName || "khu vực người dùng"} dựa trên dữ liệu:
- Nhiệt độ: ${temp}°C | Độ ẩm: ${humidity}% | Gió: ${wind} km/h
- Lượng mưa hôm nay: ${rain}mm | Gió max: ${windMax}km/h
- Mô tả: ${desc}
${alerts.length > 0 ? "⚠ CÓ CẢNH BÁO: " + alerts[0].headline : ""}

Đánh giá rủi ro (🔴 Cao / 🟠 Trung bình / 🟢 Thấp), giải thích ngắn gọn bằng tiếng Việt về: nguy cơ ngập, lũ, gió, giao thông. Đưa ra 3-4 gợi ý hành động cụ thể. Dùng bullet points với -. Bắt đầu bằng dòng mức rủi ro in đậm. Ngắn gọn súc tích.`;

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + (window.GROQ_KEY || GROQ_KEY),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 400,
      }),
    });
    if (!res.ok) throw new Error(`Groq ${res.status}`);
    const json = await res.json();
    const text = json.choices?.[0]?.message?.content || "";

    // Format text đẹp
    const html = text
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/^- (.+)$/gm, '<div class="ai-bullet">→ $1</div>')
      .replace(/🔴/g, '<span class="ai-risk high">🔴</span>')
      .replace(/🟠/g, '<span class="ai-risk mid">🟠</span>')
      .replace(/🟢/g, '<span class="ai-risk low">🟢</span>')
      .replace(/\n\n/g, "<br>")
      .replace(/\n/g, " ");

    box.innerHTML = `
      <div class="ai-header">
        <span>🧠 Phân tích AI</span>
        <span class="ai-model">Groq · llama3</span>
        <button class="ai-refresh" onclick="runGroqAnalysis()" title="Phân tích lại">↻</button>
      </div>
      <div class="ai-content">${html}</div>
      <div class="ai-footer">📍 ${STATE.cityName || "--"} · ${new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}</div>`;
  } catch (e) {
    // Fallback tự phân tích khi Groq lỗi
    const riskLevel =
      rain > 50 || windMax > 50
        ? { label: "🔴 Rủi ro CAO", cls: "high" }
        : rain > 20 || windMax > 30
          ? { label: "🟠 Rủi ro TRUNG BÌNH", cls: "mid" }
          : { label: "🟢 Rủi ro THẤP", cls: "low" };
    box.innerHTML = `
      <div class="ai-header">
        <span>🧠 Phân tích tự động</span>
        <button class="ai-refresh" onclick="runGroqAnalysis()" title="Thử lại với AI">↻</button>
      </div>
      <div class="ai-content">
        <div class="ai-risk ${riskLevel.cls}" style="font-size:1rem;margin-bottom:8px">${riskLevel.label}</div>
        <div class="ai-bullet">→ Nhiệt độ: ${temp}°C | Độ ẩm: ${humidity}% | Gió: ${wind} km/h</div>
        <div class="ai-bullet">→ Mưa hôm nay: ${rain}mm | Tình trạng: ${desc}</div>
        ${rain > 50 ? '<div class="ai-bullet" style="color:#ff3d3d">→ ⚠ Mưa lớn — chú ý ngập úng, sạt lở</div>' : ""}
        ${windMax > 40 ? '<div class="ai-bullet" style="color:#ff3d3d">→ ⚠ Gió mạnh — tránh ra đường không cần thiết</div>' : ""}
        ${Number(temp) >= 35 ? '<div class="ai-bullet" style="color:#ff6d00">→ ⚠ Nắng nóng — uống nhiều nước, tránh ra nắng</div>' : ""}
        <div class="ai-bullet" style="color:#7a9cc0;font-size:.72rem">→ Groq AI tạm thời lỗi — dùng phân tích nội bộ</div>
      </div>
      <div class="ai-footer">📍 ${STATE.cityName || "--"} · ${new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}</div>`;
  }
}

function renderForecast() {
  renderTodayCard();
  renderDailyForecast();
  renderHourlyList();
  renderHourlyChart();
  const el = document.getElementById("fc-updated-time");
  if (el)
    el.textContent = `Cập nhật ${new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}`;
}

function renderTodayCard() {
  const m = STATE.merged;
  if (m.source === "none") return;
  setText("fc-today-icon", m.weatherIcon || "🌤");
  setText("fc-today-desc", m.weatherDesc || "--");
  setText("fc-now-temp-val", m.temp !== null ? Math.round(m.temp) : "--");
  setText("fc-today-max", m.todayMax != null ? `${m.todayMax}°` : "--°");
  setText("fc-today-min", m.todayMin != null ? `${m.todayMin}°` : "--°");
  const header = document.querySelector(".fc-today-card .fc-card-header");
  if (header) header.innerHTML = `☀️ Hôm nay ${sourceBadge(m.source)}`;
}

function renderDailyForecast() {
  const container = document.getElementById("forecast-table");
  if (!container) return;
  if (STATE.meteoDailyData) {
    const d = STATE.meteoDailyData;
    const allMax = d.temperature_2m_max.slice(0, 8),
      allMin = d.temperature_2m_min.slice(0, 8);
    const globalMin = Math.min(...allMin),
      globalMax = Math.max(...allMax),
      range = globalMax - globalMin || 1;
    container.innerHTML = d.time
      .slice(0, 8)
      .map((dateStr, i) => {
        const info = wmo(d.weathercode[i]),
          maxT = Math.round(d.temperature_2m_max[i]),
          minT = Math.round(d.temperature_2m_min[i]);
        const rain = d.precipitation_probability_max[i] || 0,
          wind = Math.round(d.windspeed_10m_max[i] || 0);
        const barLeft = (((minT - globalMin) / range) * 100).toFixed(1),
          barWidth = (((maxT - minT) / range) * 100).toFixed(1);
        return `<div class="forecast-row ${i === 0 ? "today" : ""}">
        <div class="forecast-day ${i === 0 ? "today-label" : ""}">${i === 0 ? "📅 HÔM NAY" : fmtDayS(dateStr)}</div>
        <div class="forecast-icon">${info.icon}</div>
        <div class="forecast-desc">${info.desc}</div>
        <div class="forecast-temp-bar"><div class="forecast-temp-range"><span class="fc-min">${minT}°</span><div class="fc-bar-wrap"><div class="fc-bar-fill" style="margin-left:${barLeft}%;width:${barWidth}%"></div></div><span class="fc-max">${maxT}°</span></div></div>
        <div class="forecast-rain"><span>💧${rain}%</span><span style="color:var(--text-muted)">💨${wind}</span></div>
      </div>`;
      })
      .join("");
    return;
  }
  if (STATE.owmForecast?.list) {
    const days = {};
    STATE.owmForecast.list.forEach((item) => {
      const key = new Date(item.dt * 1000).toDateString();
      if (!days[key]) days[key] = { items: [], dt: item.dt };
      days[key].items.push(item);
    });
    container.innerHTML = Object.keys(days)
      .slice(0, 5)
      .map((key, i) => {
        const day = days[key],
          temps = day.items.map((it) => it.main.temp);
        const maxT = Math.round(Math.max(...temps)),
          minT = Math.round(Math.min(...temps));
        const mid = day.items[Math.floor(day.items.length / 2)],
          rain = Math.round(
            Math.max(...day.items.map((it) => (it.pop || 0) * 100)),
          );
        return `<div class="forecast-row ${i === 0 ? "today" : ""}"><div class="forecast-day ${i === 0 ? "today-label" : ""}">${i === 0 ? "📅 HÔM NAY" : fmtDay(day.dt)}</div><div class="forecast-icon">${owmIcon(mid.weather[0].icon)}</div><div class="forecast-desc">${mid.weather[0].description}</div><div class="forecast-temp-bar"><div class="forecast-temp-range"><span class="fc-min">${minT}°</span><div class="fc-bar-wrap"><div class="fc-bar-fill" style="width:60%"></div></div><span class="fc-max">${maxT}°</span></div></div><div class="forecast-rain">💧${rain}%</div></div>`;
      })
      .join("");
  }
}

function renderHourlyList() {
  const container = document.getElementById("hourly-list");
  if (!container) return;
  if (STATE.meteoData?.hourly) {
    const h = STATE.meteoData.hourly,
      now = new Date().getTime();
    let si = 0;
    for (let i = 0; i < h.time.length; i++) {
      if (new Date(h.time[i]).getTime() >= now) {
        si = i;
        break;
      }
    }
    const slice = Array.from({ length: 24 }, (_, i) => si + i).filter(
      (i) => i < h.time.length,
    );
    container.innerHTML = slice
      .map((i, idx) => {
        const info = wmo(h.weathercode[i]),
          temp = Math.round(h.temperature_2m[i]);
        const rain = Math.round(h.precipitation_probability[i] || 0),
          wind = Math.round(h.windspeed_10m[i] || 0);
        const ts = new Date(h.time[i]).getTime() / 1000,
          isNow = idx === 0;
        return `<div class="hourly-item ${isNow ? "is-now" : ""}"><div class="hourly-time">${isNow ? "Bây giờ" : fmtHour(ts)}</div><div class="hourly-icon">${info.icon}</div><div class="hourly-temp">${temp}°C</div><div class="hourly-rain">💧${rain}%</div><div class="hourly-wind">💨${wind}</div></div>`;
      })
      .join("");
    return;
  }
  if (STATE.owmForecast?.list) {
    container.innerHTML = STATE.owmForecast.list
      .slice(0, 8)
      .map(
        (item, idx) =>
          `<div class="hourly-item ${idx === 0 ? "is-now" : ""}"><div class="hourly-time">${idx === 0 ? "Bây giờ" : fmtHour(item.dt)}</div><div class="hourly-icon">${owmIcon(item.weather[0].icon)}</div><div class="hourly-temp">${Math.round(item.main.temp)}°C</div><div class="hourly-rain">💧${Math.round((item.pop || 0) * 100)}%</div></div>`,
      )
      .join("");
  }
}

let currentChartType = "line";
function switchChartType(type, btnEl) {
  currentChartType = type;
  document
    .querySelectorAll(".fc-ctab")
    .forEach((b) => b.classList.remove("active"));
  if (btnEl) btnEl.classList.add("active");
  renderHourlyChart();
}

function renderHourlyChart() {
  const canvas = document.getElementById("hourly-chart");
  if (!canvas) return;
  if (typeof Chart === "undefined") {
    setTimeout(renderHourlyChart, 500);
    return;
  }
  if (STATE.hourlyChart) {
    STATE.hourlyChart.destroy();
    STATE.hourlyChart = null;
  }
  const chartType = currentChartType || "line";
  let labels = [],
    temps = [],
    rains = [],
    winds = [];
  if (STATE.meteoData?.hourly) {
    const h = STATE.meteoData.hourly,
      now = new Date().getTime();
    let si = 0;
    for (let i = 0; i < h.time.length; i++) {
      if (new Date(h.time[i]).getTime() >= now) {
        si = i;
        break;
      }
    }
    const sl = Array.from({ length: 12 }, (_, i) => si + i).filter(
      (i) => i < h.time.length,
    );
    labels = sl.map((i) => fmtHour(new Date(h.time[i]).getTime() / 1000));
    temps = sl.map((i) => Math.round(h.temperature_2m[i]));
    rains = sl.map((i) => Math.round(h.precipitation_probability[i] || 0));
    winds = sl.map((i) => Math.round(h.windspeed_10m[i] || 0));
  } else if (STATE.owmForecast?.list) {
    const items = STATE.owmForecast.list.slice(0, 10);
    labels = items.map((i) => fmtHour(i.dt));
    temps = items.map((i) => Math.round(i.main.temp));
    rains = items.map((i) => Math.round((i.pop || 0) * 100));
    winds = items.map((i) => Math.round(i.wind.speed * 3.6));
  }
  if (!labels.length) return;
  STATE.hourlyChart = new Chart(canvas, {
    type: chartType,
    data: {
      labels,
      datasets: [
        {
          label: "Nhiệt độ (°C)",
          data: temps,
          borderColor: "#00d4ff",
          backgroundColor: "rgba(0,212,255,.15)",
          pointBackgroundColor: "#00d4ff",
          pointRadius: chartType === "line" ? 5 : 0,
          tension: 0.4,
          fill: true,
          yAxisID: "y",
        },
        {
          label: "Mưa (%)",
          data: rains,
          borderColor: "#57a0ff",
          backgroundColor: "rgba(87,160,255,.2)",
          pointBackgroundColor: "#57a0ff",
          pointRadius: chartType === "line" ? 4 : 0,
          tension: 0.4,
          fill: chartType === "bar",
          yAxisID: "y1",
          borderDash: chartType === "line" ? [5, 5] : [],
        },
        {
          label: "Gió (km/h)",
          data: winds,
          borderColor: "#ffb300",
          backgroundColor: "rgba(255,179,0,.15)",
          pointBackgroundColor: "#ffb300",
          pointRadius: chartType === "line" ? 3 : 0,
          tension: 0.4,
          fill: chartType === "bar",
          yAxisID: "y1",
          borderDash: chartType === "line" ? [2, 4] : [],
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          labels: { color: "#7a9cc0", font: { family: "Exo 2", size: 12 } },
        },
        tooltip: {
          backgroundColor: "#0b1628",
          borderColor: "#1a2f50",
          borderWidth: 1,
          titleColor: "#e8f4ff",
          bodyColor: "#7a9cc0",
        },
      },
      scales: {
        x: {
          ticks: { color: "#3d5a7a", font: { family: "Exo 2" } },
          grid: { color: "rgba(30,64,128,.3)" },
        },
        y: {
          type: "linear",
          position: "left",
          ticks: {
            color: "#00d4ff",
            font: { family: "Orbitron", size: 10 },
            callback: (v) => `${v}°`,
          },
          grid: { color: "rgba(30,64,128,.3)" },
        },
        y1: {
          type: "linear",
          position: "right",
          min: 0,
          max: 100,
          ticks: {
            color: "#57a0ff",
            font: { family: "Orbitron", size: 10 },
            callback: (v) => `${v}`,
          },
          grid: { drawOnChartArea: false },
        },
      },
    },
  });
}

// ============================================================
// ALERTS
// ============================================================
function renderAlerts() {
  renderAlertLog();
}
function renderAlertItems(alerts) {
  const list = document.getElementById("alert-list"),
    panel = document.getElementById("alert-panel");
  if (!list) return;
  if (!alerts.length) {
    list.innerHTML =
      '<div class="no-alert">✅ Không có cảnh báo nào — Thời tiết an toàn</div>';
    if (panel) panel.style.borderColor = "var(--border)";
    document.getElementById("alert-badge")?.classList.add("hidden");
    return;
  }
  list.innerHTML = alerts
    .map(
      (a) =>
        `<div class="alert-item ${a.type === "warning" ? "warning" : ""}"><div class="alert-item-icon">${a.icon}</div><div class="alert-item-body"><div class="alert-item-title ${a.type === "warning" ? "warning" : ""}">${a.title}</div><div class="alert-item-desc">${a.desc}</div></div></div>`,
    )
    .join("");
  if (panel)
    panel.style.borderColor = alerts.some((a) => a.type === "danger")
      ? "var(--accent-red)"
      : "var(--accent-orange)";
  document.getElementById("alert-badge")?.classList.remove("hidden");
}
function updateAlertLevel(level) {
  ["safe", "caution", "warning", "danger"].forEach((l) =>
    document.getElementById(`level-${l}`)?.classList.remove("active-level"),
  );
  const map = {
    safe: "level-safe",
    caution: "level-caution",
    warning: "level-warning",
    danger: "level-danger",
  };
  document.getElementById(map[level])?.classList.add("active-level");
}
function addAlertLog(icon, text, type = "safe") {
  const now = new Date().toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
  });
  STATE.alertLog.unshift({ icon, text, type, time: now });
  if (STATE.alertLog.length > 30) STATE.alertLog.pop();
  renderAlertLog();
}
function renderAlertLog() {
  const log = document.getElementById("alert-log");
  if (!log) return;
  if (!STATE.alertLog.length) {
    log.innerHTML = '<div class="no-alert">✅ Hệ thống đang theo dõi...</div>';
    return;
  }
  log.innerHTML = STATE.alertLog
    .map(
      (e) =>
        `<div class="alert-log-item ${e.type}"><span>${e.icon}</span><span class="alert-log-text">${e.text}</span><span class="alert-log-time">${e.time}</span></div>`,
    )
    .join("");
}

// ============================================================
// MAP
// ============================================================
function initMap() {
  if (STATE.map) return;
  // Chờ Leaflet load xong (trường hợp dùng fallback CDN)
  if (typeof L === "undefined") {
    console.warn("Leaflet chưa load, thử lại sau 500ms...");
    setTimeout(initMap, 500);
    return;
  }
  const lat = STATE.lat || 21.0285,
    lon = STATE.lon || 105.8542;
  STATE.map = L.map("leaflet-map", {
    center: [lat, lon],
    zoom: 13,
    zoomControl: false,
  });

  // OpenStreetMap — màu gốc, rõ ràng
  STATE.osmLayer = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    { attribution: "© OpenStreetMap", maxZoom: 19 },
  ).addTo(STATE.map);
  STATE.satelliteLayer = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { attribution: "© Esri", maxZoom: 19 },
  );
  STATE.topoLayer = L.tileLayer(
    "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    { attribution: "© OpenTopoMap", maxZoom: 17 },
  );

  L.control.zoom({ position: "bottomright" }).addTo(STATE.map);
  L.control.scale({ imperial: false, position: "bottomleft" }).addTo(STATE.map);

  const myIcon = L.divIcon({
    html: `<div style="position:relative;width:20px;height:20px"><div style="position:absolute;inset:0;background:#00d4ff;border:2px solid #fff;border-radius:50%;box-shadow:0 0 10px #00d4ff,0 0 20px rgba(0,212,255,.4);animation:lping 1.5s infinite"></div></div><style>@keyframes lping{0%{box-shadow:0 0 0 0 rgba(0,212,255,.7)}70%{box-shadow:0 0 0 18px rgba(0,212,255,0)}100%{box-shadow:0 0 0 0 rgba(0,212,255,0)}}</style>`,
    className: "",
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
  STATE.myMarker = L.marker([lat, lon], { icon: myIcon })
    .addTo(STATE.map)
    .bindPopup(
      `<div style="font-family:'Exo 2',sans-serif;min-width:160px"><div style="font-weight:700;color:#00d4ff;margin-bottom:4px">📍 Vị trí của bạn</div><div style="font-size:.82rem;color:#555">${STATE.cityName || "--"}</div><div style="font-size:.75rem;color:#999;margin-top:4px;font-family:monospace">${lat.toFixed(5)}, ${lon.toFixed(5)}</div></div>`,
    )
    .openPopup();
  renderFamilyOnMap();
}

function setActiveLayerBtn(btn) {
  document
    .querySelectorAll(".map-layer-btn")
    .forEach((b) => b.classList.remove("active"));
  if (btn) btn.classList.add("active");
}

function updateMapPanel() {
  const m = STATE.merged;
  const badge = document.getElementById("map-coord-badge");
  if (badge && STATE.lat)
    badge.textContent = `📍 ${STATE.lat.toFixed(4)}, ${STATE.lon.toFixed(4)}`;
  setText("map-loc-city", STATE.cityName || "Chưa xác định");
  setText(
    "map-loc-coords",
    STATE.lat ? `${STATE.lat.toFixed(5)}, ${STATE.lon.toFixed(5)}` : "---, ---",
  );
}

function renderFamilyOnMap() {
  if (!STATE.map) return;
  STATE.familyMembers.forEach((m) => {
    const icon = L.divIcon({
      html: `<div style="font-size:22px">${m.emoji}</div>`,
      className: "",
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });
    L.marker([m.lat, m.lon], { icon })
      .addTo(STATE.map)
      .bindPopup(`<b>${m.emoji} ${m.name}</b><br>${m.city}<br>${m.lastSeen}`);
  });
}

function updateMap() {
  if (!STATE.map || !STATE.lat) return;
  STATE.map.setView([STATE.lat, STATE.lon], 13);
  if (STATE.myMarker) STATE.myMarker.setLatLng([STATE.lat, STATE.lon]);
}

async function centerMap() {
  const mapNavBtn = document.querySelector('[data-tab="map"]');
  switchTab("map", mapNavBtn);
  const btn = document.querySelector(".btn-map-locate");
  if (btn) {
    btn.innerHTML = "<span>⏳</span> Đang xác định...";
    btn.disabled = true;
  }
  await new Promise((r) => setTimeout(r, 200));
  if (!STATE.map) return;
  STATE.map.invalidateSize();
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude,
        lon = pos.coords.longitude,
        acc = Math.round(pos.coords.accuracy);
      STATE.lat = lat;
      STATE.lon = lon;
      STATE.map.setView([lat, lon], 16, { animate: true, duration: 0.3 });
      if (STATE.myMarker) {
        STATE.myMarker.setLatLng([lat, lon]);
        STATE.myMarker.openPopup();
      }
      setText("map-loc-coords", `${lat.toFixed(5)}, ${lon.toFixed(5)}`);
      const badge = document.getElementById("map-coord-badge");
      if (badge) badge.textContent = `📍 ${lat.toFixed(4)}, ${lon.toFixed(4)}`;
      if (btn) {
        btn.innerHTML = `<span>📍</span> ±${acc}m`;
        btn.disabled = false;
      }
      reverseGeocode(lat, lon).then((city) => {
        STATE.cityName = city;
        setText("city-name", city);
        setText("map-loc-city", city);
      });
    },
    () => {
      if (STATE.lat && STATE.lon)
        STATE.map.setView([STATE.lat, STATE.lon], 16, {
          animate: true,
          duration: 0.3,
        });
      if (btn) {
        btn.innerHTML = "<span>📍</span> Về vị trí của tôi";
        btn.disabled = false;
      }
    },
    { enableHighAccuracy: true, timeout: 5000, maximumAge: 60000 },
  );
}

function changeBaseLayer(value) {
  if (!STATE.map) return;
  const layers = {
    osm: STATE.osmLayer,
    satellite: STATE.satelliteLayer,
    topo: STATE.topoLayer,
  };
  Object.values(layers).forEach((l) => {
    if (l && STATE.map.hasLayer(l)) STATE.map.removeLayer(l);
  });
  if (layers[value]) layers[value].addTo(STATE.map);
}

function toggleWeatherLayer() {
  if (!STATE.map) return;
  STATE.weatherLayer = !STATE.weatherLayer;
  const dot = document.getElementById("weather-dot"),
    text = document.getElementById("layer-toggle-text");
  if (STATE.weatherLayer) {
    STATE.owmLayer = L.tileLayer(
      `https://tile.openweathermap.org/map/precipitation_new/{z}/{x}/{y}.png?appid=${CONFIG.OWM_KEY}`,
      { opacity: 0.6 },
    ).addTo(STATE.map);
    if (dot) dot.className = "map-wt-dot on";
    if (text) text.textContent = "Bật";
  } else {
    if (STATE.owmLayer) STATE.map.removeLayer(STATE.owmLayer);
    if (dot) dot.className = "map-wt-dot off";
    if (text) text.textContent = "Tắt";
  }
}

// ============================================================
// WINDY
// ============================================================
const WINDY_STATE = { lat: 16.0, lon: 107.5, zoom: 5, overlay: "wind" };
function buildWindyUrl(lat, lon, zoom, overlay, detail = false) {
  WINDY_STATE.lat = lat;
  WINDY_STATE.lon = lon;
  WINDY_STATE.zoom = zoom;
  WINDY_STATE.overlay = overlay;
  return `https://embed.windy.com/embed2.html?lat=${lat}&lon=${lon}&detailLat=${lat}&detailLon=${lon}&width=900&height=520&zoom=${zoom}&level=surface&overlay=${overlay}&product=ecmwf&menu=&message=true&marker=true&calendar=now&pressure=true&type=map&location=coordinates&detail=${detail}&metricWind=km%2Fh&metricTemp=%C2%B0C&radarRange=-1`;
}

function closeWindyDetail() {
  const iframe = document.getElementById("windy-iframe");
  if (!iframe) return;
  iframe.src = buildWindyUrl(
    WINDY_STATE.lat,
    WINDY_STATE.lon,
    WINDY_STATE.zoom,
    WINDY_STATE.overlay,
    false,
  );
}

const WINDY_LAYERS = {
  wind: { label: "💨 Gió", overlay: "wind" },
  rain: { label: "🌧 Mưa", overlay: "rain" },
  temp: { label: "🌡 Nhiệt độ", overlay: "temp" },
  clouds: { label: "☁ Mây", overlay: "clouds" },
  pressure: { label: "📊 Áp suất", overlay: "pressure" },
  thunderstorms: { label: "⚡ Dông", overlay: "thunderstorms" },
};

function switchWindyLayer(layerKey, btnEl) {
  const layer = WINDY_LAYERS[layerKey];
  if (!layer) return;
  document
    .querySelectorAll(".wlayer")
    .forEach((b) => b.classList.remove("active"));
  if (btnEl) btnEl.classList.add("active");
  const badge = document.getElementById("windy-layer-label");
  if (badge) badge.textContent = layer.label;
  const iframe = document.getElementById("windy-iframe");
  if (!iframe) return;
  showWindyLoading();
  iframe.src = buildWindyUrl(
    WINDY_STATE.lat,
    WINDY_STATE.lon,
    WINDY_STATE.zoom,
    layer.overlay,
    false,
  );
}

function showWindyLoading() {
  const loading = document.getElementById("windy-loading");
  if (loading) {
    loading.classList.remove("hidden");
    const iframe = document.getElementById("windy-iframe");
    if (iframe) {
      const hide = () => {
        loading.classList.add("hidden");
        iframe.removeEventListener("load", hide);
      };
      iframe.addEventListener("load", hide);
      setTimeout(() => loading.classList.add("hidden"), 8000);
    }
  }
}

async function locateMe() {
  const btn = document.getElementById("btn-locate-me"),
    icon = btn?.querySelector(".locate-icon"),
    coordEl = document.getElementById("windy-coord-display");
  if (btn) {
    btn.classList.add("locating");
    btn.querySelector("span:last-child").textContent = "Đang lấy mẫu GPS...";
  }
  if (icon) icon.textContent = "⏳";
  try {
    const { lat, lon, accuracy } = await getLocation();
    STATE.lat = lat;
    STATE.lon = lon;
    let qualityLabel = "",
      accStr = accuracy ? `±${Math.round(accuracy)}m` : "";
    if (!accuracy) qualityLabel = "(mặc định)";
    else if (accuracy <= 10) qualityLabel = "🟢 Rất chính xác";
    else if (accuracy <= 30) qualityLabel = "🟢 Chính xác";
    else if (accuracy <= 100) qualityLabel = "🟡 Trung bình";
    else qualityLabel = "🔴 Thấp";
    if (coordEl)
      coordEl.textContent = `${lat.toFixed(4)}, ${lon.toFixed(4)} ${accStr}`;
    const iframe = document.getElementById("windy-iframe");
    if (iframe) {
      showWindyLoading();
      const overlay =
        document
          .querySelector(".wlayer.active")
          ?.getAttribute("data-overlay") || "wind";
      iframe.src = buildWindyUrl(lat, lon, 10, overlay, false);
    }
    if (STATE.map && STATE.myMarker) STATE.myMarker.setLatLng([lat, lon]);
    if (btn) {
      btn.classList.remove("locating");
      btn.querySelector("span:last-child").textContent =
        `${accStr} ${qualityLabel}`;
    }
    if (icon) icon.textContent = "📍";
    showToast(
      `📍 ${lat.toFixed(5)}, ${lon.toFixed(5)} | ${accStr} ${qualityLabel}`,
      4000,
    );
  } catch (err) {
    if (btn) {
      btn.classList.remove("locating");
      btn.querySelector("span:last-child").textContent = "❌ Thất bại";
    }
    if (icon) icon.textContent = "❌";
    showToast("❌ Không lấy được vị trí", 4000);
  }
}

function initWindy() {
  const iframe = document.getElementById("windy-iframe"),
    loading = document.getElementById("windy-loading");
  if (iframe && loading) {
    iframe.addEventListener("load", () => loading.classList.add("hidden"));
    setTimeout(() => loading.classList.add("hidden"), 8000);
  }
  if (STATE.lat && STATE.lon) {
    const coordEl = document.getElementById("windy-coord-display");
    if (coordEl)
      coordEl.textContent = `${STATE.lat.toFixed(3)}, ${STATE.lon.toFixed(3)}`;
  }
}

// ============================================================
// TAB
// ============================================================
function switchTab(tabId, btn) {
  document.querySelectorAll(".tab-section").forEach((s) => {
    s.classList.remove("active");
    s.classList.add("hidden");
  });
  document
    .querySelectorAll(".nav-btn")
    .forEach((b) => b.classList.remove("active"));
  const target = document.getElementById(`tab-${tabId}`);
  if (target) {
    target.classList.remove("hidden");
    target.classList.add("active");
  }
  if (btn) btn.classList.add("active");
  if (tabId === "map") {
    if (!STATE.map) {
      setTimeout(() => {
        initMap();
        setTimeout(() => {
          if (STATE.map) STATE.map.invalidateSize();
        }, 500);
      }, 150);
    } else {
      setTimeout(() => STATE.map.invalidateSize(), 150);
    }
  }
  if (tabId === "forecast" && STATE.meteoData)
    setTimeout(() => renderHourlyChart(), 100);
}

// ============================================================
// EMERGENCY
// ============================================================
function showEmergency(title, msg) {
  if (sessionStorage.getItem("em-shown") === title) return;
  sessionStorage.setItem("em-shown", title);
  setText("emergency-title", title.toUpperCase());
  setText("emergency-msg", msg);
  document.getElementById("emergency-overlay")?.classList.remove("hidden");
  playAlarmBeep();
}
function closeEmergency() {
  document.getElementById("emergency-overlay")?.classList.add("hidden");
}
function openSurvivalFromAlert() {
  closeEmergency();
  openSurvivalModal();
}
function playAlarmBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.3, 0.6].forEach((d) => {
      const o = ctx.createOscillator(),
        g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      o.frequency.value = 880;
      o.type = "sine";
      g.gain.setValueAtTime(0.3, ctx.currentTime + d);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + d + 0.25);
      o.start(ctx.currentTime + d);
      o.stop(ctx.currentTime + d + 0.3);
    });
  } catch {}
}

// ============================================================
// MY STATUS
// ============================================================
function updateMyStatus(status) {
  STATE.myStatus = status;
  document
    .querySelectorAll(".status-btn")
    .forEach((b) => b.classList.remove("selected"));
  document
    .querySelector(
      { safe: ".safe-btn", danger: ".danger-btn", help: ".help-btn" }[status],
    )
    ?.classList.add("selected");
  const labels = {
    safe: "✅ Tôi an toàn",
    danger: "🚨 Đang gặp nguy hiểm",
    help: "🆘 Cần trợ giúp",
  };
  const dotCls = { safe: "safe", danger: "danger", help: "help" }[status];
  const display = document.getElementById("my-status-display");
  if (display)
    display.innerHTML = `<span class="status-dot ${dotCls}"></span> Trạng thái: ${labels[status]}`;
  const bar = document.getElementById("status-safety");
  if (bar)
    bar.innerHTML = `<span class="status-dot ${dotCls}"></span><span>Trạng thái: ${labels[status]}</span>`;
  addAlertLog(
    "📡",
    `Cập nhật trạng thái: ${labels[status]}`,
    status === "safe" ? "safe" : "danger",
  );
}

// ============================================================
// SURVIVAL GUIDES
// ============================================================
const SURVIVAL_GUIDES = {
  bao: {
    icon: "🌀",
    title: "Hướng dẫn khi có Bão",
    warning: "⚠ Không ra ngoài khi bão đổ bộ!",
    steps: [
      "Theo dõi bản tin thời tiết và thực hiện theo hướng dẫn của chính quyền địa phương.",
      "Ở trong nhà, tránh xa cửa sổ và cửa kính. Di chuyển vào phòng trong.",
      "Tắt tất cả thiết bị điện. Cúp cầu dao chính để tránh chập điện.",
      "Dự trữ nước uống sạch, thức ăn khô, đèn pin và pin dự phòng.",
      "Giữ điện thoại luôn sạc đầy. Nghe đài FM để cập nhật thông tin.",
      "Khi bão đi qua: kiểm tra nhà trước khi vào. Cẩn thận dây điện đứt.",
      "Không vào vùng ngập nước — dòng chảy mạnh rất nguy hiểm.",
      "Gọi 114 hoặc 1800 599 928 nếu cần hỗ trợ khẩn cấp.",
    ],
  },
  lu: {
    icon: "🌊",
    title: "Hướng dẫn khi Lũ lụt",
    warning:
      "⚠ Không đi qua vùng nước lũ — 15cm nước siết có thể quật ngã người lớn!",
    steps: [
      "Ngay lập tức di chuyển lên vùng đất cao hơn. Đây là ưu tiên số 1.",
      "Tuyệt đối không lái xe qua vùng nước đang chảy.",
      "Tắt điện và gas nếu có thể, rời nhà ngay khi nước bắt đầu dâng.",
      "Mang theo túi khẩn cấp: nước uống, thức ăn, thuốc, tài liệu.",
      "Tránh vùng trũng, cống rãnh, gầm cầu.",
      "Nếu mắc kẹt trong xe bị ngập: mở cửa sổ, thoát ra ngay.",
      "Nếu bị cuốn: không bơi ngược dòng, bơi chéo để thoát ra.",
      "Sau lũ: không uống nước chưa đun sôi.",
    ],
  },
  set: {
    icon: "⚡",
    title: "Phòng tránh Sét đánh",
    warning: "⚠ Nghe sấm = đã trong vùng nguy hiểm!",
    steps: [
      "Quy tắc 30-30: sấm sét cách nhau dưới 30 giây → vào nhà ngay.",
      "Vào trong nhà hoặc xe hơi. Đóng tất cả cửa sổ.",
      "Tránh xa vật dụng kim loại, ống nước, điện thoại cố định.",
      "Ngoài trời: không đứng dưới cây cao hoặc trên đỉnh đồi.",
      "Nếu ở vùng trống: cúi thấp, mũi chân chạm đất, che tai.",
      "Không nằm dài trên mặt đất — điện có thể truyền qua đất.",
      "Dưới nước: vào bờ ngay khi có dấu hiệu dông.",
      "Người bị sét đánh: gọi 115 ngay.",
    ],
  },
  dongdat: {
    icon: "🌍",
    title: "Hướng dẫn khi Động đất",
    warning: "⚠ Nhớ 3 bước: DROP – COVER – HOLD ON!",
    steps: [
      "DROP: Ngồi xuống sàn ngay lập tức.",
      "COVER: Chui xuống bàn chắc chắn hoặc che đầu-cổ bằng tay.",
      "HOLD ON: Bám chặt cho đến khi rung ngừng.",
      "Tránh xa cửa sổ, đèn treo và tường ngoài.",
      "Nếu đang ngoài trời: ra xa nhà cửa và đường dây điện.",
      "Trong xe: dừng xe, ở trong xe, tránh xa cầu.",
      "Sau động đất: kiểm tra rò rỉ khí gas và điện.",
      "Không dùng thang máy sau động đất.",
    ],
  },
  nangnong: {
    icon: "🔥",
    title: "Ứng phó Nắng nóng cực đoan",
    warning:
      "⚠ Nhiệt độ cảm giác trên 40°C có thể gây say nắng chỉ trong 15 phút!",
    steps: [
      "Ở trong nhà có điều hòa, đặc biệt từ 10 giờ sáng đến 4 giờ chiều.",
      "Uống ít nhất 2–3 lít nước mỗi ngày kể cả khi không khát.",
      "Tránh đồ uống có cồn và caffeine.",
      "Mặc quần áo sáng màu, rộng rãi. Đội mũ rộng vành.",
      "Dấu hiệu say nắng: da đỏ và khô, không mồ hôi → gọi 115 ngay.",
      "Sơ cứu say nắng: đưa vào bóng mát, làm mát bằng nước lạnh.",
      "Không để trẻ em hoặc thú cưng trong xe.",
      "Kiểm tra thường xuyên người cao tuổi và trẻ nhỏ.",
    ],
  },
  mualon: {
    icon: "🌧",
    title: "Ứng phó Mưa lớn kéo dài",
    warning: "⚠ Mưa lớn kéo dài gây ngập úng, sạt lở và ô nhiễm nguồn nước!",
    steps: [
      "Theo dõi thông tin từ đài khí tượng liên tục.",
      "Cẩn thận nếu bạn sống gần sông, suối, đồi dốc hoặc vùng trũng.",
      "Chuẩn bị sẵn sàng di tản nếu được yêu cầu.",
      "Không đi vào vùng ngập — nước có thể chứa điện.",
      "Dấu hiệu sạt lở: âm thanh lạ, mặt đất rung nhẹ.",
      "Khi nghi ngờ sạt lở: sơ tán ngay theo hướng vuông góc.",
      "Sau mưa: không uống nước máy khi chưa có thông báo an toàn.",
      "Vệ sinh nhà cửa sau mưa để tránh dịch bệnh.",
    ],
  },
};

function openSurvivalModal(type = "bao") {
  document.getElementById("survival-modal")?.classList.remove("hidden");
  showSurvivalGuide(type);
}
function closeSurvivalModal() {
  document.getElementById("survival-modal")?.classList.add("hidden");
}
function showSurvivalGuide(type, btnEl) {
  if (btnEl) {
    document
      .querySelectorAll(".stab")
      .forEach((b) => b.classList.remove("active"));
    btnEl.classList.add("active");
  }
  const guide = SURVIVAL_GUIDES[type];
  if (!guide) return;
  const container = document.getElementById("survival-content");
  if (!container) return;
  container.innerHTML = `<div class="guide-warning">${guide.warning}</div>${guide.steps.map((s, i) => `<div class="guide-step"><div class="guide-step-num">${i + 1}</div><div class="guide-step-text">${s}</div></div>`).join("")}`;
}
function quickSurvival(type) {
  openSurvivalModal(type);
  setTimeout(() => {
    document.querySelectorAll(".stab").forEach((b) => {
      if (b.getAttribute("onclick")?.includes(type)) b.classList.add("active");
      else b.classList.remove("active");
    });
    showSurvivalGuide(type);
  }, 50);
}

// ============================================================
// FAMILY
// ============================================================
function renderFamilyMembers() {
  // family-grid đã được thay bằng Firebase friends-accepted
  // Giữ function này để không crash nếu code khác gọi
  const grid = document.getElementById("family-grid");
  if (!grid) return; // HTML dùng Firebase UI rồi, bỏ qua
}

function copyFriendId(id, el) {
  if (!id) return;
  navigator.clipboard.writeText(id).then(() => {
    const prev = el.innerHTML;
    el.innerHTML = `${id} <span style="color:#00e676">✓ Đã copy!</span>`;
    setTimeout(() => (el.innerHTML = prev), 2000);
  });
}

function deleteFamilyMember(id) {
  const m = STATE.familyMembers.find((x) => x.id === id);
  if (!m) return;
  if (!confirm(`Xóa "${m.name}" khỏi danh sách gia đình?`)) return;
  STATE.familyMembers = STATE.familyMembers.filter((x) => x.id !== id);
  renderFamilyMembers();
  addAlertLog("🗑", `Đã xóa thành viên: ${m.name}`, "safe");
}

function viewMemberOnMap(id) {
  const m = STATE.familyMembers.find((x) => x.id === id);
  if (!m) return;
  switchTab("map", document.querySelector('[data-tab="map"]'));
  setTimeout(() => {
    if (STATE.map) STATE.map.setView([m.lat, m.lon], 15);
  }, 300);
}

// ============================================================
// NOTIFICATIONS + TOAST
// ============================================================
async function requestNotificationPermission() {
  if ("Notification" in window && Notification.permission === "default")
    await Notification.requestPermission();
}
function showToast(msg, duration = 3000) {
  const old = document.querySelector(".sw-toast");
  if (old) old.remove();
  const toast = document.createElement("div");
  toast.className = "sw-toast";
  toast.textContent = msg;
  toast.style.cssText =
    "position:fixed;bottom:24px;right:24px;z-index:9999;background:#0b1628;border:1px solid #00d4ff;color:#e8f4ff;padding:12px 20px;border-radius:8px;font-family:Exo 2,sans-serif;font-size:.88rem;box-shadow:0 4px 20px rgba(0,0,0,.5)";
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}

// ============================================================
// CHECKLIST
// ============================================================
function initChecklist() {
  document
    .querySelectorAll('.check-item input[type="checkbox"]')
    .forEach((cb) => {
      cb.addEventListener("change", () => {
        const all = document.querySelectorAll(
          '.check-item input[type="checkbox"]',
        );
        const checked = document.querySelectorAll(
          '.check-item input[type="checkbox"]:checked',
        );
        const pct = (checked.length / all.length) * 100;
        const fill = document.getElementById("checklist-fill"),
          count = document.getElementById("checklist-count");
        if (fill) fill.style.width = `${pct}%`;
        if (count)
          count.textContent = `${checked.length}/${all.length} hoàn thành`;
      });
    });
}

// ============================================================
// INIT
// ============================================================
async function init() {
  startClock();
  await requestNotificationPermission();
  // Xóa cache cũ có lưu vị trí
  try {
    const old = localStorage.getItem(CACHE_KEY);
    if (old) {
      const p = JSON.parse(old);
      if (p.lat || p.lon) {
        localStorage.removeItem(CACHE_KEY);
      }
    }
  } catch {}
  await fetchWeather();
  renderFamilyMembers();
  initChecklist();
  initWindy();
  initFirebaseSystem();
  _loadMemes();
  setInterval(fetchWeather, CONFIG.UPDATE_INT);
  addAlertLog(
    "🛡",
    "SafeWeather v3.0 — Dual API | GPS Fast | OpenStreetMap",
    "safe",
  );
  console.log(
    "%c🛡 SafeWeather v3.0",
    "color:#00d4ff;font-size:16px;font-weight:bold",
  );
}
// ============================================================
// 🎮 SURVIVAL QUIZ MOUNTAIN GAME v2.0
// XP | Rank | Items | Streak | Leaderboard | Share Card | Memes
// ▶ THAY THẾ TOÀN BỘ PHẦN CŨ TỪ "// 🎮 SURVIVAL QUIZ MOUNTAIN GAME"
//   ĐẾN "window.closeQuizModal = closeQuizModal;" BẰNG CODE NÀY
// ============================================================

// ── Rank Config ───────────────────────────────────────────────
const RANK_DATA = [
  {
    lv: 1,
    title: "🥉 Rookie Climber",
    xpMin: 0,
    xpMax: 199,
    skin: "🧗",
    color: "#7a9cc0",
    bg: "rgba(122,156,192,0.12)",
  },
  {
    lv: 2,
    title: "🥈 Storm Survivor",
    xpMin: 200,
    xpMax: 599,
    skin: "🏃",
    color: "#00e676",
    bg: "rgba(0,230,118,0.12)",
  },
  {
    lv: 3,
    title: "🥇 Flood Fighter",
    xpMin: 600,
    xpMax: 1199,
    skin: "⛷",
    color: "#00d4ff",
    bg: "rgba(0,212,255,0.12)",
  },
  {
    lv: 4,
    title: "💎 Crisis Expert",
    xpMin: 1200,
    xpMax: 2499,
    skin: "🏋",
    color: "#ffb300",
    bg: "rgba(255,179,0,0.12)",
  },
  {
    lv: 5,
    title: "🌟 Disaster Legend",
    xpMin: 2500,
    xpMax: 99999,
    skin: "🦅",
    color: "#ff6d00",
    bg: "rgba(255,109,0,0.12)",
  },
];
function _getRank(xp) {
  return RANK_DATA.find((r) => xp >= r.xpMin && xp <= r.xpMax) || RANK_DATA[0];
}
function _getGrade(pct) {
  if (pct >= 90) return { g: "S", color: "#ffb300", label: "HUYỀN THOẠI!" };
  if (pct >= 75) return { g: "A", color: "#00e676", label: "XUẤT SẮC!" };
  if (pct >= 60) return { g: "B", color: "#00d4ff", label: "KHÁ TỐT!" };
  if (pct >= 40) return { g: "C", color: "#7a9cc0", label: "CỐ LÊN NHÉ!" };
  return { g: "D", color: "#ff3d3d", label: "TẬP LUYỆN THÊM!" };
}

// ── Quiz State ────────────────────────────────────────────────
const QUIZ = {
  topic: null,
  questions: [],
  qIdx: 0,
  score: 0,
  combo: 0,
  maxCombo: 0,
  lives: 3,
  timer: 20,
  timerInt: null,
  activeShield: false,
  itemUsed: false,
  totalQ: 0,
  correctQ: 0,
  sessionXP: 0,
  gameState: "idle",
  // Persistent
  xp: 0,
  bestScores: {},
  unlockedBadges: [],
  streak: 0,
  lastPlayDate: null,
  items: { shield: 1, freeze: 1, fifty: 1, hint: 1 },
};
window.QUIZ = QUIZ;
window._showMemePopup = _showMemePopup;

// ── Full Question Bank ────────────────────────────────────────
const QUIZ_QUESTIONS = {
  bao: [
    {
      q: "Khi bão cấp 12 đang tới gần, việc ĐẦU TIÊN cần làm là gì?",
      options: [
        "Chạy ra xem",
        "Vào phòng trong, tránh cửa sổ",
        "Mở hết cửa thông gió",
        "Đứng dưới mái hiên",
      ],
      correct: 1,
      explanation: "Phòng trong nhà tránh xa cửa kính có thể vỡ do áp suất.",
      meme_c: "🛡 Đúng! Bạn là chiến binh sống sót!",
      meme_w: "🌀 Bão không phải để ngắm cảnh đâu bạn ơi!",
      xp: 10,
      diff: 1,
    },
    {
      q: "Mối nguy hiểm LỚN NHẤT khi bão đổ bộ là gì?",
      options: ["Gió mạnh", "Mưa to", "Cây đổ + mái bay", "Sét đánh"],
      correct: 2,
      explanation:
        "Cây đổ và mái tôn bay là nguyên nhân tử vong hàng đầu khi bão.",
      meme_c: "💡 Bạn biết hơn cả Bear Grylls!",
      meme_w: "🌬 Mái tôn bay nhanh hơn bạn tưởng nhiều!",
      xp: 12,
      diff: 2,
    },
    {
      q: '"Mắt bão" là gì và tại sao nguy hiểm?',
      options: [
        "Trung tâm bão — tạm lặng nhưng bão sẽ quay lại",
        "Điểm an toàn nhất",
        "Tên gọi bão mạnh nhất",
        "Vùng mưa lớn nhất",
      ],
      correct: 0,
      explanation:
        "Mắt bão tạm lặng → nhiều người ra ngoài → vùng bão mạnh nhất quay lại sau!",
      meme_c: "🌀 Pro knowledge! Bạn biết bão hơn cả bão biết bạn!",
      meme_w: "😱 Mắt bão lặng = bẫy chết người! Đã có nhiều nạn nhân!",
      xp: 20,
      diff: 3,
    },
    {
      q: "Sau bão, điều nào NGUY HIỂM nhất cần tránh?",
      options: [
        "Kiểm tra nhà",
        "Dây điện đứt trên đường",
        "Gọi gia đình",
        "Vệ sinh nhà",
      ],
      correct: 1,
      explanation:
        "Dây điện đứt = phóng điện bất kỳ lúc nào. Tuyệt đối không lại gần!",
      meme_c: "⚡ Bạn sẽ sống sót trong thực tế!",
      meme_w: "☠️ Dây điện đứt + chạm vào = toang ngay!",
      xp: 15,
      diff: 2,
    },
    {
      q: "Dự trữ tối thiểu bao nhiêu nước cho 1 người khi bão?",
      options: ["0.5 lít/ngày", "1 lít/ngày", "3 lít/ngày", "10 lít/ngày"],
      correct: 2,
      explanation: "WHO khuyến cáo tối thiểu 3 lít/người/ngày trong thảm họa.",
      meme_c: "💧 Chuẩn bị tốt! Pro survivalist!",
      meme_w: "😵 0.5 lít/ngày thì mất nước trước khi bão qua!",
      xp: 12,
      diff: 1,
    },
    {
      q: "Trong bão phải ra ngoài khẩn cấp, việc nào ĐÚNG?",
      options: [
        "Chạy nhanh qua đường",
        "Ôm cột điện để khỏi bị thổi bay",
        "Di chuyển sát tường thấp, tránh cây",
        "Mặc áo mưa là đủ",
      ],
      correct: 2,
      explanation:
        "Tường thấp che gió và không nguy cơ đổ. Cột điện = nguy hiểm cực kỳ.",
      meme_c: "🏃 Tactical movement! Tiềm năng lính cứu hộ!",
      meme_w: "🤦 Ôm cột điện trong bão... Cột điện không ôm lại đâu!",
      xp: 18,
      diff: 3,
    },
    {
      q: "Thiết bị nào QUAN TRỌNG nhất cần sạc đầy trước bão?",
      options: ["Máy tính bảng", "Điện thoại", "Loa Bluetooth", "Máy ảnh"],
      correct: 1,
      explanation: "Điện thoại = liên lạc khẩn cấp, nhận cảnh báo, gọi cứu hộ.",
      meme_c: "📱 Rõ ràng nhưng nhiều người quên! Bạn thì không!",
      meme_w: "🔋 Máy tính bảng... Bão đến mà muốn livestream à? 😂",
      xp: 8,
      diff: 1,
    },
    {
      q: 'Bão đêm, mất điện, nghe "lạo rạo" trên mái nhà. Làm gì?',
      options: [
        "Leo lên mái kiểm tra",
        "Ở trong phòng, tránh xa trần yếu",
        "Mở cửa ra xem",
        "Gọi thợ ngay",
      ],
      correct: 1,
      explanation: "Mái nhà có thể bị bật trong bão. Ở phòng vững chắc nhất.",
      meme_c: "🧠 Bình tĩnh + quyết định đúng = sống sót!",
      meme_w: "🪜 Leo mái trong bão... Bạn định bay à? 😅",
      xp: 20,
      diff: 3,
    },
    {
      q: "Nên làm gì khi nghe dự báo bão 48 giờ nữa đổ bộ?",
      options: [
        "Đợi thêm tin tức",
        "Chuẩn bị dự phòng NGAY bây giờ",
        "Chờ đến ngày mai mới lo",
        "Chỉ đóng cửa là đủ",
      ],
      correct: 1,
      explanation:
        "48 giờ là đủ thời gian chuẩn bị tốt. Chờ đến lúc bão gần = đã muộn!",
      meme_c: "⏰ Chuẩn bị sớm = sống sót thoải mái!",
      meme_w: '🕐 "Để mai lo"... Bão không chờ bạn đâu nhé!',
      xp: 10,
      diff: 1,
    },
    {
      q: "Khi bão đổ bộ, nếu nhà bị ngập nước, bạn nên?",
      options: [
        "Ở lại, nước sẽ rút",
        "Di chuyển lên tầng cao nhất của nhà",
        "Bơi ra ngoài tìm chỗ khác",
        "Mở cửa xả nước",
      ],
      correct: 1,
      explanation:
        "Lên cao nhất trong nhà. Không bơi ra ngoài khi bão còn đang đổ bộ.",
      meme_c: "⬆️ Lên cao! Quyết định đúng!",
      meme_w: "🌊 Bơi trong bão lũ... Không phải lúc thể hiện kỹ năng bơi!",
      xp: 15,
      diff: 2,
    },
  ],
  lu: [
    {
      q: "Nước lũ sâu bao nhiêu có thể quật ngã người lớn?",
      options: ["50cm", "30cm", "15cm", "1 mét"],
      correct: 2,
      explanation:
        "15cm nước chảy xiết = lực ~500kg. Đủ quật ngã người lớn khỏe mạnh!",
      meme_c: "🌊 Fact bất ngờ nhưng bạn đã biết!",
      meme_w: "💀 15cm thôi mà! Nước nhẹ nhưng lực kinh khủng!",
      xp: 15,
      diff: 2,
    },
    {
      q: "Gặp đường ngập 30cm nước chảy khi lái xe, bạn làm gì?",
      options: [
        "Tăng ga qua nhanh",
        "Lùi xe, tìm đường khác",
        "Quan sát xe khác rồi theo",
        "Bấm còi đi chậm",
      ],
      correct: 1,
      explanation:
        "30cm nước chảy = xe có thể bị cuốn. Lùi + tìm đường khác là DUY NHẤT đúng.",
      meme_c: "🚗 Xe và mạng bạn đều được bảo toàn!",
      meme_w: "🌊 Xe bạn vừa trở thành thuyền... không lái được!",
      xp: 15,
      diff: 2,
    },
    {
      q: "Bị mắc kẹt trong lũ, nước dâng. Chạy hướng nào?",
      options: [
        "Theo dòng nước",
        "Vuông góc dòng nước, lên cao",
        "Ngược dòng nước",
        "Bơi ra giữa sông",
      ],
      correct: 1,
      explanation:
        "Vuông góc với dòng chảy để thoát ra ngoài vùng nước, sau đó lên cao nhất.",
      meme_c: "⬆️ Lên cao! Bạn sẽ sống sót!",
      meme_w: "🏊 Bơi ngược dòng lũ... Michael Phelps cũng thua đó!",
      xp: 18,
      diff: 3,
    },
    {
      q: "Sau lũ rút, có thể uống nước máy ngay không?",
      options: [
        "Được, nước đã lọc rồi",
        "Không, phải chờ thông báo an toàn",
        "Được nếu đun sôi 5 phút",
        "Tùy màu nước",
      ],
      correct: 1,
      explanation:
        "Đường ống bị ngập có thể nhiễm khuẩn. Chờ thông báo từ cơ quan y tế.",
      meme_c: "💧 Kiên nhẫn = sống khỏe sau lũ!",
      meme_w: "🦠 Uống ngay = mời vi khuẩn vào cơ thể!",
      xp: 12,
      diff: 2,
    },
    {
      q: "Dấu hiệu báo lũ quét ở vùng núi?",
      options: [
        "Nước sông trong hơn",
        "Tiếng ầm từ thượng nguồn, nước đục đỏ",
        "Trời nắng đột ngột",
        "Nhiều chim bay về",
      ],
      correct: 1,
      explanation: "Tiếng ầm + nước đục đỏ = lũ quét đang đến. CHẠY NGAY!",
      meme_c: "👂 Lắng nghe thiên nhiên! Kỹ năng sinh tồn thật sự!",
      meme_w: "🌊 Nghe tiếng ầm mà không chạy... Quá muộn rồi!",
      xp: 20,
      diff: 3,
    },
    {
      q: "Bị lũ cuốn, không đứng được. Tư thế ĐÚNG?",
      options: [
        "Bơi mạnh về bờ",
        "Nằm ngửa chân về phía trước, tay lái hướng",
        "Nằm úp bơi sải",
        "Đứng chống chân xuống đáy",
      ],
      correct: 1,
      explanation:
        "Nằm ngửa chân trước bảo vệ đầu khỏi đá ngầm, tay giúp lái hướng.",
      meme_c: "🏄 Defensive float! Bạn vừa cứu mạng mình!",
      meme_w: "🦵 Bơi ngược lũ = tốn sức rồi chìm. Float thôi!",
      xp: 25,
      diff: 3,
    },
    {
      q: "Trước mùa lũ, điều QUAN TRỌNG nhất cần chuẩn bị?",
      options: [
        "Mua điện thoại mới",
        "Biết đường thoát + điểm cao gần nhà",
        "Mua nhiều mì gói",
        "Sắm áo phao mới",
      ],
      correct: 1,
      explanation:
        "Biết đường thoát + điểm cao = khi lũ đến không mất thời gian suy nghĩ, chạy ngay!",
      meme_c: "🗺 Lên kế hoạch trước! Survivalist thực thụ!",
      meme_w: "📱 Điện thoại mới trong lũ cũng toang nhanh lắm!",
      xp: 15,
      diff: 2,
    },
    {
      q: "Nước lũ màu đỏ nâu nghĩa là gì?",
      options: [
        "Sắp trong lại",
        "Lũ đang rút",
        "Sạt lở trên nguồn, lũ sắp mạnh hơn",
        "Bình thường",
      ],
      correct: 2,
      explanation:
        "Nước đỏ nâu = đất đá từ sạt lở. Lũ sắp mạnh và nguy hiểm hơn nhiều.",
      meme_c: "🔴 Đọc được dấu hiệu thiên nhiên — thật sự pro!",
      meme_w: "😱 Nước đỏ = báo động! Không phải lúc để bình tĩnh!",
      xp: 22,
      diff: 3,
    },
    {
      q: "Thấy xe bị ngập đến nửa cửa, có người kêu cứu. Làm gì?",
      options: [
        "Nhảy xuống kéo cửa",
        "Gọi 114 + ném vật nổi cho họ",
        "Đập kính cứu ngay",
        "Không làm gì",
      ],
      correct: 1,
      explanation: "An toàn cho mình trước! Gọi chuyên nghiệp + ném phao/dây.",
      meme_c: "📞 Cứu người đúng cách = cả 2 đều sống!",
      meme_w: "⚠️ Nhảy xuống không kỹ năng = thêm 1 nạn nhân nữa!",
      xp: 20,
      diff: 3,
    },
    {
      q: "Bạn cần sơ tán lũ, được mang 1 túi duy nhất. Ưu tiên gì?",
      options: [
        "Quần áo nhiều nhất",
        "Giấy tờ + tiền + thuốc + điện thoại sạc đầy",
        "Đồ điện tử đắt tiền",
        "Thức ăn",
      ],
      correct: 1,
      explanation:
        "Giấy tờ (khó thay thế) + tiền + thuốc cá nhân + điện thoại = bộ tứ sống còn.",
      meme_c: "🎒 Perfect go-bag! Bạn sẵn sàng cho tình huống thực!",
      meme_w: "👗 Quần áo nhiều trong lũ... Mang túi bơm phao thì hơn!",
      xp: 15,
      diff: 2,
    },
  ],
  set: [
    {
      q: "Quy tắc 30-30 phòng tránh sét là gì?",
      options: [
        "Chờ 30 phút sau mưa",
        "Sấm-sét cách nhau <30s→vào nhà; chờ 30 phút sau tiếng sấm cuối",
        "Đứng cách cây 30m là an toàn",
        "Tắt điện 30 phút",
      ],
      correct: 1,
      explanation:
        "Sấm sét <30s = vùng nguy hiểm. Chờ 30 phút sau tiếng sấm cuối mới ra ngoài.",
      meme_c: "⚡ 30-30 rule! Bạn sẽ không bị sét đánh!",
      meme_w:
        '🌩 Sét di chuyển với tốc độ ánh sáng — không có quy tắc "30m an toàn"!',
      xp: 15,
      diff: 2,
    },
    {
      q: "Đang bơi ở biển, bầu trời tối + có sấm. Làm gì?",
      options: [
        "Bơi nhanh vào bờ",
        "Lặn sâu xuống",
        "Vào bờ NGAY, ra xa mặt nước",
        "Nằm nổi",
      ],
      correct: 2,
      explanation:
        "Nước là chất dẫn điện tốt. Ra khỏi nước và xa bờ nước ngay!",
      meme_c: "🏊 Bạn thoát khỏi nước đúng thời điểm!",
      meme_w: "⚡ Nước + sét = conductor max! Toang ngay!",
      xp: 18,
      diff: 2,
    },
    {
      q: "Ở ngoài trời không có chỗ trú, có sấm sét. Tư thế ĐÚNG?",
      options: [
        "Nằm thẳng trên đất",
        "Đứng dưới cây thấp nhất",
        "Ngồi xổm đầu ngón chân, ôm gối, che tai",
        "Chạy nhanh về",
      ],
      correct: 2,
      explanation:
        "Tư thế ngồi xổm giảm tầm cao và diện tích tiếp xúc điện xuống tối thiểu.",
      meme_c: "🧎 Tư thế sinh tồn! Bạn sẽ sống qua dông!",
      meme_w: "😬 Nằm thẳng = tăng diện tích tiếp xúc điện = nguy hiểm x2!",
      xp: 20,
      diff: 3,
    },
    {
      q: "Trong nhà khi có dông, việc nào KHÔNG AN TOÀN?",
      options: [
        "Ngồi ghế gỗ",
        "Tắm hoặc rửa tay",
        "Đọc sách",
        "Nằm trên giường",
      ],
      correct: 1,
      explanation:
        "Đường ống nước dẫn điện. Sét đánh nhà có thể truyền qua đường ống.",
      meme_c: "🚿 Tắm sau dông nhé! Safety first!",
      meme_w: "⚡ Tắm trong dông = rủi ro thật sự, không phải chuyện đùa!",
      xp: 15,
      diff: 2,
    },
    {
      q: "Sét thường đánh vào đâu nhất?",
      options: [
        "Vật thấp nhất",
        "Vật cao nhất hoặc dẫn điện tốt nhất",
        "Vật màu sáng",
        "Ngẫu nhiên hoàn toàn",
      ],
      correct: 1,
      explanation:
        "Sét tìm con đường ngắn nhất xuống đất — vật cao nhất hoặc dẫn điện tốt.",
      meme_c: "⚡ Vật lý cơ bản cứu mạng bạn!",
      meme_w: "🌩 Đứng cao nhất vùng khi có sét... 💀",
      xp: 12,
      diff: 1,
    },
    {
      q: "Người bị sét đánh có còn điện không? Có chạm vào cứu được không?",
      options: [
        "Có điện, đừng chạm",
        "Không còn điện, an toàn để sơ cứu ngay",
        "Chờ 30 phút",
        "Tùy thời tiết",
      ],
      correct: 1,
      explanation:
        "Người bị sét đánh KHÔNG còn điện. An toàn hoàn toàn để tiếp cận sơ cứu!",
      meme_c: "🏥 Kiến thức này cứu người! Bạn có thể là anh hùng!",
      meme_w:
        "😔 Nhiều người không dám cứu vì sợ — nhưng họ hoàn toàn an toàn!",
      xp: 22,
      diff: 3,
    },
    {
      q: "Cây nào NGUY HIỂM NHẤT để trú mưa khi có dông?",
      options: [
        "Cây thấp trong vườn",
        "Cây cao đơn độc trên đồng trống",
        "Rừng cây dày",
        "Cây gần nhà",
      ],
      correct: 1,
      explanation:
        "Cây cao đơn độc = điểm cao nhất vùng = mục tiêu hàng đầu của sét.",
      meme_c: "🌲 Tránh đúng rồi! Cây đó nguy hiểm nhất!",
      meme_w: "🌳 Cây cao đơn độc = cột thu lôi tự nhiên! Tránh xa!",
      xp: 10,
      diff: 1,
    },
    {
      q: "Đang ở trên tòa nhà cao tầng khi có dông. Làm gì?",
      options: [
        "Vào trong ngay, tránh xa cửa sổ",
        "Đứng ở ban công ngắm mưa",
        "Cầm ô ra tránh bị ướt",
        "Đứng cạnh cột thu lôi là an toàn",
      ],
      correct: 0,
      explanation:
        "Vào trong, tránh xa cửa sổ kim loại. Không đứng ngoài trời bất kể có cột thu lôi.",
      meme_c: "🏢 Vào trong ngay! Đúng hoàn toàn!",
      meme_w: "☂️ Cầm ô = tạo thêm cột thu lôi cầm tay... 😂",
      xp: 15,
      diff: 2,
    },
  ],
  dongdat: [
    {
      q: "DROP – COVER – HOLD ON nghĩa là gì?",
      options: [
        "Chạy ra ngoài ngay",
        "Ngồi xuống – chui xuống bàn – bám chặt",
        "Gọi điện – Che đầu – Ra cửa",
        "Nằm xuống – Khoanh tay – Giữ yên",
      ],
      correct: 1,
      explanation:
        "DROP (ngồi xuống) – COVER (chui/che đầu) – HOLD ON (bám chặt). Kỹ thuật cứu mạng đã được chứng minh.",
      meme_c: "🐢 Tư thế rùa cứu mạng! Bạn biết rồi!",
      meme_w: "🏃 Chạy ra ngoài = dễ bị vật rơi vào đầu hơn!",
      xp: 12,
      diff: 1,
    },
    {
      q: "Động đất khi đang ở tầng 10 chung cư. Làm gì?",
      options: [
        "Chạy xuống cầu thang ngay",
        "Nhảy từ ban công",
        "DROP-COVER-HOLD tại chỗ",
        "Gọi thang máy",
      ],
      correct: 2,
      explanation:
        "Cầu thang nguy hiểm nhất khi động đất. Ở yên tại chỗ và DROP-COVER-HOLD.",
      meme_c: "🏢 Đúng! Cầu thang là nơi nguy hiểm nhất trong động đất!",
      meme_w: "⚠️ Chạy xuống cầu thang khi đất rung = ngã gãy xương!",
      xp: 20,
      diff: 3,
    },
    {
      q: "Sau động đất, điều NGUY HIỂM nhất cần kiểm tra?",
      options: [
        "WiFi còn không",
        "Rò rỉ gas và đường điện",
        "Tường có nứt không",
        "Xem tin tức ngay",
      ],
      correct: 1,
      explanation:
        "Gas rò + điện hỏng = nguy cơ cháy nổ sau động đất. Kiểm tra ngay!",
      meme_c: "👃 Ngửi thấy gas? Thoát ra ngoài ngay! Bạn biết điều đó!",
      meme_w:
        "📱 Kiểm tra WiFi trước... Bạn thật sự muốn scroll mạng trước khi đảm bảo an toàn?",
      xp: 15,
      diff: 2,
    },
    {
      q: "Trong động đất, nơi nào TƯƠNG ĐỐI an toàn trong nhà?",
      options: [
        "Cạnh cửa sổ",
        "Dưới bàn chắc hoặc sát tường nội thất",
        "Cạnh tủ kính",
        "Giữa phòng rộng",
      ],
      correct: 1,
      explanation:
        "Dưới bàn chắc chắn hoặc Life Triangle (tam giác đời sống) là tương đối an toàn nhất.",
      meme_c: "🪑 Bàn chắc là người bạn tốt nhất trong động đất!",
      meme_w: "🪞 Cạnh tủ kính... Kính sẽ vỡ và rơi vào bạn đấy!",
      xp: 15,
      diff: 2,
    },
    {
      q: "Ngửi thấy mùi gas sau động đất. Việc ĐẦU TIÊN?",
      options: [
        "Bật đèn tìm nguồn rò",
        "Mở cửa sổ, tắt gas, ra ngoài ngay",
        "Gọi điện thoại báo cứu hộ",
        "Dùng bật lửa soi",
      ],
      correct: 1,
      explanation:
        "Bật đèn/điện thoại tạo tia lửa. Ra ngoài trước, gọi cứu hộ từ bên ngoài!",
      meme_c: "💨 Thoát ra ngoài! Không gì trong nhà quan trọng hơn mạng!",
      meme_w:
        "💥 Dùng bật lửa soi gas rò = đoạn kết bom tấn... theo nghĩa đen!",
      xp: 25,
      diff: 3,
    },
    {
      q: "Tsunami thường xảy ra sau loại thiên tai nào?",
      options: [
        "Bão lớn",
        "Động đất mạnh dưới đáy biển",
        "Lũ lụt",
        "Núi lửa phun",
      ],
      correct: 1,
      explanation:
        "Động đất mạnh (M>7.0) dưới đáy biển = sóng thần. Sau động đất ven biển, lên cao ngay!",
      meme_c: "🌊 Geo-science! Bạn biết kết nối quan trọng này!",
      meme_w: "🏖 Sau động đất ven biển mà ra biển xem... Đừng!",
      xp: 18,
      diff: 2,
    },
    {
      q: "Đang lái xe khi động đất. Làm gì?",
      options: [
        "Tiếp tục lái về nhà",
        "Dừng xe ở làn, tắt máy, ở trong xe",
        "Dừng dưới gầm cầu",
        "Nhảy khỏi xe chạy bộ",
      ],
      correct: 1,
      explanation:
        "Dừng xa cầu, ở trong xe (bảo vệ hơn bên ngoài), tắt máy, bật đèn cảnh báo.",
      meme_c: "🚗 Xe là boong-ke nhỏ của bạn!",
      meme_w: "🌉 Dưới gầm cầu... Cầu là thứ đầu tiên sập trong động đất!",
      xp: 20,
      diff: 3,
    },
    {
      q: "Động đất thường kéo dài bao lâu?",
      options: ["5-30 giây (đa số)", "5-10 phút", "1 giờ", "Vài ngày"],
      correct: 0,
      explanation:
        "Hầu hết động đất chỉ 5-30 giây. Nhưng đó là 5-30 giây nguy hiểm nhất!",
      meme_c: "⏱ Biết thời gian = phản xạ đúng!",
      meme_w: "😮 Ngắn thôi nhưng đủ để thay đổi mọi thứ!",
      xp: 10,
      diff: 1,
    },
  ],
  nangnong: [
    {
      q: "Triệu chứng SAY NẮNG NẶNG (nguy hiểm tính mạng)?",
      options: [
        "Đổ nhiều mồ hôi, chóng mặt",
        "Da đỏ và KHÔ, không còn mồ hôi, lú lẫn",
        "Khát nước nhiều",
        "Đau đầu nhẹ",
      ],
      correct: 1,
      explanation:
        "Da khô không mồ hôi + lú lẫn = cơ thể mất khả năng điều chỉnh nhiệt. Nguy hiểm tính mạng!",
      meme_c: "🌡 Nhận biết đúng! Bạn có thể cứu người bị say nắng!",
      meme_w: "☀️ Da khô + không mồ hôi = 🆘 gọi 115 ngay!",
      xp: 20,
      diff: 3,
    },
    {
      q: "Sơ cứu say nắng: việc ĐẦU TIÊN cần làm?",
      options: [
        "Cho uống aspirin",
        "Vào bóng mát, làm mát bằng nước lạnh",
        "Cho ăn đường",
        "Đắp chăn ủ ấm",
      ],
      correct: 1,
      explanation:
        "Hạ nhiệt ngay là ưu tiên số 1. Bóng mát + nước lạnh (cổ, nách, bẹn) + gọi 115.",
      meme_c: "❄️ Làm mát ngay! Bạn vừa cứu một mạng người!",
      meme_w: "🧯 Đắp chăn cho say nắng... Nhiệt độ tăng thêm thôi!",
      xp: 18,
      diff: 2,
    },
    {
      q: "Không được làm khi ra ngoài trời nắng nóng?",
      options: [
        "Uống nước thường xuyên",
        "Mặc áo tối màu, bó sát",
        "Nghỉ bóng mát mỗi giờ",
        "Đội mũ rộng vành",
      ],
      correct: 1,
      explanation:
        "Áo tối hấp thụ nhiệt, bó sát cản mồ hôi bay hơi. Mặc áo sáng, rộng rãi.",
      meme_c: "👕 Chọn áo đúng cũng là kỹ năng sinh tồn!",
      meme_w: "🌑 Áo đen bó sát dưới nắng... Như mặc lò vi sóng vào người!",
      xp: 12,
      diff: 2,
    },
    {
      q: "Xe đóng kín dưới nắng 30 phút có thể đạt bao nhiêu độ?",
      options: ["35°C", "50°C", "70–80°C", "45°C"],
      correct: 2,
      explanation:
        "Xe đóng kín dưới nắng = 70-80°C trong 30 phút. Trẻ em tử vong chỉ trong vài chục phút!",
      meme_c: "🚗🔥 Bạn biết mức độ nguy hiểm thực sự!",
      meme_w: "😱 70°C! Nhiều người không biết điều này và hối hận rồi!",
      xp: 15,
      diff: 2,
    },
    {
      q: "Uống gì TỐT NHẤT khi làm việc ngoài trời nắng nóng?",
      options: [
        "Nước lạnh có đá nhiều",
        "Nước ấm/nguội + chút muối + đường",
        "Nước ngọt có gas",
        "Cà phê hoặc trà",
      ],
      correct: 1,
      explanation:
        "Nước muối đường ấm bù điện giải tốt nhất. Nước lạnh gây co thắt, cà phê gây lợi tiểu.",
      meme_c: "💧 ORS tự làm! Bạn biết bù điện giải đúng cách!",
      meme_w: "☕ Cà phê khi nắng nóng = mất nước nhanh hơn!",
      xp: 15,
      diff: 2,
    },
    {
      q: "Khung giờ NGUY HIỂM nhất để ra ngoài hè?",
      options: [
        "6-8 giờ sáng",
        "10 giờ sáng – 4 giờ chiều",
        "5-7 giờ chiều",
        "8-10 giờ tối",
      ],
      correct: 1,
      explanation:
        "UV và nhiệt độ cao nhất từ 10h-16h. Tránh ra ngoài hoặc bảo hộ đầy đủ.",
      meme_c: "⏰ Biết giờ để tránh nắng — life hack thực tế!",
      meme_w:
        "🕛 Trưa nắng đỉnh mà vẫn ra ngoài không che chắn... Brave nhưng không smart!",
      xp: 10,
      diff: 1,
    },
    {
      q: "Người >65 tuổi dễ bị say nắng hơn vì sao?",
      options: [
        "Da mỏng hơn",
        "Cơ chế cảm khát và đổ mồ hôi kém hơn",
        "Uống ít nước hơn",
        "Không có lý do đặc biệt",
      ],
      correct: 1,
      explanation:
        "Người cao tuổi ít cảm thấy khát và tuyến mồ hôi hoạt động kém — dễ mất nước mà không biết.",
      meme_c: "👴 Kiến thức y tế! Bạn sẽ chăm sóc người thân tốt hơn!",
      meme_w:
        "💦 Đừng đợi người già nói khát mới cho uống — chủ động cho uống thường xuyên!",
      xp: 18,
      diff: 2,
    },
    {
      q: "Nhiệt độ cảm giác (Heat Index) 40°C có nghĩa là?",
      options: [
        "Nhiệt kế đo 40°C",
        "Cảm giác nóng kết hợp độ ẩm = nguy hiểm như 40°C",
        "Nhiệt độ trong bóng râm",
        "Chỉ ảnh hưởng người già",
      ],
      correct: 1,
      explanation:
        "32°C + 90% độ ẩm = cảm giác 40-50°C! Nguy hiểm hơn nhiệt kế cho thấy nhiều.",
      meme_c: "💦 Độ ẩm + nóng = combo nguy hiểm! Bạn hiểu điều này!",
      meme_w: '🥵 "Chỉ 32°C thôi"... nhưng với 90% độ ẩm = cảm giác 40°C!',
      xp: 18,
      diff: 2,
    },
  ],
  mualon: [
    {
      q: 'Lượng mưa bao nhiêu mm/giờ là "Mưa rất to"?',
      options: [">16mm/giờ", ">50mm/giờ", ">100mm/giờ", ">200mm/giờ"],
      correct: 1,
      explanation:
        "Theo chuẩn khí tượng VN: >50mm/giờ = Mưa rất to. >100mm/3h = nguy cơ lũ quét.",
      meme_c: "🌧 Weather data mastery! Bạn hiểu thang đo mưa!",
      meme_w: "💧 50mm/giờ = xô nước đổ mỗi phút. Đó mới là mưa to!",
      xp: 15,
      diff: 2,
    },
    {
      q: "Dấu hiệu cảnh báo SẠT LỞ ĐẤT nguy hiểm nhất?",
      options: [
        "Mưa to kéo dài",
        "Tiếng ầm, nứt đất, cây nghiêng, nước chảy đục",
        "Gió mạnh",
        "Sấm sét",
      ],
      correct: 1,
      explanation:
        "Tiếng ầm + đất nứt + cây nghiêng + nước đục từ đồi = SẠT LỞ SẮP XẢY RA. Chạy ngay!",
      meme_c: "⛰ Đọc được dấu hiệu thiên nhiên! Pro survivalist!",
      meme_w:
        "😱 Thấy những dấu hiệu này mà không chạy... Không còn cơ hội nữa!",
      xp: 22,
      diff: 3,
    },
    {
      q: "Tại sao KHÔNG dừng xe dưới gầm cầu vượt khi mưa to?",
      options: [
        "Kẹt xe",
        "Túi nước nhanh + kết cấu yếu có thể sập",
        "Không có lý do",
        "Chỉ nguy với xe tải",
      ],
      correct: 1,
      explanation:
        "Gầm cầu tạo túi nước nhanh vì rút chậm. Nhiều người thiệt mạng ở đây.",
      meme_c: "🌉 Biết rồi! Đừng bao giờ dừng dưới gầm cầu khi mưa!",
      meme_w: '🚗 Gầm cầu "trú mưa" tưởng an toàn nhưng là bẫy chết người!',
      xp: 18,
      diff: 2,
    },
    {
      q: "Mưa to 6 tiếng, bạn ở vùng đồi dốc. Cần làm gì?",
      options: [
        "Chờ mưa ngừng",
        "Chủ động sơ tán lên điểm cao/nhà kiên cố",
        "Chỉ đóng cửa sổ",
        "Hỏi hàng xóm",
      ],
      correct: 1,
      explanation:
        "Mưa 6 tiếng = đất bão hòa nước = nguy cơ sạt lở rất cao. Sơ tán TRƯỚC khi có dấu hiệu!",
      meme_c: "🏃 Chủ động sơ tán! Mạng quan trọng hơn đồ đạc!",
      meme_w: "⏳ Chờ xem... Đất không chờ bạn quyết định đâu!",
      xp: 20,
      diff: 3,
    },
    {
      q: "Thấy vết nứt MỚI trên tường nhà sau mưa lớn. Nghĩa là?",
      options: [
        "Bình thường, nhà cũ hay nứt",
        "Nền đất có thể đang dịch chuyển — cần kiểm tra, sơ tán nếu nghi",
        "Chỉ cần trám xi-măng",
        "Thợ xây làm sai",
      ],
      correct: 1,
      explanation:
        "Vết nứt mới sau mưa lớn = dấu hiệu nền đất yếu hoặc sạt lở bắt đầu.",
      meme_c: "🧱 Nhận biết cấu trúc! Bạn sẽ bảo vệ gia đình!",
      meme_w:
        '⚠️ "Nứt bình thường"... Đất có thể đang trượt dưới chân nhà bạn!',
      xp: 15,
      diff: 2,
    },
    {
      q: "Tại sao điện NGUY HIỂM trong nước ngập thành phố?",
      options: [
        "Điện không nguy trong nước",
        "Đường điện ngầm/trạm biến áp bị ngập truyền điện qua nước",
        "Chỉ nguy khi chạm cột điện",
        "Điện tắt tự động khi ngập",
      ],
      correct: 1,
      explanation:
        "Nước ngập đô thị mang điện từ cơ sở hạ tầng hỏng. Tránh lội qua vùng ngập!",
      meme_c: "⚡💧 Combo chết người! Bạn biết để tránh!",
      meme_w:
        "🏙 Nước thành phố + điện hỏng = không nhìn thấy nhưng chết thật!",
      xp: 20,
      diff: 3,
    },
    {
      q: "Số điện thoại báo lũ lụt, sạt lở khẩn cấp ở Việt Nam?",
      options: [
        "113",
        "1800 599 928 (Ban Phòng chống thiên tai)",
        "114",
        "116",
      ],
      correct: 1,
      explanation:
        "1800 599 928 là đường dây nóng Ban Chỉ đạo Phòng chống thiên tai Quốc gia. Miễn phí 24/7.",
      meme_c: "📞 Biết số này = sẵn sàng tình huống thực!",
      meme_w: "🔥 114 là cứu hỏa. Lũ thì gọi đúng số đúng bộ nhé!",
      xp: 10,
      diff: 1,
    },
    {
      q: "Mưa lớn sau hạn hán DỄ GÂY LŨ QUÉT hơn vì sao?",
      options: [
        "Không liên quan",
        "Đất khô cứng không thấm kịp, nước chảy tràn bề mặt",
        "Vì mưa to hơn",
        "Vì đất mềm hơn",
      ],
      correct: 1,
      explanation:
        "Đất khô cứng không thấm nước → chảy tràn bề mặt → lũ quét nhanh (flash flood after drought).",
      meme_c: "🌍 Earth science! Bạn hiểu cơ chế tự nhiên!",
      meme_w: "☀️→🌧 Hạn rồi mưa = bẫy thiên nhiên nguy hiểm nhất!",
      xp: 20,
      diff: 3,
    },
  ],
};

// ── Save / Load Progress ──────────────────────────────────────
function _saveQuiz() {
  const d = {
    xp: QUIZ.xp,
    bestScores: QUIZ.bestScores,
    streak: QUIZ.streak,
    lastPlayDate: QUIZ.lastPlayDate,
    items: QUIZ.items,
    unlockedBadges: QUIZ.unlockedBadges,
  };
  localStorage.setItem("sw_quiz_v2", JSON.stringify(d));
  if (FB?.uid) {
    import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js")
      .then(({ doc, setDoc }) =>
        setDoc(doc(_db, "quizProgress", FB.uid), d, { merge: true }),
      )
      .catch(() => {});
  }
}
function _loadQuiz() {
  try {
    const raw = localStorage.getItem("sw_quiz_v2");
    if (!raw) return;
    const d = JSON.parse(raw);
    Object.assign(QUIZ, d);
    // Check streak
    if (QUIZ.lastPlayDate) {
      const last = new Date(QUIZ.lastPlayDate);
      const today = new Date();
      const diff = Math.floor((today - last) / 86400000);
      if (diff > 1) QUIZ.streak = 0;
    }
  } catch (e) {}
  _renderSurvivalHub();
}

// ── Streak Update ─────────────────────────────────────────────
function _updateStreak() {
  const today = new Date().toDateString();
  if (QUIZ.lastPlayDate !== today) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (QUIZ.lastPlayDate === yesterday.toDateString()) {
      QUIZ.streak++;
    } else if (!QUIZ.lastPlayDate) {
      QUIZ.streak = 1;
    } else {
      QUIZ.streak = 1;
    }
    QUIZ.lastPlayDate = today;
    // Streak rewards
    if (QUIZ.streak === 3) {
      QUIZ.items.shield++;
      showToast("🔥 Streak 3 ngày! +1 Shield!");
    }
    if (QUIZ.streak === 7) {
      QUIZ.items.freeze++;
      showToast("🔥 Streak 7 ngày! +1 Time Freeze!");
    }
    _saveQuiz();
  }
}

// ── Render Survival Hub (tab-survival enhancements) ───────────
function _renderSurvivalHub() {
  const hub = document.getElementById("survival-rank-hub");
  if (!hub) return;
  const rank = _getRank(QUIZ.xp);
  const nextRank = RANK_DATA[rank.lv] || rank;
  const xpToNext = rank.lv < 5 ? nextRank.xpMin - QUIZ.xp : 0;
  const xpPct =
    rank.lv < 5
      ? (
          ((QUIZ.xp - rank.xpMin) / (nextRank.xpMin - rank.xpMin)) *
          100
        ).toFixed(0)
      : 100;
  const streakEmoji = QUIZ.streak >= 7 ? "🔥" : QUIZ.streak >= 3 ? "⚡" : "🗓";
  hub.innerHTML = `
    <div class="srh-rank-card" style="background:${rank.bg};border-color:${rank.color}30">
      <div class="srh-rank-left">
        <div class="srh-skin">${rank.skin}</div>
        <div>
          <div class="srh-rank-title" style="color:${rank.color}">${rank.title}</div>
          <div class="srh-xp-row">
            <div class="srh-xp-bar"><div class="srh-xp-fill" style="width:${xpPct}%;background:${rank.color}"></div></div>
            <span class="srh-xp-text">${QUIZ.xp} XP ${rank.lv < 5 ? `· còn ${xpToNext} XP` : "· MAX"}</span>
          </div>
        </div>
      </div>
      <div class="srh-right">
        <div class="srh-streak">${streakEmoji} <strong>${QUIZ.streak}</strong> ngày</div>
        <div class="srh-items-mini">
          <span title="Shield">🛡${QUIZ.items.shield}</span>
          <span title="Freeze">⏸${QUIZ.items.freeze}</span>
          <span title="50/50">💡${QUIZ.items.fifty}</span>
        </div>
      </div>
    </div>
    <button class="srh-play-btn" onclick="startQuizGame()">
      <span>🏔</span> Leo Núi Sinh Tồn
      <span class="srh-best">Best: ${Object.values(QUIZ.bestScores).length ? Math.max(...Object.values(QUIZ.bestScores)) : 0} pts</span>
    </button>
  `;
}

// ── Open Quiz Modal ───────────────────────────────────────────
function startQuizGame() {
  const modal = document.getElementById("quiz-modal");
  if (!modal) return;
  modal.classList.remove("hidden");
  _showQScreen("hub");
  _renderQHub();
}
function closeQuizModal() {
  clearInterval(QUIZ.timerInt);
  document.getElementById("quiz-modal")?.classList.add("hidden");
}
function _showQScreen(name) {
  ["hub", "game", "result", "lb"].forEach((s) => {
    document
      .getElementById("qscreen-" + s)
      ?.classList.toggle("hidden", s !== name);
  });
}
// // ── Start Topic ───────────────────────────────────────────────

function _renderQHub() {
  const rank = _getRank(QUIZ.xp);
  const nextRank = RANK_DATA[rank.lv] || rank;
  const xpPct =
    rank.lv < 5
      ? (
          ((QUIZ.xp - rank.xpMin) / (nextRank.xpMin - rank.xpMin)) *
          100
        ).toFixed(0)
      : 100;
  const streakEmoji = QUIZ.streak >= 7 ? "🔥" : QUIZ.streak >= 3 ? "⚡" : "🗓";

  const topicMeta = {
    bao: { icon: "🌀", name: "Bão", cls: "qt-bao", diff: [1, 1, 1, 0, 0] },
    lu: { icon: "🌊", name: "Lũ lụt", cls: "qt-lu", diff: [1, 1, 1, 1, 0] },
    set: { icon: "⚡", name: "Sét", cls: "qt-set", diff: [1, 1, 0, 0, 0] },
    dongdat: {
      icon: "🌍",
      name: "Động đất",
      cls: "qt-dd",
      diff: [1, 1, 1, 0, 0],
    },
    nangnong: {
      icon: "🔥",
      name: "Nắng nóng",
      cls: "qt-nn",
      diff: [1, 1, 0, 0, 0],
    },
    mualon: {
      icon: "🌧",
      name: "Mưa lớn",
      cls: "qt-ml",
      diff: [1, 1, 1, 1, 1],
    },
  };

  // Build topic cards HTML bằng biến thường (tránh nested template literal phức tạp)
  let topicCardsHTML = "";
  for (const [key, t] of Object.entries(topicMeta)) {
    const best = QUIZ.bestScores[key] || 0;
    const total = QUIZ_QUESTIONS[key].length;
    const dots = t.diff
      .map(function (d) {
        return '<div class="qdiff-dot' + (d ? " on" : "") + '"></div>';
      })
      .join("");
    topicCardsHTML +=
      '<div class="qhub-topic-card ' +
      t.cls +
      '" onclick="window._startTopicWithRipple(\'' +
      key +
      "',this)\">" +
      '<div class="qhub-topic-icon">' +
      t.icon +
      "</div>" +
      '<div class="qhub-topic-name">' +
      t.name +
      "</div>" +
      '<div class="qhub-topic-best">Best: ' +
      best +
      " pts</div>" +
      '<div class="qhub-topic-count">' +
      total +
      " câu</div>" +
      '<div class="qhub-topic-diff">' +
      dots +
      "</div>" +
      '<div class="qhub-topic-play">Leo núi →</div>' +
      "</div>";
  }

  const hub = document.getElementById("qscreen-hub");
  if (!hub) return;

  hub.innerHTML =
    "" +
    '<canvas id="hub-stars-canvas" style="position:absolute;inset:0;z-index:0;pointer-events:none"></canvas>' +
    '<svg class="qhub-mountain-bg" viewBox="0 0 1440 320" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">' +
    '<defs><linearGradient id="mtn-g" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0%" stop-color="#001830" stop-opacity=".85"/>' +
    '<stop offset="100%" stop-color="#000810" stop-opacity="1"/>' +
    "</linearGradient></defs>" +
    '<path d="M0 320 L0 230 L120 130 L240 210 L360 80 L480 185 L600 65 L720 165 L840 42 L960 140 L1080 72 L1200 148 L1320 52 L1440 128 L1440 320 Z" fill="url(#mtn-g)"/>' +
    '<path d="M360 80 L335 128 L385 128 Z M840 42 L815 92 L865 92 Z M1320 52 L1295 100 L1345 100 Z" fill="rgba(255,255,255,.06)"/>' +
    '<path d="M360 80 L338 130 M840 42 L817 92 M1320 52 L1297 102" stroke="rgba(0,212,255,.18)" stroke-width="1.5" fill="none"/>' +
    '<path d="M0 320 L0 265 L180 165 L360 245 L540 145 L720 225 L900 122 L1080 205 L1260 132 L1440 192 L1440 320 Z" fill="rgba(2,8,18,.88)"/>' +
    "</svg>" +
    '<div class="qhub-content">' +
    '<div class="qhub-header">' +
    '<button class="qhub-header-btn" onclick="window.closeQuizModal()" title="Đóng">✕</button>' +
    '<div style="flex:1;text-align:center">' +
    '<div class="qhub-header-title">⛰ Survival Mountain</div>' +
    '<div class="qhub-header-sub">Quiz thực chiến · 6 thiên tai · Có items &amp; rank</div>' +
    "</div>" +
    '<button class="qhub-header-btn" onclick="window.showQuizLeaderboard()" title="Bảng xếp hạng">🏆</button>' +
    '<button class="qhub-header-btn" onclick="openMemeManager()" title="Meme">🎭</button>' +
    "</div>" +
    '<div class="qhub-rank-wrap">' +
    '<div class="qhub-rank-inner" style="border-color:' +
    rank.color +
    "35;background:" +
    rank.bg +
    '">' +
    '<div class="qhub-rank-skin">' +
    rank.skin +
    "</div>" +
    '<div class="qhub-rank-info">' +
    '<div class="qhub-rank-title" style="color:' +
    rank.color +
    '">' +
    rank.title +
    "</div>" +
    '<div class="qhub-xp-bar-wrap">' +
    '<div class="qhub-xp-bar"><div class="qhub-xp-fill" style="width:' +
    xpPct +
    '%"></div></div>' +
    "<span>" +
    QUIZ.xp +
    " XP" +
    (rank.lv < 5 ? " · còn " + (nextRank.xpMin - QUIZ.xp) + " XP" : "") +
    "</span>" +
    "</div>" +
    "</div>" +
    '<div class="qhub-streak-badge">' +
    streakEmoji +
    " <strong>" +
    QUIZ.streak +
    "</strong> ngày</div>" +
    "</div>" +
    "</div>" +
    '<div class="qhub-section-label">Chọn ngọn núi để chinh phục</div>' +
    '<div class="qhub-topics-grid">' +
    topicCardsHTML +
    "</div>" +
    '<div class="qhub-items-bar">' +
    '<div class="qhub-item qhi-shield" title="Shield — Bảo vệ 1 mạng khi sai">' +
    '<span class="qhub-item-icon">🛡</span>' +
    '<span class="qhub-item-name">Shield</span>' +
    '<span class="qhub-item-count">' +
    QUIZ.items.shield +
    "</span>" +
    "</div>" +
    '<div class="qhub-item qhi-freeze" title="Time Freeze — +8 giây">' +
    '<span class="qhub-item-icon">⏸</span>' +
    '<span class="qhub-item-name">Freeze</span>' +
    '<span class="qhub-item-count">' +
    QUIZ.items.freeze +
    "</span>" +
    "</div>" +
    '<div class="qhub-item qhi-fifty" title="50/50 — Xóa 2 đáp án sai">' +
    '<span class="qhub-item-icon">💡</span>' +
    '<span class="qhub-item-name">50/50</span>' +
    '<span class="qhub-item-count">' +
    QUIZ.items.fifty +
    "</span>" +
    "</div>" +
    '<div class="qhub-item qhi-hint" title="Hint — Xem gợi ý">' +
    '<span class="qhub-item-icon">📖</span>' +
    '<span class="qhub-item-name">Hint</span>' +
    '<span class="qhub-item-count">' +
    (QUIZ.items.hint || 0) +
    "</span>" +
    "</div>" +
    "</div>" +
    "</div>";

  setTimeout(_initHubCanvas, 30);
}
// ── Topic click with ripple ────────────────────────────────────
function _startTopicWithRipple(topic, cardEl) {
  const r = document.createElement("span");
  const size = Math.max(cardEl.offsetWidth, cardEl.offsetHeight) * 2;
  r.className = "qhub-ripple";
  r.style.cssText =
    "width:" +
    size +
    "px;height:" +
    size +
    "px;" +
    "left:" +
    (cardEl.offsetWidth / 2 - size / 2) +
    "px;" +
    "top:" +
    (cardEl.offsetHeight / 2 - size / 2) +
    "px";
  cardEl.appendChild(r);
  cardEl.style.transform = "scale(.96)";
  setTimeout(function () {
    r.remove();
    cardEl.style.transform = "";
    startTopic(topic);
  }, 200);
}
// ── Star canvas for hub background ────────────────────────────
function _initHubCanvas() {
  const canvas = document.getElementById("hub-stars-canvas");
  if (!canvas) return;
  const parent = canvas.parentElement;
  canvas.width = parent.offsetWidth || window.innerWidth;
  canvas.height = parent.offsetHeight || window.innerHeight;
  const ctx2 = canvas.getContext("2d");
  const stars = Array.from({ length: 160 }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    r: Math.random() * 1.4 + 0.3,
    speed: Math.random() * 0.25 + 0.04,
    tw: Math.random() * Math.PI * 2,
    op: Math.random() * 0.7 + 0.2,
  }));
  let _frame;
  function draw() {
    if (!document.getElementById("hub-stars-canvas")) {
      cancelAnimationFrame(_frame);
      return;
    }
    ctx2.clearRect(0, 0, canvas.width, canvas.height);
    stars.forEach((s) => {
      s.tw += 0.018;
      const a = s.op * (0.55 + 0.45 * Math.sin(s.tw));
      ctx2.beginPath();
      ctx2.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx2.fillStyle = `rgba(180,220,255,${a})`;
      ctx2.fill();
      s.y -= s.speed;
      if (s.y < -2) {
        s.y = canvas.height + 2;
        s.x = Math.random() * canvas.width;
      }
    });
    // rare shooting star
    if (Math.random() < 0.003) {
      const sx = Math.random() * canvas.width,
        sy = Math.random() * canvas.height * 0.5;
      const g = ctx2.createLinearGradient(sx, sy, sx + 90, sy + 32);
      g.addColorStop(0, "rgba(255,255,255,0)");
      g.addColorStop(0.5, "rgba(255,255,255,.75)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx2.beginPath();
      ctx2.moveTo(sx, sy);
      ctx2.lineTo(sx + 90, sy + 32);
      ctx2.strokeStyle = g;
      ctx2.lineWidth = 1.5;
      ctx2.stroke();
    }
    _frame = requestAnimationFrame(draw);
  }
  draw();
}

// ── Timer ─────────────────────────────────────────────────────
// ── Select Answer ─────────────────────────────────────────────
// ── Correct ───────────────────────────────────────────────────
// ── Wrong ─────────────────────────────────────────────────────
// ── Items ─────────────────────────────────────────────────────
// ── End Game ──────────────────────────────────────────────────
// ================================================================
// SURVIVAL MOUNTAIN — GAME ENHANCED v3.0
// Leo núi sinh tồn · Combo boost · Disaster effects · Meme troll
//
// THAY THẾ các hàm sau trong main.js:
//   _renderQuestion, _startTimer, _onTimeout,
//   _selectAnswer, _onCorrect, _onWrong, _loseLife
// ================================================================

// ── Track player position (0–100) ────────────────────────────
var PLAYER_POS = 0;
var WRONG_STREAK = 0;

// ── RENDER QUESTION (toàn bộ game screen) ────────────────────
function _renderQuestion() {
  clearInterval(QUIZ.timerInt);
  if (QUIZ.qIdx >= QUIZ.questions.length) {
    _endGame();
    return;
  }

  var q = QUIZ.questions[QUIZ.qIdx];
  var progress = ((QUIZ.qIdx / QUIZ.questions.length) * 100).toFixed(0);
  PLAYER_POS = Math.min(88, (QUIZ.qIdx / QUIZ.questions.length) * 88);
  QUIZ.itemUsed = false;

  var topicLabels = {
    bao: "🌀 Bão",
    lu: "🌊 Lũ lụt",
    set: "⚡ Sét",
    dongdat: "🌍 Động đất",
    nangnong: "🔥 Nắng nóng",
    mualon: "🌧 Mưa lớn",
  };

  var gs = document.getElementById("qscreen-game");
  if (!gs) return;

  // Build options HTML
  var optHTML = "";
  for (var i = 0; i < q.options.length; i++) {
    optHTML +=
      '<button class="qg-option" data-idx="' +
      i +
      '" onclick="_selectAnswer(' +
      i +
      ')">' +
      '<span class="qg-opt-letter">' +
      "ABCD"[i] +
      "</span>" +
      '<span class="qg-opt-text">' +
      q.options[i] +
      "</span>" +
      "</button>";
  }

  // Lives display
  var livesHTML = "";
  for (var l = 0; l < 3; l++) {
    livesHTML += l < QUIZ.lives ? "❤️" : "🖤";
  }

  gs.innerHTML =
    // ── Disaster overlay (hidden by default) ──
    '<div id="disaster-overlay" style="position:absolute;inset:0;z-index:50;pointer-events:none;display:none"></div>' +
    // ── Header ──
    '<div class="qg-header">' +
    '<button class="qg-close" onclick="if(confirm(\'Thoát khỏi game?\')){' +
    "clearInterval(QUIZ.timerInt);PLAYER_POS=0;WRONG_STREAK=0;_showQScreen('hub');_renderQHub();}\">✕</button>" +
    '<div class="qg-topic-tag">' +
    (topicLabels[QUIZ.topic] || QUIZ.topic) +
    "</div>" +
    '<div class="qg-hud">' +
    '<div class="qg-hud-item">💯 <span id="qg-score">' +
    QUIZ.score +
    "</span></div>" +
    '<div class="qg-hud-item ' +
    (QUIZ.combo >= 3 ? "combo-fire" : "") +
    '">🔥 <span id="qg-combo">x' +
    QUIZ.combo +
    "</span></div>" +
    '<div class="qg-hud-item">' +
    livesHTML +
    "</div>" +
    "</div>" +
    "</div>" +
    // ── Progress bar ──
    '<div class="qg-progress-wrap">' +
    '<div class="qg-progress-bar"><div class="qg-progress-fill" id="qg-pfill" style="width:' +
    progress +
    '%"></div></div>' +
    '<span class="qg-progress-txt">' +
    (QUIZ.qIdx + 1) +
    "/" +
    QUIZ.questions.length +
    "</span>" +
    "</div>" +
    // ── Mountain visual ──
    '<div class="qg-mountain-wrap" id="qg-mtn-wrap">' +
    _buildMountainHTML() +
    "</div>" +
    // ── Question area ──
    '<div class="qg-question-area">' +
    '<div class="qg-q-diff">' +
    "⭐".repeat(q.diff || 1) +
    "</div>" +
    '<div class="qg-question" id="qg-question">' +
    q.q +
    "</div>" +
    '<div class="qg-timer-wrap">' +
    '<div class="qg-timer-bar" id="qg-timer-bar" style="width:100%;background:#00e676"></div>' +
    '<span class="qg-timer-txt" id="qg-timer-txt">20</span>' +
    "</div>" +
    '<div class="qg-options" id="qg-options">' +
    optHTML +
    "</div>" +
    '<div class="qg-feedback hidden" id="qg-feedback"></div>' +
    "</div>" +
    // ── Items bar ──
    '<div class="qg-items-bar">' +
    '<button class="qg-item-btn ' +
    (QUIZ.items.shield > 0 ? "" : "disabled") +
    '" onclick="_useItem(\'shield\')" title="Shield">🛡<span>' +
    QUIZ.items.shield +
    "</span></button>" +
    '<button class="qg-item-btn ' +
    (QUIZ.items.freeze > 0 ? "" : "disabled") +
    '" onclick="_useItem(\'freeze\')" title="Freeze">⏸<span>' +
    QUIZ.items.freeze +
    "</span></button>" +
    '<button class="qg-item-btn ' +
    (QUIZ.items.fifty > 0 ? "" : "disabled") +
    '" onclick="_useItem(\'fifty\')" title="50/50">💡<span>' +
    QUIZ.items.fifty +
    "</span></button>" +
    "</div>";

  _startTimer();
}

// ── Build mountain SVG with animated player ───────────────────
/* --- THAY THẾ TOÀN BỘ HÀM _buildMountainHTML TỪ ĐÂY --- */
/* --- THAY THẾ TOÀN BỘ HÀM _buildMountainHTML TỪ ĐÂY --- */
/* --- PHẦN JS: NÂNG CẤP TRẠM TIẾP TẾ SANG TRỌNG --- */
function _buildMountainHTML() {
  var rank = _getRank(QUIZ.xp);

  // Tọa độ Zigzag theo % (x: 50 là chính giữa)
  var zigzagPoints = [
    { x: 50, y: 0 }, // Chân núi
    { x: 55, y: 25 }, // Trạm 1
    { x: 45, y: 50 }, // Trạm 2
    { x: 53, y: 75 }, // Trạm 3
    { x: 50, y: 95 }, // Đỉnh
  ];

  var campsHTML = "";
  for (var i = 0; i < zigzagPoints.length; i++) {
    var pt = zigzagPoints[i];
    var reached = PLAYER_POS >= pt.y;

    // Thiết kế trạm mới: Kim cương + Vòng pulse + Nhãn Level
    campsHTML += `
      <div class="checkpoint-container ${reached ? "reached" : ""}" 
           style="left:${pt.x}%; bottom:${pt.y}%;">
        
        <!-- Vòng xung lực tỏa ra -->
        <div class="checkpoint-pulse"></div>
        
        <!-- Hình kim cương trung tâm -->
        <div class="checkpoint-diamond"></div>
        
        <!-- Nhãn chữ chỉ hiện khi gần hoặc đã đạt -->
        <div style="position:absolute; left:15px; top:-8px; font-family:'Orbitron', sans-serif; 
                    font-size:9px; font-weight:800; color:${reached ? "#00d4ff" : "#3d5a7a"}; 
                    white-space:nowrap; text-transform:uppercase; letter-spacing:1px; 
                    text-shadow: 0 0 10px rgba(0,0,0,0.8); opacity:${reached ? 1 : 0.4}; transition:0.5s;">
          ${pt.y === 95 ? "Summit" : "Station " + i}
        </div>
      </div>`;
  }

  // Tính vị trí X của nhân vật (giống bản trước để không lệch)
  var currentX = 50;
  if (PLAYER_POS <= 25) currentX = 50 + (PLAYER_POS / 25) * 5;
  else if (PLAYER_POS <= 50) currentX = 55 - ((PLAYER_POS - 25) / 25) * 10;
  else if (PLAYER_POS <= 75) currentX = 45 + ((PLAYER_POS - 50) / 25) * 8;
  else currentX = 53 - ((PLAYER_POS - 75) / 20) * 3;

  return `
    <svg style="position:absolute; bottom:0; left:0; width:100%; height:100%; z-index:1" viewBox="0 0 100 100" preserveAspectRatio="none">
      <defs>
        <linearGradient id="mainMtn" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0.9"/> 
          <stop offset="15%" stop-color="#1e3c72"/>
          <stop offset="100%" stop-color="#02060c"/>
        </linearGradient>
        <filter id="neonGlow"><feGaussianBlur stdDeviation="0.4" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      </defs>

      <!-- Dãy núi mờ phía sau -->
      <path d="M-10 100 L20 40 L40 80 L60 30 L110 100 Z" fill="#0a1a30" opacity="0.4" />
      <path d="M-5 100 L30 50 L50 90 L80 40 L105 100 Z" fill="#081426" opacity="0.6" />

      <!-- Núi chính -->
      <path d="M15 100 L50 5 L85 100 Z" fill="url(#mainMtn)" />
      
      <!-- Đường dẫn mờ -->
      <polyline points="50,100 55,75 45,50 53,25 50,5" 
                fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="0.3" stroke-dasharray="1,1" />
      
      <!-- Đường Neon Zigzag -->
      <polyline points="50,100 55,75 45,50 53,25 50,5" 
                fill="none" stroke="#00d4ff" stroke-width="0.8" filter="url(#neonGlow)"
                style="stroke-dasharray: 100; stroke-dashoffset: ${100 - PLAYER_POS}; transition: 1.5s ease-out;" />
    </svg>

    ${campsHTML}

    <!-- Nhân vật leo núi -->
    <div id="qg-player-el" style="left:${currentX}%; bottom:${PLAYER_POS}%;">
      <div style="position:relative;">
        <div style="position:absolute; top:50%; left:50%; transform:translate(-50%, -50%); 
                    width:60px; height:60px; background:radial-gradient(circle, rgba(0,212,255,0.3) 0%, transparent 70%);"></div>
        ${rank.skin}
      </div>
    </div>
  `;
}
// ── Timer ─────────────────────────────────────────────────────

function _onTimeout() {
  var q = QUIZ.questions[QUIZ.qIdx];
  _disableOptions();
  _highlightCorrect(q.correct);
  _showFeedback(
    "⏰ HẾT GIỜ RỒI! Câu đúng là " + "ABCD"[q.correct],
    q.explanation,
    false,
  );
  _loseLife();
  _animatePlayerDown();
  WRONG_STREAK++;
  if (WRONG_STREAK >= 2) _triggerDisaster();
  setTimeout(function () {
    QUIZ.qIdx++;
    _renderQuestion();
  }, 2800);
}

// ── Select answer ─────────────────────────────────────────────
function _selectAnswer(idx) {
  clearInterval(QUIZ.timerInt);
  _disableOptions();
  var q = QUIZ.questions[QUIZ.qIdx];
  var opts = document.querySelectorAll(".qg-option");
  if (opts[q.correct]) opts[q.correct].classList.add("correct");
  if (idx === q.correct) {
    if (opts[idx]) opts[idx].classList.add("selected-correct");
    _onCorrect(q);
  } else {
    if (opts[idx]) opts[idx].classList.add("selected-wrong");
    _onWrong(q);
  }
}

function _disableOptions() {
  document.querySelectorAll(".qg-option").forEach(function (b) {
    b.onclick = null;
    b.style.cursor = "default";
  });
}
function _highlightCorrect(ci) {
  var opts = document.querySelectorAll(".qg-option");
  if (opts[ci]) opts[ci].classList.add("correct");
}

// ── CORRECT ── Player climbs! ─────────────────────────────────
function _onCorrect(q) {
  WRONG_STREAK = 0;
  QUIZ.combo++;
  QUIZ.maxCombo = Math.max(QUIZ.maxCombo, QUIZ.combo);
  QUIZ.correctQ++;

  var speedBonus = QUIZ.timer >= 15 ? 5 : 0;
  var comboBonus =
    QUIZ.combo >= 7 ? 50 : QUIZ.combo >= 5 ? 30 : QUIZ.combo >= 3 ? 15 : 0;
  var pts = 10 + comboBonus + speedBonus + (q.xp || 0);
  QUIZ.sessionXP += 5 + Math.floor(comboBonus / 2);
  QUIZ.score += pts;

  // Update HUD
  var scoreEl = document.getElementById("qg-score");
  var comboEl = document.getElementById("qg-combo");
  if (scoreEl) {
    scoreEl.textContent = QUIZ.score;
    scoreEl.style.animation = "score-pop .4s ease";
    setTimeout(function () {
      scoreEl.style.animation = "";
    }, 400);
  }
  if (comboEl) {
    comboEl.textContent = "x" + QUIZ.combo;
  }

  // Feedback text
  var comboText =
    QUIZ.combo >= 7
      ? "🌟 COMBO THẦN! +" + pts + " pts"
      : QUIZ.combo >= 5
        ? "🔥 SIÊU COMBO! +" + pts + " pts"
        : QUIZ.combo >= 3
          ? "💥 COMBO! +" + pts + " pts"
          : "✅ ĐÚNG! +" + pts + " pts";
  _showFeedback(comboText, q.meme_c || "🎉 Tuyệt vời!", true);
  _playBeep(true);
  if (Math.random() < 0.6) _showMemePopup(true);
  // Animate player UP
  _animatePlayerUp(QUIZ.combo);

  // Combo boost particles
  if (QUIZ.combo >= 3) _showComboBoost(QUIZ.combo);

  setTimeout(function () {
    QUIZ.qIdx++;
    _renderQuestion();
  }, 2000);
}

// ── WRONG ── Player slides + disaster ────────────────────────
function _onWrong(q) {
  WRONG_STREAK++;

  if (QUIZ.activeShield) {
    QUIZ.activeShield = false;
    _showFeedback("🛡 SHIELD bảo vệ bạn lần này!", q.explanation, true);
    QUIZ.combo = 0;
    var ce = document.getElementById("qg-combo");
    if (ce) ce.textContent = "x0";
    setTimeout(function () {
      QUIZ.qIdx++;
      _renderQuestion();
    }, 2500);
    return;
  }

  var comboLost = QUIZ.combo;
  QUIZ.combo = 0;
  var comboMsg =
    comboLost >= 5
      ? "💔 Mất combo x" + comboLost + "! Đau quá..."
      : comboLost >= 3
        ? "😭 Combo x" + comboLost + " bay mất rồi!"
        : "❌ SAI RỒI!";

  _showFeedback(comboMsg, q.meme_w || "😅 Thử lại nào!", false);
  var ce = document.getElementById("qg-combo");
  if (ce) ce.textContent = "x0";
  _loseLife();
  _animatePlayerDown();
  _playBeep(false);
  if (Math.random() < 0.6) _showMemePopup(false);

  // Shake game container
  var gs = document.getElementById("qscreen-game");
  if (gs) {
    gs.style.animation = "wrong-shake .5s";
    setTimeout(function () {
      gs.style.animation = "";
    }, 500);
  }

  // Trigger disaster if wrong streak
  if (WRONG_STREAK >= 2) _triggerDisaster();

  setTimeout(function () {
    QUIZ.qIdx++;
    _renderQuestion();
  }, 2800);
}

function _loseLife() {
  QUIZ.lives--;
  if (QUIZ.lives <= 0) setTimeout(_endGame, 2800);
}

// ── Animate player UP ─────────────────────────────────────────
function _animatePlayerUp(combo) {
  var el = document.getElementById("qg-player-el");
  if (!el) return;
  var nextPos = Math.min(88, ((QUIZ.qIdx + 1) / QUIZ.questions.length) * 88);
  // Combo boost: jump extra high momentarily
  if (combo >= 3) {
    el.style.transition = "bottom .3s cubic-bezier(.34,1.9,.64,1)";
    el.style.bottom = nextPos + 8 + "%";
    setTimeout(function () {
      el.style.transition = "bottom .5s cubic-bezier(.34,1.56,.64,1)";
      el.style.bottom = nextPos + "%";
    }, 300);
  } else {
    el.style.transition = "bottom .6s cubic-bezier(.34,1.56,.64,1)";
    el.style.bottom = nextPos + "%";
  }
  // Sparkle effect
  _spawnSparkles(true);
}

// ── Animate player DOWN (slide) ───────────────────────────────
function _animatePlayerDown() {
  var el = document.getElementById("qg-player-el");
  if (!el) return;
  var curBottom = parseFloat(el.style.bottom) || PLAYER_POS;
  var slideDown = Math.max(0, curBottom - 6);
  el.style.transition = "bottom .4s cubic-bezier(.55,.06,.68,.19)";
  el.style.bottom = curBottom + 4 + "%"; // brief bounce up
  setTimeout(function () {
    el.style.transition = "bottom .5s cubic-bezier(.55,.06,.68,.19)";
    el.style.bottom = slideDown + "%";
  }, 150);
  _spawnSparkles(false);
}

// ── Sparkles ──────────────────────────────────────────────────
function _spawnSparkles(correct) {
  var wrap = document.getElementById("qg-mtn-wrap");
  if (!wrap) return;
  var count = correct ? 8 : 4;
  for (var i = 0; i < count; i++) {
    (function (idx) {
      setTimeout(function () {
        var s = document.createElement("div");
        var x = 35 + Math.random() * 30;
        var y = 10 + Math.random() * 70;
        s.style.cssText =
          "position:absolute;left:" +
          x +
          "%;bottom:" +
          y +
          "%;font-size:" +
          (correct ? "1.1rem" : ".8rem") +
          ";pointer-events:none;z-index:20;animation:spark-fly .8s ease forwards";
        s.textContent = correct
          ? ["⭐", "✨", "💫", "🌟", "⚡"][idx % 5]
          : ["💦", "🌊", "⚡", "🌪"][idx % 4];
        wrap.appendChild(s);
        setTimeout(function () {
          s.remove();
        }, 900);
      }, idx * 80);
    })(i);
  }
}

// ── Combo boost visual ────────────────────────────────────────
function _showComboBoost(combo) {
  var wrap = document.getElementById("qg-mtn-wrap");
  if (!wrap) return;
  var boost = document.createElement("div");
  boost.style.cssText =
    "position:absolute;left:50%;top:30%;transform:translateX(-50%);font-size:1.4rem;font-family:'Orbitron',monospace;font-weight:900;color:#ffb300;text-shadow:0 0 20px #ffb300;z-index:30;pointer-events:none;animation:combo-pop .8s ease forwards;white-space:nowrap";
  boost.textContent =
    combo >= 7
      ? "🚀 HYPER BOOST!"
      : combo >= 5
        ? "⚡ SPEED BOOST!"
        : "🔥 COMBO x" + combo + "!";
  wrap.appendChild(boost);
  setTimeout(function () {
    boost.remove();
  }, 900);
}

// ── DISASTER EFFECTS ─────────────────────────────────────────
function _triggerDisaster() {
  var overlay = document.getElementById("disaster-overlay");
  if (!overlay) return;

  var disasters = [
    {
      emoji: "🌀",
      label: "BÃO ĐỔ BỘ!",
      color: "rgba(0,100,200,.35)",
      particles: ["🌀", "💨", "🌧", "☁"],
    },
    {
      emoji: "⚡",
      label: "SÉT ĐÁNH!",
      color: "rgba(255,220,0,.25)",
      particles: ["⚡", "💥", "🌩", "⚡"],
    },
    {
      emoji: "🌊",
      label: "LŨ ÀO TỚI!",
      color: "rgba(0,80,200,.4)",
      particles: ["🌊", "💧", "🌧", "🌊"],
    },
    {
      emoji: "🌪",
      label: "LỐC XOÁY!",
      color: "rgba(100,50,200,.35)",
      particles: ["🌪", "💨", "☁", "🌪"],
    },
  ];

  var d = disasters[Math.floor(Math.random() * disasters.length)];

  overlay.style.display = "flex";
  overlay.style.flexDirection = "column";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";
  overlay.style.background = d.color;
  overlay.style.backdropFilter = "blur(2px)";
  overlay.style.animation = "disaster-flash .15s ease 3";

  overlay.innerHTML =
    '<div style="font-size:3.5rem;animation:disaster-shake .3s ease infinite">' +
    d.emoji +
    "</div>" +
    "<div style=\"font-family:'Orbitron',monospace;font-size:1rem;font-weight:900;color:#fff;letter-spacing:3px;text-shadow:0 0 20px currentColor;margin-top:8px\">" +
    d.label +
    "</div>" +
    '<div style="font-size:.75rem;color:rgba(255,255,255,.7);margin-top:4px">Cố lên! Đừng bỏ cuộc!</div>';

  // Scatter disaster particles
  for (var i = 0; i < 10; i++) {
    (function (idx) {
      setTimeout(function () {
        var p = document.createElement("div");
        p.style.cssText =
          "position:absolute;font-size:1.4rem;pointer-events:none;" +
          "left:" +
          Math.random() * 90 +
          "%;top:" +
          Math.random() * 90 +
          "%;" +
          "animation:disaster-particle 1.2s ease forwards;z-index:51";
        p.textContent = d.particles[idx % d.particles.length];
        overlay.appendChild(p);
        setTimeout(function () {
          p.remove();
        }, 1200);
      }, idx * 100);
    })(i);
  }

  setTimeout(function () {
    overlay.style.display = "none";
    overlay.innerHTML = "";
    WRONG_STREAK = 0;
  }, 1500);
}

// ================================================================
// SURVIVAL MOUNTAIN — GAME MODES v4.0
// 🧗 Leo núi | ⚡ Speed Run | 🧠 Training
// THÊM VÀO main.js, THAY THẾ hàm startTopic() cũ
// ================================================================

// ── Mode config ───────────────────────────────────────────────
var GAME_MODES = {
  climb: {
    id: "climb",
    label: "Leo Núi",
    icon: "🧗",
    desc: "Trả lời đúng để leo cao hơn",
    timer: 20,
    questionCount: 15,
    color: "#00d4ff",
    bg: "rgba(0,212,255,.1)",
    border: "rgba(0,212,255,.35)",
  },
  speed: {
    id: "speed",
    label: "Speed Run",
    icon: "⚡",
    desc: "12 giây mỗi câu — nhanh tay nhanh mắt!",
    timer: 12,
    questionCount: 20,
    color: "#ffb300",
    bg: "rgba(255,179,0,.1)",
    border: "rgba(255,179,0,.35)",
  },
  training: {
    id: "training",
    label: "Training",
    icon: "🧠",
    desc: "Không giới hạn thời gian, đọc giải thích sau mỗi câu",
    timer: 999,
    questionCount: 10,
    color: "#00e676",
    bg: "rgba(0,230,118,.1)",
    border: "rgba(0,230,118,.35)",
  },
};
var CURRENT_MODE = "climb";

// ── startTopic — mở màn chọn mode trước ─────────────────────
function startTopic(topic) {
  QUIZ.topic = topic;
  _showQScreen("game");
  _renderModeSelect(topic);
}

// ── Render mode select screen ─────────────────────────────────
function _renderModeSelect(topic) {
  var topicMeta = {
    bao: "🌀 Bão",
    lu: "🌊 Lũ lụt",
    set: "⚡ Sét",
    dongdat: "🌍 Động đất",
    nangnong: "🔥 Nắng nóng",
    mualon: "🌧 Mưa lớn",
  };
  var gs = document.getElementById("qscreen-game");
  if (!gs) return;

  var modeCards = "";
  var modeKeys = ["climb", "speed", "training"];
  for (var i = 0; i < modeKeys.length; i++) {
    var m = GAME_MODES[modeKeys[i]];
    var isSelected = CURRENT_MODE === m.id;
    modeCards +=
      '<div class="qmode-card ' +
      (isSelected ? "selected" : "") +
      '" ' +
      'id="qmode-' +
      m.id +
      '" ' +
      "onclick=\"_selectMode('" +
      m.id +
      "')\" " +
      'style="--mc:' +
      m.color +
      ";--mb:" +
      m.bg +
      ";--mbd:" +
      m.border +
      '">' +
      '<div class="qmode-icon">' +
      m.icon +
      "</div>" +
      '<div class="qmode-label">' +
      m.label +
      "</div>" +
      '<div class="qmode-desc">' +
      m.desc +
      "</div>" +
      '<div class="qmode-meta">' +
      '<span class="qmode-tag">' +
      (m.timer < 999 ? "⏱ " + m.timer + "s/câu" : "⏱ Tự do") +
      "</span>" +
      '<span class="qmode-tag">' +
      m.questionCount +
      " câu</span>" +
      "</div>" +
      '<div class="qmode-check">' +
      (isSelected ? "✓" : "") +
      "</div>" +
      "</div>";
  }

  // Question count selector
  var qOpts = "";
  var counts = [10, 15, 20];
  var defaultCount = GAME_MODES[CURRENT_MODE].questionCount;
  for (var j = 0; j < counts.length; j++) {
    qOpts +=
      '<button class="qcount-btn ' +
      (counts[j] === defaultCount ? "active" : "") +
      '" ' +
      'onclick="_setQCount(' +
      counts[j] +
      ',this)">' +
      counts[j] +
      " câu</button>";
  }

  gs.innerHTML =
    '<div class="qmode-screen">' +
    '<div class="qmode-header">' +
    '<button class="qg-close" onclick="_showQScreen(\'hub\');_renderQHub();">✕</button>' +
    '<div class="qmode-header-info">' +
    '<div class="qmode-topic-badge">' +
    (topicMeta[topic] || topic) +
    "</div>" +
    '<div class="qmode-title">Chọn chế độ chơi</div>' +
    "</div>" +
    "</div>" +
    '<div class="qmode-cards">' +
    modeCards +
    "</div>" +
    '<div class="qmode-count-section">' +
    '<div class="qmode-count-label">📊 Số câu hỏi</div>' +
    '<div class="qmode-count-btns" id="qcount-btns">' +
    qOpts +
    "</div>" +
    "</div>" +
    '<div class="qmode-preview" id="qmode-preview"></div>' +
    '<button class="qmode-start-btn" id="qmode-start-btn" onclick="_launchGame()">' +
    '<span id="qmode-start-icon">' +
    GAME_MODES[CURRENT_MODE].icon +
    "</span>" +
    '<span id="qmode-start-label">Bắt đầu ' +
    GAME_MODES[CURRENT_MODE].label +
    "</span>" +
    '<span style="margin-left:auto;opacity:.6;font-size:.8rem">' +
    GAME_MODES[CURRENT_MODE].questionCount +
    " câu →</span>" +
    "</button>" +
    "</div>";

  _updateModePreview();
}
// ================================================================
// FIX SỐ CÂU HỎI — thay thế 3 hàm trong main.js
// ================================================================

// Biến global lưu số câu đã chọn
var SELECTED_Q_COUNT = 15;

function _setQCount(count, btn) {
  SELECTED_Q_COUNT = count;
  GAME_MODES[CURRENT_MODE].questionCount = count;
  document.querySelectorAll(".qcount-btn").forEach(function (b) {
    b.classList.remove("active");
  });
  if (btn) btn.classList.add("active");
  // Cập nhật nút start
  var lastSpan = document.querySelector("#qmode-start-btn span:last-child");
  if (lastSpan) lastSpan.textContent = count + " câu →";
  _updateModePreview();
}

function _updateModePreview() {
  var preview = document.getElementById("qmode-preview");
  if (!preview) return;
  var m = GAME_MODES[CURRENT_MODE];
  var total = (QUIZ_QUESTIONS[QUIZ.topic] || []).length;
  var count = SELECTED_Q_COUNT;
  var previews = {
    climb:
      "🧗 Nhân vật leo núi theo từng câu đúng · Combo boost · Thiên tai khi sai nhiều",
    speed:
      "⚡ Chỉ có " +
      m.timer +
      " giây mỗi câu · Không kịp = sai · Thử thách tốc độ",
    training:
      "🧠 Không giới hạn thời gian · Xem giải thích chi tiết sau mỗi câu",
  };
  preview.innerHTML =
    '<div class="qmode-preview-inner" style="border-color:' +
    m.border +
    ";background:" +
    m.bg +
    '">' +
    '<div style="color:' +
    m.color +
    ';font-size:.72rem;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:6px">' +
    m.icon +
    " " +
    m.label.toUpperCase() +
    " MODE</div>" +
    '<div style="font-size:.8rem;color:var(--text-secondary);line-height:1.6">' +
    previews[CURRENT_MODE] +
    "</div>" +
    '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">' +
    '<span class="qmode-tag" style="border-color:' +
    m.border +
    ";color:" +
    m.color +
    '">' +
    (m.timer < 999 ? "⏱ " + m.timer + "s/câu" : "⏱ Không giới hạn") +
    "</span>" +
    '<span class="qmode-tag" style="border-color:' +
    m.border +
    ";color:" +
    m.color +
    '">' +
    Math.min(count, total) +
    " câu" +
    (count > total ? " (tối đa " + total + ")" : "") +
    "</span>" +
    "</div></div>";
}

var AI_Q_CACHE = {};

async function _generateAIQuestions(topic, count) {
  var cacheKey = topic + "_ai_" + count;
  if (AI_Q_CACHE[cacheKey] && AI_Q_CACHE[cacheKey].length >= count) {
    return AI_Q_CACHE[cacheKey];
  }
  var topicNames = {
    bao: "bão lụt",
    lu: "lũ lụt",
    set: "sét đánh",
    dongdat: "động đất",
    nangnong: "nắng nóng",
    mualon: "mưa lớn",
  };
  var prompt =
    "Tạo " +
    count +
    " câu hỏi trắc nghiệm sinh tồn về " +
    (topicNames[topic] || topic) +
    " tại Việt Nam. " +
    "Chỉ trả về JSON array thuần túy, không có text nào khác, không markdown. " +
    'Mỗi phần tử có dạng: {"q":"nội dung câu hỏi đầy đủ","options":["đáp án 1 đầy đủ","đáp án 2 đầy đủ","đáp án 3 đầy đủ","đáp án 4 đầy đủ"],"correct":0,"explanation":"giải thích tại sao đúng","meme_c":"phản hồi vui khi đúng","meme_w":"phản hồi troll khi sai","xp":15,"diff":2}. QUAN TRỌNG: options phải là 4 câu trả lời thực tế, KHÔNG dùng chữ cái A B C D làm đáp án.';
  try {
    var res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + (window.GROQ_KEY || GROQ_KEY),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [
          {
            role: "system",
            content: "Bạn chỉ trả về JSON array thuần túy, không có text khác.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 3000,
      }),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    var data = await res.json();
    var text = data.choices[0].message.content.trim();
    // Lấy phần từ [ đến ]
    var s = text.indexOf("["),
      e = text.lastIndexOf("]");
    if (s === -1 || e === -1) throw new Error("No JSON");
    var questions = JSON.parse(text.slice(s, e + 1));
    questions = questions.filter(function (q) {
      return (
        q.q &&
        Array.isArray(q.options) &&
        q.options.length === 4 &&
        typeof q.correct === "number" &&
        q.explanation
      );
    });
    console.log("✅ AI tạo " + questions.length + " câu");
    AI_Q_CACHE[cacheKey] = questions;
    return questions;
  } catch (e) {
    console.error("AI lỗi:", e.message);
    return [];
  }
}
// ── _launchGame mới — tự động gọi AI nếu thiếu câu ──────────
async function _launchGame() {
  var allQ = QUIZ_QUESTIONS[QUIZ.topic] || [];
  var target = SELECTED_Q_COUNT;
  var startBtn = document.getElementById("qmode-start-btn");

  // Xáo trộn câu gốc
  var shuffled = allQ.slice().sort(function () {
    return Math.random() - 0.5;
  });
  var finalQuestions = shuffled.slice(); // lấy HẾT câu gốc trước

  // Nếu số câu gốc < target → gọi AI tạo thêm
  if (allQ.length < target) {
    var needed = target - allQ.length;

    // Update UI
    if (startBtn) {
      startBtn.innerHTML =
        "<span>⏳</span>" +
        "<span>AI đang tạo thêm " +
        needed +
        " câu...</span>" +
        '<span style="margin-left:auto;font-size:.75rem;opacity:.6">Vài giây</span>';
      startBtn.disabled = true;
    }
    showToast("🧠 AI đang tạo thêm " + needed + " câu hỏi mới...");

    var aiQs = await _generateAIQuestions(QUIZ.topic, needed + 2); // +2 buffer

    if (aiQs.length > 0) {
      var aiShuffled = aiQs.sort(function () {
        return Math.random() - 0.5;
      });
      finalQuestions = finalQuestions.concat(aiShuffled);
      showToast(
        "✅ Đã có đủ " + Math.min(finalQuestions.length, target) + " câu hỏi!",
      );
    } else {
      showToast(
        "⚠ AI không tạo được câu, chơi với " + allQ.length + " câu gốc",
      );
    }

    if (startBtn) startBtn.disabled = false;
  }

  // Cắt đúng số câu cần
  finalQuestions = finalQuestions
    .sort(function () {
      return Math.random() - 0.5;
    })
    .slice(0, target);

  QUIZ.questions = finalQuestions;
  QUIZ.qIdx = 0;
  QUIZ.score = 0;
  QUIZ.combo = 0;
  QUIZ.maxCombo = 0;
  QUIZ.lives = CURRENT_MODE === "speed" ? 2 : 3;
  QUIZ.totalQ = QUIZ.questions.length;
  QUIZ.correctQ = 0;
  QUIZ.sessionXP = 0;
  QUIZ.activeShield = false;
  QUIZ.gameMode = CURRENT_MODE;
  PLAYER_POS = 0;
  WRONG_STREAK = 0;
  _updateStreak();
  _renderQuestion();
}
// Cũng fix _selectMode để reset SELECTED_Q_COUNT khi đổi mode
function _selectMode(modeId) {
  CURRENT_MODE = modeId;
  SELECTED_Q_COUNT = GAME_MODES[modeId].questionCount;
  var keys = ["climb", "speed", "training"];
  for (var i = 0; i < keys.length; i++) {
    var card = document.getElementById("qmode-" + keys[i]);
    if (!card) continue;
    var isThis = keys[i] === modeId;
    card.classList.toggle("selected", isThis);
    card.querySelector(".qmode-check").textContent = isThis ? "✓" : "";
  }
  // Reset count buttons
  var m = GAME_MODES[modeId];
  document.querySelectorAll(".qcount-btn").forEach(function (b) {
    b.classList.toggle("active", parseInt(b.textContent) === m.questionCount);
  });
  // Update start btn
  var icon = document.getElementById("qmode-start-icon");
  var label = document.getElementById("qmode-start-label");
  var last = document.querySelector("#qmode-start-btn span:last-child");
  if (icon) icon.textContent = m.icon;
  if (label) label.textContent = "Bắt đầu " + m.label;
  if (last) last.textContent = m.questionCount + " câu →";
  _updateModePreview();
}

// ── Launch game with selected mode ────────────────────────────

// ── Override _startTimer for speed mode ──────────────────────
var _origStartTimer = typeof _startTimer === "function" ? _startTimer : null;

function _startTimer() {
  var timerSec =
    QUIZ.gameMode === "speed" ? 12 : QUIZ.gameMode === "training" ? 999 : 20;
  QUIZ.timer = timerSec;

  var bar = document.getElementById("qg-timer-bar");
  var txt = document.getElementById("qg-timer-txt");
  var wrap = document.querySelector(".qg-timer-wrap");

  if (bar) {
    bar.style.width = "100%";
    // Reset trạng thái ban đầu
    wrap.classList.remove("timer-critical");
    if (QUIZ.gameMode === "speed") {
      wrap.classList.add("speed-mode-active");
    } else {
      wrap.classList.remove("speed-mode-active");
    }
  }

  if (txt) txt.textContent = timerSec >= 999 ? "∞" : timerSec;

  clearInterval(QUIZ.timerInt);
  if (timerSec >= 999) return;

  QUIZ.timerInt = setInterval(function () {
    QUIZ.timer--;
    var maxT = QUIZ.gameMode === "speed" ? 12 : 20;
    var pct = ((QUIZ.timer / maxT) * 100).toFixed(1);

    if (bar) {
      bar.style.width = pct + "%";

      // Hiệu ứng đổi màu và rung khi thời gian dưới 30% (hoặc dưới 2s cho speed run)
      if (pct < 30) {
        wrap.classList.add("timer-critical");
      }
    }

    if (txt) txt.textContent = QUIZ.timer;

    if (QUIZ.timer <= 0) {
      clearInterval(QUIZ.timerInt);
      _onTimeout();
    }
  }, 1000);
}
// ── Override _showFeedback for training mode ──────────────────
function _showFeedback(title, sub, isCorrect) {
  var fb = document.getElementById("qg-feedback");
  if (!fb) return;
  fb.className = "qg-feedback " + (isCorrect ? "correct" : "wrong");

  if (QUIZ.gameMode === "training") {
    // Training: show full explanation + next button
    fb.innerHTML =
      '<div class="qgf-title">' +
      title +
      "</div>" +
      '<div class="qgf-sub" style="margin-bottom:10px">' +
      sub +
      "</div>" +
      '<div class="training-explanation">' +
      '<div style="font-size:.65rem;text-transform:uppercase;letter-spacing:2px;color:var(--text-muted);margin-bottom:6px">📖 Giải thích</div>' +
      '<div style="font-size:.82rem;color:var(--text-primary);line-height:1.6">' +
      (QUIZ.questions[QUIZ.qIdx]
        ? QUIZ.questions[QUIZ.qIdx].explanation
        : sub) +
      "</div></div>" +
      '<button class="training-next-btn" onclick="QUIZ.qIdx++;_renderQuestion()">Câu tiếp theo →</button>';
  } else {
    fb.innerHTML =
      '<div class="qgf-title">' +
      title +
      "</div>" +
      '<div class="qgf-sub">' +
      sub +
      "</div>";
  }
}

// ── Progress bar also shows mode badge in header ──────────────
// Override _renderQuestion to inject mode badge
var _origRenderQ =
  typeof _renderQuestion === "function" ? _renderQuestion : null;
// (The full _renderQuestion from quiz_game_enhanced.js will call _startTimer
//  which now respects QUIZ.gameMode — no need to fully override)

// ── Items ─────────────────────────────────────────────────────
function _useItem(type) {
  if (QUIZ.itemUsed) {
    showToast("⚠ Mỗi câu chỉ dùng 1 vật phẩm!");
    return;
  }
  if (!QUIZ.items[type] || QUIZ.items[type] <= 0) {
    showToast("❌ Hết vật phẩm này rồi!");
    return;
  }
  QUIZ.items[type]--;
  QUIZ.itemUsed = true;
  var q = QUIZ.questions[QUIZ.qIdx];
  if (type === "shield") {
    QUIZ.activeShield = true;
    showToast("🛡 Shield kích hoạt! Lần sai tiếp theo được bảo vệ.");
  } else if (type === "freeze") {
    clearInterval(QUIZ.timerInt);
    QUIZ.timer = Math.min(QUIZ.timer + 8, 20);
    var bar = document.getElementById("qg-timer-bar");
    var txt = document.getElementById("qg-timer-txt");
    if (bar) bar.style.width = (QUIZ.timer / 20) * 100 + "%";
    if (txt) txt.textContent = QUIZ.timer;
    showToast("⏸ +8 giây! Thở đi đã!");
    _startTimer();
  } else if (type === "fifty") {
    var opts = document.querySelectorAll(".qg-option");
    var wrongIdxs = [];
    opts.forEach(function (b, i) {
      if (i !== q.correct) wrongIdxs.push(i);
    });
    wrongIdxs
      .sort(function () {
        return Math.random() - 0.5;
      })
      .slice(0, 2)
      .forEach(function (i) {
        opts[i].style.opacity = "0.18";
        opts[i].onclick = null;
      });
    showToast("💡 2 đáp án sai đã bị loại!");
  }
  _saveQuiz();
}
function _endGame() {
  clearInterval(QUIZ.timerInt);
  QUIZ.gameState = "done";
  // XP
  const oldXP = QUIZ.xp;
  QUIZ.xp += QUIZ.sessionXP;
  const oldRank = _getRank(oldXP);
  const newRank = _getRank(QUIZ.xp);
  const rankedUp = newRank.lv > oldRank.lv;
  // Best score
  if (
    !QUIZ.bestScores[QUIZ.topic] ||
    QUIZ.score > QUIZ.bestScores[QUIZ.topic]
  ) {
    QUIZ.bestScores[QUIZ.topic] = QUIZ.score;
  }
  _saveQuiz();
  _renderSurvivalHub();
  // Grade
  const pct =
    QUIZ.totalQ > 0 ? Math.round((QUIZ.correctQ / QUIZ.totalQ) * 100) : 0;
  const grade = _getGrade(pct);
  const topicMeta = {
    bao: "🌀 Bão",
    lu: "🌊 Lũ lụt",
    set: "⚡ Sét",
    dongdat: "🌍 Động đất",
    nangnong: "🔥 Nắng nóng",
    mualon: "🌧 Mưa lớn",
  };
  _showQScreen("result");
  const rs = document.getElementById("qscreen-result");
  if (!rs) return;
  rs.innerHTML = `
    <div class="qr-wrap">
      <div class="qr-topic">${topicMeta[QUIZ.topic] || QUIZ.topic}</div>
      ${rankedUp ? `<div class="qr-rankup">🎉 RANK UP! ${newRank.title}</div>` : ""}
      <div class="qr-grade-big" style="color:${grade.color}">${grade.g}</div>
      <div class="qr-grade-label" style="color:${grade.color}">${grade.label}</div>
      <div class="qr-stats-grid">
        <div class="qr-stat"><span class="qr-stat-val">${QUIZ.score}</span><span class="qr-stat-lbl">Điểm</span></div>
        <div class="qr-stat"><span class="qr-stat-val">${QUIZ.correctQ}/${QUIZ.totalQ}</span><span class="qr-stat-lbl">Đúng</span></div>
        <div class="qr-stat"><span class="qr-stat-val">+${QUIZ.sessionXP}</span><span class="qr-stat-lbl">XP nhận</span></div>
        <div class="qr-stat"><span class="qr-stat-val">x${QUIZ.maxCombo}</span><span class="qr-stat-lbl">Max combo</span></div>
      </div>
      <div class="qr-best ${QUIZ.score >= (QUIZ.bestScores[QUIZ.topic] || 0) ? "new-best" : ""}">
        ${QUIZ.score >= (QUIZ.bestScores[QUIZ.topic] || 0) ? "🏆 Kỷ lục mới!" : `Best: ${QUIZ.bestScores[QUIZ.topic]} pts`}
      </div>
      <div class="qr-actions">
        <button class="qr-btn primary" onclick="startTopic('${QUIZ.topic}')">🔄 Chơi lại</button>
        <button class="qr-btn secondary" onclick="_generateShareCard()">📸 Chia sẻ</button>
        <button class="qr-btn ghost" onclick="_showQScreen(\'hub\');_renderQHub();">🏠 Về hub</button>
      </div>
      <div class="qr-leaderboard-prev" id="qr-lb-prev">
        <div style="color:var(--text-muted);font-size:.78rem">⏳ Đang tải bảng xếp hạng bạn bè...</div>
      </div>
    </div>
  `;
  _playBeep(QUIZ.lives > 0);
  _loadFriendScores();
}

// ── Friend Leaderboard ────────────────────────────────────────
async function _loadFriendScores() {
  const el = document.getElementById("qr-lb-prev");
  if (!el || !FB?.friends?.length) {
    if (el) el.innerHTML = "";
    return;
  }
  const entries = [
    {
      name: "Tôi",
      score: QUIZ.score,
      emoji: FB.profile?.emoji || "😊",
      isMe: true,
    },
  ];
  FB.friends.forEach((f) => {
    const n = f._dir === "in" ? f.fromName : f.toName;
    const e = f._dir === "in" ? f.fromEmoji : f.toEmoji;
    const uid = f._dir === "in" ? f.fromUid : f.toUid;
    entries.push({
      name: n || "Bạn bè",
      score: Math.floor(Math.random() * 150),
      emoji: e,
      uid,
      isMe: false,
    });
  });
  entries.sort((a, b) => b.score - a.score);
  el.innerHTML = `
    <div style="font-size:.72rem;text-transform:uppercase;letter-spacing:1.5px;color:var(--text-muted);margin-bottom:8px;">🏆 Bảng bạn bè</div>
    ${entries
      .slice(0, 5)
      .map(
        (e, i) => `
      <div class="qr-lb-row ${e.isMe ? "is-me" : ""}">
        <span class="qr-lb-rank">${["🥇", "🥈", "🥉", "4", "5"][i] || i + 1}</span>
        <span>${e.emoji}</span>
        <span class="qr-lb-name">${e.name}${e.isMe ? " (Tôi)" : ""}</span>
        <span class="qr-lb-score">${e.score} pts</span>
      </div>`,
      )
      .join("")}
  `;
}

// ── Share Card ────────────────────────────────────────────────
function _generateShareCard() {
  const modal = document.getElementById("share-card-modal");
  if (!modal) {
    _fallbackShare();
    return;
  }
  const canvas = document.getElementById("share-canvas");
  if (!canvas) {
    _fallbackShare();
    return;
  }
  const ctx = canvas.getContext("2d");
  canvas.width = 800;
  canvas.height = 450;
  // BG
  const grd = ctx.createLinearGradient(0, 0, 800, 450);
  grd.addColorStop(0, "#050d1a");
  grd.addColorStop(1, "#0b1628");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 800, 450);
  // Accent line
  ctx.fillStyle = "#00d4ff";
  ctx.fillRect(0, 0, 800, 4);
  // Logo
  ctx.fillStyle = "#00d4ff";
  ctx.font = "bold 20px Arial";
  ctx.fillText("🛡 SafeWeather", 30, 50);
  // Topic
  const topicMeta = {
    bao: "🌀 Bão",
    lu: "🌊 Lũ lụt",
    set: "⚡ Sét",
    dongdat: "🌍 Động đất",
    nangnong: "🔥 Nắng nóng",
    mualon: "🌧 Mưa lớn",
  };
  ctx.fillStyle = "#7a9cc0";
  ctx.font = "18px Arial";
  ctx.fillText(topicMeta[QUIZ.topic] || QUIZ.topic, 30, 90);
  // Grade
  const pct =
    QUIZ.totalQ > 0 ? Math.round((QUIZ.correctQ / QUIZ.totalQ) * 100) : 0;
  const grade = _getGrade(pct);
  ctx.fillStyle = grade.color;
  ctx.font = "bold 120px Arial";
  ctx.fillText(grade.g, 60, 250);
  // Score
  ctx.fillStyle = "#e8f4ff";
  ctx.font = "bold 60px Arial";
  ctx.fillText(QUIZ.score + " pts", 240, 200);
  ctx.fillStyle = "#7a9cc0";
  ctx.font = "24px Arial";
  ctx.fillText(
    QUIZ.correctQ + "/" + QUIZ.totalQ + " đúng · Combo x" + QUIZ.maxCombo,
    240,
    240,
  );
  // Rank
  const rank = _getRank(QUIZ.xp);
  ctx.fillStyle = rank.color;
  ctx.font = "bold 22px Arial";
  ctx.fillText(rank.title, 240, 290);
  // CTA
  ctx.fillStyle = "rgba(0,212,255,0.15)";
  ctx.roundRect(30, 340, 740, 80, 12);
  ctx.fill();
  ctx.fillStyle = "#00d4ff";
  ctx.font = "bold 22px Arial";
  ctx.textAlign = "center";
  ctx.fillText("Bạn có làm tốt hơn không? 🔥 Thử ngay SafeWeather!", 400, 390);
  ctx.textAlign = "left";
  modal.classList.remove("hidden");
}
function _fallbackShare() {
  const topicMeta = {
    bao: "Bão",
    lu: "Lũ lụt",
    set: "Sét",
    dongdat: "Động đất",
    nangnong: "Nắng nóng",
    mualon: "Mưa lớn",
  };
  const txt = `🛡 SafeWeather Quiz\n🏔 ${topicMeta[QUIZ.topic] || QUIZ.topic}\n💯 ${QUIZ.score} pts · ${QUIZ.correctQ}/${QUIZ.totalQ} đúng\n🔥 Combo x${QUIZ.maxCombo}\n🏅 ${_getRank(QUIZ.xp).title}\nBạn thử xem sao nhé!`;
  if (navigator.share) {
    navigator.share({ title: "SafeWeather Quiz", text: txt }).catch(() => {});
  } else {
    navigator.clipboard
      .writeText(txt)
      .then(() => showToast("✅ Đã copy kết quả để chia sẻ!"));
  }
}
function closeShareModal() {
  document.getElementById("share-card-modal")?.classList.add("hidden");
}
function downloadShareCard() {
  const canvas = document.getElementById("share-canvas");
  if (!canvas) return;
  const a = document.createElement("a");
  a.download = "safeweather-quiz.png";
  a.href = canvas.toDataURL("image/png");
  a.click();
}

// ── Sound ─────────────────────────────────────────────────────
function _playBeep(correct) {
  try {
    const ctx2 = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx2.createOscillator();
    const gain = ctx2.createGain();
    osc.connect(gain);
    gain.connect(ctx2.destination);
    if (correct) {
      osc.frequency.setValueAtTime(800, ctx2.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1200, ctx2.currentTime + 0.15);
    } else {
      osc.frequency.setValueAtTime(400, ctx2.currentTime);
      osc.frequency.exponentialRampToValueAtTime(200, ctx2.currentTime + 0.3);
    }
    gain.gain.setValueAtTime(0.18, ctx2.currentTime);
    gain.gain.exponentialRampToValueAtTime(
      0.001,
      ctx2.currentTime + (correct ? 0.2 : 0.35),
    );
    osc.start(ctx2.currentTime);
    osc.stop(ctx2.currentTime + (correct ? 0.25 : 0.4));
  } catch (e) {}
}

// ── Leaderboard Screen ────────────────────────────────────────
function showQuizLeaderboard() {
  _showQScreen("lb");
  const lb = document.getElementById("qscreen-lb");
  if (!lb) return;
  const rank = _getRank(QUIZ.xp);
  const allScores = Object.entries(QUIZ.bestScores).map(([t, s]) => ({
    topic: t,
    score: s,
  }));
  allScores.sort((a, b) => b.score - a.score);
  lb.innerHTML = `
    <div class="qlb-header">
      <button class="qg-close" onclick="_showQScreen('hub');_renderQHub();">‹ Về</button>
      <span>🏆 Bảng xếp hạng</span>
      <div></div>
    </div>
    <div class="qlb-myrank" style="background:${rank.bg};border-color:${rank.color}40">
      <span class="qlb-rank-skin">${rank.skin}</span>
      <div><div style="font-weight:700;color:${rank.color}">${rank.title}</div>
      <div style="font-size:.78rem;color:var(--text-muted)">${QUIZ.xp} XP · Streak ${QUIZ.streak} ngày</div></div>
    </div>
    <div style="padding:0 16px 8px;font-size:.7rem;text-transform:uppercase;letter-spacing:1.5px;color:var(--text-muted)">Điểm cao nhất của bạn</div>
    ${
      allScores.length
        ? allScores
            .map((e, i) => {
              const tm = {
                bao: "🌀 Bão",
                lu: "🌊 Lũ",
                set: "⚡ Sét",
                dongdat: "🌍 Động đất",
                nangnong: "🔥 Nắng",
                mualon: "🌧 Mưa",
              };
              return `<div class="qlb-row">
        <span class="qlb-pos">${["🥇", "🥈", "🥉"][i] || i + 1}</span>
        <span>${tm[e.topic] || e.topic}</span>
        <span class="qlb-score">${e.score} pts</span>
      </div>`;
            })
            .join("")
        : '<div style="text-align:center;padding:30px;color:var(--text-muted)">Chưa có điểm nào!<br>Bắt đầu chơi để ghi điểm 🎮</div>'
    }
    <div style="padding:0 16px;margin-top:16px;font-size:.7rem;text-transform:uppercase;letter-spacing:1.5px;color:var(--text-muted)">Bạn bè</div>
    ${
      FB?.friends?.length
        ? FB.friends
            .slice(0, 5)
            .map((f) => {
              const n = f._dir === "in" ? f.fromName : f.toName;
              const e = f._dir === "in" ? f.fromEmoji : f.toEmoji;
              return `<div class="qlb-row"><span>${e}</span><span>${n || "Bạn bè"}</span><span class="qlb-score" style="color:var(--text-muted)">--</span></div>`;
            })
            .join("")
        : '<div style="padding:12px 16px;color:var(--text-muted);font-size:.82rem">Kết bạn để thi đua!</div>'
    }
  `;
}

// ================================================================
// MEME MANAGER — Thêm ảnh meme theo chủ đề, tự động hiện khi đúng/sai
// Thêm vào main.js TRƯỚC Object.assign(window,{...})
// ================================================================

// ── Meme Storage ──────────────────────────────────────────────
var MEME_DB = {
  bao: { correct: [], wrong: [] },
  lu: { correct: [], wrong: [] },
  set: { correct: [], wrong: [] },
  dongdat: { correct: [], wrong: [] },
  nangnong: { correct: [], wrong: [] },
  mualon: { correct: [], wrong: [] },
};
window.MEME_DB = MEME_DB; // ← THÊM DÒNG NÀY

function _saveMemes() {
  var db = window.MEME_DB || MEME_DB;
  localStorage.setItem("sw_memes_v1", JSON.stringify(db));
}
function _loadMemes() {
  try {
    var raw = localStorage.getItem("sw_memes_v1");
    if (raw) {
      var saved = JSON.parse(raw);
      Object.keys(MEME_DB).forEach(function (t) {
        if (saved[t]) MEME_DB[t] = saved[t];
      });
      window.MEME_DB = MEME_DB;
    }
  } catch (e) {}
}

// ── Hiện meme popup ───────────────────────────────────────────
function _showMemePopup(isCorrect) {
  var topic = QUIZ.topic;
  var db = window.MEME_DB || MEME_DB;
  if (!topic || !db[topic]) return;
  var pool = isCorrect ? db[topic].correct : db[topic].wrong;
  if (!pool || pool.length === 0) return;

  // Chọn ngẫu nhiên
  var url = pool[Math.floor(Math.random() * pool.length)];
  if (!url) return;

  // Xóa popup cũ
  var old = document.getElementById("meme-popup-overlay");
  if (old) old.remove();

  var overlay = document.createElement("div");
  overlay.id = "meme-popup-overlay";
  overlay.style.cssText = [
    "position:fixed",
    "inset:0",
    "z-index:9999",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "background:rgba(0,0,0,.55)",
    "animation:meme-fadein .2s ease",
    "cursor:pointer",
  ].join(";");
  overlay.onclick = function () {
    overlay.remove();
  };

  var label = isCorrect
    ? '<div style="color:#00e676;font-size:1.1rem;font-weight:700;margin-bottom:8px;text-shadow:0 0 12px #00e676">✅ ĐÚNG RỒI!</div>'
    : '<div style="color:#ff3d3d;font-size:1.1rem;font-weight:700;margin-bottom:8px;text-shadow:0 0 12px #ff3d3d">❌ SAI MẤT RỒI!</div>';

  overlay.innerHTML =
    '<div style="background:#0b1628;border:2px solid ' +
    (isCorrect ? "#00e676" : "#ff3d3d") +
    ';border-radius:16px;padding:16px;max-width:340px;width:90%;text-align:center;animation:meme-popin .3s cubic-bezier(.34,1.56,.64,1)">' +
    label +
    '<img src="' +
    url +
    '" style="width:100%;max-height:260px;object-fit:contain;border-radius:8px;display:block" onerror="this.style.display=\'none\'">' +
    '<div style="color:#3d5a7a;font-size:.7rem;margin-top:8px">Bấm để đóng</div>' +
    "</div>";

  document.body.appendChild(overlay);

  // Tự đóng sau 2.5s
  setTimeout(function () {
    if (document.getElementById("meme-popup-overlay")) overlay.remove();
  }, 2500);
}

// ── CSS cho meme ──────────────────────────────────────────────
function _injectMemeCSS() {
  if (document.getElementById("meme-style")) return;
  var style = document.createElement("style");
  style.id = "meme-style";
  style.textContent = [
    "@keyframes meme-fadein{from{opacity:0}to{opacity:1}}",
    "@keyframes meme-popin{from{transform:scale(.6);opacity:0}to{transform:scale(1);opacity:1}}",
    ".meme-mgr-wrap{padding:16px;max-height:80vh;overflow-y:auto}",
    ".meme-mgr-topic-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}",
    ".meme-mgr-tab{padding:5px 12px;border-radius:20px;border:1px solid #1a2f50;background:transparent;color:#7a9cc0;cursor:pointer;font-size:.78rem;font-family:'Exo 2',sans-serif}",
    ".meme-mgr-tab.active{background:rgba(0,212,255,.15);border-color:#00d4ff;color:#00d4ff}",
    ".meme-mgr-section{margin-bottom:16px}",
    ".meme-mgr-section-title{font-size:.72rem;text-transform:uppercase;letter-spacing:1.5px;color:#7a9cc0;margin-bottom:8px}",
    ".meme-mgr-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px}",
    ".meme-mgr-item{position:relative;border-radius:8px;overflow:hidden;border:1px solid #1a2f50;aspect-ratio:1}",
    ".meme-mgr-item img{width:100%;height:100%;object-fit:cover}",
    ".meme-mgr-del{position:absolute;top:3px;right:3px;background:rgba(255,61,61,.85);color:#fff;border:none;border-radius:50%;width:20px;height:20px;cursor:pointer;font-size:.7rem;display:flex;align-items:center;justify-content:center;line-height:1}",
    ".meme-mgr-add-row{display:flex;gap:6px;margin-bottom:6px}",
    ".meme-mgr-input{flex:1;background:#0b1628;border:1px solid #1a2f50;border-radius:6px;color:#e8f4ff;padding:6px 10px;font-size:.78rem;font-family:'Exo 2',sans-serif}",
    ".meme-mgr-input:focus{outline:none;border-color:#00d4ff}",
    ".meme-mgr-btn{padding:6px 12px;border-radius:6px;border:none;cursor:pointer;font-size:.78rem;font-family:'Exo 2',sans-serif;white-space:nowrap}",
    ".meme-mgr-btn.add{background:#00d4ff;color:#000;font-weight:700}",
    ".meme-mgr-btn.upload{background:#1a2f50;color:#00d4ff;border:1px solid #00d4ff}",
    ".meme-mgr-empty{color:#3d5a7a;font-size:.78rem;text-align:center;padding:12px;border:1px dashed #1a2f50;border-radius:8px}",
    ".meme-modal-overlay{position:fixed;inset:0;z-index:5000;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center}",
    ".meme-modal-box{background:#0b1628;border:1px solid #1a2f50;border-radius:16px;width:90%;max-width:440px;max-height:90vh;overflow-y:auto}",
  ].join("");
  document.head.appendChild(style);
}

// ── Meme Manager Modal ────────────────────────────────────────
var _memeMgrTopic = "bao";
var _memeMgrType = "correct";
window._memeMgrTopic = _memeMgrTopic;
window._memeMgrType = _memeMgrType;

function openMemeManager() {
  _injectMemeCSS();
  var old = document.getElementById("meme-mgr-modal");
  if (old) old.remove();

  var modal = document.createElement("div");
  modal.id = "meme-mgr-modal";
  modal.className = "meme-modal-overlay";
  modal.innerHTML =
    '<div class="meme-modal-box">' +
    '<div style="padding:14px 16px;border-bottom:1px solid #1a2f50;display:flex;align-items:center;justify-content:space-between">' +
    '<div style="font-size:.9rem;font-weight:700;color:#00d4ff">🎭 Quản lý Meme</div>' +
    '<button onclick="document.getElementById(\'meme-mgr-modal\').remove()" style="background:transparent;border:none;color:#7a9cc0;cursor:pointer;font-size:1.1rem">✕</button>' +
    "</div>" +
    '<div class="meme-mgr-wrap" id="meme-mgr-body"></div>' +
    "</div>";
  document.body.appendChild(modal);
  _renderMemeManager();
}

function _renderMemeManager() {
  var body = document.getElementById("meme-mgr-body");
  if (!body) return;

  var topicMeta = {
    bao: "🌀 Bão",
    lu: "🌊 Lũ",
    set: "⚡ Sét",
    dongdat: "🌍 Động đất",
    nangnong: "🔥 Nắng",
    mualon: "🌧 Mưa",
  };

  // Tabs chủ đề
  var tabsHTML = "";
  Object.keys(topicMeta).forEach(function (t) {
    tabsHTML +=
      '<button class="meme-mgr-tab' +
      (t === window._memeMgrTopic ? " active" : "") +
      '" onclick="window._memeMgrTopic=\'' +
      t +
      "';_renderMemeManager()\">" +
      topicMeta[t] +
      "</button>";
  });

  // Type toggle
  var typeHTML =
    '<div style="display:flex;gap:6px;margin-bottom:14px">' +
    '<button class="meme-mgr-tab' +
    (window._memeMgrType === "correct" ? " active" : "") +
    '" onclick="window._memeMgrType=\'correct\';_renderMemeManager()">✅ Khi đúng</button>' +
    '<button class="meme-mgr-tab' +
    (window._memeMgrType === "wrong" ? " active" : "") +
    '" onclick="window._memeMgrType=\'wrong\';_renderMemeManager()">❌ Khi sai</button>' +
    "</div>";
  // Meme grid
  var pool = MEME_DB[window._memeMgrTopic][window._memeMgrType] || [];
  var gridHTML = "";
  if (pool.length === 0) {
    gridHTML =
      '<div class="meme-mgr-empty">Chưa có meme nào<br>Thêm link hoặc upload ảnh bên dưới</div>';
  } else {
    gridHTML = '<div class="meme-mgr-grid">';
    pool.forEach(function (url, idx) {
      gridHTML +=
        '<div class="meme-mgr-item">' +
        '<img src="' +
        url +
        '" onerror="this.src=\'\';">' +
        '<button class="meme-mgr-del" onclick="_deleteMeme(' +
        idx +
        ')">✕</button>' +
        "</div>";
    });
    gridHTML += "</div>";
  }

  // Add URL row
  var addHTML =
    '<div class="meme-mgr-section">' +
    '<div class="meme-mgr-section-title">Thêm từ URL</div>' +
    '<div class="meme-mgr-add-row">' +
    '<input class="meme-mgr-input" id="meme-url-input" placeholder="https://... (link ảnh)" type="text" onkeydown="if(event.key===\'Enter\')_addMemeUrl()">' +
    '<button class="meme-mgr-btn add" onclick="_addMemeUrl()">+ Thêm</button>' +
    "</div>" +
    '<div class="meme-mgr-section-title" style="margin-top:10px">Upload từ máy</div>' +
    '<input type="file" id="meme-file-input" accept="image/*" multiple style="display:none" onchange="_handleMemeUpload(this)">' +
    '<button class="meme-mgr-btn upload" onclick="document.getElementById(\'meme-file-input\').click()">📁 Chọn ảnh từ máy</button>' +
    '<div style="font-size:.68rem;color:#3d5a7a;margin-top:6px">Ảnh upload sẽ lưu dưới dạng base64 trong localStorage</div>' +
    "</div>";

  body.innerHTML =
    '<div class="meme-mgr-topic-tabs">' +
    tabsHTML +
    "</div>" +
    typeHTML +
    '<div class="meme-mgr-section">' +
    '<div class="meme-mgr-section-title">' +
    topicMeta[window._memeMgrTopic] +
    " · " +
    (window._memeMgrType === "correct" ? "Khi đúng" : "Khi sai") +
    " (" +
    pool.length +
    " meme)</div>" +
    gridHTML +
    "</div>" +
    addHTML;
}

function _addMemeUrl() {
  var input = document.getElementById("meme-url-input");
  var url = input ? input.value.trim() : "";
  if (!url) {
    showToast("⚠ Nhập URL ảnh trước!");
    return;
  }
  if (!url.match(/^https?:\/\//)) {
    showToast("❌ URL phải bắt đầu bằng https://");
    return;
  }
  MEME_DB[window._memeMgrTopic][window._memeMgrType].push(url);
  _saveMemes();
  if (input) input.value = "";
  showToast("✅ Đã thêm meme!");
  _renderMemeManager();
}

function _deleteMeme(idx) {
  MEME_DB[window._memeMgrTopic][window._memeMgrType].splice(idx, 1);
  _saveMemes();
  _renderMemeManager();
}

function _handleMemeUpload(input) {
  var files = Array.from(input.files);
  if (!files.length) return;
  var count = 0;
  files.forEach(function (file) {
    if (!file.type.startsWith("image/")) return;
    var reader = new FileReader();
    reader.onload = function (e) {
      MEME_DB[_memeMgrTopic][_memeMgrType].push(e.target.result);
      count++;
      if (count === files.length) {
        _saveMemes();
        showToast("✅ Đã upload " + count + " ảnh!");
        _renderMemeManager();
      }
    };
    reader.readAsDataURL(file);
  });
  input.value = "";
}
// ── Init ──────────────────────────────────────────────────────
function initQuiz() {
  _loadQuiz();
}

// ── Expose to window ──────────────────────────────────────────
window.startQuizGame = startQuizGame;
window.closeQuizModal = closeQuizModal;
window.startTopic = startTopic;
window.showQuizLeaderboard = showQuizLeaderboard;
window.closeShareModal = closeShareModal;
window.downloadShareCard = downloadShareCard;
window._selectAnswer = _selectAnswer;
window._useItem = _useItem;
window._generateShareCard = _generateShareCard;
window._showQScreen = _showQScreen;
window._renderQHub = _renderQHub;
window._renderSurvivalHub = _renderSurvivalHub;

// ============================================================
// EXPOSE TẤT CẢ FUNCTIONS RA WINDOW — phải trước init()
// ============================================================
Object.assign(window, {
  _startTopicWithRipple,
  _renderSurvivalHub,
  _renderQHub,
  SELECTED_Q_COUNT,
  showQuizLeaderboard,
  closeShareModal,
  downloadShareCard,
  switchTab,
  fetchWeather,
  updateMyStatus,
  quickSurvival,
  locateMe,
  switchWindyLayer,
  closeWindyDetail,
  switchChartType,
  openMemeManager,
  _showMemePopup,
  _loadMemes,
  _saveMemes,
  _deleteMeme,
  _addMemeUrl,
  _handleMemeUpload,
  _renderMemeManager,
  centerMap,
  changeBaseLayer,
  setActiveLayerBtn,
  toggleWeatherLayer,
  showSurvivalGuide,
  closeSurvivalModal,
  openSurvivalFromAlert,
  fbSendRequest,
  fbEditName,
  copyMyId,
  startSharing,
  stopSharing,
  closeEmergency,
  toggleChatWindow,
  openChat,
  showChatList,
  chatGoMap,
  switchChatTab,
  showCreateGroup,
  toggleGrpEmoji,
  setGrpEmoji,
  toggleFriendSelect,
  createGroup,
  openGroupChat,
  showGroupMembers,
  showGroupChat,
  inviteToGroup,
  kickMember,
  leaveGroup,
  showRenameGroup,
  cancelRenameGroup,
  toggleRenameEmoji,
  setRenameEmoji,
  submitRenameGroup,
  chatSend,
  chatInputChange,
  toggleChatEmoji,
  chatEmoji,
  showMsgMenu,
  ctxCopy,
  ctxForward,
  ctxDelete,
  _acceptRequest,
  _rejectRequest,
  _cancelRequest,
  _removeFriend,
  _viewOnMap,
  runGroqAnalysis,
  startTopic, // ← THÊM
  _selectMode, // ← THÊM
  _setQCount, // ← THÊM
  _initHubCanvas, // <-- THÊM DÒNG NÀY
  _generateAIQuestions, // <-- THÊM DÒNG NÀY
  _launchGame,
});

// Chạy sau khi expose xong
document.addEventListener("DOMContentLoaded", init);
