// scripts/admin.js
function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return decodeURIComponent(parts.pop().split(';').shift().trim());
  return null;
}

function getAdminSession(key) {
  let val = getCookie(key);
  if (val) return val;
  try {
    const stored = localStorage.getItem('avtotest_' + key);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.expiresAt > Date.now()) {
        val = parsed.value;
        const expiresMs = 60 * 24 * 60 * 60 * 1000;
        document.cookie = key + '=' + encodeURIComponent(val) + '; Path=/; Expires=' + new Date(Date.now() + expiresMs).toUTCString() + '; SameSite=Lax';
        return val;
      }
      localStorage.removeItem('avtotest_' + key);
    }
  } catch (e) {}
  return null;
}

function deleteCookie(name) {
  document.cookie = name + '=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT';
  if (name === 'isAdmin') try { localStorage.removeItem('avtotest_isAdmin'); } catch (e) {}
  if (name === 'isSuperAdmin') try { localStorage.removeItem('avtotest_isSuperAdmin'); } catch (e) {}
}

// 1. Admin check: superadmin must use /superadmin; regular admin uses /admin
const isAdminSession = getAdminSession('isAdmin') === 'true';
const isSuperAdminSession = getAdminSession('isSuperAdmin') === 'true';
if (!isAdminSession && !isSuperAdminSession) {
  window.location.href = '/login';
} else if (isSuperAdminSession) {
  window.location.href = '/superadmin';
} else {
  // 2. Create new user
  const createUserBtn = document.getElementById('createUser');
  const statusSelect = document.getElementById('statusSelect');

  if (createUserBtn && statusSelect) {
    createUserBtn.addEventListener('click', async () => {
      const email = prompt("Foydalanuvchi emailini kiriting:");
      if (!email) return;

      const password = prompt("Foydalanuvchi parolini kiriting (kamida 6 belgi):");
      if (!password || password.length < 6) {
        alert("Parol kamida 6 belgidan iborat bo'lishi kerak!");
        return;
      }

      // Normalize status values (supports Uzbek labels and internal keys)
      const rawStatus = String(statusSelect.value || '').trim().toLowerCase();
      const statusMap = {
        temporary: 'temporary',
        vaqtinchalik: 'temporary',
        permanent: 'permanent',
        doimiy: 'permanent',
        completed: 'completed',
        tolangan: 'completed',
        "to‘langan": 'completed',
        "to'langan": 'completed',
      };
      const status = statusMap[rawStatus] || rawStatus;
      const validStatuses = ['temporary', 'permanent', 'completed'];

      if (!validStatuses.includes(status)) {
        alert("Faqat 'vaqtinchalik', 'doimiy' yoki 'tolangan' holatini tanlash mumkin!");
        return;
      }

      try {
        // IMPORTANT: creating a user via primary `auth` signs the admin out.
        // Use a secondary Firebase app instance so the admin stays logged in.
        const secondaryAppName = 'AdminCreateUser';
        let secondaryApp;
        try {
          secondaryApp = firebase.app(secondaryAppName);
        } catch (e) {
          // Use the already-initialized app's options (firebaseConfig isn't global here)
          secondaryApp = firebase.initializeApp(firebase.app().options, secondaryAppName);
        }
        const secondaryAuth = secondaryApp.auth();

        const userCredential = await secondaryAuth.createUserWithEmailAndPassword(email, password);

        // Calculate expiration date based on status
        let expiresAtDate;
        if (status === 'permanent' || status === 'completed') {
          expiresAtDate = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
        } else if (status === 'temporary') {
          expiresAtDate = new Date(Date.now() + 30 * 60 * 1000);
        }

        // Use a client timestamp for immediate UI ordering (serverTimestamp resolves later)
        const createdAtClient = firebase.firestore.Timestamp.now();

        await db.collection('users').doc(userCredential.user.uid).set({
          email,
          password,
          status,
          expiresAt: firebase.firestore.Timestamp.fromDate(expiresAtDate),
          createdAt: createdAtClient,
          createdAtServer: firebase.firestore.FieldValue.serverTimestamp(),
          lastUpdated: createdAtClient,
          lastUpdatedServer: firebase.firestore.FieldValue.serverTimestamp(),
          isBlocked: false,
          isLoggedIn: false
        });

        // Clean up secondary auth/app
        try { await secondaryAuth.signOut(); } catch (e) {}

        const message = `Yangi foydalanuvchi qo'shildi!\nEmail: ${email}\nParol: ${password}`;
        await sendTelegramMessage(message);

        alert(`Foydalanuvchi muvaffaqiyatli qo'shildi!`);
        fetchUsers();
      } catch (error) {
        console.error('Create user error:', error);
        alert("Xatolik yuz berdi: " + (error.code ? `${error.code} - ` : '') + error.message);
      }
    });
  }

  // 3. Real-time presence + user list
  var userList = document.getElementById('userList');
  let activeUsersMap = {};
  let realtimeErrorShown = false;
  var presenceUnsubscribe = function () {};

  function isUserOnline(uid) {
    if (window.Presence && typeof window.Presence.isUserOnline === 'function') {
      return window.Presence.isUserOnline(activeUsersMap[uid]);
    }
    var r = activeUsersMap[uid];
    return r && r.online === true;
  }

  function showRealtimeError(msg) {
    var banner = document.getElementById('realtimeDbErrorBanner');
    if (banner) return;
    banner = document.createElement('div');
    banner.id = 'realtimeDbErrorBanner';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#d32f2f;color:#fff;padding:12px 20px;z-index:9999;font-size:14px;text-align:center;';
    banner.textContent = msg;
    document.body.appendChild(banner);
  }

  function onPresenceUpdate(map) {
    realtimeErrorShown = false;
    activeUsersMap = map || {};
    renderLoadedUsers();
  }

  function onPresenceError(err) {
    console.error('Admin presence error', err);
    if (!realtimeErrorShown) {
      realtimeErrorShown = true;
      showRealtimeError('Onlayn ro\'yxat ishlamayapti. Firebase Realtime Database qoidalarini tekshiring: legacy/FIREBASE_RULES_SETUP.md');
    }
  }

  var presenceAttached = false;
  function setupPresenceSubscription() {
    if (presenceAttached) return;
    function attach() {
      if (presenceAttached) return;
      if (window.Presence && typeof window.Presence.subscribeActiveUsers === 'function') {
        presenceUnsubscribe = window.Presence.subscribeActiveUsers(onPresenceUpdate, onPresenceError) || function () {};
        presenceAttached = true;
        return;
      }
      if (!window.realtimeDb) return;
      try {
        presenceAttached = true;
        window.realtimeDb.ref('activeUsers').on('value',
          function (snapshot) {
            onPresenceUpdate(snapshot.val() || {});
          },
          onPresenceError
        );
      } catch (err) {
        presenceAttached = false;
        setTimeout(setupPresenceSubscription, 500);
      }
    }
    attach();
    if (presenceAttached) return;
    window.addEventListener('firebase-realtime-ready', function () {
      if (!presenceAttached) setupPresenceSubscription();
    }, { once: true });
    var attempts = 0;
    var id = setInterval(function () {
      attempts++;
      if (presenceAttached || attempts > 50) {
        clearInterval(id);
        return;
      }
      setupPresenceSubscription();
    }, 300);
  }

  setupPresenceSubscription();

  const PAGE_SIZE = 15;
  let lastDoc = null;
  let loadedUsers = [];
  let hasMorePages = true;

  function renderLoadedUsers() {
    if (!userList) return;
    userList.innerHTML = '';
    const activeHeader = document.createElement('h2');
    activeHeader.textContent = 'Faol Foydalanuvchilar (Onlayn)';
    userList.appendChild(activeHeader);
    const activeUsersList = document.createElement('div');
    activeUsersList.id = 'activeUsersList';
    userList.appendChild(activeUsersList);
    const allUsersHeader = document.createElement('h2');
    allUsersHeader.textContent = 'Oxirgi yaratilgan foydalanuvchilar';
    userList.appendChild(allUsersHeader);
    const allUsersList = document.createElement('div');
    allUsersList.id = 'allUsersList';
    userList.appendChild(allUsersList);
    loadedUsers.forEach(({ doc, user, userId }) => {
      const isActive = isUserOnline(userId);
      renderUser(doc, user, userId, isActive, activeUsersList, allUsersList);
    });
    const loadMoreBtn = document.createElement('button');
    loadMoreBtn.id = 'loadMoreUsers';
    loadMoreBtn.textContent = '+';
    loadMoreBtn.title = 'Yana yuklash';
    loadMoreBtn.style.marginTop = '15px';
    loadMoreBtn.style.fontSize = '20px';
    loadMoreBtn.style.padding = '8px 20px';
    loadMoreBtn.onclick = () => fetchUsers(false);
    loadMoreBtn.style.display = (loadedUsers.length > 0 && hasMorePages) ? 'inline-block' : 'none';
    userList.appendChild(loadMoreBtn);
  }

  function renderUser(doc, user, userId, isActive, activeUsersList, allUsersList) {
    if (user.status === 'forsale') return;
    const createdAt = user.createdAt?.seconds ? new Date(user.createdAt.seconds * 1000).toLocaleString() : 'N/A';
    const expiresAt = user.expiresAt?.seconds ? new Date(user.expiresAt.seconds * 1000).toLocaleString() : 'N/A';
    const userDiv = document.createElement('div');
    userDiv.style.border = isActive ? '2px solid #4caf50' : '1px solid #eee';
    userDiv.innerHTML = `
      <div class="user-details">
        <strong>Email:</strong> ${user.email || 'N/A'} ${isActive ? 'ONLAYN' : 'OFLAN'}<br>
        <strong>Holat:</strong> ${user.status}<br>
        <strong>Yaratilgan:</strong> ${createdAt}<br>
        <strong>Amal qilish:</strong> ${expiresAt}
      </div>
      <div class="user-actions">
        <button onclick="deleteUser('${doc.id}', ${isActive})">
          ${isActive ? 'Sessiyani Yakunlash' : 'O\'chirish'}
        </button>
      </div>
    `;
    if (isActive) activeUsersList.appendChild(userDiv);
    else allUsersList.appendChild(userDiv);
  }

  async function fetchUsers(reset = true) {
    userList = document.getElementById('userList');
    if (!userList || !window.db) return false;
    try {
      if (reset) {
        lastDoc = null;
        loadedUsers = [];
        // Fetch users without orderBy (no index needed), sort by createdAt in memory
        const snapshot = await db.collection('users').limit(200).get();
        const list = [];
        snapshot.forEach(doc => {
          const user = doc.data();
          if (user.status === 'forsale') return;
          list.push({ doc, user, userId: doc.id });
        });
        list.sort((a, b) => {
          const tA = a.user.createdAt?.seconds ?? 0;
          const tB = b.user.createdAt?.seconds ?? 0;
          return tB - tA;
        });
        loadedUsers = list;
        hasMorePages = false;
      }

      renderLoadedUsers();
      return true;
    } catch (error) {
      console.error('Error fetching users:', error);
      return false;
    }
  }

  function runInitialFetch() {
    function tryFetch() {
      userList = document.getElementById('userList');
      if (userList && window.db) {
        fetchUsers();
        return true;
      }
      return false;
    }
    if (tryFetch()) return;
    window.addEventListener('firebase-realtime-ready', tryFetch, { once: true });
    if (window.db) window.addEventListener('load', tryFetch, { once: true });
    var attempts = 0;
    var id = setInterval(function () {
      attempts++;
      if (tryFetch() || attempts > 60) clearInterval(id);
    }, 250);
  }

  runInitialFetch();

  window.deleteUser = async (userId, isActive = false) => {
    if (window.confirm('Ishonchingiz komilmi?')) {
      try {
        if (window.realtimeDb) {
          const logoutSignalRef = window.realtimeDb.ref(`logoutSignals/${userId}`);
          await logoutSignalRef.set({ forceLogout: true, deleted: true, timestamp: Date.now() });
          if (isActive) await window.realtimeDb.ref(`activeUsers/${userId}`).remove();
          setTimeout(() => logoutSignalRef.remove(), 5000);
        }
        await db.collection('users').doc(userId).delete();
        alert('O\'chirildi');
        fetchUsers();
      } catch (error) {
        alert('Xato: ' + error.message);
      }
    }
  };

  const logoutBtn = document.getElementById('logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      if (window.auth) await auth.signOut();
      deleteCookie('isAdmin');
      deleteCookie('isSuperAdmin'); // clear both (user may be superadmin)
      window.location.href = '/login';
    });
  }

  async function sendTelegramMessage(message) {
    try {
      const res = await fetch(`/api/telegram`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: message })
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.warn('Telegram notify failed:', res.status, text);
      }
    } catch (e) { }
  }

}
