/**
 * Real-time user presence tracking (Firebase Realtime Database).
 * - activeUsers/{uid}: { email, uid, online, lastSeen, connectedAt }
 * - User is considered "online" only if online===true AND lastSeen within threshold.
 * - Waits for window.realtimeDb before exposing API so listeners work reliably.
 */
(function () {
  'use strict';

  var PATH_ACTIVE_USERS = 'activeUsers';
  var HEARTBEAT_INTERVAL_MS = 25000;  // 25 seconds
  var ONLINE_THRESHOLD_MS = 90000;    // 90 seconds — treat as offline if no heartbeat
  var MAX_WAIT_MS = 8000;             // wait up to 8s for realtimeDb

  function getDb() {
    return typeof window !== 'undefined' ? window.realtimeDb : null;
  }

  function getFirebase() {
    return typeof window !== 'undefined' && window.firebase ? window.firebase : null;
  }

  function whenRealtimeReady(cb) {
    if (getDb()) {
      cb(getDb());
      return;
    }
    var start = Date.now();
    var t = setInterval(function () {
      if (getDb()) {
        clearInterval(t);
        cb(getDb());
        return;
      }
      if (Date.now() - start > MAX_WAIT_MS) {
        clearInterval(t);
        cb(null);
      }
    }, 80);
  }

  /**
   * Returns true if the presence record should be shown as "online".
   * Uses lastSeen so stale entries (browser crash, no disconnect) show as offline.
   */
  function isUserOnline(record) {
    if (!record || record.online !== true) return false;
    var lastSeen = record.lastSeen;
    if (lastSeen == null) return true; // legacy entry without lastSeen
    var ms = typeof lastSeen === 'number' ? lastSeen : (lastSeen && lastSeen.seconds != null ? lastSeen.seconds * 1000 : 0);
    return ms > 0 && (Date.now() - ms) < ONLINE_THRESHOLD_MS;
  }

  /**
   * Start presence for the current user (main app). Call once when user is logged in.
   * - Sets presence immediately
   * - Registers onDisconnect to remove on tab close
   * - Listens to .info/connected to re-apply on reconnection
   * - Heartbeat every HEARTBEAT_INTERVAL_MS
   * - Refreshes on visibility change and window online event
   * @param {string} uid - Firebase user id
   * @param {string} email - User email
   * @returns {function} cancel() to stop presence and clear interval
   */
  function startPresence(uid, email) {
    var db = getDb();
    var fb = getFirebase();
    if (!db || !fb) {
      setTimeout(function () { startPresence(uid, email); }, 500);
      return function cancel() {};
    }

    var userRef = db.ref(PATH_ACTIVE_USERS + '/' + uid);
    var heartbeatId = null;

    function makePayload() {
      return {
        email: email || '',
        uid: uid,
        online: true,
        lastSeen: fb.database.ServerValue.TIMESTAMP,
        connectedAt: fb.database.ServerValue.TIMESTAMP
      };
    }

    function applyPresence() {
      userRef.onDisconnect().remove().then(function () {
        userRef.set(makePayload());
      }).catch(function (err) {
        console.warn('[Presence] onDisconnect failed, setting anyway', err);
        userRef.set(makePayload());
      });
    }

    // Set immediately so admin sees user online right away
    applyPresence();

    // Re-apply when Realtime DB reconnects
    var connectedRef = db.ref('.info/connected');
    connectedRef.on('value', function (snap) {
      if (snap.val() === true) applyPresence();
    });

    // Heartbeat so lastSeen stays fresh
    heartbeatId = setInterval(function () {
      if (getDb()) {
        userRef.update({ lastSeen: fb.database.ServerValue.TIMESTAMP }).catch(function () {});
      } else {
        if (heartbeatId) clearInterval(heartbeatId);
      }
    }, HEARTBEAT_INTERVAL_MS);

    // Tab visible again
    document.addEventListener('visibilitychange', function onVisible() {
      if (document.visibilityState === 'visible' && getDb()) {
        userRef.update({ online: true, lastSeen: fb.database.ServerValue.TIMESTAMP }).catch(function () {});
      }
    });

    // Network back online
    window.addEventListener('online', function onOnline() {
      if (getDb()) {
        userRef.set(makePayload()).then(function () {
          userRef.onDisconnect().remove();
        }).catch(function () {});
      }
    });

    return function cancel() {
      if (heartbeatId) clearInterval(heartbeatId);
      userRef.remove().catch(function () {});
    };
  }

  /**
   * Subscribe to all active users (admin/superadmin). Callback receives a map:
   * { [uid]: { email, uid, online, lastSeen, connectedAt } }
   * Use isUserOnline(record) to decide if a user is shown as online.
   * @param {function(object)} onUpdate - called on every change with activeUsers map
   * @param {function(object)} onError - optional, called on permission/error
   * @returns {function} unsubscribe()
   */
  function subscribeActiveUsers(onUpdate, onError) {
    var unsubRef = { current: function () {} };
    function attach(db) {
      if (!db) {
        if (typeof onError === 'function') onError({ message: 'Realtime DB not available' });
        return function () {};
      }
      var ref = db.ref(PATH_ACTIVE_USERS);
      function handleSnapshot(snapshot) {
        var val = snapshot.val();
        onUpdate(val || {});
      }
      function handleError(err) {
        console.error('[Presence] subscribe error', err);
        if (typeof onError === 'function') onError(err);
      }
      ref.on('value', handleSnapshot, handleError);
      return function unsubscribe() {
        ref.off('value', handleSnapshot);
      };
    }
    var db = getDb();
    if (db) {
      unsubRef.current = attach(db);
      return unsubRef.current;
    }
    whenRealtimeReady(function (readyDb) {
      unsubRef.current = attach(readyDb);
    });
    return function unsubscribe() {
      if (typeof unsubRef.current === 'function') unsubRef.current();
    };
  }

  // Expose API as soon as script runs; startPresence/subscribeActiveUsers wait for DB internally
  window.Presence = {
    isUserOnline: isUserOnline,
    startPresence: startPresence,
    subscribeActiveUsers: subscribeActiveUsers,
    whenRealtimeReady: whenRealtimeReady,
    PATH_ACTIVE_USERS: PATH_ACTIVE_USERS,
    ONLINE_THRESHOLD_MS: ONLINE_THRESHOLD_MS
  };
})();
