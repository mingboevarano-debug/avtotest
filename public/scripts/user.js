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
  console.log(`Cookie deleted: ${name}, remaining=${getCookie(name)}`);
}

// 1. Check login state
const userCookie = getCookie('user');
let userData;
try {
  userData = userCookie ? JSON.parse(userCookie) : null;
  if (userData && userData.status === 'permanent') {
    let oraliq = document.querySelector('.oraliq');
    if (oraliq) oraliq.style.display = 'none';
    let darslar = document.querySelector('.darslar');
    if (darslar) darslar.style.display = 'none';
    let variant = document.querySelector('.variant');
    if (variant) variant.style.display = 'none';
    let testlar = document.querySelector('.testlar');
    if (testlar) testlar.style.display = "none"
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
  // 2. Show user info
  const userEmailElement = document.getElementById('userEmail');
  if (userEmailElement) {
    userEmailElement.textContent = userData.email || 'Unknown';
  }

  // 3. Set up WebSocket-like real-time connection for force logout
  if (userData.uid) {
    const userId = userData.uid;

    // Wait for Firebase Realtime Database to be ready
    function setupUserPresence() {
      if (!window.realtimeDb || !window.firebase) {
        console.error('Firebase or Realtime Database not initialized. Retrying...');
        setTimeout(setupUserPresence, 500);
        return;
      }

      try {
        // Mark user as active in Realtime Database
        const userStatusRef = window.realtimeDb.ref(`activeUsers/\${userId}`);
        const userStatusData = {
          email: userData.email,
          uid: userId,
          online: true,
          lastSeen: firebase.database.ServerValue.TIMESTAMP,
          connectedAt: firebase.database.ServerValue.TIMESTAMP
        };

        userStatusRef.set(userStatusData).then(() => {
          console.log('User marked as active:', userId, userStatusData);

          // Keep connection alive by updating lastSeen every 30 seconds
          const keepAliveInterval = setInterval(() => {
            if (window.realtimeDb) {
              userStatusRef.update({
                lastSeen: firebase.database.ServerValue.TIMESTAMP
              }).catch(err => {
                console.error('Error updating lastSeen:', err);
                clearInterval(keepAliveInterval);
              });
            } else {
              clearInterval(keepAliveInterval);
            }
          }, 30000); // Update every 30 seconds

          // Clear interval when page unloads
          window.addEventListener('beforeunload', () => {
            clearInterval(keepAliveInterval);
          });
        }).catch((error) => {
          console.error('Error marking user as active:', error);
        });

        // Set up disconnect handler
        userStatusRef.onDisconnect().remove().then(() => {
          console.log('Disconnect handler set up for user:', userId);
        }).catch(err => {
          console.error('Error setting up disconnect handler:', err);
        });

        console.log('User presence tracking set up successfully');
      } catch (error) {
        console.error('Error setting up user presence:', error);
      }
    }

    setupUserPresence();

    // Listen for force logout signals
    function setupLogoutListener() {
      if (!window.realtimeDb) {
        console.error('Realtime Database not initialized. Retrying logout listener...');
        setTimeout(setupLogoutListener, 500);
        return;
      }

      try {
        const logoutSignalRef = window.realtimeDb.ref(`logoutSignals/\${userId}`);
        logoutSignalRef.on('value', (snapshot) => {
          const signal = snapshot.val();
          if (signal && signal.forceLogout === true) {
            console.log('Force logout signal received - logging out immediately');

            const userStatusRef = window.realtimeDb.ref(`activeUsers/\${userId}`);
            userStatusRef.remove();

            if (window.db) {
              db.collection('users').doc(userId).update({
                isLoggedIn: false
              }).catch(err => console.error('Error updating Firestore:', err));
            }

            logoutSignalRef.remove();
            deleteCookie('user');
            if (window.auth) {
              auth.signOut().then(() => {
                alert('Your session has been ended by admin.');
                window.location.href = '/login';
              }).catch(error => {
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

    // 4. IMMEDIATE check on page load
    async function checkUserExists() {
      if (!userData || !userData.uid || !window.db) {
        return false;
      }

      try {
        const userDoc = await db.collection('users').doc(userData.uid).get();
        if (!userDoc.exists) {
          if (window.realtimeDb) {
            window.realtimeDb.ref(`activeUsers/\${userData.uid}`).remove();
          }
          deleteCookie('user');
          if (window.auth) await auth.signOut();
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

    const userExistenceCheck = setInterval(async () => {
      await checkUserExists();
    }, 5000);

    window.addEventListener('online', () => {
      checkUserExists();
    });
  }

  // 7. Logout
  const logoutBtn = document.getElementById('logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      if (userData && userData.uid && window.realtimeDb) {
        window.realtimeDb.ref(`activeUsers/\${userData.uid}`).remove();
      }

      deleteCookie('user');
      if (window.auth) {
        auth.signOut().then(() => {
          window.location.href = '/login';
        }).catch(error => {
          window.location.href = '/login';
        });
      } else {
        window.location.href = '/login';
      }
    });
  }
}
