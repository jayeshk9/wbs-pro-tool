// READ-ONLY diagnostic — lists projectsMeta, projects task counts, and versions snapshots.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, getDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyBFaj0C6BspGmYaKN7l8WDEm3DsrU6qHy0',
  authDomain: 'ajmerestatewbs.firebaseapp.com',
  projectId: 'ajmerestatewbs',
  storageBucket: 'ajmerestatewbs.firebasestorage.app',
  messagingSenderId: '1012877588714',
  appId: '1:1012877588714:web:4222d3f6b09b82da3fbf93',
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

console.log('\n=== projectsMeta ===');
const metaSnap = await getDocs(collection(db, 'projectsMeta'));
for (const d of metaSnap.docs) {
  const data = d.data();
  // peek at the live tasks doc for this project
  let taskCount = 'NO DOC';
  try {
    const p = await getDoc(doc(db, 'projects', d.id));
    if (p.exists()) taskCount = (p.data().tasks || []).length + ' tasks';
  } catch (e) { taskCount = 'err'; }
  console.log(`  id=${d.id}  name=${JSON.stringify(data.name)}  order=${data.order}  live=${taskCount}`);
}

console.log('\n=== versions (snapshots, newest first) ===');
const verSnap = await getDocs(collection(db, 'versions'));
const versions = verSnap.docs
  .map(d => ({ id: d.id, ...d.data() }))
  .sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
for (const v of versions) {
  console.log(`  id=${v.id}  projectId=${v.projectId}  projectName=${JSON.stringify(v.projectName)}  reportDate=${v.reportDate}  savedAt=${v.savedAt}  tasks=${(v.tasks || []).length}`);
}

console.log(`\nTotal versions: ${versions.length}`);
process.exit(0);
