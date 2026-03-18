// scripts/auth.js
// Cookie utility functions
function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return decodeURIComponent(parts.pop().split(';').shift());
    return null;
}

function setCookie(name, value, userStatus) {
    try {
        if (!name || !value) {
            console.error("Error: Cookie name or value is missing");
            return;
        }

        let expires;
        if (userStatus && userStatus.toLowerCase() === "temporary") {
            expires = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
        } else {
            expires = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000); // 2 months (users created by super admin)
        }

        const cookieString = `${name}=${encodeURIComponent(value)}; Path=/; Expires=${expires.toUTCString()}; SameSite=Lax`;
        document.cookie = cookieString;

        const cookieCheck = getCookie(name);
        if (!cookieCheck) {
            console.warn(`Failed to verify ${name} cookie after setting.`);
        }
    } catch (error) {
        console.error(`Error in setCookie: ${error.message}`);
    }
}

function deleteCookie(name) {
    document.cookie = `${name}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    if (name === 'user') {
        try { localStorage.removeItem('avtotest_user'); } catch (e) {}
    } else if (name === 'isSuperAdmin' || name === 'isAdmin') {
        try { localStorage.removeItem('avtotest_' + name); } catch (e) {}
    }
}

/** Save admin/superadmin to BOTH cookie and localStorage (2 months persistence) */
function saveAdminToStorage(key, value) {
    var expiresMs = 60 * 24 * 60 * 60 * 1000;
    var expiresAt = Date.now() + expiresMs;
    try {
        document.cookie = key + '=' + encodeURIComponent(value) + '; Path=/; Expires=' + new Date(expiresAt).toUTCString();
    } catch (e) { console.warn('Cookie set failed:', e); }
    try {
        localStorage.setItem('avtotest_' + key, JSON.stringify({ value: value, expiresAt: expiresAt }));
    } catch (e) { console.warn('localStorage set failed:', e); }
    try {
        sessionStorage.setItem('avtotest_' + key, JSON.stringify({ value: value, expiresAt: expiresAt }));
    } catch (e) {}
}

/** Save user data to BOTH cookie and localStorage. Forsale, permanent, completed = 2 months; temporary = 30 min */
function saveUserToStorage(userData, status) {
    if (!userData) return;
    var statusLower = (status || (userData.status || '')).toLowerCase();
    var isTemporary = statusLower === 'temporary';
    var expiresMs = isTemporary
        ? 30 * 60 * 1000
        : 60 * 24 * 60 * 60 * 1000;
    var expiresAt = Date.now() + expiresMs;
    var userJson = JSON.stringify(userData);

    try {
        document.cookie = 'user=' + encodeURIComponent(userJson) + '; Path=/; Expires=' + new Date(expiresAt).toUTCString();
    } catch (e) {
        console.warn('Cookie set failed:', e);
    }

    try {
        localStorage.setItem('avtotest_user', JSON.stringify({
            data: userData,
            expiresAt: expiresAt
        }));
    } catch (e) {
        console.warn('localStorage set failed:', e);
    }

    try {
        sessionStorage.setItem('avtotest_user', JSON.stringify({
            data: userData,
            expiresAt: expiresAt
        }));
    } catch (e) {}
}

// Admin check (move to server-side in production)
async function isAdmin(email, password) {
    const ADMIN_CREDENTIALS = [
        { email: "newadmin@admin.com", password: "Admin@x" }
    ];
    return ADMIN_CREDENTIALS.some(admin =>
        admin.email.toLowerCase() === email.toLowerCase() && admin.password === password
    );
}

// Superadmin check
async function isSuperAdmin(email, password) {
    const SUPERADMIN_CREDENTIALS = [
        { email: "superadmin@admin.com", password: "SuperAdmin@2024" }
    ];
    return SUPERADMIN_CREDENTIALS.some(superadmin => superadmin.email === email && superadmin.password === password);
}

async function checkUserStatus(uid) {
    try {
        const userDoc = await db.collection('users').doc(uid).get();
        if (userDoc.exists) {
            const userData = userDoc.data();
            const expiresAt = userData.expiresAt?.seconds ? new Date(userData.expiresAt.seconds * 1000) : null;
            const isExpired = expiresAt && expiresAt < new Date();
            switch (userData.status) {
                case 'temporary':
                    return isExpired ? 'expired' : 'temporary';
                case 'permanent':
                    return isExpired ? 'expired' : 'permanent';
                case 'completed':
                    return isExpired ? 'expired' : 'completed';
                case 'forsale':
                    return isExpired ? 'expired' : 'forsale';
                default:
                    return 'unknown';
            }
        }
        return 'notFound';
    } catch (error) {
        console.error(`Error checking user status: ${error.message}`);
        return 'error';
    }
}

const loginForm = document.getElementById('loginForm');
const errorElement = document.getElementById('error');

if (loginForm && errorElement) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorElement.textContent = '';

        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value.trim();

        if (!email || !password) {
            errorElement.textContent = 'Iltimos, email va parolni kiriting!';
            return;
        }

        try {
            // Check for superadmin login first
            const isSuperAdminResult = await isSuperAdmin(email, password);
            if (isSuperAdminResult) {
                deleteCookie('isAdmin');
                try { localStorage.removeItem('avtotest_isAdmin'); } catch (e) {}
                saveAdminToStorage('isSuperAdmin', 'true');
                window.location.href = '/superadmin';
                return;
            }

            // Check for admin login
            const isAdminResult = await isAdmin(email, password);
            if (isAdminResult) {
                deleteCookie('isSuperAdmin');
                try { localStorage.removeItem('avtotest_isSuperAdmin'); } catch (e) {}
                saveAdminToStorage('isAdmin', 'true');
                window.location.href = '/admin';
                return;
            }

            // Firebase login — ensure LOCAL persistence so login survives PC restart
            await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
            const userCredential = await auth.signInWithEmailAndPassword(email, password);
            const userId = userCredential.user.uid;

            const userDoc = await db.collection('users').doc(userId).get();
            if (!userDoc.exists) {
                await auth.signOut();
                throw new Error('Foydalanuvchi topilmadi yoki o\'chirilgan.');
            }

            // One login = 1 device only
            const data = userDoc.data();
            if (data && data.isLoggedIn === true) {
                // Check if user is ACTUALLY online on another device via Realtime DB
                let isActuallyOnline = false;
                if (window.realtimeDb) {
                    try {
                        const activeSnapshot = await window.realtimeDb.ref(`activeUsers/${userId}`).once('value');
                        const activeData = activeSnapshot.val();
                        if (activeSnapshot.exists() && activeData && activeData.online === true) {
                            // Verify lastSeen is within the last 2 minutes (not a stale entry)
                            const lastSeen = activeData.lastSeen || 0;
                            const twoMinutesAgo = Date.now() - 2 * 60 * 1000;
                            isActuallyOnline = lastSeen > twoMinutesAgo;
                        }
                    } catch (e) {
                        console.warn('Could not check active status:', e);
                    }
                }

                if (isActuallyOnline) {
                    // Genuinely active on another device — BLOCK login
                    await auth.signOut();
                    errorElement.textContent = 'Bu akkaunt boshqa qurilmada faol ishlatilmoqda. Faqat bitta qurilmada kirish mumkin.';
                    return;
                }

                // User is NOT actually online — stale isLoggedIn from browser close.
                // Clean up and allow login on this device.
                if (window.realtimeDb) {
                    try { await window.realtimeDb.ref(`activeUsers/${userId}`).remove(); } catch (e) {}
                }
            }

            const sessionId = typeof crypto !== 'undefined' && crypto.randomUUID
                ? crypto.randomUUID()
                : 's' + Date.now() + '-' + Math.random().toString(36).slice(2);

            await db.collection('users').doc(userId).update({
                isLoggedIn: true,
                lastActive: firebase.firestore.FieldValue.serverTimestamp(),
                currentSessionId: sessionId
            });

            if (window.realtimeDb) {
                try {
                    const userStatusRef = window.realtimeDb.ref(`activeUsers/${userId}`);
                    const userStatusData = {
                        email: email,
                        uid: userId,
                        online: true,
                        lastSeen: firebase.database.ServerValue.TIMESTAMP,
                        connectedAt: firebase.database.ServerValue.TIMESTAMP
                    };

                    await userStatusRef.set(userStatusData);
                    userStatusRef.onDisconnect().remove();
                } catch (error) {
                    console.error('Error setting up real-time presence:', error);
                }
            }

            const status = await checkUserStatus(userCredential.user.uid);

            if (status === 'expired') {
                await auth.signOut();
                deleteCookie('user');
                try { localStorage.removeItem('avtotest_user'); } catch (e) {}
                throw new Error('Your account has expired');
            }

            const userData = {
                email: userCredential.user.email,
                uid: userCredential.user.uid,
                status: status,
                sessionId: sessionId
            };
            // Save to BOTH cookie and localStorage - forsale/permanent/completed = 2 months, temporary = 30 min
            saveUserToStorage(userData, status);

            window.location.href = '/';
        } catch (error) {
            errorElement.textContent = 'Login failed: ' +
                (error.code === 'auth/wrong-password' ? 'Invalid password' :
                    error.code === 'auth/user-not-found' ? 'User not found' :
                        error.message);
        }
    });
}
