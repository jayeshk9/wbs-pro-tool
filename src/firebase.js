import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY || "AIzaSyBFaj0C6BspGmYaKN7l8WDEm3DsrU6qHy0",
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN || "ajmerestatewbs.firebaseapp.com",
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID || "ajmerestatewbs",
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET || "ajmerestatewbs.firebasestorage.app",
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID || "1012877588714",
  appId: process.env.REACT_APP_FIREBASE_APP_ID || "1:1012877588714:web:4222d3f6b09b82da3fbf93",
  measurementId: process.env.REACT_APP_FIREBASE_MEASUREMENT_ID || "G-7FVE8C2XF0",
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const analytics = getAnalytics(app);
