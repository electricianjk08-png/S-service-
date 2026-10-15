// Firebase configuration: replace every placeholder with values from Firebase Console.
// Firebase Console > Project settings > Your apps > Web app config.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDb1krUYmijVF0WPUbd7m7C8cxxAn1x_Gk",
  authDomain: "fir-service-f9824.firebaseapp.com",
  projectId: "fir-service-f9824",
  storageBucket: "fir-service-f9824.firebasestorage.app",
  messagingSenderId: "565734633427",
  appId: "1:565734633427:web:fdde61bbdc60690188c926",
  measurementId: "G-R4VNDQD4YJ"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
