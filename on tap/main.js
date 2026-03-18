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
        Authorization: `Bearer ${GROQ_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama3-8b-8192",
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
  initFirebaseSystem(); // Firebase khởi động song song
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
// EXPOSE TẤT CẢ FUNCTIONS RA WINDOW — phải trước init()
// ============================================================
Object.assign(window, {
  switchTab,
  fetchWeather,
  updateMyStatus,
  quickSurvival,
  locateMe,
  switchWindyLayer,
  closeWindyDetail,
  switchChartType,
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
});

// Chạy sau khi expose xong
document.addEventListener("DOMContentLoaded", init);
