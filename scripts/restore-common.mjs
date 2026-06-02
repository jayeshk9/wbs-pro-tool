// Restore the "Common" project (doc id: main-project) from snapshot lDxTsR1Xw122pItFGixy.
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';

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

const SNAPSHOT_ID = 'lDxTsR1Xw122pItFGixy';
const PROJECT_ID = 'main-project';

// 1. Load the snapshot
const snap = await getDoc(doc(db, 'versions', SNAPSHOT_ID));
if (!snap.exists()) { console.error('Snapshot not found!'); process.exit(1); }
const v = snap.data();
const tasks = v.tasks || [];
console.log(`Snapshot: "${v.projectName}"  reportDate=${v.reportDate}  savedAt=${v.savedAt}  tasks=${tasks.length}`);
console.log('First 6 task texts:');
tasks.slice(0, 6).forEach((t, i) => console.log(`  ${i + 1}. [L${t.level}] ${t.text}`));

if (tasks.length < 30) { console.error('Refusing: snapshot has too few tasks, aborting.'); process.exit(1); }

// 2. Restore the live tasks doc
await setDoc(doc(db, 'projects', PROJECT_ID), { tasks }, { merge: true });
console.log(`\n✓ Restored ${tasks.length} tasks to projects/${PROJECT_ID}`);

// 3. Rename the project meta back to "Common" (preserve order/createdAt via merge)
await setDoc(doc(db, 'projectsMeta', PROJECT_ID), { name: 'Common' }, { merge: true });
console.log(`✓ Renamed projectsMeta/${PROJECT_ID} back to "Common"`);

// 4. Verify
const check = await getDoc(doc(db, 'projects', PROJECT_ID));
const checkMeta = await getDoc(doc(db, 'projectsMeta', PROJECT_ID));
console.log(`\nVerify: name="${checkMeta.data().name}"  liveTasks=${(check.data().tasks || []).length}`);
process.exit(0);
