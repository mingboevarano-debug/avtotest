// scripts/superadmin.js
function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return decodeURIComponent(parts.pop().split(';').shift().trim());
  return null;
}

function getAdminSession(key) {
  var val = getCookie(key);
  if (val) return val;
  var stored = null;
  try { stored = localStorage.getItem('avtotest_' + key); } catch (e) {}
  if (!stored) {
    try { stored = sessionStorage.getItem('avtotest_' + key); } catch (e) {}
  }
  if (stored) {
    try {
      var parsed = JSON.parse(stored);
      if (parsed.expiresAt > Date.now()) {
        val = parsed.value;
        try { document.cookie = key + '=' + encodeURIComponent(val) + '; Path=/; Expires=' + new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toUTCString(); } catch (e) {}
        return val;
      }
    } catch (e) {}
    try { localStorage.removeItem('avtotest_' + key); } catch (e) {}
    try { sessionStorage.removeItem('avtotest_' + key); } catch (e) {}
  }
  return null;
}

function deleteCookie(name) {
  document.cookie = name + '=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT';
  if (name === 'isSuperAdmin') try { localStorage.removeItem('avtotest_isSuperAdmin'); } catch (e) {}
}

// 1. Superadmin check (cookie + localStorage) - retry on refresh to avoid timing issues
function checkSuperAdminAndRun() {
  if (getAdminSession('isSuperAdmin') === 'true') {
    runSuperAdmin();
    return;
  }
  setTimeout(function () {
    if (getAdminSession('isSuperAdmin') === 'true') {
      runSuperAdmin();
      return;
    }
    window.location.href = '/login';
  }, 150);
}
function runSuperAdmin() {
  // 2. Create new for sale user
  const createUserBtn = document.getElementById('createForSaleUser');
  const userEmailInput = document.getElementById('userEmail');
  const userPasswordInput = document.getElementById('userPassword');

  if (createUserBtn) {
    createUserBtn.addEventListener('click', async () => {
      const email = userEmailInput.value.trim();
      const password = userPasswordInput.value.trim();

      if (!email || !password) {
        alert("Iltimos, email va parolni kiriting!");
        return;
      }

      try {
        // Use a secondary Firebase app to avoid changing the primary auth state
        const secondaryAppName = 'SuperAdminCreateUser';
        let secondaryApp;
        try {
          secondaryApp = firebase.app(secondaryAppName);
        } catch (e) {
          secondaryApp = firebase.initializeApp(firebase.app().options, secondaryAppName);
        }
        const secondaryAuth = secondaryApp.auth();

        const userCredential = await secondaryAuth.createUserWithEmailAndPassword(email, password);
        const expiresAt = new Date();
        expiresAt.setMonth(expiresAt.getMonth() + 2);

        await db.collection('users').doc(userCredential.user.uid).set({
          email,
          password,
          status: 'forsale',
          expiresAt: firebase.firestore.Timestamp.fromDate(expiresAt),
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
          isBlocked: false,
          isLoggedIn: false
        });

        try { await secondaryAuth.signOut(); } catch (e) {}
        alert(`For Sale user muvaffaqiyatli qo'shildi!`);
        userEmailInput.value = '';
        userPasswordInput.value = '';
        fetchUsers();
      } catch (error) {
        alert("Xatolik yuz berdi: " + error.message);
      }
    });
  }

  // 3. Real-time presence + user list
  var userList = document.getElementById('superUserList') || document.getElementById('userList');
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
    activeHeader.textContent = 'Faol Sotuvdagi Foydalanuvchilar (Onlayn)';
    userList.appendChild(activeHeader);
    const activeUsersList = document.createElement('div');
    activeUsersList.id = 'activeForSaleUsersList';
    userList.appendChild(activeUsersList);
    const allUsersHeader = document.createElement('h2');
    allUsersHeader.textContent = 'Oxirgi yaratilgan foydalanuvchilar';
    userList.appendChild(allUsersHeader);
    const allUsersList = document.createElement('div');
    allUsersList.id = 'allForSaleUsersList';
    userList.appendChild(allUsersList);
    loadedUsers.forEach(({ doc, user, userId }) => {
      const isActive = isUserOnline(userId);
      renderUser(doc, user, userId, isActive, activeUsersList, allUsersList);
    });
    const loadMoreBtn = document.createElement('button');
    loadMoreBtn.id = 'loadMoreForSaleUsers';
    loadMoreBtn.textContent = '+';
    loadMoreBtn.title = 'Yana yuklash';
    loadMoreBtn.className = 'btn-super';
    loadMoreBtn.style.marginTop = '15px';
    loadMoreBtn.style.background = '#2e7d32';
    loadMoreBtn.onclick = () => fetchUsers(false);
    loadMoreBtn.style.display = (loadedUsers.length > 0 && hasMorePages) ? 'inline-block' : 'none';
    userList.appendChild(loadMoreBtn);
  }

  function renderUser(doc, user, userId, isActive, activeUsersList, allUsersList) {
    const expiresAt = user.expiresAt?.seconds ? new Date(user.expiresAt.seconds * 1000).toLocaleString() : 'N/A';
    const userDiv = document.createElement('div');
    userDiv.style.border = isActive ? '2px solid #4caf50' : '1px solid #eee';
    userDiv.style.padding = '15px';
    userDiv.style.marginBottom = '10px';
    userDiv.style.borderRadius = '5px';
    userDiv.innerHTML = `
      <div class="user-details">
        <strong>Email:</strong> ${user.email || 'N/A'} ${isActive ? 'ONLAYN' : 'OFLAN'}<br>
        <strong>Amal qilish:</strong> ${expiresAt}
      </div>
      <div class="user-actions" style="margin-top:10px;text-align:right">
        <button onclick="deleteUser('${doc.id}', ${isActive})" class="btn-super btn-danger">
          ${isActive ? 'Sessiyani Yakunlash' : 'O\'chirish'}
        </button>
      </div>
    `;
    if (isActive) activeUsersList.appendChild(userDiv);
    else allUsersList.appendChild(userDiv);
  }

  async function fetchUsers(reset = true) {
    userList = document.getElementById('superUserList') || document.getElementById('userList');
    if (!userList || !window.db) return false;
    try {
      if (reset) {
        loadedUsers = [];
        // Fetch forsale users (no composite index needed), then sort in memory
        const snapshot = await db.collection('users')
          .where('status', '==', 'forsale')
          .limit(200)
          .get();
        const list = [];
        snapshot.forEach(doc => {
          const user = doc.data();
          list.push({ doc, user, userId: doc.id });
        });
        list.sort((a, b) => {
          const tA = a.user.createdAt?.seconds ?? 0;
          const tB = b.user.createdAt?.seconds ?? 0;
          return tB - tA;
        });
        loadedUsers = list;
      }

      hasMorePages = false;
      renderLoadedUsers();
      return true;
    } catch (error) {
      console.error('Error fetching users:', error);
      return false;
    }
  }

  function runInitialFetch() {
    function tryFetch() {
      userList = document.getElementById('superUserList') || document.getElementById('userList');
      if (userList && window.db) {
        fetchUsers();
        return true;
      }
      return false;
    }
    if (tryFetch()) return;
    window.addEventListener('firebase-realtime-ready', tryFetch, { once: true });
    window.addEventListener('load', tryFetch, { once: true });
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
        alert('Xatolik yuz berdi.');
      }
    }
  };

  const logoutBtn = document.getElementById('logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      if (window.auth) await auth.signOut();
      deleteCookie('isSuperAdmin');
      window.location.href = '/login';
    });
  }
}
checkSuperAdminAndRun();

