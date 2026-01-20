// scripts/admin.js
document.addEventListener('DOMContentLoaded', () => {
  // Cookie utility functions
  function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
  }

  // function setCookie(name, value, days) {
  //   const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  //   document.cookie = `${name}=${value}; Path=/; Expires=${expires.toUTCString()}; SameSite=Strict`;
  // }

  function deleteCookie(name) {
    document.cookie = `${name}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  }

  // 1. Admin check
  if (getCookie('isAdmin') !== 'true') {
    window.location.href = 'login.html';
    return;
  }

  // 2. Create new user
  const createUserBtn = document.getElementById('createUser');
  const statusSelect = document.getElementById('statusSelect');

  createUserBtn.addEventListener('click', async () => {
    const email = prompt("Foydalanuvchi emailini kiriting:");
    if (!email) return;

    const password = prompt("Foydalanuvchi parolini kiriting (kamida 6 belgi):");
    if (!password || password.length < 6) {
      alert("Parol kamida 6 belgidan iborat bo'lishi kerak!");
      return;
    }

    const status = statusSelect.value.toLowerCase();
    const validStatuses = ['temporary', 'permanent', 'completed'];

    if (!validStatuses.includes(status)) {
      alert("Faqat 'vaqtinchalik', 'doimiy' yoki 'tolangan' holatini tanlash mumkin!");
      return;
    }

    try {
      console.log('Creating user with email:', email);
      const userCredential = await auth.createUserWithEmailAndPassword(email, password);
      console.log('User created in Firebase Auth:', userCredential.user.uid);

      // Calculate expiration date based on status
      let expiresAtDate;
      if (status === 'permanent' || status === 'completed') {
        // 20 days for permanent and completed users
        expiresAtDate = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
      } else if (status === 'temporary') {
        // 30 minutes for temporary users
        expiresAtDate = new Date(Date.now() + 30 * 60 * 1000);
      }

      console.log('Saving user to Firestore...');
      try {
        await db.collection('users').doc(userCredential.user.uid).set({
          email,
          status,
          expiresAt: firebase.firestore.Timestamp.fromDate(expiresAtDate),
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
          isBlocked: false,
          isLoggedIn: false
        });
        console.log('User saved to Firestore successfully');
      } catch (firestoreError) {
        console.error('Firestore error:', firestoreError);
        // If Firestore fails, try to delete the auth user to avoid orphaned accounts
        try {
          await auth.currentUser.delete();
        } catch (deleteError) {
          console.error('Error deleting auth user:', deleteError);
        }
        throw new Error('Firestore xatolik: ' + (firestoreError.message || 'Ma\'lumotlarni saqlashda muammo yuz berdi. Iltimos, ad blocker ni o\'chiring yoki qayta urinib ko\'ring.'));
      }

      let statusMessage;
      switch (status) {
        case 'permanent':
          statusMessage = 'Doimiy foydalanuvchi';
          break;
        case 'temporary':
          statusMessage = 'Vaqtinchalik foydalanuvchi';
          break;
        case 'completed':
          statusMessage = 'Tolangan foydalanuvchi (12 kun)';
          break;
      }

      // Send Telegram notification
      const telegramBotToken = '7740314167:AAFWbrtDioAM2j9LapVME_EDDz91YPjuaSc'; // Replace with your bot token
      const chatId = '-1003057507989'; // Replace with your chat ID
      const message = `Yangi foydalanuvchi qo'shildi!\nEmail: ${email}\nParol: ${password}`;
      await sendTelegramMessage(telegramBotToken, chatId, message);

      alert(`Foydalanuvchi muvaffaqiyatli qo'shildi!\nHolati: ${statusMessage}`);
      fetchUsers(); // Refresh user list after adding
    } catch (error) {
      console.error('Create user error:', error);
      let errorMessage = "Xatolik yuz berdi: ";
      
      // Check for network/blocking errors
      const errorString = JSON.stringify(error);
      if (errorString.includes('ERR_BLOCKED_BY_CLIENT') || 
          errorString.includes('blocked') || 
          error.message?.includes('ERR_BLOCKED_BY_CLIENT') ||
          error.message?.includes('blocked')) {
        errorMessage += "Browser extension (ad blocker) Firestore so'rovlarini bloklayapti.\n\n" +
                       "Yechim:\n" +
                       "1. Ad blocker ni o'chiring\n" +
                       "2. Yoki Firestore so'rovlariga ruxsat bering\n" +
                       "3. Yoki boshqa browserda sinab ko'ring";
      } else if (error.code) {
        switch (error.code) {
          case 'auth/email-already-in-use':
            errorMessage += "Bu email allaqachon ro'yxatdan o'tgan";
            break;
          case 'auth/invalid-email':
            errorMessage += "Noto'g'ri email formati";
            break;
          case 'auth/weak-password':
            errorMessage += "Parol juda oddiy";
            break;
          case 'permission-denied':
            errorMessage += "Ruxsat rad etildi. Iltimos, Firebase sozlamalarini tekshiring.";
            break;
          default:
            errorMessage += error.message || error.code;
        }
      } else {
        errorMessage += error.message || 'Noma\'lum xatolik';
      }
      
      alert(errorMessage);
    }
  });

  // 3. Fetch and display users with real-time active status
  const userList = document.getElementById('userList');
  let activeUsersMap = {}; // Track active users from Realtime Database

  // Wait for Firebase to be ready, then set up real-time listener
  function setupRealtimeListener() {
    if (!window.realtimeDb) {
      console.error('Realtime Database not initialized. Retrying...');
      setTimeout(setupRealtimeListener, 500);
      return;
    }

    try {
      // Listen for active users in real-time (WebSocket-like functionality)
      const activeUsersRef = window.realtimeDb.ref('activeUsers');
      
      activeUsersRef.on('value', (snapshot) => {
        try {
          const data = snapshot.val();
          activeUsersMap = data || {};
          const activeCount = Object.keys(activeUsersMap).filter(uid => 
            activeUsersMap[uid] && activeUsersMap[uid].online === true
          ).length;
          console.log('Active users updated:', activeUsersMap);
          console.log('Number of active users:', activeCount);
          console.log('Active user IDs:', Object.keys(activeUsersMap));
          fetchUsers(); // Refresh user list when active users change
        } catch (error) {
          console.error('Error processing active users snapshot:', error);
        }
      }, (error) => {
        console.error('Error listening to active users:', error);
        if (error.code === 'PERMISSION_DENIED') {
          alert('Firebase Realtime Database ruxsatlari sozlanmagan. Iltimos, Firebase Console\'da Realtime Database Rules ni yangilang. Qo\'llanma: FIREBASE_RULES_SETUP.md faylida.');
        } else {
          alert('Faol foydalanuvchilarni kuzatishda xatolik. Iltimos, sahifani yangilang.');
        }
      });

      console.log('Real-time listener set up successfully');
    } catch (error) {
      console.error('Error setting up real-time listener:', error);
    }
  }

  // Initialize real-time listener
  setupRealtimeListener();

  async function fetchUsers() {
    try {
      const snapshot = await db.collection('users').get();
      userList.innerHTML = ''; // Clear current list
      
      // Add header for active users section
      const activeHeader = document.createElement('h2');
      activeHeader.textContent = 'Faol Foydalanuvchilar (Onlayn)';
      activeHeader.style.marginTop = '20px';
      activeHeader.style.color = '#1a73e8';
      userList.appendChild(activeHeader);
      
      const activeUsersList = document.createElement('div');
      activeUsersList.id = 'activeUsersList';
      userList.appendChild(activeUsersList);
      
      // Add header for all users section
      const allUsersHeader = document.createElement('h2');
      allUsersHeader.textContent = 'Barcha Foydalanuvchilar';
      allUsersHeader.style.marginTop = '30px';
      allUsersHeader.style.color = '#1a73e8';
      userList.appendChild(allUsersHeader);
      
      const allUsersList = document.createElement('div');
      allUsersList.id = 'allUsersList';
      userList.appendChild(allUsersList);
      
      snapshot.forEach(doc => {
        const user = doc.data();
        const userId = doc.id;
        
        // Skip forsale users - they should only be visible to superadmin
        if (user.status === 'forsale') {
          return;
        }
        
        // Check if user is active - with better debugging
        const activeUserData = activeUsersMap[userId];
        const isActive = activeUserData && activeUserData.online === true;
        
        if (isActive) {
          console.log('Found active user:', userId, activeUserData);
        }
        
        // Handle timestamp safely
        const createdAt = user.createdAt && user.createdAt.seconds
          ? new Date(user.createdAt.seconds * 1000).toLocaleString('uz-UZ', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            })
          : 'N/A';
        const expiresAt = user.expiresAt && user.expiresAt.seconds
          ? new Date(user.expiresAt.seconds * 1000).toLocaleString('uz-UZ', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            })
          : 'N/A';

        const userDiv = document.createElement('div');
        userDiv.style.border = isActive ? '2px solid #4caf50' : '1px solid #eee';
        userDiv.style.backgroundColor = isActive ? '#f1f8f4' : '#ffffff';
        userDiv.innerHTML = `
          <div class="user-details">
            <strong>Email:</strong> ${user.email || 'N/A'}
            ${isActive ? '<span style="color: #4caf50; margin-left: 10px; font-weight: bold;">● ONLAYN</span>' : '<span style="color: #999; margin-left: 10px;">○ OFLAN</span>'}<br>
            <strong>Holat:</strong> ${user.status === 'temporary' ? 'Vaqtinchalik' : user.status === 'permanent' ? 'Doimiy' : user.status === 'completed' ? 'Tolangan' : 'N/A'}<br>
            <strong>Yaratilgan vaqt:</strong> ${createdAt}<br>
            <strong>Amal qilish muddati:</strong> ${expiresAt}
          </div>
          <div class="user-actions">
            <button onclick="deleteUser('${doc.id}', ${isActive})" style="background: ${isActive ? '#ff9800' : '#d32f2f'};">
              ${isActive ? 'Sessiyani Yakunlash' : 'O\'chirish'}
            </button>
          </div>
        `;
        
        // Add to appropriate list
        if (isActive) {
          activeUsersList.appendChild(userDiv);
        } else {
          allUsersList.appendChild(userDiv);
        }
      });
      
      // Show message if no active users
      if (activeUsersList.children.length === 0) {
        activeUsersList.innerHTML = '<p style="color: #999; padding: 15px;">Hozirda faol foydalanuvchilar yo\'q.</p>';
      }
    } catch (error) {
      console.error('Foydalanuvchilarni olishda xatolik:', error);
      userList.innerHTML = '<p style="color: #ff4444;">Foydalanuvchilarni yuklashda xatolik yuz berdi.</p>';
    }
  }

  // 4. Delete user function with force logout (like Telegram end session)
  window.deleteUser = async (userId, isActive = false) => {
    const confirmMessage = isActive 
      ? 'Bu foydalanuvchi sessiyasini darhol yakunlaydi va uni tizimdan chiqaradi. Davom etasizmi?'
      : 'Bu foydalanuvchini o\'chirishni xohlaysizmi?';
    
    if (window.confirm(confirmMessage)) {
      try {
        console.log(`[ADMIN] Starting deletion for user ${userId}, isActive: ${isActive}`);
        
        // Check if Realtime Database is initialized
        if (!window.realtimeDb) {
          console.error('[ADMIN] Realtime Database not initialized!');
          alert('Xatolik: Realtime Database ishga tushmagan. Iltimos, sahifani yangilang va qaytadan urinib ko\'ring.');
          return;
        }
        
        // If user is active, send force logout signal and delete from Firestore
        if (isActive) {
          console.log(`[ADMIN] User is active, sending force logout signal...`);
          
          // Send force logout signal
          const logoutSignalRef = window.realtimeDb.ref(`logoutSignals/${userId}`);
          try {
            await logoutSignalRef.set({
              forceLogout: true,
              timestamp: firebase.database.ServerValue.TIMESTAMP,
              adminAction: true,
              deletedBy: 'admin'
            });
            console.log(`[ADMIN] Force logout signal sent successfully`);
          } catch (signalError) {
            console.error('[ADMIN] Error sending logout signal:', signalError);
            throw new Error('Logout signal yuborishda xatolik: ' + signalError.message);
          }
          
          // Remove from active users immediately
          try {
            await window.realtimeDb.ref(`activeUsers/${userId}`).remove();
            console.log(`[ADMIN] User removed from active users list`);
          } catch (activeError) {
            console.error('[ADMIN] Error removing from active users:', activeError);
            // Continue anyway - the logout signal should handle this
          }
          
          // Delete from Firestore (so user cannot login again)
          try {
            await db.collection('users').doc(userId).delete();
            console.log(`[ADMIN] User deleted from Firestore`);
          } catch (firestoreError) {
            console.error('[ADMIN] Error deleting from Firestore:', firestoreError);
            throw new Error('Firestore dan o\'chirishda xatolik: ' + firestoreError.message);
          }
          
          // Wait a moment for the signal to be processed, then clear it
          setTimeout(() => {
            logoutSignalRef.remove().then(() => {
              console.log(`[ADMIN] Logout signal cleared`);
            }).catch(err => {
              console.error('[ADMIN] Error clearing logout signal:', err);
            });
          }, 3000); // Increased to 3 seconds to ensure signal is processed
          
          alert('Foydalanuvchi sessiyasi muvaffaqiyatli yakunlandi va o\'chirildi!\nFoydalanuvchi darhol tizimdan chiqarildi va endi login qila olmaydi.');
          console.log(`[ADMIN] User deletion completed successfully`);
        } else {
          // For inactive users, just delete from database
          console.log(`[ADMIN] User is inactive, deleting from Firestore only...`);
          try {
            await db.collection('users').doc(userId).delete();
            console.log(`[ADMIN] Inactive user deleted from Firestore`);
            alert('Foydalanuvchi muvaffaqiyatli o\'chirildi!');
          } catch (firestoreError) {
            console.error('[ADMIN] Error deleting inactive user:', firestoreError);
            throw new Error('Foydalanuvchini o\'chirishda xatolik: ' + firestoreError.message);
          }
        }
        
        fetchUsers(); // Refresh list after deletion
      } catch (error) {
        console.error('[ADMIN] O\'chirish xatosi:', error);
        let errorMessage = 'Foydalanuvchini o\'chirishda xatolik yuz berdi.';
        if (error.message) {
          errorMessage += '\n\nTafsilotlar: ' + error.message;
        }
        if (error.code === 'PERMISSION_DENIED') {
          errorMessage += '\n\nFirebase ruxsatlari rad etildi. Iltimos, Firebase Database Rules ni tekshiring.';
        }
        alert(errorMessage);
      }
    }
  };

  // 5. Logout function
  const logoutBtn = document.getElementById('logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try {
        // Sign out from Firebase Auth if logged in
        if (auth.currentUser) {
          await auth.signOut();
        }
        
        // Delete admin cookie
        deleteCookie('isAdmin');
        
        // Redirect to login page
        window.location.href = 'login.html';
      } catch (error) {
        console.error('Logout error:', error);
        // Still redirect even if there's an error
        deleteCookie('isAdmin');
        window.location.href = 'login.html';
      }
    });
  } else {
    console.error('Logout button not found');
  }

  // 6. Send Telegram message function
  async function sendTelegramMessage(botToken, chatId, message) {
    try {
      const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: message
        })
      });
      const data = await response.json();
      if (!data.ok) {
        console.error('Telegram xabari yuborishda xatolik:', data.description);
      }
    } catch (error) {
      console.error('Telegram xabari yuborishda xatolik:', error);
    }
  }

  // Initial fetch
  fetchUsers();
});