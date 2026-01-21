// scripts/admin.js
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

// 1. Admin check
if (getCookie('isAdmin') !== 'true') {
  window.location.href = '/login';
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

      const status = statusSelect.value.toLowerCase();
      const validStatuses = ['temporary', 'permanent', 'completed'];

      if (!validStatuses.includes(status)) {
        alert("Faqat 'vaqtinchalik', 'doimiy' yoki 'tolangan' holatini tanlash mumkin!");
        return;
      }

      try {
        const userCredential = await auth.createUserWithEmailAndPassword(email, password);

        // Calculate expiration date based on status
        let expiresAtDate;
        if (status === 'permanent' || status === 'completed') {
          expiresAtDate = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
        } else if (status === 'temporary') {
          expiresAtDate = new Date(Date.now() + 30 * 60 * 1000);
        }

        await db.collection('users').doc(userCredential.user.uid).set({
          email,
          status,
          expiresAt: firebase.firestore.Timestamp.fromDate(expiresAtDate),
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
          isBlocked: false,
          isLoggedIn: false
        });

        const telegramBotToken = '7740314167:AAFWbrtDioAM2j9LapVME_EDDz91YPjuaSc';
        const chatId = '-1003057507989';
        const message = `Yangi foydalanuvchi qo'shildi!\nEmail: \${email}\nParol: \${password}`;
        await sendTelegramMessage(telegramBotToken, chatId, message);

        alert(`Foydalanuvchi muvaffaqiyatli qo'shildi!`);
        fetchUsers();
      } catch (error) {
        console.error('Create user error:', error);
        alert("Xatolik yuz berdi: " + error.message);
      }
    });
  }

  // 3. Fetch and display users with real-time active status
  const userList = document.getElementById('userList');
  let activeUsersMap = {};

  function setupRealtimeListener() {
    if (!window.realtimeDb) {
      setTimeout(setupRealtimeListener, 500);
      return;
    }

    const activeUsersRef = window.realtimeDb.ref('activeUsers');
    activeUsersRef.on('value', (snapshot) => {
      const data = snapshot.val();
      activeUsersMap = data || {};
      fetchUsers();
    });
  }

  setupRealtimeListener();

  async function fetchUsers() {
    if (!userList || !window.db) return;
    try {
      const snapshot = await db.collection('users').get();
      userList.innerHTML = '';

      const activeHeader = document.createElement('h2');
      activeHeader.textContent = 'Faol Foydalanuvchilar (Onlayn)';
      userList.appendChild(activeHeader);

      const activeUsersList = document.createElement('div');
      activeUsersList.id = 'activeUsersList';
      userList.appendChild(activeUsersList);

      const allUsersHeader = document.createElement('h2');
      allUsersHeader.textContent = 'Barcha Foydalanuvchilar';
      userList.appendChild(allUsersHeader);

      const allUsersList = document.createElement('div');
      allUsersList.id = 'allUsersList';
      userList.appendChild(allUsersList);

      snapshot.forEach(doc => {
        const user = doc.data();
        const userId = doc.id;
        if (user.status === 'forsale') return;

        const activeUserData = activeUsersMap[userId];
        const isActive = activeUserData && activeUserData.online === true;

        const createdAt = user.createdAt?.seconds ? new Date(user.createdAt.seconds * 1000).toLocaleString() : 'N/A';
        const expiresAt = user.expiresAt?.seconds ? new Date(user.expiresAt.seconds * 1000).toLocaleString() : 'N/A';

        const userDiv = document.createElement('div');
        userDiv.style.border = isActive ? '2px solid #4caf50' : '1px solid #eee';
        userDiv.innerHTML = `
          <div class="user-details">
            <strong>Email:</strong> \${user.email || 'N/A'} \${isActive ? 'ONLAYN' : 'OFLAN'}<br>
            <strong>Holat:</strong> \${user.status}<br>
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
          setTimeout(() => logoutSignalRef.remove(), 3000);
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
      window.location.href = '/login';
    });
  }

  async function sendTelegramMessage(botToken, chatId, message) {
    try {
      await fetch(`https://api.telegram.org/bot\${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: message })
      });
    } catch (e) { }
  }

  fetchUsers();
}
