// scripts/user.js
// Cookie utility functions
function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return decodeURIComponent(parts.pop().split(';').shift());
  return null;
}

function deleteCookie(name) {
  document.cookie = `${name}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  document.cookie = `${name}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0`;
  if (name === 'user') {
    try { localStorage.removeItem('avtotest_user'); } catch (e) {}
  }
}

/** Clear all user data: cookies, localStorage, sessionStorage - used when admin deletes user */
function clearAllUserData() {
  const cookies = document.cookie.split(';');
  for (let i = 0; i < cookies.length; i++) {
    const name = cookies[i].split('=')[0].trim();
    if (name) {
      document.cookie = `${name}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0`;
    }
  }
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch (e) {
    console.warn('Error clearing storage:', e);
  }
}

/** Sync user data to cookie + localStorage + sessionStorage. */
function syncUserToStorage(userData, originalExpiresAt) {
  if (!userData) return;
  var status = userData.status || '';
  var isTemporary = status.toLowerCase() === 'temporary';
  var expiresAt = (originalExpiresAt && originalExpiresAt > Date.now())
    ? originalExpiresAt
    : Date.now() + (isTemporary ? 30 * 60 * 1000 : 60 * 24 * 60 * 60 * 1000);
  var userJson = JSON.stringify(userData);
  var storageObj = JSON.stringify({ data: userData, expiresAt: expiresAt });

  try {
    document.cookie = 'user=' + encodeURIComponent(userJson) + '; Path=/; Expires=' + new Date(expiresAt).toUTCString();
  } catch (e) {}
  try { localStorage.setItem('avtotest_user', storageObj); } catch (e) {}
  try { sessionStorage.setItem('avtotest_user', storageObj); } catch (e) {}
}

// 1. Restore login state: cookie → localStorage → sessionStorage (triple fallback for old browsers)
var userData;
try {
  var userCookie = getCookie('user');
  if (userCookie) {
    userData = JSON.parse(userCookie);
    syncUserToStorage(userData);
  }
  if (!userData) {
    var stored = null;
    try { stored = localStorage.getItem('avtotest_user'); } catch (e) {}
    if (!stored) {
      try { stored = sessionStorage.getItem('avtotest_user'); } catch (e) {}
    }
    if (stored) {
      var parsed = JSON.parse(stored);
      if (parsed.expiresAt && parsed.expiresAt > Date.now() && parsed.data) {
        userData = parsed.data;
        syncUserToStorage(userData, parsed.expiresAt);
      } else {
        try { localStorage.removeItem('avtotest_user'); } catch (e) {}
        try { sessionStorage.removeItem('avtotest_user'); } catch (e) {}
      }
    }
  }
  if (!userData) userData = null;
  // Restrict UI by status
  // Permanent users should only see ".item.testlar" on the home page.
  if (userData && userData.status === 'permanent') {
    // Wait until the home DOM exists (scripts can run before elements are painted)
    const applyPermanentUI = () => {
      const items = document.querySelectorAll('.main-items .item');
      if (!items || items.length === 0) return false;

      items.forEach((el) => {
        const isTestlar = el.classList.contains('testlar');
        el.style.display = isTestlar ? 'flex' : 'none';
      });

      return true;
    };

    if (!applyPermanentUI()) {
      window.addEventListener('load', applyPermanentUI);
      // also retry a few times in case scripts render later
      let tries = 0;
      const t = setInterval(() => {
        tries += 1;
        if (applyPermanentUI() || tries > 20) clearInterval(t);
      }, 250);
    }
  }
  console.log('User cookie retrieved:', userData);
} catch (error) {
  console.error('Error parsing user cookie:', error);
  userData = null;
}

// Check if user cookie exists and is valid (no expiration check in JSON)
if (!userData) {
  deleteCookie('user');
  window.location.href = '/login';
  // return; // We can't return from top-level, but the redirect will happen
} else {
  (async function initUserPage() {
    if (!userData.sessionId) {
      clearAllUserData();
      window.location.href = '/login';
      return;
    }

    // Wait for Firebase services (up to 10s — slow on old devices)
    for (var i = 0; i < 100; i++) {
      if (window.db) break;
      await new Promise(function (r) { setTimeout(r, 100); });
    }
    if (!window.db) {
      console.warn('[USER] Firebase Firestore not available after 10s, showing page anyway');
    }

    // Wait for Firebase Auth to restore the signed-in user (critical on old browsers)
    if (window.auth) {
      try {
        await new Promise(function (resolve) {
          var done = false;
          var unsub = window.auth.onAuthStateChanged(function () {
            if (!done) { done = true; if (unsub) unsub(); resolve(); }
          });
          setTimeout(function () {
            if (!done) { done = true; if (unsub) unsub(); resolve(); }
          }, 5000);
        });
      } catch (e) {}
    }

    // Initial session validation — only redirect on confirmed mismatch, not on errors
    if (window.db) {
      try {
        var doc = await db.collection('users').doc(userData.uid).get();
        var data = doc.exists ? doc.data() : null;
        var currentSessionId = data && data.currentSessionId;
        if (currentSessionId !== userData.sessionId) {
          clearAllUserData();
          if (window.auth) await window.auth.signOut();
          window.location.href = '/login';
          return;
        }
      } catch (err) {
        console.warn('[USER] Initial session check failed, continuing:', err);
      }
    }

    // 2. Show user info
    var userEmailElement = document.getElementById('userEmail');
    if (userEmailElement) {
      userEmailElement.textContent = userData.email || 'Unknown';
    }

    // 3. Real-time presence tracking (presence.js) + force logout listener
    if (userData.uid) {
    const userId = userData.uid;
    var cancelPresence = function () {};

    function setupUserPresence() {
      if (window.Presence && typeof window.Presence.startPresence === 'function') {
        cancelPresence = window.Presence.startPresence(userId, userData.email);
        window.addEventListener('beforeunload', function () {
          cancelPresence();
          if (window.db && userData.uid) {
            try { db.collection('users').doc(userData.uid).update({ isLoggedIn: false }); } catch (e) {}
          }
        });
        return;
      }
      setTimeout(setupUserPresence, 400);
    }
    setupUserPresence();

    // Listen for force logout signals (e.g. login from another device or admin delete)
    function setupLogoutListener() {
      if (!window.realtimeDb) {
        setTimeout(setupLogoutListener, 500);
        return;
      }

      try {
        const logoutSignalRef = window.realtimeDb.ref(`logoutSignals/${userId}`);
        var isFirstValue = true;
        logoutSignalRef.on('value', function (snapshot) {
          var signal = snapshot.val();
          if (isFirstValue) {
            isFirstValue = false;
            return;
          }
          if (signal && (signal.forceLogout === true || signal.deleted === true)) {
            console.log('Force logout/deleted signal received - clearing all data immediately');

            const userStatusRef = window.realtimeDb.ref(`activeUsers/${userId}`);
            userStatusRef.remove().catch(() => {});

            logoutSignalRef.off('value');
            logoutSignalRef.remove().catch(() => {});

            clearAllUserData();

            if (window.auth) {
              window.auth.signOut().then(function () {
                var msg = signal.deleted ? 'Sizning hisobingiz o\'chirildi.' : (signal.reason === 'new_login' ? 'Siz boshqa qurilmada tizimga kirdingiz.' : 'Sessiya admin tomonidan yakunlandi.');
                alert(msg);
                window.location.href = '/login';
              }).catch(function () {
                window.location.href = '/login';
              });
            } else {
              window.location.href = '/login';
            }
          }
        }, (error) => {
          console.error('Error listening to logout signals:', error);
        });
      } catch (error) {
        console.error('Error setting up logout listener:', error);
      }
    }

    setupLogoutListener();

    // 4. Periodic session & existence check — generous failure tolerance for slow/old devices
    var sessionCheckFailCount = 0;
    var MAX_SESSION_FAILURES = 15;

    async function checkSessionStillValid() {
      if (!userData || !userData.uid || !userData.sessionId || !window.db) return true;
      try {
        var doc = await db.collection('users').doc(userData.uid).get();
        var data = doc.exists ? doc.data() : null;
        var currentSessionId = data && data.currentSessionId;
        if (currentSessionId !== userData.sessionId) {
          if (window.realtimeDb) window.realtimeDb.ref('activeUsers/' + userData.uid).remove();
          clearAllUserData();
          if (window.auth) await window.auth.signOut();
          window.location.href = '/login';
          return false;
        }
        sessionCheckFailCount = 0;
        return true;
      } catch (e) {
        sessionCheckFailCount++;
        console.warn('[USER] Session check error (' + sessionCheckFailCount + '/' + MAX_SESSION_FAILURES + '):', e);
        return sessionCheckFailCount < MAX_SESSION_FAILURES;
      }
    }

    async function checkUserExists() {
      if (!userData || !userData.uid || !window.db) {
        return false;
      }
      if (!(await checkSessionStillValid())) return false;
      try {
        const userDoc = await db.collection('users').doc(userData.uid).get();
        if (!userDoc.exists) {
          if (window.realtimeDb) {
            window.realtimeDb.ref(`activeUsers/${userData.uid}`).remove();
          }
          deleteCookie('user');
          if (window.auth) await window.auth.signOut();
          alert('Sizning hisobingiz o\'chirilgan. Tizimdan chiqarilmoqdasiz.');
          window.location.href = '/login';
          return false;
        }
        return true;
      } catch (error) {
        console.error('[USER] Error checking user existence:', error);
        return true;
      }
    }

    checkUserExists();

    const userExistenceCheck = setInterval(async function () {
      await checkUserExists();
    }, 30000);

    window.addEventListener('online', () => {
      sessionCheckFailCount = 0;
      checkUserExists();
    });
  }

  // 7. Logout — clear presence and set isLoggedIn false
  var logoutBtn = document.getElementById('logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', function () {
      if (userData && userData.uid) {
        cancelPresence();
        if (window.realtimeDb) {
          window.realtimeDb.ref('activeUsers/' + userData.uid).remove().catch(function () {});
        }
        if (window.db) {
          window.db.collection('users').doc(userData.uid).update({ isLoggedIn: false }).catch(function () {});
        }
      }

      deleteCookie('user');
      if (window.auth) {
        window.auth.signOut().then(function () {
          window.location.href = '/login';
        }).catch(function () {
          window.location.href = '/login';
        });
      } else {
        window.location.href = '/login';
      }
    });
  }
  })();
}
