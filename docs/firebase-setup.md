# Firebase Setup Guide

This guide walks you through setting up Firebase for the Draftly application.

## 1. Create a Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click "Add Project"
3. Enter a project name (e.g., "draftly-dev" or "draftly-prod")
4. Follow the setup wizard (you can disable Google Analytics if not needed)

## 2. Set Up Authentication

1. In your Firebase project, go to "Authentication" in the sidebar
2. Click "Get Started"
3. Enable "Email/Password" authentication
4. Enable "Google" authentication
5. Add authorized domains (localhost, your staging, and production domains)

## 3. Get Firebase Config for Client SDK

1. In your Firebase project, click the gear icon next to "Project Overview"
2. Select "Project settings"
3. Scroll down to "Your apps" section
4. Click the web icon (</>) to add a web app if none exists
5. Register your app with a nickname
6. Copy the firebaseConfig object containing:
   - apiKey
   - authDomain
   - projectId
   - storageBucket
   - messagingSenderId
   - appId

## 4. Generate Firebase Admin SDK Credentials

1. In your Firebase project settings, go to "Service accounts"
2. Click "Generate new private key"
3. Save the downloaded JSON file securely
4. Extract the following values for your .env file:
   - project_id -> FIREBASE_PROJECT_ID
   - private_key_id -> FIREBASE_PRIVATE_KEY_ID
   - private_key -> FIREBASE_PRIVATE_KEY
   - client_email -> FIREBASE_CLIENT_EMAIL
   - client_id -> FIREBASE_CLIENT_ID

## 5. Environment Variables Setup

Add the following environment variables to your `.env` file:

```
# Firebase Admin SDK
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY_ID=your-private-key-id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYour Private Key Here\n-----END PRIVATE KEY-----"
FIREBASE_CLIENT_EMAIL=your-client-email@your-project-id.iam.gserviceaccount.com
FIREBASE_CLIENT_ID=your-client-id

# Firebase Client SDK
FIREBASE_API_KEY=your-api-key
FIREBASE_APP_ID=your-app-id
FIREBASE_MESSAGING_SENDER_ID=your-messaging-sender-id
```

## 6. Security Rules

Set up appropriate security rules for your Firebase services:

- Firestore/Realtime Database: Restrict access to authenticated users
- Storage: Restrict access as needed
- Functions: Configure appropriate IAM permissions

## 7. CORS Configuration

If you're using Firebase Storage or Functions, configure CORS to allow requests from your frontend:

```javascript
const cors = require('cors')({
  origin: [
    'http://localhost:3000',
    'https://your-staging-domain.com',
    'https://your-production-domain.com'
  ],
  credentials: true
});
```

## Troubleshooting

- **auth/invalid-api-key**: Ensure your FIREBASE_API_KEY environment variable is correctly set.
- **auth/invalid-credential**: Check that your private key is properly formatted (including newlines).
- **auth/project-not-found**: Verify your project ID is correct.
