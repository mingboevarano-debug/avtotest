// scripts/superadmin.js
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
  window.location.href = '/login';
} else {
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
        const userCredential = await auth.createUserWithEmailAndPassword(email, password);
        const expiresAt = new Date();
        expiresAt.setMonth(expiresAt.getMonth() + 2);

        await db.collection('users').doc(userCredential.user.uid).set({
          email,
          status: 'forsale',
          expiresAt: firebase.firestore.Timestamp.fromDate(expiresAt),
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
          isBlocked: false,
          isLoggedIn: false
        });

        await auth.signOut();
        alert(`For Sale user muvaffaqiyatli qo'shildi!`);
        userEmailInput.value = '';
        userPasswordInput.value = '';
        fetchUsers();
      } catch (error) {
        alert("Xatolik yuz berdi: " + error.message);
      }
    });
  }

  // 3. Fetch and display for sale users with real-time active status
  const userList = document.getElementById('userList');
  let activeUsersMap = {};

  function setupRealtimeListener() {
    if (!window.realtimeDb) {
      setTimeout(setupRealtimeListener, 500);
      return;
    }

    const activeUsersRef = window.realtimeDb.ref('activeUsers');
    activeUsersRef.on('value', (snapshot) => {
      activeUsersMap = snapshot.val() || {};
      fetchUsers();
    });
  }

  setupRealtimeListener();

  async function fetchUsers() {
    if (!userList || !window.db) return;
    try {
      const snapshot = await db.collection('users').where('status', '==', 'forsale').get();
      userList.innerHTML = '';

      const activeHeader = document.createElement('h2');
      activeHeader.textContent = 'Faol Sotuvdagi Foydalanuvchilar (Onlayn)';
      userList.appendChild(activeHeader);

      const activeUsersList = document.createElement('div');
      activeUsersList.id = 'activeForSaleUsersList';
      userList.appendChild(activeUsersList);

      const allUsersHeader = document.createElement('h2');
      allUsersHeader.textContent = 'Barcha Sotuvdagi Foydalanuvchilar';
      userList.appendChild(allUsersHeader);

      const allUsersList = document.createElement('div');
      allUsersList.id = 'allForSaleUsersList';
      userList.appendChild(allUsersList);

      snapshot.forEach(doc => {
        const user = doc.data();
        const userId = doc.id;
        const isActive = activeUsersMap[userId] && activeUsersMap[userId].online === true;
        const expiresAt = user.expiresAt?.seconds ? new Date(user.expiresAt.seconds * 1000).toLocaleString() : 'N/A';
        const isExpired = user.expiresAt?.seconds ? new Date(user.expiresAt.seconds * 1000) < new Date() : false;

        const userDiv = document.createElement('div');
        userDiv.style.border = isActive ? '2px solid #4caf50' : '1px solid #eee';
        userDiv.innerHTML = `
          <div class="user-details">
            <strong>Email:</strong> \${user.email || 'N/A'} \${isActive ? 'ONLAYN' : 'OFLAN'}<br>
            <strong>Amal qilish:</strong> \${expiresAt}
          </div>
          <div class="user-actions">
            <button onclick="deleteUser('\${doc.id}', \${isActive})">
              \${isActive ? 'Sessiyani Yakunlash' : 'O\'chirish'}
            </button>
          </div>
        `;

        if (isActive) activeUsersList.appendChild(userDiv);
        else allUsersList.appendChild(userDiv);
      });
    } catch (error) {
      console.error('Error fetching users:', error);
    }
  }

  window.deleteUser = async (userId, isActive = false) => {
    if (window.confirm('Ishonchingiz komilmi?')) {
      try {
        if (isActive && window.realtimeDb) {
          const logoutSignalRef = window.realtimeDb.ref(`logoutSignals/\${userId}`);
          await logoutSignalRef.set({ forceLogout: true });
          await window.realtimeDb.ref(`activeUsers/\${userId}`).remove();
          setTimeout(() => logoutSignalRef.remove(), 2000);
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

  fetchUsers();
}

