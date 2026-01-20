# Firebase Realtime Database Rules Setup

## Problem
You're getting `permission_denied` error because Firebase Realtime Database security rules are blocking access to `/activeUsers`.

## Solution

### Step 1: Go to Firebase Console
1. Open https://console.firebase.google.com/
2. Select your project: `avtotest-3d00b`
3. Click on "Realtime Database" in the left menu
4. Click on "Rules" tab

### Step 2: Update the Rules

Replace the existing rules with these:

```json
{
  "rules": {
    "activeUsers": {
      ".read": "auth != null",
      ".write": "auth != null",
      "$uid": {
        ".read": "auth != null",
        ".write": "auth != null || auth.uid == $uid"
      }
    },
    "logoutSignals": {
      ".read": "auth != null",
      ".write": "auth != null",
      "$uid": {
        ".read": "auth != null || auth.uid == $uid",
        ".write": "auth != null"
      }
    },
    "statistics": {
      ".read": "auth != null",
      ".write": "auth != null"
    },
    ".read": false,
    ".write": false
  }
}
```

### Step 3: Publish the Rules
1. Click "Publish" button
2. Wait for confirmation

### Step 4: Test
Refresh your admin panel and check if active users appear.

## Alternative: Temporary Open Rules (FOR DEVELOPMENT ONLY)

If you want to test quickly, you can use these open rules (NOT RECOMMENDED FOR PRODUCTION):

```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```

**WARNING**: These rules allow anyone to read/write. Only use for testing!

