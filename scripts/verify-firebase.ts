/**
 * Firebase Configuration Verification Script
 * 
 * This script verifies that all required Firebase environment variables
 * are set correctly and that Firebase can be initialized.
 * 
 * Usage: npm run verify:firebase
 */

import { firebaseIntegration } from '../src/integrations/FirebaseIntegration.js';
import config from '../src/config/index.js';

async function verifyFirebaseConfig() {
  console.log('\n🔍 Verifying Firebase Configuration...\n');
  
  try {
    // Check required environment variables
    console.log('Checking environment variables:');
    
    const requiredVars = [
      { name: 'FIREBASE_PROJECT_ID', value: config.firebaseProjectId },
      { name: 'FIREBASE_PRIVATE_KEY', value: config.firebasePrivateKey?.substring(0, 15) + '...' },
      { name: 'FIREBASE_CLIENT_EMAIL', value: config.firebaseClientEmail },
      { name: 'FIREBASE_API_KEY', value: process.env.FIREBASE_API_KEY?.substring(0, 5) + '...' }
    ];
    
    let missingVars = false;
    
    for (const v of requiredVars) {
      if (!v.value) {
        console.log(`❌ ${v.name} is missing or empty`);
        missingVars = true;
      } else {
        console.log(`✅ ${v.name} is set to ${v.value}`);
      }
    }
    
    if (missingVars) {
      throw new Error('One or more required environment variables are missing');
    }
    
    // Test Firebase Admin SDK
    console.log('\nTesting Firebase Admin SDK initialization...');
    const auth = firebaseIntegration.getAdminAuth();
    console.log('✅ Firebase Admin SDK initialized successfully');
    
    // Test Firebase Client SDK if API key is present
    if (process.env.FIREBASE_API_KEY) {
      console.log('\nTesting Firebase Client SDK initialization...');
      const clientAuth = firebaseIntegration.getClientAuth();
      console.log('✅ Firebase Client SDK initialized successfully');
    }
    
    console.log('\n✅ Firebase configuration verification completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Firebase configuration verification failed:');
    console.error(error);
    process.exit(1);
  }
}

verifyFirebaseConfig();
