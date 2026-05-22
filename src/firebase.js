// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";

// THIS IS THE LINE YOU WERE MISSING:
import { getFirestore } from "firebase/firestore"; 

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBFaj0C6BspGmYaKN7l8WDEm3DsrU6qHy0",
  authDomain: "ajmerestatewbs.firebaseapp.com",
  projectId: "ajmerestatewbs",
  storageBucket: "ajmerestatewbs.firebasestorage.app",
  messagingSenderId: "1012877588714",
  appId: "1:1012877588714:web:4222d3f6b09b82da3fbf93",
  measurementId: "G-7FVE8C2XF0"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firestore and Analytics
export const db = getFirestore(app);
export const analytics = getAnalytics(app);