// scripts/superadmin.js
document.addEventListener('DOMContentLoaded', () => {
  // Cookie utility functions
  function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
  }

  function deleteCookie(name) {
    document.cookie = `${name}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  }

  // 1. Superadmin check
  if (getCookie('isSuperAdmin') !== 'true') {
    window.location.href = 'login.html';
    return;
  }

  // 2. Create new for sale user
  const createUserBtn = document.getElementById('createForSaleUser');
  const userEmailInput = document.getElementById('userEmail');
  const userPasswordInput = document.getElementById('userPassword');

  createUserBtn.addEventListener('click', async () => {
    const email = userEmailInput.value.trim();
    const password = userPasswordInput.value.trim();

    if (!email || !password) {
      alert("Iltimos, email va parolni kiriting!");
      return;
    }

    if (password.length < 6) {
      alert("Parol kamida 6 belgidan iborat bo'lishi kerak!");
      return;
    }

    try {
      console.log('Creating for sale user with email:', email);
      // Create user in Firebase Auth
      const userCredential = await auth.createUserWithEmailAndPassword(email, password);
      console.log('User created in Firebase Auth:', userCredential.user.uid);

      // Calculate expiration date: 2 months from now
      const expiresAt = new Date();
      expiresAt.setMonth(expiresAt.getMonth() + 2);

      console.log('Saving user to Firestore...');
      try {
        // Create user document in Firestore with forsale status
        await db.collection('users').doc(userCredential.user.uid).set({
          email,
          status: 'forsale',
          expiresAt: firebase.firestore.Timestamp.fromDate(expiresAt),
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

      // Sign out the created user (we don't want to stay logged in as them)
      await auth.signOut();

      alert(`For Sale user muvaffaqiyatli qo'shildi!\nEmail: ${email}\nParol: ${password}\nAmal qilish muddati: 2 oy\nStatus: For Sale`);

      // Clear form
      userEmailInput.value = '';
      userPasswordInput.value = '';

      // Refresh user list
      fetchUsers();
    } catch (error) {
      console.error('Create user error:', error);
      let errorMessage = "Xatolik yuz berdi: ";
      
      // Check for network/blocking errors
      if (error.message && (error.message.includes('ERR_BLOCKED_BY_CLIENT') || error.message.includes('blocked'))) {
        errorMessage += "Browser extension (ad blocker) Firestore so'rovlarini bloklayapti. Iltimos, ad blocker ni o'chiring yoki Firestore so'rovlariga ruxsat bering.";
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

  // 3. Fetch and display for sale users with real-time active status
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
          activeUsersMap = snapshot.val() || {};
          console.log('Active users updated:', activeUsersMap);
          console.log('Number of active users:', Object.keys(activeUsersMap).length);
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
      // Only fetch users with forsale status
      const snapshot = await db.collection('users')
        .where('status', '==', 'forsale')
        .get();
      
      userList.innerHTML = ''; // Clear current list

      // Add header for active users section
      const activeHeader = document.createElement('h2');
      activeHeader.textContent = 'Faol Sotuvdagi Foydalanuvchilar (Onlayn)';
      activeHeader.style.marginTop = '20px';
      activeHeader.style.color = '#9c27b0';
      userList.appendChild(activeHeader);
      
      const activeUsersList = document.createElement('div');
      activeUsersList.id = 'activeForSaleUsersList';
      userList.appendChild(activeUsersList);
      
      // Add header for all for sale users section
      const allUsersHeader = document.createElement('h2');
      allUsersHeader.textContent = 'Barcha Sotuvdagi Foydalanuvchilar';
      allUsersHeader.style.marginTop = '30px';
      allUsersHeader.style.color = '#9c27b0';
      userList.appendChild(allUsersHeader);
      
      const allUsersList = document.createElement('div');
      allUsersList.id = 'allForSaleUsersList';
      userList.appendChild(allUsersList);

      if (snapshot.empty) {
        activeUsersList.innerHTML = '<p style="color: #999; padding: 15px;">Sotuvdagi foydalanuvchilar topilmadi.</p>';
        return;
      }

      snapshot.forEach(doc => {
        const user = doc.data();
        const userId = doc.id;
        const isActive = activeUsersMap[userId] && activeUsersMap[userId].online === true;
        
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

        // Check if expired
        const isExpired = user.expiresAt && user.expiresAt.seconds
          ? new Date(user.expiresAt.seconds * 1000) < new Date()
          : false;

        const userDiv = document.createElement('div');
        userDiv.style.border = isActive ? '2px solid #4caf50' : '1px solid #eee';
        userDiv.style.borderLeft = isActive ? '4px solid #4caf50' : (isExpired ? '4px solid #d32f2f' : '4px solid #9c27b0');
        userDiv.style.backgroundColor = isActive ? '#f1f8f4' : (isExpired ? '#ffebee' : '#f3e5f5');
        
        userDiv.innerHTML = `
          <div class="user-details">
            <strong>Email:</strong> ${user.email || 'N/A'}
            ${isActive ? '<span style="color: #4caf50; margin-left: 10px; font-weight: bold;">● ONLAYN</span>' : '<span style="color: #999; margin-left: 10px;">○ OFLAN</span>'}
            ${isExpired ? '<span style="color: #d32f2f; margin-left: 10px; font-weight: bold;">[MUDDATI TUGAGAN]</span>' : '<span style="color: #9c27b0; margin-left: 10px; font-weight: bold;">[FAOL]</span>'}<br>
            <strong>Holat:</strong> <span style="color: #9c27b0; font-weight: bold;">SOTUVDA</span><br>
            <strong>Yaratilgan vaqt:</strong> ${createdAt}<br>
            <strong>Amal qilish muddati:</strong> ${expiresAt} (2 oy)
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
        activeUsersList.innerHTML = '<p style="color: #999; padding: 15px;">Hozirda faol sotuvdagi foydalanuvchilar yo\'q.</p>';
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
      : 'Bu for sale foydalanuvchini o\'chirishni xohlaysizmi?';
    
    if (window.confirm(confirmMessage)) {
      try {
        // If user is active, send force logout signal and delete from Firestore
        if (isActive) {
          const logoutSignalRef = window.realtimeDb.ref(`logoutSignals/${userId}`);
          await logoutSignalRef.set({
            forceLogout: true,
            timestamp: firebase.database.ServerValue.TIMESTAMP,
            adminAction: true
          });
          
          // Remove from active users
          await window.realtimeDb.ref(`activeUsers/${userId}`).remove();
          
          // Delete from Firestore (so user cannot login again)
          await db.collection('users').doc(userId).delete();
          
          // Wait a moment for the signal to be processed, then clear it
          setTimeout(() => {
            logoutSignalRef.remove();
          }, 2000);
          
          alert('Foydalanuvchi sessiyasi muvaffaqiyatli yakunlandi va o\'chirildi! Foydalanuvchi darhol tizimdan chiqarildi va endi login qila olmaydi.');
        } else {
          // For inactive users, just delete from database
          await db.collection('users').doc(userId).delete();
          alert('For sale foydalanuvchi muvaffaqiyatli o\'chirildi!');
        }
        
        fetchUsers(); // Refresh list after deletion
      } catch (error) {
        alert('Foydalanuvchini o\'chirishda xatolik yuz berdi.');
        console.error('O\'chirish xatosi:', error);
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
        
        // Delete superadmin cookie
        deleteCookie('isSuperAdmin');
        
        // Redirect to login page
        window.location.href = 'login.html';
      } catch (error) {
        console.error('Logout error:', error);
        // Still redirect even if there's an error
        deleteCookie('isSuperAdmin');
        window.location.href = 'login.html';
      }
    });
  } else {
    console.error('Logout button not found');
  }

  // Initial fetch
  fetchUsers();
});

