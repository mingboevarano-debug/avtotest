// scripts/index.js (or wherever this code resides)
document.addEventListener('DOMContentLoaded', () => {
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
    if (userData.status === 'permanent') {
      let oraliq = document.querySelector('.oraliq');
      oraliq.style.display = 'none';
      let darslar = document.querySelector('.darslar');
      darslar.style.display = 'none';
      let variant = document.querySelector('.variant');
      variant.style.display = 'none';
      let testlar = document.querySelector('.testlar');
      testlar.style.display = "none"


    }
    console.log('User cookie retrieved:', userData);
  } catch (error) {
    console.error('Error parsing user cookie:', error);
    userData = null;
  }

  // Check if user cookie exists and is valid (no expiration check in JSON)
  if (!userData) {
    deleteCookie('user');
    window.location.href = 'login.html';
    return;
  }

  // 2. Show user info
  const userEmailElement = document.getElementById('userEmail');
  if (userEmailElement) {
    userEmailElement.textContent = userData.email || 'Unknown';
  } else {
    console.error('userEmail element not found');
  }

  // 3. Set up WebSocket-like real-time connection for force logout
  if (userData && userData.uid) {
    const userId = userData.uid;

    // Wait for Firebase Realtime Database to be ready
    function setupUserPresence() {
      if (!window.realtimeDb) {
        console.error('Realtime Database not initialized. Retrying...');
        setTimeout(setupUserPresence, 500);
        return;
      }

      try {
        // Mark user as active in Realtime Database
        const userStatusRef = window.realtimeDb.ref(`activeUsers/${userId}`);
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

    // Listen for force logout signals (like Telegram end session)
    function setupLogoutListener() {
      if (!window.realtimeDb) {
        console.error('Realtime Database not initialized. Retrying logout listener...');
        setTimeout(setupLogoutListener, 500);
        return;
      }

      try {
        const logoutSignalRef = window.realtimeDb.ref(`logoutSignals/${userId}`);
        logoutSignalRef.on('value', (snapshot) => {
          const signal = snapshot.val();
          if (signal && signal.forceLogout === true) {
            console.log('Force logout signal received - logging out immediately');

            // Get userStatusRef for removal
            const userStatusRef = window.realtimeDb.ref(`activeUsers/${userId}`);

            // Remove from active users
            userStatusRef.remove();

            // Update Firestore
            db.collection('users').doc(userId).update({
              isLoggedIn: false
            }).catch(err => console.error('Error updating Firestore:', err));

            // Clear logout signal
            logoutSignalRef.remove();

            // Delete cookie and sign out
            deleteCookie('user');
            auth.signOut().then(() => {
              console.log('Force logout successful');
              // Show message and redirect
              alert('Your session has been ended by admin.');
              window.location.href = 'login.html';
            }).catch(error => {
              console.error('Force logout error:', error);
              window.location.href = 'login.html';
            });
          }
        }, (error) => {
          console.error('Error listening to logout signals:', error);
        });
      } catch (error) {
        console.error('Error setting up logout listener:', error);
      }
    }

    setupLogoutListener();

    // 4. IMMEDIATE check on page load if user exists in Firebase
    async function checkUserExists() {
      if (!userData || !userData.uid) {
        return false;
      }

      try {
        console.log('[USER] Checking if user exists in database...');
        const userDoc = await db.collection('users').doc(userData.uid).get();
        if (!userDoc.exists) {
          console.log('[USER] User deleted from database - logging out...');

          // Remove from active users
          if (window.realtimeDb) {
            window.realtimeDb.ref(`activeUsers/${userData.uid}`).remove();
          }

          // Delete cookie and sign out
          deleteCookie('user');
          await auth.signOut();
          alert('Sizning hisobingiz o\'chirilgan. Tizimdan chiqarilmoqdasiz.');
          window.location.href = 'login.html';
          return false;
        }
        console.log('[USER] User exists in database ✓');
        return true;
      } catch (error) {
        console.error('[USER] Error checking user existence:', error);
        return true; // Don't kick out user on error, just log it
      }
    }

    // Run immediate check on page load
    checkUserExists();

    // 5. Check every 5 seconds if user is deleted from Firebase (reduced from 60s)
    const userExistenceCheck = setInterval(async () => {
      await checkUserExists();
    }, 5000); // Check every 5 seconds (5000 ms) for rapid detection

    // 6. Also check when browser comes back online
    window.addEventListener('online', () => {
      console.log('[USER] Browser back online, checking user existence...');
      checkUserExists();
    });
  }

  // 7. Logout
  const logoutBtn = document.getElementById('logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      // Remove from active users
      if (userData && userData.uid) {
        window.realtimeDb.ref(`activeUsers/${userData.uid}`).remove();
      }

      deleteCookie('user');
      auth.signOut().then(() => {
        console.log('Logout successful');
        window.location.href = 'login.html';
      }).catch(error => {
        console.error('Logout error:', error);
        window.location.href = 'login.html';
      });
    });
  } else {
    console.error('Logout button not found');
  }
});