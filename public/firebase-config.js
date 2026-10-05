// Firebase 設定（将来の Firestore オンライン対戦用）
// 使い方:
//   <script type="module">
//     import { initializeApp } from "https://www.gstatic.com/firebasejs/10.x/firebase-app.js";
//     import { getFirestore } from "https://www.gstatic.com/firebasejs/10.x/firebase-firestore.js";
//     import { firebaseConfig } from "./firebase-config.js";
//     const app = initializeApp(firebaseConfig);
//     const db = getFirestore(app);
//   </script>
// 現状のアプリは localStorage 動作のため、このファイルは読み込まなくても動きます。
export const firebaseConfig = {
  apiKey: "AIzaSyANq1dPOlGFpi0PfcX3ClwQn1tdkB0JO8Q",
  authDomain: "wordapp-76053.firebaseapp.com",
  projectId: "wordapp-76053",
  storageBucket: "wordapp-76053.firebasestorage.app",
  messagingSenderId: "43160312838",
  appId: "1:43160312838:web:e4d923b4326820ce903787",
  measurementId: "G-MQGS9JTG90"
};
