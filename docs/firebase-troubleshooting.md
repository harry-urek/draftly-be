# Firebase Authentication Troubleshooting

If you encounter the error:

```
Error [FirebaseError]: Firebase: Error (auth/invalid-api-key).
```

This guide will help you resolve it.

## Common Causes and Solutions

1. **Missing or Invalid Firebase API Key**

   The most common cause of this error is a missing or invalid Firebase API key.

   **Solution:**
   - Ensure you have set the `FIREBASE_API_KEY` environment variable in your `.env` file
   - Verify the API key is correct by checking it against your Firebase project settings

2. **Environment Variable Not Loading**

   Your application might not be loading the environment variables correctly.

   **Solution:**
   - Make sure you've copied the `.env.example` to `.env`
   - Check that `dotenv` is configured correctly
   - Run `npm run verify:firebase` to check your configuration

3. **Wrong Firebase Project**

   You might be using the API key from one project but other credentials from another.

   **Solution:**
   - Ensure all Firebase credentials are from the same project
   - Check that `FIREBASE_PROJECT_ID` matches the project your API key is from

4. **Firebase Project Settings**

   There might be restrictions in your Firebase project settings.

   **Solution:**
   - Check the authorized domains in your Firebase Authentication settings
   - Ensure your application's domain is added to the list
   - Verify IP restrictions if you've set them up

## Verifying Your Configuration

Run the verification script to check your Firebase configuration:

```
npm run verify:firebase
```

This will validate your environment variables and test Firebase initialization.

## Complete Setup Guide

For a complete guide on setting up Firebase for this project, see `docs/firebase-setup.md`.
