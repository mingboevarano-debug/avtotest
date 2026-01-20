document.addEventListener('DOMContentLoaded', () => {
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
                console.log(`Setting cookie for temporary user: ${name}, expires in 30 minutes`);
            } else {
                expires = new Date(Date.now() + 24 * 60 * 60 * 30000); // 1 day
                console.log(`Setting cookie for non-temporary user: ${name}, expires in 1 day`);
            }

            const cookieString = `${name}=${encodeURIComponent(value)}; Path=/; Expires=${expires.toUTCString()}; SameSite=Lax`;
            document.cookie = cookieString;
            console.log(`Cookie string set: ${cookieString}`);

            const cookieCheck = getCookie(name);
            console.log(`Attempted to set cookie: ${name}=${value}, stored as=${cookieCheck}, expires=${expires.toUTCString()}`);
            if (!cookieCheck) {
                console.warn(`Failed to verify ${name} cookie after setting. Current document.cookie: ${document.cookie}`);
            } else if (cookieCheck !== value) {
                console.warn(`Cookie value mismatch for ${name}. Expected: ${value}, Found: ${cookieCheck}`);
            }
        } catch (error) {
            console.error(`Error in setCookie: ${error.message}`);
        }
    }

    function deleteCookie(name) {
        document.cookie = `${name}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
        console.log(`Cookie deleted: ${name}, remaining=${getCookie(name)}`);
    }

    // Admin check (move to server-side in production)
    async function isAdmin(email, password) {
        // Placeholder: Replace with server-side check
        const ADMIN_CREDENTIALS = [
            { email: "newadmin@admin.com", password: "Admin@x" }
        ];
        const emailMatch = ADMIN_CREDENTIALS.some(admin => admin.email.toLowerCase() === email.toLowerCase());
        const passwordMatch = ADMIN_CREDENTIALS.some(admin => admin.password === password);
        const fullMatch = ADMIN_CREDENTIALS.some(admin => 
            admin.email.toLowerCase() === email.toLowerCase() && admin.password === password
        );
        console.log('Admin login check:', { email, password, emailMatch, passwordMatch, fullMatch });
        return fullMatch;
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
                console.log(`User ${uid} status check:`, { status: userData.status, expiresAt, isExpired });
                switch (userData.status) {
                    case 'temporary':
                        // Temporary users expire after 30 minutes
                        return isExpired ? 'expired' : 'temporary';
                    case 'permanent':
                        // Permanent users can expire after 20 days (but status remains permanent)
                        return isExpired ? 'expired' : 'permanent';
                    case 'completed':
                        // Completed users expire after 20 days
                        return isExpired ? 'expired' : 'completed';
                    case 'forsale':
                        // Forsale users expire after 2 months
                        return isExpired ? 'expired' : 'forsale';
                    default:
                        return 'unknown';
                }
            }
            console.warn(`User ${uid} not found in Firestore`);
            return 'notFound';
        } catch (error) {
            console.error(`Error checking user status: ${error.message}`);
            return 'error';
        }
    }

    const loginForm = document.getElementById('loginForm');
    const errorElement = document.getElementById('error');

    if (!loginForm || !errorElement) {
        console.error('Login elements not found:', { loginForm, errorElement });
        return;
    }

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
            console.log('Login attempt:', { email, passwordLength: password.length });
            
            // Check for superadmin login first
            const isSuperAdminResult = await isSuperAdmin(email, password);
            console.log('Superadmin check result:', isSuperAdminResult);
            if (isSuperAdminResult) {
                setCookie('isSuperAdmin', 'true', 'permanent');
                console.log('Superadmin login successful, redirecting to superadmin.html');
                window.location.href = 'superadmin.html';
                return;
            }

            // Check for admin login
            const isAdminResult = await isAdmin(email, password);
            console.log('Admin check result:', isAdminResult);
            if (isAdminResult) {
                setCookie('isAdmin', 'true', 'permanent');
                console.log('Admin login successful, redirecting to admin.html');
                window.location.href = 'admin.html';
                return;
            }
            
            console.log('Not admin or superadmin, proceeding with regular user login...');

            // Check if user is already logged in
            const userSnapshot = await db.collection('users').where('email', '==', email).get();
            if (!userSnapshot.empty) {
                const userData = userSnapshot.docs[0].data();
                if (userData.isLoggedIn) {
                    throw new Error('This account is already logged in on another device');
                }
            }

            // Firebase login
            const userCredential = await auth.signInWithEmailAndPassword(email, password);
            const userId = userCredential.user.uid;
            
            // Check if user exists in Firestore (important: prevents deleted users from logging in)
            const userDoc = await db.collection('users').doc(userId).get();
            if (!userDoc.exists) {
                await auth.signOut();
                throw new Error('Foydalanuvchi topilmadi yoki o\'chirilgan. Iltimos, admin bilan bog\'laning.');
            }
            
            // Mark user as logged in and active
            await db.collection('users').doc(userId).update({
                isLoggedIn: true,
                lastActive: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            // Set up real-time presence tracking in Realtime Database
            if (window.realtimeDb) {
              try {
                const userStatusRef = window.realtimeDb.ref(`activeUsers/${userId}`);
                
                // Set user as active with connection info
                const userStatusData = {
                  email: email,
                  uid: userId,
                  online: true,
                  lastSeen: firebase.database.ServerValue.TIMESTAMP,
                  connectedAt: firebase.database.ServerValue.TIMESTAMP
                };
                
                userStatusRef.set(userStatusData).then(() => {
                  console.log('User marked as active in Realtime Database:', userId);
                  
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
                  console.error('Error setting user as active:', error);
                });
                
                // Set up disconnect handler to remove from active users when user closes browser/tab
                userStatusRef.onDisconnect().remove().then(() => {
                  console.log('Disconnect handler set up for user:', userId);
                }).catch(err => {
                  console.error('Error setting up disconnect handler:', err);
                });
              } catch (error) {
                console.error('Error setting up real-time presence:', error);
              }
            } else {
              console.warn('Realtime Database not available');
            }

            // Check user status
            const status = await checkUserStatus(userCredential.user.uid);
            console.log(`User status determined: ${status}`);
            
            // Check if account is expired (but allow forsale users to login)
            if (status === 'expired') {
                await auth.signOut();
                deleteCookie('user');
                throw new Error('Your account has expired');
            }

            // Store user data in cookie
            const userData = {
                email: userCredential.user.email,
                uid: userCredential.user.uid,
                status: status
            };
            const userJson = JSON.stringify(userData);
            setCookie('user', userJson, status);

            // Redirect all users (including forsale) to index.html
            console.log(`Redirecting to index.html for user with status: ${status}`);
            window.location.href = 'index.html';
        } catch (error) {
            errorElement.textContent = 'Login failed: ' +
                (error.code === 'auth/wrong-password' ? 'Invalid password' :
                 error.code === 'auth/user-not-found' ? 'User not found' :
                 error.message);
            console.error('Login error:', error);
        }
    });
});